// Doctor API: powers the dashboard's "Doctor" tab.
//
// Serves the agent/baseline plans and scores, exposes the target-database
// connection, and can launch the baseline or the Index Doctor agent as a
// child process, streaming its progress. The agent itself remains read-only
// against the target database (see agent/tools.ts); nothing here executes DDL.

import { Router } from 'express'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDatabaseUrl } from './db.js'
import { scoreTool } from '../eval/score-lib.js'
import { isSandboxUrl, maskUrl, resultsDirFor } from '../shared/db.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Sandbox artifacts live in eval/results; other targets' artifacts are routed
// to the gitignored eval/local-private. Serve whichever matches the current
// connection so the UI always shows the plan for the database it's looking at.
const resultsDir = () => resultsDirFor(ROOT, getDatabaseUrl())
// Ground-truth scoring only ever applies to sandbox artifacts.
const SANDBOX_RESULTS = join(ROOT, 'eval', 'results')

interface RunState {
  kind: 'agent' | 'baseline' | null
  running: boolean
  log: string[]
  startedAt: string | null
  exitCode: number | null
}
const run: RunState = { kind: null, running: false, log: [], startedAt: null, exitCode: null }

function launch(kind: 'agent' | 'baseline') {
  run.kind = kind
  run.running = true
  run.log = []
  run.startedAt = new Date().toISOString()
  run.exitCode = null
  const script = kind === 'agent' ? 'agent/run.ts' : 'eval/baseline/run.ts'
  const child = spawn('npx', ['tsx', script], {
    cwd: ROOT,
    env: { ...process.env, SANDBOX_DATABASE_URL: getDatabaseUrl() },
  })
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) run.log.push(line)
    }
    if (run.log.length > 500) run.log = run.log.slice(-500)
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('close', (code) => {
    run.running = false
    run.exitCode = code
  })
}

function readJsonIfExists(path: string): unknown | null {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

export const doctorRouter = Router()

doctorRouter.get('/api/doctor/connection', (_req, res) => {
  res.json({ url: maskUrl(getDatabaseUrl()) })
})

doctorRouter.post('/api/doctor/run/:kind', (req, res) => {
  const kind = req.params.kind
  if (kind !== 'agent' && kind !== 'baseline') {
    res.status(400).json({ error: 'kind must be agent or baseline' })
    return
  }
  if (!getDatabaseUrl()) {
    res.status(400).json({ error: 'no database configured — set DATABASE_URL in .env and restart' })
    return
  }
  if (run.running) {
    res.status(409).json({ error: `${run.kind} run already in progress` })
    return
  }
  launch(kind)
  res.json({ ok: true, kind })
})

doctorRouter.get('/api/doctor/status', (_req, res) => {
  res.json(run)
})

doctorRouter.get('/api/doctor/plan/:tool', (req, res) => {
  const file = req.params.tool === 'agent' ? 'agent.json' : req.params.tool === 'baseline' ? 'baseline.json' : null
  if (!file) {
    res.status(400).json({ error: 'tool must be agent or baseline' })
    return
  }
  const plan = readJsonIfExists(join(resultsDir(), file))
  if (!plan) {
    res.status(404).json({ error: `${file} not found — run the ${req.params.tool} first` })
    return
  }
  res.json(plan)
})

doctorRouter.get('/api/doctor/report', (_req, res) => {
  const path = join(resultsDir(), 'REPORT.md')
  if (!existsSync(path)) {
    res.status(404).json({ error: 'REPORT.md not found — run the agent first' })
    return
  }
  res.json({ markdown: readFileSync(path, 'utf8') })
})

// Evidence trail: the verification trajectory for one plan item — every tool
// call the verifier made and the verdict it submitted, straight from the
// run's JSONL logs. Trajectories follow the same sandbox/local-private
// routing as results.
doctorRouter.get('/api/doctor/evidence/:candidateId', (req, res) => {
  const id = req.params.candidateId
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) {
    res.status(400).json({ error: 'invalid candidate id' })
    return
  }
  const base = isSandboxUrl(getDatabaseUrl())
    ? join(ROOT, 'eval', 'trajectories')
    : join(ROOT, 'eval', 'local-private', 'trajectories')
  if (!existsSync(base)) {
    res.status(404).json({ error: 'no trajectories recorded yet' })
    return
  }
  // Prefer the exact run that produced the shown plan; fall back to newest.
  const plan = readJsonIfExists(join(resultsDir(), 'agent.json')) as { run_id?: string } | null
  const runs = readdirSync(base).sort().reverse()
  if (plan?.run_id && runs.includes(plan.run_id)) {
    runs.splice(runs.indexOf(plan.run_id), 1)
    runs.unshift(plan.run_id)
  }
  for (const run of runs) {
    const file = join(base, run, `2-verify-${id}.jsonl`)
    if (!existsSync(file)) continue
    const CAP = 1600
    const entries = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.type === 'tool_call' || e.type === 'verdict_submitted')
      .map((e) =>
        e.type === 'tool_call'
          ? {
              type: 'tool_call',
              tool: e.tool,
              input: JSON.stringify(e.input).slice(0, CAP),
              output: String(e.output).slice(0, CAP) + (String(e.output).length > CAP ? '\n… (truncated)' : ''),
            }
          : { type: 'verdict', verdict: e.verdict },
      )
    res.json({ run, entries })
    return
  }
  res.status(404).json({ error: `no verification trajectory found for ${id}` })
})

// Ground-truth scores — meaningful only against the eval sandbox, so the
// response says whether the current connection IS the sandbox and the UI
// hides the scoreboard elsewhere.
doctorRouter.get('/api/doctor/scores', (_req, res) => {
  const score = (file: string) => {
    const path = join(SANDBOX_RESULTS, file)
    if (!existsSync(path)) return null
    try {
      return scoreTool(path)
    } catch {
      return null
    }
  }
  const sandbox = isSandboxUrl(getDatabaseUrl())
  res.json({ sandbox, agent: score('agent.json'), baseline: score('baseline.json') })
})
