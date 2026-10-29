// Applies a remediation plan to a CLONE of the sandbox database, after human
// approval, then measures workload latency on the clone.
//
//   tsx eval/apply.ts eval/results/agent.json agent
//   tsx eval/apply.ts eval/results/baseline.json baseline
//   tsx eval/apply.ts --none before          (no plan: clone + measure only)
//
// The original database is never modified — not even by measurement, which
// would pollute its scan counters (the whole point of the stats window is that
// the dunning job has zero scans in it). The plan runs against
// indexdoctor_<name>, created fresh from TEMPLATE indexdoctor. If a
// recommendation carries no executable DDL (e.g. the heuristic baseline's
// "add index" items, which never identify columns), it is skipped and reported.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { execFileSync } from 'node:child_process'
import { Client } from 'pg'
import { isSandboxUrl, maskUrl, requireTargetUrl } from '../shared/db.js'
import type { Recommendation as Rec } from '../shared/plan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = requireTargetUrl('apply')

function synthesizeDdl(rec: Rec): string[] | null {
  if (rec.ddl) return [rec.ddl.replace(/;\s*$/, '')]
  switch (rec.action) {
    case 'drop_index':
      if (!rec.index_candidates?.length) return null
      // Duplicate-group items say "drop all but one": keep the first.
      return rec.index_candidates.length > 1
        ? rec.index_candidates.slice(1).map((i) => `DROP INDEX ${i}`)
        : [`DROP INDEX ${rec.index_candidates[0]}`]
    case 'reindex':
      return rec.index_candidates?.length ? [`REINDEX INDEX ${rec.index_candidates[0]}`] : null
    case 'vacuum':
      return rec.table ? [`VACUUM ANALYZE ${rec.table}`] : null
    default:
      return null // add_index without DDL cannot be executed
  }
}

async function main() {
  const [planPath, name] = process.argv.slice(2)
  if (!planPath || !name) {
    console.error('usage: tsx eval/apply.ts <plan.json | --none> <clone-name>')
    process.exit(1)
  }
  // HARD GUARD: apply clones the database on the SAME server and terminates
  // every connection to the source to do it. That is only ever acceptable on
  // the eval sandbox — never on a shared/staging/production server.
  if (!isSandboxUrl(BASE_URL)) {
    console.error(
      `Refusing to run: SANDBOX_DATABASE_URL points at "${maskUrl(BASE_URL)}", not the eval sandbox (database "indexdoctor").\n` +
        'apply.ts terminates connections on the source database and copies it — sandbox only.\n' +
        'On a real database, execute the plan\'s DDL yourself through your normal change process.',
    )
    process.exit(1)
  }
  const plan =
    planPath === '--none'
      ? { tool: 'unmodified', recommendations: [] as Rec[] }
      : (JSON.parse(readFileSync(planPath, 'utf8')) as { tool: string; recommendations: Rec[] })
  const cloneDb = `indexdoctor_${name}`

  const statements: { rec: Rec; sql: string }[] = []
  const skipped: { rec: Rec; why: string }[] = []
  for (const rec of plan.recommendations) {
    const ddl = synthesizeDdl(rec)
    if (ddl) ddl.forEach((sql) => statements.push({ rec, sql: sql.replace(/\bCONCURRENTLY\b\s*/gi, '') }))
    else skipped.push({ rec, why: 'no executable DDL (action/columns not specified by the tool)' })
  }

  console.log(`Plan: ${plan.tool} -> clone database "${cloneDb}"`)
  console.log(`\nStatements to execute (${statements.length}):`)
  statements.forEach((s, i) => console.log(`  ${i + 1}. ${s.sql};`))
  if (skipped.length) {
    console.log(`\nSkipped — not executable (${skipped.length}):`)
    skipped.forEach((s) => console.log(`  - [${s.rec.action}] ${s.rec.table}: ${s.why}`))
  }

  if (statements.length > 0) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`\nApply these ${statements.length} statements to ${cloneDb}? [y/N] `)
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted — nothing was executed.')
      process.exit(0)
    }
  }

  const adminUrl = BASE_URL.replace(/\/[^/]+$/, '/postgres')
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  console.log(`\nCreating ${cloneDb} from template...`)
  await admin.query(`DROP DATABASE IF EXISTS ${cloneDb} WITH (FORCE)`)
  // Template copy requires no active connections on the source.
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'indexdoctor' AND pid <> pg_backend_pid()`)
  await admin.query(`CREATE DATABASE ${cloneDb} TEMPLATE indexdoctor`)
  await admin.end()

  const cloneUrl = BASE_URL.replace(/\/[^/]+$/, `/${cloneDb}`)
  const clone = new Client({ connectionString: cloneUrl })
  await clone.connect()
  const applied: string[] = []
  const failed: { sql: string; error: string }[] = []
  for (const s of statements) {
    try {
      await clone.query(s.sql)
      applied.push(s.sql)
      console.log(`  ok: ${s.sql}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ sql: s.sql, error: msg })
      console.log(`  FAILED: ${s.sql} — ${msg}`)
    }
  }
  await clone.end()

  console.log('\nMeasuring workload latency on the clone...')
  const out = execFileSync('npx', ['tsx', join(ROOT, 'eval', 'sandbox', 'workload.ts'), '--measure', '--db', cloneUrl], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  mkdirSync(join(ROOT, 'eval', 'results'), { recursive: true })
  const resultPath = join(ROOT, 'eval', 'results', `measure-${name}.json`)
  writeFileSync(resultPath, JSON.stringify({ plan: plan.tool, clone: cloneDb, applied, failed, skipped: skipped.map((s) => s.rec), measurement: JSON.parse(out) }, null, 2))
  console.log(`\nSaved: ${resultPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
