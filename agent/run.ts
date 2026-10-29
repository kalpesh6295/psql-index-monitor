// Index Doctor agent: triage -> per-finding verification -> remediation plan.
//
//   tsx agent/run.ts
//
// Phase 1 (triage): one call over the same collector snapshot the dashboard
//   shows, plus pg_stat_statements. Produces candidate findings to verify.
// Phase 2 (verify): each candidate gets a fresh verifier conversation with
//   read-only tools (EXPLAIN, HypoPG, index inspection, the app query catalog).
//   The verifier must attach tool-derived evidence or reject the candidate.
// Phase 3 (plan): verdicts are composed into eval/results/agent.json and a
//   human-readable REPORT.md. Nothing is executed — apply.ts does that later,
//   behind human approval, against a cloned database.
//
// Every phase logs a full trajectory to eval/trajectories/<run>/.

import 'dotenv/config'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { queries } from '../server/queries.js'
import { isSandboxUrl, maskUrl, requireTargetUrl, resultsDirFor } from '../shared/db.js'
import type { Plan } from '../shared/plan.js'
import { createPool, createTools, type TrajectoryLogger } from './tools.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB_URL = requireTargetUrl('index-doctor agent')
// The bundled query catalog describes the SANDBOX's application. Against any
// other database it would be misleading, so it must be configured explicitly.
const IS_SANDBOX_DB = isSandboxUrl(DB_URL)
const CATALOG_DIR = process.env.QUERY_CATALOG_DIR || (IS_SANDBOX_DB ? join(ROOT, 'eval', 'sandbox', 'queries') : null)
const MODEL = process.env.AGENT_MODEL || 'claude-opus-5'
const MAX_VERIFY_ITERATIONS = 14

const client = new Anthropic()
const pool = createPool(DB_URL)

const runId = new Date().toISOString().replace(/[:.]/g, '-')
// Non-sandbox targets may expose private schemas: their artifacts (results
// AND trajectories) are routed to the gitignored eval/local-private.
const RESULTS_DIR = resultsDirFor(ROOT, DB_URL)
const trajDir = IS_SANDBOX_DB
  ? join(ROOT, 'eval', 'trajectories', runId)
  : join(ROOT, 'eval', 'local-private', 'trajectories', runId)
mkdirSync(trajDir, { recursive: true })
mkdirSync(RESULTS_DIR, { recursive: true })

function makeLogger(file: string): TrajectoryLogger {
  const path = join(trajDir, file)
  return (entry) => appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
}

// Pricing per MTok [input, output, cache-read]; unknown models fall back to
// the claude-opus-5 rates.
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5': [5, 25, 0.5],
  'claude-sonnet-5': [3, 15, 0.3],
  'claude-haiku-4-5': [1, 5, 0.1],
}
const usage = { input: 0, output: 0, cacheRead: 0 }
function addUsage(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  usage.input += u.input_tokens
  usage.output += u.output_tokens
  usage.cacheRead += u.cache_read_input_tokens ?? 0
}
const estimatedCostUsd = () => {
  const [pin, pout, pcache] = PRICES[MODEL] ?? PRICES['claude-opus-5']
  return (usage.input * pin + usage.output * pout + usage.cacheRead * pcache) / 1e6
}

// ---------------------------------------------------------------------------
// Instruments: real databases often lack the optional extensions. The agent
// must degrade gracefully — verify with what exists, lower confidence, and
// say which instrument would have given decisive evidence.
// ---------------------------------------------------------------------------
async function detectInstruments() {
  const res = await pool.query(
    `SELECT extname FROM pg_extension WHERE extname IN ('pg_stat_statements', 'hypopg', 'pgstattuple')`,
  )
  const installed = new Set<string>(res.rows.map((r) => r.extname))
  return {
    pg_stat_statements: installed.has('pg_stat_statements'),
    hypopg: installed.has('hypopg'),
    pgstattuple: installed.has('pgstattuple'),
  }
}

