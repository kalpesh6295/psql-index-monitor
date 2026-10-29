# Index Remediation Report

**Database:** 11 tables · 30 indexes · 583 MB heap / 455 MB indexes / 1038 MB total · cache hit ratio 93.91%
**Observation window:** 1 day 20 hours (pg_stat_database.stats_reset = 2026-08-28T16:54:31Z)
**Candidates examined:** 16 · **Actionable:** 10 · **Deliberately rejected/kept:** 6

**Net effect if all actions are applied:** index footprint 455 MB → ~432 MB (+69 MB added, −66 MB dropped, −26 MB rebuilt); ~17 MB of dead heap space in `audit_logs` reclaimed for reuse; ~30.6 s of the 44-hour window's query time removed from the top-3 statements; ~93M redundant index tuple reads/window eliminated on `events`.

---

## 1. Summary of recommended actions

| # | Sev | Action | Object | Evidence (one line) | Δ size | Lock |
|---|-----|--------|--------|---------------------|--------|------|
| A1 | **critical** | ADD INDEX | `events (user_id, created_at DESC)` | Top statement: 400 calls, 21,071 ms total; HypoPG cost 31,002 → 8.08 | +60 MB | none (CONCURRENTLY) |
| A2 | **critical** | ADD INDEX | `orders (user_id, created_at DESC)` | #3 statement: 1,200 calls, 9,567 ms total; no index leads with `user_id`; cost 5,706 → 11.93 | +7–9 MB | none (CONCURRENTLY) |
| A3 | **warning** | VACUUM + re-enable autovacuum | `audit_logs` | `autovacuum_enabled=false`; 237,898 dead tuples = 32.9% of heap; `vacuum_count=0` | −17 MB dead | SHARE UPDATE EXCL |
| A4 | **warning** | REINDEX | `idx_messages_sender` | `avg_leaf_density=22.21%`, `leaf_fragmentation=49.49%`; index is live (600 scans) | 15 MB → ~4 MB | SHARE UPDATE EXCL |
| A5 | **warning** | DROP INDEX | `idx_products_price` | 0 scans / 44 h; `price_cents` appears in no WHERE/ORDER BY in the 17-query catalog | −20 MB | none (CONCURRENTLY) |
| A6 | **warning** | DROP INDEX | `idx_order_items_order_id` | Catalog-identical duplicate of `idx_order_items_order` (1,500 scans vs 0) | −17 MB | none (CONCURRENTLY) |
| A7 | **warning** | DROP INDEX | `idx_events_type` | 0 scans; `type` only in SELECT list; n_distinct=8 over 2M rows | −12 MB | none (CONCURRENTLY) |
| A8 | **warning** | DROP INDEX | `idx_events_source` | 0 scans; `source` only in SELECT list; no catalog predicate | −12 MB | none (CONCURRENTLY) |
| A9 | **info** | DROP INDEX | `idx_products_category` | 0 scans; no consumer in catalog or pg_stat_statements (index *is* usable — see risk) | −5 MB | none (CONCURRENTLY) |
| A10 | **info** | REINDEX | `messages_pkey` | `avg_leaf_density=18.25%` (~73 entries/page vs ~360–400 packed) | 20 MB → ~4 MB | brief ACCESS EXCL at swap |

### Recommended execution order

1. **A1, A2** first (pure additions, no plan regression risk; they are the only latency fixes here).
2. **A5–A9** drops — but run A7/A8 (`events`) *after* A1 has been built and validated, so the `events` write path is never simultaneously mid-build and mid-drop.
3. **A3** (`audit_logs`) — schedule off-peak, requires an owner conversation before flipping `autovacuum_enabled`.
4. **A4, A10** reindexes last; they are disk-reclamation only, not latency fixes.

`idx_events_created_at` (59 MB, 401 scans) is **retained** in this pass — see §12.

---

## 2. A1 — ADD INDEX `events (user_id, created_at DESC)` · CRITICAL

### DDL
```sql
CREATE INDEX CONCURRENTLY idx_events_user_id_created_at
  ON public.events (user_id, created_at DESC);
```

### Rollback
```sql
DROP INDEX CONCURRENTLY idx_events_user_id_created_at;
```

