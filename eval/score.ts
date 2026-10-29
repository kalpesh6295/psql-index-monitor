// Scores tool recommendations against sandbox/ground-truth.json.
//
//   tsx eval/score.ts eval/results/baseline.json eval/results/agent.json
//
// Scoring rules (applied identically to every tool):
// - positive case: credited when the tool emits a recommendation with the same
//   action and table; if the case names index_any_of, the recommendation must
//   name one of those indexes; add_index cases additionally track whether the
//   required columns were identified (ground-truth columns must be a leading
//   prefix of the recommended columns — a correct composite counts).
// - trap case: failed when the tool emits the listed wrong_action against the
//   listed table (and index, if given).
// - control case: failed when the tool emits ANY actionable recommendation
//   for the table.
// - precision: share of actionable recommendations (add/drop/reindex/vacuum)
//   that match a positive case. Several overlapping recs may cover one case.
//   'review' items and aggregate items naming no table are noise, not scored.

import { scoreTool } from './score-lib.js'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: tsx eval/score.ts <results.json> [...more]')
  process.exit(1)
}
for (const p of paths) {
  const s = scoreTool(p)
  console.log(`\n================ ${s.tool} (${p}) ================`)
  for (const r of s.rows) {
    console.log(`  ${r.id.padEnd(6)} ${r.kind.padEnd(8)} ${r.result.padEnd(5)} ${r.detail}`)
  }
  console.log('  --')
  for (const [k, v] of Object.entries(s.summary)) {
    console.log(`  ${k}: ${Array.isArray(v) ? (v.length ? v.join(' | ') : 'none') : v}`)
  }
}