function instrumentsNote(inst: Awaited<ReturnType<typeof detectInstruments>>): string {
  const missing = Object.entries(inst)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)
  return [
    `Instrument availability on this database: hypopg=${inst.hypopg}, pg_stat_statements=${inst.pg_stat_statements}, pgstattuple=${inst.pgstattuple}, app_query_catalog=${CATALOG_DIR ? 'configured' : 'not configured'}.`,
    missing.length || !CATALOG_DIR
      ? `Where an instrument is unavailable: verify by other means (EXPLAIN with representative literal values, pg_catalog/pg_stats inspection), lower confidence accordingly, be extra conservative with drop_index (a zero scan count alone never justifies a drop), and when an unavailable instrument would have provided decisive evidence, say so in risk_notes (e.g. suggest CREATE EXTENSION hypopg for planner-verified index testing).`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Snapshot: the exact same data the dashboard renders.
// ---------------------------------------------------------------------------
async function collectSnapshot() {
  const q = async (sql: string) => (await pool.query(sql)).rows
  const [overview, allIndexes, unused, tableSizes, bloat, duplicates, seqVsIdx, missing, writeOverhead, idxRatio] =
    await Promise.all([
      q(queries.overview),
      q(queries.allIndexes),
      q(queries.unusedIndexes),
      q(queries.tableSizes),
      q(queries.indexBloat),
      q(queries.duplicateIndexes),
      q(queries.indexVsSeqScan),
      q(queries.missingIndexes),
      q(queries.writeOverhead),
      q(queries.indexTableRatio),
    ])
  return { overview: overview[0], allIndexes, unused, tableSizes, bloat, duplicates, seqVsIdx, missing, writeOverhead, idxRatio }
}

// ---------------------------------------------------------------------------
// Phase 1: triage
// ---------------------------------------------------------------------------
const CandidateSchema = z.object({
  id: z.string().describe('short id like C1, C2...'),
  table: z.string(),
  hypothesis: z.enum(['add_index', 'drop_index', 'reindex', 'vacuum', 'healthy_check']),
  index: z.string().optional().describe('target index name for drop/reindex'),
  columns: z.array(z.string()).optional().describe('candidate columns for add_index'),
  rationale: z.string().describe('why this is worth verifying, citing the snapshot numbers'),
})
type Candidate = z.infer<typeof CandidateSchema>

const TRIAGE_SYSTEM = `You are Index Doctor, a senior PostgreSQL performance engineer.
You receive a monitoring snapshot (pg_stat_* views) plus pg_stat_statements totals for a database.
Your job in this phase is TRIAGE ONLY: enumerate candidate findings that a verifier will then prove or refute with tools.

Rules:
- Cover every plausible issue: missing indexes (including ones invisible to seq-scan counters but visible as expensive statements), unused indexes, duplicate indexes, bloated indexes, tables needing vacuum.
- Statistics can mislead. An index with zero scans in a short window is NOT proven droppable; a table with many seq scans does NOT necessarily need an index. Raise these as candidates anyway — the verifier decides.
- The snapshot's bloat estimator is unreliable for narrow deduplicated btrees: also raise a reindex candidate for any used index whose size looks large for its table's live row count (the verifier can measure exactly).
- Also include a healthy_check candidate for anything that looks suspicious but is probably fine, so it gets cleared explicitly.
- Do NOT include generic advisories (over-indexing reviews, HOT-update ratios) unless a concrete action could follow.
- Submit via submit_triage exactly once.`

async function triage(snapshot: unknown, queryStats: string, capsNote: string): Promise<Candidate[]> {
  const log = makeLogger('1-triage.jsonl')
  let captured: Candidate[] | null = null
  const submitTriage = betaZodTool({
    name: 'submit_triage',
    description: 'Submit the final list of candidate findings to verify.',
    inputSchema: z.object({ candidates: z.array(CandidateSchema).min(1).max(16) }),
    run: async ({ candidates }) => {
      captured = candidates
      log({ type: 'triage_submitted', candidates })
      return 'Triage recorded. You are done — do not call any more tools.'
    },
  })

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: TRIAGE_SYSTEM,
    tools: [submitTriage],
    messages: [
      {
        role: 'user',
        content: `${capsNote}\n\nMonitoring snapshot:\n${JSON.stringify(snapshot)}\n\nTop statements by total execution time (pg_stat_statements):\n${queryStats}`,
      },
    ],
  })
  for await (const message of runner) {
    addUsage(message.usage)
    log({ type: 'assistant', content: message.content, stop_reason: message.stop_reason })
    if (captured) break
  }
  if (!captured) throw new Error('Triage did not produce candidates')
  return captured
}