### Evidence
- **Top statement by total time.** `SELECT type, source, created_at FROM events WHERE user_id=$1 AND created_at > now()-interval $2 ORDER BY created_at DESC LIMIT $3` — 400 calls, 52.68 ms mean, **21,071 ms total**. Matched in the app catalog as `events_recent_by_user.sql`, so this is a live application path, not ad-hoc.
- **Current plan discards almost everything it reads.** Parallel Bitmap Heap Scan → Bitmap Index Scan on `idx_events_created_at` with the Index Cond on `created_at` only and `Filter: (user_id = $1)` applied post-read; ~172,098 estimated index rows fetched per execution, total cost 31,002.43.
- **Counters corroborate the read amplification.** `idx_events_created_at`: `idx_scan=401`, `idx_tup_read=93,654,234` → ~233k tuples per scan, while the query returns ~1.16 rows/call (465 rows / 400 calls).
- **HypoPG confirms adoption.** With the hypothetical index: `Index Scan using <hypo> ... Index Cond: ((user_id = $1) AND (created_at > now() - interval))`, cost **0.06..8.08** — a ~3,800× planner-cost reduction.
- **Covering variant rejected on measurement.** `(user_id, created_at DESC) INCLUDE (type, source)` produced an Index Only Scan at the *identical* 8.08 cost. The payload columns bought zero planner benefit and would add write and size overhead; the plain 2-column form was chosen.
- **Leading column is selective.** 2,000,000 live rows, `pg_stats.n_distinct(user_id)=185,818` → ~10.8 rows/user.
- `events.seq_scan=0` — the cost is entirely inside index reads, not sequential scans.

### Risk notes
- **Evidence inconsistency, disclosed:** the C1 EXPLAIN captured a Parallel Bitmap Heap Scan at cost 31,002.43, while the C14 EXPLAIN of the same statement captured a Parallel Seq Scan at cost 42,363.67 (hypothetical index → 24.16 there). This is a plan-flip between captures (parameter/plan-cache state), not a contradiction: both baselines are 3–4 orders of magnitude above the indexed plan. Do not quote a single "×" figure to stakeholders; quote "cost drops from 31k–42k to <25".
- **Write cost.** +~60 MB and one extra index maintenance write per INSERT on a 2M-row append-heavy table. Justified: the index removes ~93M tuple reads per 44-hour window from the #1 statement.
- **`CONCURRENTLY` mechanics.** Two table passes; cannot run inside a transaction block. If it fails it leaves an **INVALID** index — check `SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indrelid='events'::regclass;`, `DROP INDEX CONCURRENTLY` the invalid one, retry.
- **`DESC` is cosmetic.** A plain `(user_id, created_at)` btree scans backwards at identical cost. Keeping `DESC` for readability only.
- **Do not chain a drop of `idx_events_created_at` onto this.** An ad-hoc `SELECT count(*) FROM events WHERE created_at > now()-interval $1` still range-scans `created_at` alone. Re-evaluate after a full post-change observation window.

### Verification
```sql
-- after 1 full window
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes WHERE relname='events';
-- expect idx_events_user_id_created_at ~400 scans with idx_tup_read/scan in single digits,
-- and idx_events_created_at's 93M tup_read collapsing.
```

---

## 3. A2 — ADD INDEX `orders (user_id, created_at DESC)` · CRITICAL

### DDL
```sql
CREATE INDEX CONCURRENTLY idx_orders_user_id_created_at
  ON public.orders (user_id, created_at DESC);
```

### Rollback
```sql
DROP INDEX CONCURRENTLY idx_orders_user_id_created_at;
```

### Evidence
- **No access path exists today.** `pg_indexes` on `orders` returns exactly two indexes: `orders_pkey (id)` and `idx_orders_created_at (created_at)`. Nothing leads with `user_id`.
- **Current plan.** `SELECT id, status, total_cents, created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20` → Parallel Seq Scan (cost 0.00..4,705.88) + Sort, total **5,706.02**.
- **HypoPG.** Planner switches to Bitmap Index Scan on the hypothetical index (`Index Cond: user_id = $1`), total cost **11.93** — ~478× cheaper; `planner_used_it=true`.
- **Volume.** 1,200 calls, 7.97 ms mean, **9,567 ms total** — 3rd largest total time in the window. Catalog: `orders_by_user.sql`, "Order history page: every profile visit".
- **Seq-scan burden.** `pg_stat_user_tables(orders)`: `seq_scan=2201`, `seq_tup_read=361,200,000` on a 300,000-row / 20 MB table → ~164k rows read per scan. `idx_scan=300` (the ops dashboard only).
- **Selectivity.** 300,000 orders / 155,278 distinct `user_id` → avg 1.93, max 9 rows per user.
- **Alternatives measured.** Plain `(user_id)` and `(user_id, created_at DESC) INCLUDE (status, total_cents)` both plan at the identical 11.93. The two-column form is the smallest that also satisfies `ORDER BY created_at DESC LIMIT` without a sort as per-user order counts grow.

