// BASELINE: the pre-existing heuristic rules from the dashboard, as a CLI.
//
// This is a verbatim port of computeActions() in client/src/components/ActionItems.tsx
// (same thresholds, same conditions), reading from the same collector queries in
// server/queries.ts. It exists so the heuristics can be scored against
// sandbox/ground-truth.json on identical terms with the agent.
//
//   tsx baseline/run.ts        -> writes eval/results/baseline.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { queries } from '../../server/queries.js'
import { createDbPool, maskUrl, requireTargetUrl, resultsDirFor } from '../../shared/db.js'
import type { Plan, Recommendation } from '../../shared/plan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const url = requireTargetUrl('baseline')

const n = (v: unknown) => Number(v)

async function main() {
  const pool = createDbPool(url, { readOnly: true, statementTimeout: '30s', max: 4 })
  const [unused, bloat, duplicates, tableSizes, writeOverhead, idxRatio, missing] = await Promise.all([
    pool.query(queries.unusedIndexes),
    pool.query(queries.indexBloat),
    pool.query(queries.duplicateIndexes),
    pool.query(queries.tableSizes),
    pool.query(queries.writeOverhead),
    pool.query(queries.indexTableRatio),
    pool.query(queries.missingIndexes),
  ])
  await pool.end()

  const recs: Recommendation[] = []

  // -- unused indexes (ActionItems.tsx: large -> per-index critical drop,
  //    small -> one aggregate warning that names no table/index)
  const largeUnused = unused.rows.filter((u) => n(u.index_size_bytes) > 10 * 1024 * 1024)
  const smallUnused = unused.rows.filter((u) => n(u.index_size_bytes) <= 10 * 1024 * 1024)
  for (const idx of largeUnused) {
    recs.push({
      action: 'drop_index',
      table: idx.table_name,
      index_candidates: [idx.index_name],
      severity: 'critical',
      reason: `Zero scans on table "${idx.table_name}". Reclaim ${idx.index_size}.`,
    })
  }
  if (smallUnused.length > 0) {
    recs.push({
      action: 'drop_index',
      table: '',
      severity: 'warning',
      reason: `${smallUnused.length} small unused indexes (aggregate item — no specific index named). Tables: ${[
        ...new Set(smallUnused.map((s) => s.table_name)),
      ].join(', ')}`,
    })
  }

  // -- duplicate indexes
  for (const dup of duplicates.rows) {
    recs.push({
      action: 'drop_index',
      table: dup.table_name,
      index_candidates: dup.index_names as string[],
      severity: 'critical',
      reason: `Duplicate indexes on (${dup.index_columns}) — drop all but one.`,
    })
  }

  // -- bloat
  for (const b of bloat.rows) {
    if (n(b.bloat_pct) > 50 && n(b.bloat_size_bytes) > 50 * 1024 * 1024) {
      recs.push({
        action: 'reindex',
        table: b.table_name,
        index_candidates: [b.index_name],
        severity: 'critical',
        reason: `${b.bloat_pct}% bloated, reclaim ~${b.bloat_size}.`,
      })
    } else if (n(b.bloat_pct) > 30) {
      recs.push({
        action: 'reindex',
        table: b.table_name,
        index_candidates: [b.index_name],
        severity: 'warning',
        reason: `${b.bloat_pct}% bloated, reclaim ~${b.bloat_size}.`,
      })
    }
  }

  // -- index:table ratio review
  for (const r of idxRatio.rows) {
    if (n(r.ratio) > 3 && n(r.indexes_size_bytes) > 50 * 1024 * 1024) {
      recs.push({ action: 'review', table: r.table_name, severity: 'critical', reason: `Indexes ${r.ratio}x table size.` })
    } else if (n(r.ratio) > 2 && n(r.indexes_size_bytes) > 10 * 1024 * 1024) {
      recs.push({ action: 'review', table: r.table_name, severity: 'warning', reason: `Indexes ${r.ratio}x table size.` })
    }
  }

  // -- write overhead review
  for (const w of writeOverhead.rows) {
    if (n(w.index_count) > 10 && n(w.total_writes) > 100000) {
      recs.push({
        action: 'review',
        table: w.table_name,
        severity: n(w.index_count) > 15 ? 'critical' : 'warning',
        reason: `${w.index_count} indexes under heavy writes.`,
      })
    }
    if (n(w.hot_update_pct) < 20 && n(w.updates) > 50000) {
      recs.push({ action: 'review', table: w.table_name, severity: 'warning', reason: `Low HOT update rate (${w.hot_update_pct}%).` })
    }
  }

  // -- dead rows -> vacuum
  for (const t of tableSizes.rows) {
    if (n(t.dead_row_pct) > 20 && n(t.dead_rows) > 10000) {
      recs.push({
        action: 'vacuum',
        table: t.table_name,
        severity: n(t.dead_row_pct) > 40 ? 'critical' : 'warning',
        reason: `${t.dead_row_pct}% dead rows (${t.dead_rows}).`,
      })
    }
  }

  // -- missing indexes
  for (const m of missing.rows) {
    if (n(m.live_rows) > 100000 && n(m.seq_scan) > 1000) {
      recs.push({
        action: 'add_index',
        table: m.table_name,
        severity: 'warning',
        reason: `${m.live_rows} rows, ${m.seq_scan} seq scans. Check slow query logs to identify which columns to index.`,
      })
    }
  }

  const out: Plan = { tool: 'baseline-heuristics', generated_at: new Date().toISOString(), recommendations: recs }
  const resultsDir = resultsDirFor(ROOT, url)
  mkdirSync(resultsDir, { recursive: true })
  const path = join(resultsDir, 'baseline.json')
  writeFileSync(path, JSON.stringify(out, null, 2))

  console.log(`Heuristic baseline — target ${maskUrl(url)}`)
  console.log(`${recs.length} recommendation(s) from threshold rules (unverified):\n`)
  for (const r of recs) {
    const target = [r.table, r.index_candidates?.join(', ')].filter(Boolean).join('.') || '(aggregate)'
    const reason = r.reason.length > 88 ? r.reason.slice(0, 85) + '...' : r.reason
    console.log(`  ${r.severity.toUpperCase().padEnd(9)}${r.action.padEnd(12)}${target}`)
    console.log(`           ${reason}`)
  }
  const byAction = new Map<string, number>()
  const bySeverity = new Map<string, number>()
  for (const r of recs) {
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1)
    bySeverity.set(r.severity, (bySeverity.get(r.severity) ?? 0) + 1)
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, n]) => `${n} ${k}`).join(' · ')
  console.log(`\nSummary: ${fmt(byAction)} | ${fmt(bySeverity)}`)
  console.log(`Note: these are the same items as the dashboard's Action Items tab — no verification performed.`)
  console.log(`Wrote ${path}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
