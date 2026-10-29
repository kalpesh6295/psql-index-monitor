// Workload driver for the Index Doctor sandbox.
//
//   tsx sandbox/workload.ts                  — run the full stats window (~13k queries)
//   tsx sandbox/workload.ts --measure        — measure per-query latency, print JSON
//   tsx sandbox/workload.ts --measure --db postgres://...  — measure against a clone
//
// Query texts live in sandbox/queries/*.sql (one file per application query).

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDbPool, requireTargetUrl } from '../../shared/db.js'
import type { Pool } from 'pg'

const QUERIES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'queries')

// Deterministic PRNG so every seeded sandbox sees the same workload.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
const md5 = (s: string) => createHash('md5').update(s).digest('hex')

const COUNTRIES = ['US', 'GB', 'DE', 'IN', 'BR', 'JP']

interface QuerySpec {
  file: string
  calls: number // calls during the stats window (0 = never runs in-window)
  params: () => unknown[]
}

const SPECS: QuerySpec[] = [
  { file: 'orders_by_user.sql', calls: 1200, params: () => [randInt(1, 200000)] },
  { file: 'events_recent_by_user.sql', calls: 400, params: () => [randInt(1, 200000)] },
  { file: 'page_views_daily_rollup.sql', calls: 600, params: () => [] },
  { file: 'page_views_by_site.sql', calls: 600, params: () => [randInt(1, 2)] },
  { file: 'user_by_email.sql', calls: 2000, params: () => [`user${randInt(1, 200000)}@example.com`] },
  { file: 'users_by_country.sql', calls: 300, params: () => [pick(COUNTRIES)] },
  { file: 'session_by_token.sql', calls: 2000, params: () => [md5(`${randInt(1, 150000)}session-salt`)] },
  { file: 'sessions_by_user.sql', calls: 500, params: () => [randInt(1, 200000)] },
  { file: 'order_items_by_order.sql', calls: 1500, params: () => [randInt(1, 300000)] },
  { file: 'product_by_sku.sql', calls: 800, params: () => [`SKU-${String(randInt(1, 600000)).padStart(8, '0')}`] },
  { file: 'products_by_ids.sql', calls: 400, params: () => [[randInt(1, 800000), randInt(1, 800000), randInt(1, 800000)]] },
  { file: 'messages_by_thread.sql', calls: 800, params: () => [randInt(1, 50000)] },
  { file: 'messages_by_sender.sql', calls: 600, params: () => [randInt(1, 200000)] },
  { file: 'invoices_by_user.sql', calls: 800, params: () => [randInt(1, 200000)] },
  { file: 'orders_recent.sql', calls: 300, params: () => [] },
  { file: 'audit_by_actor.sql', calls: 300, params: () => [randInt(1, 200000)] },
  { file: 'dunning_job.sql', calls: 0, params: () => [] },
]

function loadSql(file: string): string {
  return readFileSync(join(QUERIES_DIR, file), 'utf8')
}

async function runWindow(pool: Pool) {
  const jobs: { sql: string; params: unknown[] }[] = []
  for (const spec of SPECS) {
    const sql = loadSql(spec.file)
    for (let i = 0; i < spec.calls; i++) jobs.push({ sql, params: spec.params() })
  }
  // Deterministic shuffle
  for (let i = jobs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[jobs[i], jobs[j]] = [jobs[j], jobs[i]]
  }

  console.log(`Running stats window: ${jobs.length} queries...`)
  const started = Date.now()
  let done = 0
  const CONCURRENCY = 8
  let cursor = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++]
        await pool.query(job.sql, job.params)
        if (++done % 2000 === 0) console.log(`  ${done}/${jobs.length}`)
      }
    }),
  )
  console.log(`Stats window complete in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

async function measure(pool: Pool) {
  const WARMUP = 3
  const TIMED = 15
  const results: { query: string; mean_ms: number; p50_ms: number; runs: number }[] = []
  for (const spec of SPECS) {
    const sql = loadSql(spec.file)
    // Fixed params per query so before/after comparisons measure the same work
    const paramSets = Array.from({ length: WARMUP + TIMED }, () => spec.params())
    const times: number[] = []
    for (let i = 0; i < WARMUP + TIMED; i++) {
      const t0 = process.hrtime.bigint()
      await pool.query(sql, paramSets[i])
      const ms = Number(process.hrtime.bigint() - t0) / 1e6
      if (i >= WARMUP) times.push(ms)
    }
    times.sort((a, b) => a - b)
    results.push({
      query: spec.file,
      mean_ms: +(times.reduce((s, t) => s + t, 0) / times.length).toFixed(2),
      p50_ms: +times[Math.floor(times.length / 2)].toFixed(2),
      runs: TIMED,
    })
  }
  const totalWindowMs = results.reduce((s, r) => {
    const spec = SPECS.find((x) => x.file === r.query)!
    return s + r.mean_ms * spec.calls
  }, 0)
  console.log(JSON.stringify({ queries: results, projected_window_ms: Math.round(totalWindowMs) }, null, 2))
}

async function main() {
  const args = process.argv.slice(2)
  const dbFlag = args.indexOf('--db')
  const url = dbFlag >= 0 ? args[dbFlag + 1] : requireTargetUrl('workload')
  const pool = createDbPool(url, { max: 8 })
  try {
    if (args.includes('--measure')) await measure(pool)
    else await runWindow(pool)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