### Risk notes
- +7–9 MB of index and a small write cost on `orders` INSERT/UPDATE, against a 20 MB table serving a per-profile-visit query. Sound trade.
- At ~1.93 rows/user today the trailing `created_at` column is **not** load-bearing — it is future-proofing, not a measured win. Do not claim a sort elimination benefit; the current plan is a Bitmap Index Scan either way.
- **`idx_orders_created_at` must be retained** — `orders_recent.sql` (ops dashboard, 300 calls) depends on it. This is not a redundancy pair.
- `CONCURRENTLY`: cannot run in a transaction block; a failed build leaves an INVALID index that must be dropped and retried.

---

## 4. A3 — VACUUM `audit_logs` and re-enable autovacuum · WARNING

### DDL
```sql
VACUUM (ANALYZE, VERBOSE) audit_logs;
ALTER TABLE audit_logs SET (autovacuum_enabled = true);
```

### Rollback
```sql
ALTER TABLE audit_logs RESET (autovacuum_enabled);
-- or, to restore the exact prior state:
ALTER TABLE audit_logs SET (autovacuum_enabled = false);
```
The `VACUUM` itself reclaims dead space and refreshes statistics; it is not reversible and requires no rollback.

### Evidence
- **Measured, not estimated.** `pgstattuple('audit_logs')`: `dead_tuple_count=237,898`, `dead_tuple_percent=32.9`, `dead_tuple_len=17,128,656 bytes`, `free_percent=6.23`. This **corrects** the triage figure of 280,000 / 41.18%, which came from the `n_dead_tup` estimator.
- **Root cause is a table storage parameter, not thresholds.** `pg_class.reloptions = {autovacuum_enabled=false}`.
- **Global settings are healthy** and would have fired long ago: `autovacuum=on`, `autovacuum_vacuum_threshold=50`, `autovacuum_vacuum_scale_factor=0.2` → trigger at ~80,050 dead tuples vs 237,898 present.
- **Zero vacuum history.** `last_vacuum=NULL`, `last_autovacuum=NULL`, `vacuum_count=0`, `autovacuum_count=0`; only a single manual `ANALYZE` on 2026-08-28.
- **The dead tuples are being paid for on the read path.** `idx_audit_logs_actor`: `idx_scan=300`, `idx_tup_read=1043`, **`idx_tup_fetch=0`** — entries read then discarded at the heap visibility check. `seq_scan=2` with `seq_tup_read=1,275,796` (~638k tuples/scan vs 400,000 live rows).
- **Active consumer.** `audit_by_actor.sql` (~300 calls/window) plans as Bitmap Index Scan → Bitmap Heap Scan with Recheck Cond, so it pays the dead-tuple heap-visit cost directly.
- **No wraparound urgency.** heap 50 MB / `relpages=6356`, `age(relfrozenxid)=77`.

### Risk notes
- **This candidate was MODIFIED from triage in two ways.**
  1. **Root cause corrected.** Triage blamed autovacuum thresholds. It is an explicit per-table override. A one-off `VACUUM` alone would let the table silently re-bloat to the same state — the storage parameter must be reverted or this finding recurs.
  2. **The index REINDEX was rejected.** `pgstatindex('idx_audit_logs_actor')`: `avg_leaf_density=83.12%`, `empty_pages=0`, `deleted_pages=0`, `tree_level=2`. That is healthy fill, well above the ~55% action threshold. The 28 MB of indexes on this table need **no** rebuild; the fix is heap-side only.
- **Before flipping `autovacuum_enabled` back on, ask the owning team why it was disabled.** The usual reason is a bulk-load or retention job avoiding vacuum contention. If that job still exists, prefer per-table tuning (`autovacuum_vacuum_cost_delay`, `autovacuum_vacuum_scale_factor`) over leaving autovacuum off — an append-only audit table left unvacuumed also accumulates transaction-ID freeze debt.
- Plain `VACUUM` takes only SHARE UPDATE EXCLUSIVE and runs concurrently with reads and writes.
- **`VACUUM FULL` is deliberately not recommended:** ACCESS EXCLUSIVE lock for no benefit on a 50 MB heap whose free space will be reused by future inserts.

---

## 5. A4 — REINDEX `idx_messages_sender` · WARNING

### DDL
```sql
REINDEX INDEX CONCURRENTLY public.idx_messages_sender;
```

### Rollback
No rollback needed — REINDEX rebuilds the identical definition (`CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_id)`). If it fails mid-flight it leaves an invalid leftover:
```sql
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indrelid='messages'::regclass;
DROP INDEX CONCURRENTLY public.idx_messages_sender_ccnew;
```
The original index remains valid throughout; no query regresses.