// ---------------------------------------------------------------------------
// Phase 2: verification
// ---------------------------------------------------------------------------
const VerdictSchema = z.object({
  candidate_id: z.string(),
  verdict: z.enum(['confirmed', 'modified', 'rejected']),
  action: z.enum(['add_index', 'drop_index', 'reindex', 'vacuum', 'keep', 'no_action']),
  table: z.string(),
  index: z.string().optional().describe('exact index name for drop/reindex/keep'),
  columns: z.array(z.string()).optional().describe('exact columns for add_index'),
  ddl: z.string().optional().describe('production-safe DDL to execute (e.g. CREATE INDEX CONCURRENTLY ...)'),
  rollback: z.string().optional().describe('how to undo the action'),
  severity: z.enum(['critical', 'warning', 'info']),
  evidence: z.array(z.string()).min(1).describe('specific tool-derived facts backing the verdict'),
  risk_notes: z.string().describe('what could go wrong and why it is acceptable, or why the candidate was rejected'),
  confidence: z.enum(['high', 'medium', 'low']),
})
type Verdict = z.infer<typeof VerdictSchema>

const VERIFY_SYSTEM = `You are the verification stage of Index Doctor, a skeptical senior PostgreSQL engineer.
You receive ONE candidate finding. Prove it, correct it, or refute it using the tools. Never trust the triage rationale — gather your own evidence.

Verification requirements by hypothesis:
- add_index: identify the exact query pattern that would benefit (get_query_stats / the app catalog), then run test_hypothetical_index. Only confirm if the planner actually chooses the hypothetical index and the cost improvement is meaningful. Pick the best column set/order yourself — test alternatives if unsure. If no index changes the plan, reject with action no_action and say what would actually help.
- drop_index: run inspect_index (constraints, uniqueness, partial predicate), then check list_app_queries for ANY query — including rare scheduled jobs — that needs it (match on table, columns in WHERE/ORDER BY, and partial predicates). A zero scan count in a short window is not sufficient evidence on its own. For duplicate indexes, confirm the definitions are truly redundant and name which one to drop. If the index must stay, use action keep.
- reindex: measure exact bloat with run_sql on pgstatindex('index_name') AND confirm the index is actually used (a bloated unused index should be dropped instead). Calibration: a live btree normally sits at 65-75% avg_leaf_density — that is healthy fill, NOT bloat. Only recommend reindex when density is clearly below ~55%, or the index holds several times more pages than its live entry count needs. When in doubt, no_action.
- vacuum: confirm dead-row ratio and table size justify it; note autovacuum settings (run_sql on pg_class.reloptions / pg_stat_user_tables).
- healthy_check: verify the object is actually fine and submit action no_action (or the appropriate action if it is NOT fine).

Always finish with exactly one submit_verdict call. Evidence entries must be concrete facts from tool output (plan excerpts, costs, scan counts, matching catalog queries), never restatements of the hypothesis. DDL must be production-safe (CREATE INDEX CONCURRENTLY, DROP INDEX CONCURRENTLY, REINDEX INDEX CONCURRENTLY) and include a rollback.`

async function verify(candidate: Candidate, index: number, capsNote: string): Promise<Verdict | null> {
  const log = makeLogger(`2-verify-${candidate.id}.jsonl`)
  log({ type: 'candidate', candidate })
  let captured: Verdict | null = null
  const submitVerdict = betaZodTool({
    name: 'submit_verdict',
    description: 'Submit the final verdict for this candidate.',
    inputSchema: VerdictSchema,
    run: async (verdict) => {
      captured = verdict
      log({ type: 'verdict_submitted', verdict })
      return 'Verdict recorded. You are done — do not call any more tools.'
    },
  })

  const tools = [...createTools(pool, CATALOG_DIR, log), submitVerdict]
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    system: VERIFY_SYSTEM,
    tools,
    messages: [{ role: 'user', content: `${capsNote}\n\nCandidate finding #${index + 1}:\n${JSON.stringify(candidate, null, 2)}` }],
  })
  let iterations = 0
  for await (const message of runner) {
    addUsage(message.usage)
    log({ type: 'assistant', content: message.content, stop_reason: message.stop_reason })
    if (captured) break
    if (++iterations >= MAX_VERIFY_ITERATIONS) {
      log({ type: 'aborted', reason: 'max iterations reached without verdict' })
      break
    }
  }
  return captured
}

