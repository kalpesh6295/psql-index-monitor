export interface Overview {
  total_indexes: number
  total_tables: number
  total_index_size: string
  total_db_size: string
  total_table_size: string
  cache_hit_ratio: number
}

export interface IndexInfo {
  schema: string
  table_name: string
  index_name: string
  index_size: string
  index_size_bytes: number
  scans: number
  tuples_read: number
  tuples_fetched: number
  table_size: string
  table_size_bytes: number
  is_unique: boolean
  is_primary: boolean
  definition: string
}

export interface UnusedIndex {
  schema: string
  table_name: string
  index_name: string
  index_size: string
  index_size_bytes: number
  scans: number
  is_unique: boolean
  is_primary: boolean
  definition: string
}

export interface MostUsedIndex {
  table_name: string
  index_name: string
  scans: number
  tuples_read: number
  tuples_fetched: number
  index_size: string
  definition: string
}

export interface TableSize {
  schema: string
  table_name: string
  table_size: string
  table_size_bytes: number
  indexes_size: string
  indexes_size_bytes: number
  total_size: string
  total_size_bytes: number
  index_count: number
  live_rows: number
  dead_rows: number
  dead_row_pct: number
  seq_scan: number
  idx_scan: number
  last_vacuum: string | null
  last_autovacuum: string | null
  last_analyze: string | null
  last_autoanalyze: string | null
}

export interface BloatedIndex {
  schema: string
  table_name: string
  index_name: string
  index_size: string
  index_size_bytes: number
  bloat_pct: number
  bloat_size: string
  bloat_size_bytes: number
}

export interface DuplicateIndex {
  table_name: string
  index_names: string[]
  index_sizes: string[]
  index_columns: string
}

export interface SeqVsIdx {
  table_name: string
  seq_scan: number
  idx_scan: number
  idx_scan_pct: number
  seq_tup_read: number
  idx_tup_fetch: number
  live_rows: number
}

export interface MissingIndex {
  table_name: string
  seq_scan: number
  seq_tup_read: number
  idx_scan: number
  live_rows: number
  avg_seq_tup_read: number
}

export interface WriteOverhead {
  table_name: string
  index_count: number
  inserts: number
  updates: number
  deletes: number
  total_writes: number
  hot_updates: number
  hot_update_pct: number
  write_index_cost: number
  indexes_size: string
  indexes_size_bytes: number
  idx_scan: number
}

export interface IndexTableRatio {
  table_name: string
  table_size: string
  table_size_bytes: number
  indexes_size: string
  indexes_size_bytes: number
  ratio: number
  index_count: number
  live_rows: number
}
