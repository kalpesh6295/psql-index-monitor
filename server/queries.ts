export const queries = {
  overview: `
    SELECT
      (SELECT count(*) FROM pg_stat_user_indexes WHERE schemaname = 'public')::int AS total_indexes,
      (SELECT count(*) FROM pg_stat_user_tables WHERE schemaname = 'public')::int AS total_tables,
      (SELECT pg_size_pretty(sum(pg_indexes_size(relid))) FROM pg_stat_user_tables WHERE schemaname = 'public') AS total_index_size,
      (SELECT pg_size_pretty(sum(pg_total_relation_size(relid))) FROM pg_stat_user_tables WHERE schemaname = 'public') AS total_db_size,
      (SELECT pg_size_pretty(sum(pg_relation_size(relid))) FROM pg_stat_user_tables WHERE schemaname = 'public') AS total_table_size,
      (SELECT
        round((100.0 * sum(idx_blks_hit) / nullif(sum(idx_blks_hit + idx_blks_read), 0))::numeric, 2)
        FROM pg_statio_user_indexes
        WHERE schemaname = 'public'
      ) AS cache_hit_ratio
  `,

  allIndexes: `
    SELECT
      s.schemaname AS schema,
      s.relname AS table_name,
      s.indexrelname AS index_name,
      pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
      pg_relation_size(i.indexrelid) AS index_size_bytes,
      s.idx_scan AS scans,
      s.idx_tup_read AS tuples_read,
      s.idx_tup_fetch AS tuples_fetched,
      pg_size_pretty(pg_relation_size(s.relid)) AS table_size,
      pg_relation_size(s.relid) AS table_size_bytes,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_stat_user_indexes s
    JOIN pg_index ix ON s.indexrelid = ix.indexrelid
    JOIN pg_statio_user_indexes i ON s.indexrelid = i.indexrelid
    WHERE s.schemaname = 'public'
    ORDER BY pg_relation_size(i.indexrelid) DESC
  `,

  unusedIndexes: `
    SELECT
      s.schemaname AS schema,
      s.relname AS table_name,
      s.indexrelname AS index_name,
      pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
      pg_relation_size(s.indexrelid) AS index_size_bytes,
      s.idx_scan AS scans,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary,
      pg_get_indexdef(s.indexrelid) AS definition
    FROM pg_stat_user_indexes s
    JOIN pg_index ix ON s.indexrelid = ix.indexrelid
    WHERE s.schemaname = 'public'
      AND s.idx_scan = 0
      AND NOT ix.indisprimary
      AND NOT ix.indisunique
    ORDER BY pg_relation_size(s.indexrelid) DESC
  `,

  mostUsed: `
    SELECT
      s.relname AS table_name,
      s.indexrelname AS index_name,
      s.idx_scan AS scans,
      s.idx_tup_read AS tuples_read,
      s.idx_tup_fetch AS tuples_fetched,
      pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
      pg_get_indexdef(s.indexrelid) AS definition
    FROM pg_stat_user_indexes s
    WHERE s.schemaname = 'public'
      AND s.idx_scan > 0
    ORDER BY s.idx_scan DESC
    LIMIT 50
  `,

  tableSizes: `
    SELECT
      t.schemaname AS schema,
      t.relname AS table_name,
      pg_size_pretty(pg_relation_size(t.relid)) AS table_size,
      pg_relation_size(t.relid) AS table_size_bytes,
      pg_size_pretty(pg_indexes_size(t.relid)) AS indexes_size,
      pg_indexes_size(t.relid) AS indexes_size_bytes,
      pg_size_pretty(pg_total_relation_size(t.relid)) AS total_size,
      pg_total_relation_size(t.relid) AS total_size_bytes,
      (SELECT count(*) FROM pg_stat_user_indexes si WHERE si.relid = t.relid)::int AS index_count,
      t.n_live_tup AS live_rows,
      t.n_dead_tup AS dead_rows,
      round((100.0 * t.n_dead_tup / nullif(t.n_live_tup + t.n_dead_tup, 0))::numeric, 2) AS dead_row_pct,
      t.seq_scan,
      t.idx_scan,
      t.last_vacuum,
      t.last_autovacuum,
      t.last_analyze,
      t.last_autoanalyze
    FROM pg_stat_user_tables t
    WHERE t.schemaname = 'public'
    ORDER BY pg_total_relation_size(t.relid) DESC
  `,

  indexBloat: `
    WITH btree_index_atts AS (
      SELECT
        nspname, relname, reltuples, relpages,
        indrelid, indexrelid,
        regexp_split_to_table(indkey::text, ' ')::smallint AS attnum,
        indexrelid AS index_oid
      FROM pg_index
      JOIN pg_class ON pg_class.oid = indexrelid
      JOIN pg_namespace ON pg_namespace.oid = relnamespace
      JOIN pg_am ON pg_am.oid = relam
      WHERE pg_am.amname = 'btree' AND pg_class.relpages > 0
        AND nspname = 'public'
    ),
    index_item_sizes AS (
      SELECT
        i.nspname, i.relname, i.reltuples, i.relpages,
        i.indrelid, i.indexrelid,
        current_setting('block_size')::numeric AS bs,
        8 AS maxalign,
        24 AS pagehdr,
        CASE WHEN max(coalesce(s.null_frac, 0)) = 0
          THEN 2
          ELSE 6
        END AS index_tuple_hdr,
        sum((1 - coalesce(s.null_frac, 0)) * coalesce(s.avg_width, 1024)) AS nulldatawidth
      FROM btree_index_atts AS i
      JOIN pg_stats AS s ON s.schemaname = i.nspname
        AND s.tablename = (SELECT relname FROM pg_class WHERE oid = i.indrelid)
        AND s.attname = (SELECT attname FROM pg_attribute WHERE attrelid = i.indrelid AND attnum = i.attnum)
      GROUP BY i.nspname, i.relname, i.reltuples, i.relpages, i.indrelid, i.indexrelid, bs, maxalign, pagehdr
    ),
    index_aligned AS (
      SELECT *,
        maxalign + pagehdr +
          nulldatawidth + maxalign - CASE
            WHEN index_tuple_hdr % maxalign = 0 THEN maxalign
            ELSE index_tuple_hdr % maxalign
          END + nulldatawidth + maxalign - CASE
            WHEN nulldatawidth::integer % maxalign = 0 THEN maxalign
            ELSE nulldatawidth::integer % maxalign
          END AS nulldatahdrwidth
      FROM index_item_sizes
    ),
    otta_calc AS (
      SELECT
        nspname, relname, indexrelid,
        coalesce(
          ceil(reltuples * nulldatahdrwidth / (bs - pagehdr::float)) +
            CASE WHEN relpages > 0 THEN 1 ELSE 0 END,
          0
        ) AS otta
      FROM index_aligned
    )
    SELECT
      nspname AS schema,
      c2.relname AS table_name,
      c.relname AS index_name,
      pg_size_pretty(pg_relation_size(oc.indexrelid)) AS index_size,
      pg_relation_size(oc.indexrelid) AS index_size_bytes,
      CASE WHEN oc.otta = 0 THEN 0
        ELSE round((100.0 * (c.relpages - oc.otta) / oc.otta)::numeric, 1)
      END AS bloat_pct,
      pg_size_pretty(
        CASE WHEN c.relpages > oc.otta
          THEN (c.relpages - oc.otta)::bigint * current_setting('block_size')::bigint
          ELSE 0
        END
      ) AS bloat_size,
      CASE WHEN c.relpages > oc.otta
        THEN (c.relpages - oc.otta)::bigint * current_setting('block_size')::bigint
        ELSE 0
      END AS bloat_size_bytes
    FROM otta_calc oc
    JOIN pg_class c ON c.oid = oc.indexrelid
    JOIN pg_class c2 ON c2.oid = (SELECT indrelid FROM pg_index WHERE indexrelid = oc.indexrelid)
    WHERE c.relpages > oc.otta AND oc.otta > 0
    ORDER BY (c.relpages - oc.otta)::bigint * current_setting('block_size')::bigint DESC
  `,

  duplicateIndexes: `
    SELECT
      table_name,
      json_agg(index_name) AS index_names,
      json_agg(index_size) AS index_sizes,
      index_columns
    FROM (
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
        array_to_string(array_agg(a.attname ORDER BY x.n), ', ') AS index_columns
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid
      JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON a.attnum = x.attnum
      WHERE n.nspname = 'public'
      GROUP BY t.relname, i.relname, i.oid
    ) sub
    GROUP BY table_name, index_columns
    HAVING count(*) > 1
    ORDER BY table_name
  `,

  indexVsSeqScan: `
    SELECT
      relname AS table_name,
      seq_scan,
      idx_scan,
      CASE WHEN (seq_scan + idx_scan) > 0
        THEN round((100.0 * idx_scan / (seq_scan + idx_scan))::numeric, 2)
        ELSE 0
      END AS idx_scan_pct,
      seq_tup_read,
      idx_tup_fetch,
      n_live_tup AS live_rows
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND (seq_scan + idx_scan) > 0
    ORDER BY seq_scan DESC
    LIMIT 50
  `,

  missingIndexes: `
    SELECT
      relname AS table_name,
      seq_scan,
      seq_tup_read,
      idx_scan,
      n_live_tup AS live_rows,
      round(seq_tup_read::numeric / nullif(seq_scan, 0), 0) AS avg_seq_tup_read
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND seq_scan > 100
      AND n_live_tup > 10000
      AND idx_scan < seq_scan
    ORDER BY seq_tup_read DESC
    LIMIT 30
  `,

  writeOverhead: `
    SELECT
      t.relname AS table_name,
      (SELECT count(*) FROM pg_stat_user_indexes si WHERE si.relid = t.relid)::int AS index_count,
      t.n_tup_ins AS inserts,
      t.n_tup_upd AS updates,
      t.n_tup_del AS deletes,
      (t.n_tup_ins + t.n_tup_upd + t.n_tup_del) AS total_writes,
      t.n_tup_hot_upd AS hot_updates,
      CASE WHEN t.n_tup_upd > 0
        THEN round((100.0 * t.n_tup_hot_upd / t.n_tup_upd)::numeric, 1)
        ELSE 0
      END AS hot_update_pct,
      (t.n_tup_ins + t.n_tup_upd + t.n_tup_del) *
        (SELECT count(*) FROM pg_stat_user_indexes si WHERE si.relid = t.relid)::bigint AS write_index_cost,
      pg_size_pretty(pg_indexes_size(t.relid)) AS indexes_size,
      pg_indexes_size(t.relid) AS indexes_size_bytes,
      t.idx_scan
    FROM pg_stat_user_tables t
    WHERE t.schemaname = 'public'
      AND (t.n_tup_ins + t.n_tup_upd + t.n_tup_del) > 0
    ORDER BY (t.n_tup_ins + t.n_tup_upd + t.n_tup_del) *
      (SELECT count(*) FROM pg_stat_user_indexes si WHERE si.relid = t.relid)::bigint DESC
    LIMIT 50
  `,

  indexTableRatio: `
    SELECT
      t.relname AS table_name,
      pg_size_pretty(pg_relation_size(t.relid)) AS table_size,
      pg_relation_size(t.relid) AS table_size_bytes,
      pg_size_pretty(pg_indexes_size(t.relid)) AS indexes_size,
      pg_indexes_size(t.relid) AS indexes_size_bytes,
      CASE WHEN pg_relation_size(t.relid) > 0
        THEN round((pg_indexes_size(t.relid)::numeric / pg_relation_size(t.relid)), 2)
        ELSE 0
      END AS ratio,
      (SELECT count(*) FROM pg_stat_user_indexes si WHERE si.relid = t.relid)::int AS index_count,
      t.n_live_tup AS live_rows
    FROM pg_stat_user_tables t
    WHERE t.schemaname = 'public'
      AND pg_relation_size(t.relid) > 0
    ORDER BY pg_indexes_size(t.relid)::numeric / pg_relation_size(t.relid) DESC
  `,
}