### Evidence
- `pgstatindex('idx_messages_sender')`: **`avg_leaf_density = 22.21%`** (healthy band 65–75%, action threshold ~55%) and **`leaf_fragmentation = 49.49%`** — sparsely filled *and* physically out of order.
- **Page math.** 1,853 leaf pages hold 180,000 entries. At normal ~90% fill a bigint btree of that entry count needs ~460–500 leaf pages → the index occupies ~4× the pages its live entries require. Expected post-rebuild ~4 MB vs 15,245,312 bytes today (**~11 MB reclaimed**).
- `empty_pages=0`, `deleted_pages=0` — the waste is *inside* partially-filled leaf pages, which only a rebuild compacts. VACUUM cannot help.
- **Drop is the wrong action — the index is live.** `idx_scan=600`, `table_seq_scans=0`. Catalog match: `messages_by_sender.sql` (~600 calls/window, `WHERE sender_id = $1 ORDER BY created_at DESC LIMIT 50`), call count matching `idx_scan` exactly. EXPLAIN: `Index Scan using idx_messages_sender ... Index Cond: (sender_id = $1)` (cost 0.42..12.45).
- **Selective column:** 118,627 distinct senders over 180,000 rows (~1.5 rows/value).
- **Not churn-driven:** `n_dead_tup=0`, `n_tup_upd=0`, `n_tup_del=0`, `autovacuum_count=0`.

### Risk notes
- The triage rationale used an unreliable heuristic ("87 bytes/row" — meaningless for deduplicated btrees). The verdict stands only because independent `pgstatindex` measurement confirmed it. Do not reuse the bytes/row heuristic elsewhere.
- `REINDEX CONCURRENTLY` takes only SHARE UPDATE EXCLUSIVE; reads and writes to `messages` continue. 15 MB index on a 72 MB heap — fast.
- Requires transient disk headroom for a second copy (~15 MB) and will **wait for long-running transactions to drain**. Avoid running during long analytics transactions.
- **Doing nothing is not dangerous.** Results stay correct and the plan is already cheap (cost 12.45). The cost of inaction is ~11 MB wasted plus buffer-cache pressure across ~600 scans/window.
- With zero update/delete churn, the bloat should not recur — this is a one-off fix, not a recurring maintenance job.

---

## 6. A5 — DROP INDEX `idx_products_price` · WARNING

### DDL
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_products_price;
```

### Rollback
```sql
CREATE INDEX CONCURRENTLY idx_products_price ON public.products USING btree (price_cents);
```

### Evidence
- `inspect_index`: `btree (price_cents)`, **20 MB**, `idx_scan=0`, `is_unique=false`, `is_primary=false`, `backing_constraint=null`, `partial_predicate=null` — nothing depends on it.
- **Full catalog scan.** Only two queries touch `products`: `product_by_sku.sql` (`WHERE sku = $1`) and `products_by_ids.sql` (`WHERE id = ANY($1::bigint[])`). `price_cents` appears **only in SELECT output lists** — never in a WHERE, ORDER BY, or range predicate. No cron/rare job references it (contrast `dunning_job.sql`, which the catalog explicitly flags as depending on `idx_invoices_unpaid_due`).
- **Index traffic fully accounted for.** `products` total `idx_scan=2000`; per-index: `products_pkey=1200` + `products_sku_key=800` = 2000. Exactly zero attributable to `idx_products_price`.
- **Call counts align.** `product_by_sku` 800 calls / 0.25 ms mean ↔ 800 sku scans; `products_by_ids` 400 calls / 0.26 ms mean ↔ pkey scans. No price-filtered or price-ordered statement anywhere in the top-20 by total time.
- **Window is not a burst.** 44 hours covering all 17 catalogued queries.
- Table is read-only in this window (`n_tup_ins=0`, `n_tup_upd=0`, `n_tup_del=0`), so the index currently costs 20 MB of storage/cache/backup footprint and would add write amplification on any future price update.

### Risk notes
- **Residual risk:** an ad-hoc BI/admin price-range query (`WHERE price_cents BETWEEN …`, `ORDER BY price_cents`) that runs outside the instrumented catalog and outside the 44-hour window would fall back to a seq scan of 800k rows. Acceptable: the index is non-unique, backs no constraint, and no FK references `price_cents`, so the drop cannot break correctness — only plan shape. Rollback is one non-blocking statement.
- Use `DROP INDEX CONCURRENTLY`, not plain `DROP`, to avoid ACCESS EXCLUSIVE on `products`. Cannot run inside a transaction block.
- If the environment has an uninstrumented reporting replica, check its `pg_stat_user_indexes` before executing — this analysis covers the primary only.

---

## 7. A6 — DROP INDEX `idx_order_items_order_id` (duplicate) · WARNING

### DDL
```sql
DROP INDEX CONCURRENTLY public.idx_order_items_order_id;
```

### Rollback
```sql
CREATE INDEX CONCURRENTLY idx_order_items_order_id
  ON public.order_items USING btree (order_id);
