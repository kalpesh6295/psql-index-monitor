# Index Doctor Remediation Report

## Executive Summary

| Candidate | Action | Severity | Status | Rationale |
|-----------|--------|----------|--------|-----------|
| C1 (`idx_items_status`) | **KEEP** | ⚠️ WARNING | Rejected (Keep) | Index actively used by query planner for aggregate & selective queries; zero scans in 1h 44m window is insufficient evidence of disuse. Monitoring window too short; requires 7-day validation. |
| C3 (Proposed duplicate `idx_items_status`) | **NO ACTION** | ℹ️ INFO | Rejected | Candidate proposes creating index that already exists. Zero scans prove status-filtered queries absent in workload, not that new index is needed. Duplicate would waste 1.3 MB. |
| C4 (Table maintenance) | **NO ACTION** | ℹ️ INFO | Confirmed | Table healthy: 0 bloat, fresh autovacuum/analyze, optimal fill ratio (120 tuples/page). No maintenance required. |

**Bottom line:** No DDL changes recommended at this time. Extend monitoring and verify application query patterns before reconsidering `idx_items_status`.

---

## Action Items

### None — All Candidates Rejected or Confirmed as No-Op

#### Why No Index Drop

**Index:** `idx_items_status` (1,280 kB)

The verdict correctly rejects dropping this index despite zero idx_scan count in the 1h 44m monitoring window. Evidence confirms:

- **Active query planner usage:** EXPLAIN shows planner selects `idx_items_status` for:
  - `SELECT COUNT(*) WHERE status='active'` → Index Only Scan (cost 0.29)
  - `SELECT id, name WHERE status='inactive'` → Index Scan (cost 0.29)
- **Zero scans reflect workload shape, not index invalidity:** 152 seq_scans show current traffic is unfiltered full-table reads (`SELECT * LIMIT 100`), where seq_scan is cheaper than index lookup due to 50-50 status distribution (100K 'active', 100K 'archived').
- **Monitoring window insufficient:** 1h 44m uptime captures a single workload pattern; periodic jobs (nightly reports, batch status updates) may not have executed yet.
- **Application query catalog unconfigured:** Cannot confirm absence of scheduled processes filtering by status.

**Risk of drop:** Forcing seq_scan on aggregate COUNT() queries and selective single-row lookups would degrade performance by ~1-2 orders of magnitude for those query classes, even if they execute only occasionally.

**Recommended action instead:**
1. Extend monitoring to ≥7 days to capture full workload cycle (daily/weekly jobs)
2. Enable `pg_stat_statements` (if not already active) or configure application query catalog
3. Query `pg_stat_statements` for any `WHERE status IN (...)` or `status = '...'` patterns
4. Only reconsider drop if sustained zero usage confirmed AND application confirms no status-filtered queries in scheduled tasks

---

#### Why No Index Creation

**Candidate C3:** Proposes adding index on `status` column.

This is rejected because the index **already exists** (`idx_items_status`). The candidate's logic is inverted:

- Zero idx_scan count is NOT evidence that a new index is needed
- Zero idx_scan count IS evidence that status-filtered queries are absent
- Current data distribution (all 200K rows have `status='active'`) further limits index utility
- If the intent were to evaluate the existing index, that should trigger a **drop_index** candidate, not a **create_index** candidate

**Cost of pursuing this:** +1,280 kB storage, +maintenance overhead on inserts/updates, zero query benefit.

---

## Items Examined & Deliberately Left Alone

| Item | Finding | Why No Action |
|------|---------|---------------|
| `items_pkey` (Primary Key) | 4,408 kB, 1 scan over window, no duplicates | Primary keys are mandatory; scan count is immaterial. Retain. |
| Table bloat (`n_dead_tup=0, n_mod_since_analyze=0`) | Zero dead tuples, fresh autovacuum (2026-08-28 18:01:17) | Table is healthy; autovacuum configured correctly. No manual VACUUM required. |
| Index fragmentation | Not explicitly analyzed (pgstattuple unavailable) | pg_class tuple/page counts (13 MB / 1667 pages / 200K rows) indicate healthy 120 tuples/page fill ratio. REINDEX not warranted. |
| Autovacuum tuning | Using database defaults (`reloptions=null`) | Defaults appropriate for workload; table size (13 MB) does not warrant aggressive tuning. Leave as-is. |
| `status` column cardinality | `n_distinct=2` (only 'active' + 'archived'), current data 100% 'active' | Low cardinality limits index selectivity but does not justify dropping; index still useful for the 'archived' class once data arrives. Changing data distribution may vindicate index. |

---

## Final Recommendation

**No remediation DDL to execute.** 

The database is well-optimized for its current workload. Before making destructive changes to `idx_items_status`, collect evidence over a longer monitoring period (7+ days) and confirm application query patterns do not include status-based filtering in scheduled jobs. Once that validation is complete and if zero usage is sustained, revisit the drop decision.