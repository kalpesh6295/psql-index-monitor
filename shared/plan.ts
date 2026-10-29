// The normalized remediation-plan schema. Both tools (heuristic baseline and
// the Index Doctor agent) emit this shape, the eval scorer consumes it, and
// the apply harness executes it — one contract, three consumers.

export type PlanAction = 'add_index' | 'drop_index' | 'reindex' | 'vacuum' | 'review'

export interface Recommendation {
  action: PlanAction
  table: string
  /** Triage candidate id (agent plans only) — keys the verification trajectory. */
  candidate_id?: string
  /**
   * Target index name(s) for drop/reindex. Duplicate-index groups may list
   * every member when the emitter says "drop all but one" without choosing.
   */
  index_candidates?: string[]
  /** add_index only: the proposed column list. */
  columns?: string[]
  /** Production-safe DDL, when the emitter can produce it. */
  ddl?: string
  rollback?: string
  severity: 'critical' | 'warning' | 'info'
  reason: string
  evidence?: string[]
  confidence?: 'high' | 'medium' | 'low'
}

export interface ClearedItem {
  action: string
  table: string
  candidate_id?: string
  index?: string
  evidence?: string[]
  reason?: string
}

export interface Plan {
  tool: string
  generated_at: string
  model?: string
  /** Trajectory run directory that produced this plan (agent plans only). */
  run_id?: string
  usage?: { input: number; output: number; cacheRead: number; estimated_cost_usd: number }
  recommendations: Recommendation[]
  cleared?: ClearedItem[]
}