```

### Evidence
- **Byte-for-byte equivalence proven in the catalog, not inferred from names.** Both indexes: `amname=btree`, `indnatts=1`, `indnkeyatts=1` (no INCLUDE), `indisunique=false`, `is_partial=false`, `has_expr=false`, `opclasses='3124'` (int8_ops), `collations='0'`, `indoption='0'` (same ASC/NULLS LAST ordering).
- **No constraint depends on it.** `backing_constraint=null`, `constraint_type=null`, `is_unique=false`, `is_primary=false` — cannot break a constraint or a REPLICA IDENTITY.
- **The planner has consistently picked the sibling.** `idx_order_items_order`: `idx_scan=1500`, `idx_tup_read=4502`. `idx_order_items_order_id`: `idx_scan=0`, `idx_tup_read=0`.
- **Plan is unchanged after the drop.** `SELECT product_id, qty FROM order_items WHERE order_id = $1` already plans Bitmap Index Scan on `idx_order_items_order` (cost 0.00..4.46, total 20.21).
- **Zero scans is not a short-window artifact.** The catalog contains exactly one `order_items` query (`order_items_by_order.sql`, ~1,500 calls/window, no ORDER BY, no partial predicate) and **no** rare/cron job references `order_items` at all.
- Both indexes are 17 MB on a 900,000-row table. The drop reclaims 17 MB and removes one duplicate index-insert path per write.

### Risk notes
- **Lowest-risk action in this report.** Identical AM, key column, opclass, collation, indoption; no INCLUDE, predicate, or expression on either. The retained index can satisfy every plan the dropped one could.
- **Direction matters.** Drop `idx_order_items_order_id` (0 scans), keep `idx_order_items_order` (1,500 scans). Dropping the used one would be functionally equivalent but would invalidate cached plans and discard a warm cache for no reason.
- `DROP INDEX CONCURRENTLY` to avoid ACCESS EXCLUSIVE on a hot 900k-row table; cannot run in a transaction block; a failure can leave an INVALID index that must be dropped again.
- **Out of scope, noted:** `order_items_pkey` also shows `idx_scan=0` but enforces the primary key and must be kept (see §12).

---

## 8. A7 — DROP INDEX `idx_events_type` · WARNING

### DDL
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_events_type;
```

### Rollback
```sql
CREATE INDEX CONCURRENTLY idx_events_type ON public.events USING btree (type);
```

### Evidence
- `inspect_index`: `btree (type)`, **12 MB**, `idx_scan=0`, `is_unique=false`, `is_primary=false`, `partial_predicate=null`, `backing_constraint=null`.
- **Only one events query exists in the entire catalog:** `events_recent_by_user.sql` (`WHERE user_id = $1 AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 100`). `type` appears **only in the SELECT list**. No cron/monthly job touches `events`.
- `pg_stat_statements`: the only recurring events statement is that same activity feed (400 calls, 21.1 s). Nothing filters or sorts on `events.type`.
- **EXPLAIN confirms non-participation.** The activity feed uses `idx_events_created_at` (Bitmap Index Scan, cost 0..3,870.84) with `user_id` as a heap Filter; `idx_events_type` appears nowhere in the plan.
- **Low value even hypothetically.** `n_distinct(type)=8` over 2,000,000 rows (~250k rows/value). A synthetic `WHERE type='purchase'` estimates 244,533 rows at cost 30,425.
- Sibling counters: `idx_events_created_at`=401 scans; `idx_events_type` and `idx_events_source` both 0.

### Risk notes
- Non-unique, non-partial, backs no constraint — the drop cannot affect data integrity or a FK.
- **Residual risk:** an unlogged analyst query filtering on `type`. Because `type` has 8 distinct values (~250k rows each), such a query would get a bitmap scan of marginal benefit over a seq scan; rebuild is minutes.
- **Zero scans alone was not sufficient justification here** — counters were reset recently (`n_tup_ins=0` for events). The verdict rests on the app catalog and the absence of any `type` predicate in query stats.
- Use `DROP INDEX CONCURRENTLY` — no long ACCESS EXCLUSIVE lock on a high-insert table.
- **Sequence after A1.** Do not run this while the A1 build is in flight.

