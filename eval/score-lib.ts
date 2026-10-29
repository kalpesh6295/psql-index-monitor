// Scoring core shared by the CLI (eval/score.ts) and the dashboard API
// (server/doctor.ts). Rules are documented in eval/score.ts.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PlanAction, Recommendation as Rec } from '../shared/plan.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export interface GtCase {
  id: string
  kind: 'positive' | 'trap' | 'control'
  table: string
  action?: string
  wrong_action?: string
  columns?: string[]
  index_any_of?: string[]
  why: string
}
export interface ScoreRow {
  id: string
  kind: string
  result: string
  detail: string
}
export interface Score {
  tool: string
  rows: ScoreRow[]
  summary: Record<string, string | number | string[]>
}

const ACTIONABLE: PlanAction[] = ['add_index', 'drop_index', 'reindex', 'vacuum']

function loadGroundTruth(): GtCase[] {
  return (JSON.parse(readFileSync(join(ROOT, 'eval', 'sandbox', 'ground-truth.json'), 'utf8')) as { cases: GtCase[] }).cases
}

function matchesIndex(rec: Rec, anyOf?: string[]): boolean {
  if (!anyOf) return true
  return (rec.index_candidates ?? []).some((i) => anyOf.includes(i))
}

// "user_id" / "created_at DESC" / "LOWER(email)" -> bare column identifier
const normalizeCol = (c: string) => c.trim().toLowerCase().replace(/\s+(asc|desc)(\s+nulls\s+(first|last))?$/i, '')

// Exact-column credit: the ground-truth columns must be a leading prefix of the
// recommendation's columns. A composite whose leading columns are the required
// ones serves the target query at least as well (e.g. (user_id, created_at)
// for a case that requires user_id).
function columnsSatisfy(gtColumns: string[], recColumns?: string[]): boolean {
  if (!recColumns || recColumns.length < gtColumns.length) return false
  return gtColumns.every((c, i) => normalizeCol(recColumns[i]) === normalizeCol(c))
}

export function scoreTool(path: string): Score {
  const gtCases = loadGroundTruth()
  const data = JSON.parse(readFileSync(path, 'utf8')) as { tool: string; recommendations: Rec[] }
  const recs = data.recommendations
  const actionable = recs.filter((r) => ACTIONABLE.includes(r.action) && r.table)
  const noise = recs.filter((r) => !ACTIONABLE.includes(r.action) || !r.table)

  const rows: ScoreRow[] = []
  let positives = 0
  let hits = 0
  let trapFails = 0
  let controlFails = 0
  let addWithColumns = 0
  let addCases = 0

  for (const c of gtCases) {
    if (c.kind === 'positive') {
      positives++
      const match = actionable.find((r) => r.action === c.action && r.table === c.table && matchesIndex(r, c.index_any_of))
      if (match) {
        hits++
        let detail = 'recommended'
        if (c.action === 'add_index') {
          addCases++
          const exact = columnsSatisfy(c.columns!, match.columns)
          if (exact) addWithColumns++
          detail = exact ? `recommended with exact columns (${match.columns!.join(', ')})` : 'recommended but columns not identified'
        }
        rows.push({ id: c.id, kind: c.kind, result: 'PASS', detail })
      } else {
        rows.push({ id: c.id, kind: c.kind, result: 'MISS', detail: `no ${c.action} recommendation for ${c.table}` })
      }
    } else if (c.kind === 'trap') {
      const bad = actionable.find((r) => r.action === c.wrong_action && r.table === c.table && matchesIndex(r, c.index_any_of))
      if (bad) {
        trapFails++
        rows.push({ id: c.id, kind: c.kind, result: 'FAIL', detail: `fell for the trap: ${bad.action} ${c.table} — "${bad.reason.slice(0, 90)}"` })
      } else {
        rows.push({ id: c.id, kind: c.kind, result: 'PASS', detail: 'did not make the harmful recommendation' })
      }
    } else {
      const any = actionable.filter((r) => r.table === c.table)
      if (any.length > 0) {
        controlFails++
        rows.push({ id: c.id, kind: c.kind, result: 'FAIL', detail: `flagged healthy table: ${any.map((r) => r.action).join(', ')}` })
      } else {
        rows.push({ id: c.id, kind: c.kind, result: 'PASS', detail: 'no recommendation for healthy table' })
      }
    }
  }

  const matchesAnyPositive = (r: Rec) =>
    gtCases.some((c) => c.kind === 'positive' && r.action === c.action && r.table === c.table && matchesIndex(r, c.index_any_of))
  const matchesAnyTrap = (r: Rec) =>
    gtCases.some((c) => c.kind === 'trap' && r.action === c.wrong_action && r.table === c.table && matchesIndex(r, c.index_any_of))
  const correctRecs = actionable.filter(matchesAnyPositive)
  const falsePositives = actionable.filter((r) => !matchesAnyPositive(r) && !matchesAnyTrap(r))

  const trapTotal = gtCases.filter((c) => c.kind === 'trap').length
  const controlTotal = gtCases.filter((c) => c.kind === 'control').length
  const precision = actionable.length > 0 ? correctRecs.length / actionable.length : 1
  const correctDecisions = hits + (trapTotal - trapFails) + (controlTotal - controlFails)

  return {
    tool: data.tool,
    rows,
    summary: {
      correct_decisions: `${correctDecisions}/${gtCases.length}`,
      recall: `${hits}/${positives}`,
      traps_passed: `${trapTotal - trapFails}/${trapTotal}`,
      controls_passed: `${controlTotal - controlFails}/${controlTotal}`,
      precision: `${correctRecs.length}/${actionable.length} (${(precision * 100).toFixed(0)}%)`,
      add_index_with_exact_columns: `${addWithColumns}/${addCases}`,
      recs_with_executable_ddl: `${actionable.filter((r) => !!r.ddl).length}/${actionable.length}`,
      unscored_noise_items: noise.length,
      false_positives: falsePositives.map((r) => `${r.action} ${r.table}${r.index_candidates ? ` (${r.index_candidates.join(',')})` : ''}`),
    },
  }
}