// ---------------------------------------------------------------------------
// Phase 3: compose plan + report
// ---------------------------------------------------------------------------
async function writeReport(verdicts: Verdict[], snapshotOverview: unknown): Promise<string> {
  const log = makeLogger('3-report.jsonl')
  log({ type: 'report_input', verdicts })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system:
      'You are Index Doctor. Write the final remediation report in Markdown for the engineer who owns this database. Lead with a summary table of recommended actions ordered by severity, then one section per action with: exact DDL, rollback, the evidence, and risk notes. Include a final section for items examined and deliberately left alone (with why — these prevent bad changes). Be precise and quantitative; no filler.',
    messages: [
      {
        role: 'user',
        content: `Database overview: ${JSON.stringify(snapshotOverview)}\n\nVerified verdicts:\n${JSON.stringify(verdicts, null, 2)}`,
      },
    ],
  })
  addUsage(response.usage)
  log({ type: 'assistant', content: response.content, stop_reason: response.stop_reason })
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

async function main() {
  console.log(`Index Doctor — model ${MODEL}, db ${maskUrl(DB_URL)}`)
  console.log(`Trajectories: ${trajDir}`)

  console.log('\n[1/3] Collecting snapshot + triage...')
  const instruments = await detectInstruments()
  const capsNote = instrumentsNote(instruments)
  console.log(`  ${capsNote.split('\n')[0]}`)
  const snapshot = await collectSnapshot()
  const queryStats = instruments.pg_stat_statements
    ? JSON.stringify(
        (
          await pool.query(`
            SELECT left(query, 300) AS query, calls, round(mean_exec_time::numeric,1) AS mean_ms, round(total_exec_time::numeric) AS total_ms
            FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            ORDER BY total_exec_time DESC LIMIT 20`)
        ).rows,
      )
    : 'pg_stat_statements is not installed on this database — statement-level timings are unavailable.'
  const candidates = await triage(snapshot, queryStats, capsNote)
  console.log(`  ${candidates.length} candidates: ${candidates.map((c) => `${c.id}:${c.hypothesis}(${c.table})`).join(', ')}`)

  console.log('\n[2/3] Verifying candidates (concurrency 3)...')
  const verdicts: Verdict[] = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < candidates.length) {
        const i = cursor++
        // One candidate failing (API error, dropped connection) must not sink
        // the run — report it and keep verifying the rest.
        try {
          const v = await verify(candidates[i], i, capsNote)
          if (v) {
            verdicts.push(v)
            console.log(`  ${candidates[i].id} -> ${v.verdict}/${v.action} (${v.table}${v.index ? '.' + v.index : ''})`)
          } else {
            console.log(`  ${candidates[i].id} -> NO VERDICT (aborted)`)
          }
        } catch (err) {
          console.log(`  ${candidates[i].id} -> FAILED: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }),
  )

  console.log('\n[3/3] Composing plan + report...')
  const actionable = verdicts.filter((v) => ['add_index', 'drop_index', 'reindex', 'vacuum'].includes(v.action))
  const cleared = verdicts.filter((v) => ['keep', 'no_action'].includes(v.action))
  const plan: Plan = {
    tool: 'index-doctor-agent',
    model: MODEL,
    run_id: runId,
    generated_at: new Date().toISOString(),
    usage: { ...usage, estimated_cost_usd: +estimatedCostUsd().toFixed(2) },
    recommendations: actionable.map((v) => ({
      action: v.action as 'add_index' | 'drop_index' | 'reindex' | 'vacuum',
      table: v.table,
      candidate_id: v.candidate_id,
      index_candidates: v.index ? [v.index] : undefined,
      columns: v.columns,
      ddl: v.ddl,
      rollback: v.rollback,
      severity: v.severity,
      reason: v.risk_notes,
      evidence: v.evidence,
      confidence: v.confidence,
    })),
    cleared: cleared.map((v) => ({ action: v.action, table: v.table, candidate_id: v.candidate_id, index: v.index, evidence: v.evidence, reason: v.risk_notes })),
  }
  const planPath = join(RESULTS_DIR, 'agent.json')
  writeFileSync(planPath, JSON.stringify(plan, null, 2))

  const report = await writeReport(verdicts, snapshot.overview)
  const reportPath = join(RESULTS_DIR, 'REPORT.md')
  writeFileSync(reportPath, report)
  if (!IS_SANDBOX_DB) console.log('  (non-sandbox target: artifacts routed to gitignored eval/local-private)')

  console.log(`\nDone. ${actionable.length} recommendations, ${cleared.length} cleared items.`)
  console.log(`  tokens: ${usage.input} in / ${usage.output} out / ${usage.cacheRead} cache-read (~$${estimatedCostUsd().toFixed(2)})`)
  console.log(`  plan:   ${planPath}`)
  console.log(`  report: ${reportPath}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