---

## 9. A8 — DROP INDEX `idx_events_source` · WARNING

### DDL
```sql
DROP INDEX CONCURRENTLY idx_events_source;
```

### Rollback
```sql
CREATE INDEX CONCURRENTLY idx_events_source ON public.events USING btree (source);
```

### Evidence
- `inspect_index`: `btree (source)`, **12 MB**, `idx_scan=0`, `is_unique=false`, `is_primary=false`, `partial_predicate=null`, `backing_constraint=null`.
- **Full 17-query catalog (including rare cron jobs like `dunning_job.sql`):** only `events_recent_by_user.sql` touches `events`, and `source` appears only in the SELECT list. No query filters, joins, sorts, or groups on `events.source`. No scheduled job references it.
- `pg_stat_statements`: the only events statements in the window are the activity feed (400 calls) and a one-off `SELECT count(*) FROM events WHERE created_at > …`. Neither can use a btree on `(source)`.
- **EXPLAIN:** the activity feed chooses Bitmap Index Scan on `idx_events_created_at`; a single-column index on `(source)` cannot serve a predicate on `user_id`/`created_at` and appears nowhere in the plan.
- Removes 12 MB plus one index-maintenance write per row inserted into the 2M-row table.

### Risk notes
- Same residual risk profile as A7: an analyst query on `source` outside both the catalog and the window would fall back to a seq scan on 2M rows. Acceptable — non-constraint, non-unique, zero-scan, rebuild is a single CONCURRENTLY statement (~12 MB, no exclusive lock).
- **`idx_events_created_at` is the only currently useful index on this table and must be retained.**
- The activity feed's 52.7 ms mean is addressed by A1, not by this drop — the two are independent.

---

## 10. A9 — DROP INDEX `idx_products_category` · INFO

### DDL
```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_products_category;
```

### Rollback
```sql
CREATE INDEX CONCURRENTLY idx_products_category ON public.products USING btree (category);
```

### Evidence
- `inspect_index`: `btree (category)`, **5,080 kB**, `idx_scan=0`, `is_unique=false`, `is_primary=false`, `partial_predicate=null`, `backing_constraint=null`.
- **No consumer exists.** Across the full 17-query catalog including the monthly dunning cron, *no* query filters, sorts, or groups by `products.category`. `product_by_sku` returns `category` in the SELECT list but does not predicate on it, so it cannot use this index.
- `pg_stat_statements`: the only `products` statements are `WHERE sku = $1` (800 calls, 0.25 ms mean) and `WHERE id = ANY($1::bigint[])` (400 calls, 0.26 ms mean). No category predicate appears at all.
- `products_pkey` (17 MB, 1,200 scans) and `products_sku_key` (24 MB, 800 scans) fully serve both live patterns. `table_seq_scans = 0` — no fallback sequential scan is compensating for a missing category path.
- Non-unique, non-partial; a FK target must be unique, so no FK can reference it. No catalog dependency blocks the drop.

### Risk notes
- **The triage rationale was wrong and must not be recorded as the justification.** It claimed low cardinality means "the planner may never use it even if a query exists." That was tested directly: `EXPLAIN SELECT id, name, price_cents FROM products WHERE category = $1` **does** choose a Bitmap Index Scan on `idx_products_category` (cost 1,095.42..9,917.42, est. 100,000 rows) over a seq scan. `n_distinct(category)=8` over 800k rows (~12.5% selectivity) is still cheap enough for a bitmap scan. **The index is usable — it is simply unused.** The drop is justified purely by "no consumer exists."
- **Practical risk is higher than for A5/A7/A8**, because a category-browse or category-facet feature is a plausible near-term addition on a products table. If added, that query regresses to a seq scan of 800k rows until the index is rebuilt.
- **Benefit is modest** — 5 MB plus small write-amplification savings — hence severity `info`, not `warning`. If your team has any roadmap item touching category browse, **defer this one**; the other four drops (54 MB combined) carry the real value.
- `DROP INDEX CONCURRENTLY` so no ACCESS EXCLUSIVE lock is taken.

---

## 11. A10 — REINDEX `messages_pkey` · INFO

### DDL
```sql
REINDEX INDEX CONCURRENTLY public.messages_pkey;
```

### Rollback
No rollback is required or possible — REINDEX CONCURRENTLY rebuilds identical index contents and swaps atomically; the PRIMARY KEY constraint and its definition are unchanged. If the rebuild fails midway it leaves an INVALID index:
```sql
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indrelid='messages'::regclass;
DROP INDEX CONCURRENTLY public.messages_pkey_ccnew;  -- then re-run
```

