-- Plant the "damage" cases, then reset stats so the observation window is clean.

-- [GT-7] Bloat idx_messages_sender: delete 80% of rows, then plain VACUUM.
-- The btree keeps its pages (relpages stays high vs. reltuples), which is
-- exactly what real-world churn produces.
DELETE FROM messages WHERE id % 20 < 16;
VACUUM messages;

-- [GT-8] Dead rows on audit_logs: update 70% of rows with autovacuum off.
UPDATE audit_logs SET detail = detail || ' *' WHERE id % 10 < 7;

-- Clean observation window: zero all scan/tuple counters, then ANALYZE so
-- n_live_tup / n_dead_tup estimates are repopulated.
SELECT pg_stat_reset();
SELECT pg_stat_statements_reset();
ANALYZE;