### Evidence
- `pgstatindex('messages_pkey')`: **`avg_leaf_density = 18.25%`** — far below the healthy 65–75% band and well under the ~55% action threshold. Direct measurement, not an estimator.
- **Physical shape confirms it.** 2,459 leaf pages / 20,234,240 bytes for 180,000 bigint entries = ~73 entries per 8 KB page. A packed btree page holds ~360–400 bigint entries → the index occupies roughly 5× the pages its live entries require (~490 leaf pages / ~4 MB expected).
- `leaf_fragmentation=0`, `empty_pages=0`, `deleted_pages=0` — the waste is sparse in-page fill, exactly what REINDEX fixes. VACUUM is not the remedy.
- **Not churn-driven:** `n_dead_tup=0`, `n_tup_upd=0`, `n_tup_del=0`, `autovacuum_count=0`. A one-time rebuild is durable.
- **Not a default-fillfactor artifact:** `pg_class.reloptions` is NULL for this index.
- **Cannot be dropped despite `idx_scan=0`:** `is_primary=true`, `is_unique=true`, `backing_constraint=messages_pkey`, `constraint_type='p'`. It enforces PK uniqueness on every INSERT.
- `idx_scan=0` is *expected* here: no FK references `messages.id`, and both catalogued messages queries filter on `thread_id`/`sender_id`, never `id`.

### Risk notes
- **Severity deliberately downgraded to `info`.** The bloat is real and confirmed by pgstattuple, but the index is never used for reads, so the only benefit is ~15 MB of disk and marginally cheaper insert-time uniqueness checks. **This is not a latency fix.** Recovering 15 MB on a database whose `messages` heap alone is 72 MB does not justify an emergency window — batch it with other maintenance.
- Execution: safe on PG12+, does not block reads or writes, but takes a **brief ACCESS EXCLUSIVE lock at the final swap**. Run off-peak; expect it to abort if it cannot acquire that lock behind a long-running transaction.
- Needs transient disk headroom for a second copy (~20 MB) and can leave an INVALID `*_ccnew` index if interrupted.
- **Non-obvious trap, recorded for future reviewers:** `idx_scan = 0` would normally argue for DROP over REINDEX. Here it backs the PRIMARY KEY and dropping is not an option.

---

## 12. Examined and deliberately left alone

These were investigated and **no change was made**. Each entry records *why*, so a future zero-scan or bloat sweep does not undo this analysis.

| Object | Finding | Why no action |
|---|---|---|
| `idx_invoices_unpaid_due` (invoices, 31 MB, 0 scans) | **Keep — would break a monthly batch** | `dunning_job.sql` runs on the 1st of the month; its `status='unpaid' AND due_date < current_date ORDER BY due_date LIMIT 500` matches the partial predicate and leading key exactly. EXPLAIN today: `Limit (cost=0.43..104.35) -> Index Scan using idx_invoices_unpaid_due (Index Cond: due_date < CURRENT_DATE)` — the LIMIT terminates after ~104 cost units because the index supplies pre-sorted rows, and the index covers 3 of the 4 selected columns. Zero scans is fully explained by monthly cadence vs a 44-hour window (`invoices_pkey` is also 0 in the same window). 31 MB is legitimate: 600,389 of 1,500,000 rows are `unpaid` (40%). Dropping it converts a 104-cost LIMIT scan into a seq scan of 1.5M rows plus a sort of ~305k rows (full index-scan baseline cost 63,420) — **and the failure would surface only on the 1st of the month, long after the change window.** No other index on `invoices` leads on `due_date` or filters on `status`. *Re-evaluate only with a stats window spanning a month-boundary run.* Optional future shrink: the trailing `amount_cents` exists purely for covering and could be dropped if write cost ever becomes a measured problem — no evidence of that today. |
| `api_keys_key_hash_key` (384 kB, 0 scans) | **Keep — correctness guarantee, unprotected by catalog** | `indisunique=true`, all of indisvalid/indisready/indislive true. Critically, `pg_constraint` on `api_keys` returns **only** `api_keys_pkey`; the key_hash unique index is a **bare unique index with no backing constraint**, so nothing in the catalog would refuse an accidental `DROP INDEX`. Dropping it would silently permit duplicate `key_hash` values (auth ambiguity / security defect), and recreating it later could fail if duplicates had already been inserted. Zero scans is explained by the table receiving **zero reads of any kind** (`seq_scan=0`, `idx_scan=0`, 5,000 live rows) — no api_keys query exists in the catalog or in pg_stat_statements, so the window contains no evidence either way. Health is fine: `avg_leaf_density=70.01%`, 46 leaf pages, `n_dead_tup=0`. **Same exemption applies to `api_keys_pkey` and the never-scanned PKs on `page_views`, `users`, `sessions`, `orders`, `invoices`, and `order_items` — unique/PK indexes must be excluded from zero-scan drop heuristics.** |
| `idx_events_created_at` (59 MB, 401 scans) | **No REINDEX — premise unsupported** | `pgstatindex`: `avg_leaf_density=66`, `empty_pages=0`, `deleted_pages=0`, 7,468 leaf pages, `tree_level=2` — inside the healthy 65–75% band. Size math refutes the bloat claim: 2,000,000 rows / 7,468 leaf pages = 268 entries/page vs a theoretical max of 8192×0.66/20 = 270 for a 16-byte timestamptz tuple + 4-byte line pointer at 66% fill. **The index is within 1% of its theoretical size**; the "~30 bytes/row" is fillfactor, not bloat. `events_pkey` likewise measures `avg_leaf_density=90.08`, `leaf_fragmentation=0`. `n_dead_tup=0` — no churn driving bloat. A REINDEX would consume I/O and roughly double disk usage during the rebuild to recover essentially zero space, **and would not touch the 52.68 ms activity-feed query**, which does not use this index in the plan captured in that analysis. The real fix is A1. The only non-pristine metric is `leaf_fragmentation=49.77`, which measures physical leaf-page ordering, not wasted space, and is immaterial at 401 scans. *Revisit as a **drop** candidate — not a reindex — after A1 has been live for a full window.* |
| `idx_users_country` (1,327,104 bytes, 300 scans, ~33k tuples/scan) | **No change — high tuples/scan is cardinality, not misuse** | EXPLAIN of `SELECT count(*) FROM users WHERE country = $1`: `Aggregate (cost=774.95..774.96) -> Index Only Scan using idx_users_country (cost=0.29..691.62 rows=33333)`. `idx_tup_fetch = 0` proves the scans are genuinely heap-free; 9,997,708 tup_read / 300 scans = ~33,326/scan, matching the planner's rows=33,333 estimate (200k rows / ~6 countries). `relpages=1910`, `relallvisible=1910` — the visibility map covers 100% of the heap. Health: `avg_leaf_density=94.9%`, `leaf_fragmentation=3.12%`, 160 leaf pages — a REINDEX would reclaim nothing. Latency is a non-issue: 300 calls, 279 ms total, 0.93 ms mean — ~1.3% of the top statement's 21,071 ms. Any "fix" is harmful: dropping forces a seq scan of 1,910 heap pages per call. **Monitor:** if `idx_tup_fetch` on this index becomes non-zero and mean latency climbs, that signals a visibility-map/vacuum issue on `users`, not an index defect. |
| `page_views (site_id)` — proposed index | **Rejected — cannot be selective** | `pg_stats`: `n_distinct=2` with MCV frequencies `{2:0.5004, 1:0.4996}` — every predicate value matches ~50% of the 200,000 live rows. HypoPG tested **three** variants, all `planner_used_it=false` with unchanged cost: plain `(site_id)` (Parallel Seq Scan cost 0.00..2,912.59, total 4,059.76, identical before/after), composite `(site_id, viewed_at)` (same 4,059.76, no index-only path was cheaper), and partial `(site_id) WHERE site_id = 1` against the literal-value query (4,059.64 unchanged). The statement costs 7.12 ms mean / 4,275 ms over 600 calls on an already-parallelized 11 MB table; an index returning 100k rows would require more I/O than the seq scan. Creating it would add ~4 MB and write overhead on an insert-heavy table for a plan the planner provably never picks. **The real fix is out of index scope:** a materialized view / summary table keyed on `(site_id)` and `(day)`, or a trigger-maintained counter table. Raising `max_parallel_workers_per_gather` is a cheaper partial mitigation. *Re-evaluate a partial index only if `site_id` becomes skewed (e.g. a new low-traffic site).* |
| `page_views (viewed_at)` — daily rollup, #2 by total time | **Rejected — no btree can help this shape** | `SELECT date_trunc($1, viewed_at), count(*) FROM page_views GROUP BY 1 ORDER BY 1` — 600 calls, 32.40 ms mean, **19,438 ms total**. Plan is unavoidable full aggregation: `GroupAggregate (cost=24288.64..28288.64 rows=200000) -> Sort (24288.64..24788.64) -> Seq Scan (0.00..3942.00 rows=200000)`.