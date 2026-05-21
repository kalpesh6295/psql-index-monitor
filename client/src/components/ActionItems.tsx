import { useMemo, useState } from 'react'
import { Badge } from './Badge.js'
import type {
  UnusedIndex,
  BloatedIndex,
  DuplicateIndex,
  TableSize,
  WriteOverhead,
  IndexTableRatio,
  MissingIndex,
  SeqVsIdx,
} from '../types/index.js'

type Severity = 'critical' | 'warning' | 'info'
type Category = 'drop' | 'reindex' | 'add' | 'vacuum' | 'review'

interface ActionItem {
  severity: Severity
  category: Category
  title: string
  detail: string
  impact: string
  table: string
}

interface ActionItemsProps {
  unused: UnusedIndex[] | null
  bloat: BloatedIndex[] | null
  duplicates: DuplicateIndex[] | null
  tableSizes: TableSize[] | null
  writeOverhead: WriteOverhead[] | null
  idxRatio: IndexTableRatio[] | null
  missing: MissingIndex[] | null
  seqVsIdx: SeqVsIdx[] | null
}

const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
const severityColor: Record<Severity, 'red' | 'yellow' | 'blue'> = { critical: 'red', warning: 'yellow', info: 'blue' }
const categoryLabels: Record<Category, string> = {
  drop: 'Drop Index',
  reindex: 'Reindex',
  add: 'Add Index',
  vacuum: 'Vacuum',
  review: 'Review',
}
const categoryColor: Record<Category, 'red' | 'yellow' | 'green' | 'blue' | 'gray'> = {
  drop: 'red',
  reindex: 'yellow',
  add: 'green',
  vacuum: 'blue',
  review: 'gray',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function computeActions(props: ActionItemsProps): ActionItem[] {
  const items: ActionItem[] = []

  if (props.unused) {
    const large = props.unused.filter((u) => u.index_size_bytes > 10 * 1024 * 1024)
    const small = props.unused.filter((u) => u.index_size_bytes <= 10 * 1024 * 1024)

    for (const idx of large) {
      items.push({
        severity: 'critical',
        category: 'drop',
        title: `Drop unused index "${idx.index_name}"`,
        detail: `Zero scans on table "${idx.table_name}". Definition: ${idx.definition}`,
        impact: `Reclaim ${idx.index_size} + reduce write overhead`,
        table: idx.table_name,
      })
    }
    if (small.length > 0) {
      const totalSize = small.reduce((s, i) => s + i.index_size_bytes, 0)
      items.push({
        severity: 'warning',
        category: 'drop',
        title: `${small.length} small unused indexes`,
        detail: `Indexes under 10 MB with zero scans across tables: ${[...new Set(small.map((s) => s.table_name))]
          .slice(0, 10)
          .join(', ')}${small.length > 10 ? '...' : ''}`,
        impact: `Reclaim ~${formatBytes(totalSize)} total`,
        table: '',
      })
    }
  }

  if (props.duplicates) {
    for (const dup of props.duplicates) {
      items.push({
        severity: 'critical',
        category: 'drop',
        title: `Duplicate indexes on "${dup.table_name}" (${dup.index_columns})`,
        detail: `Indexes: ${(dup.index_names as string[]).join(', ')}. Sizes: ${(dup.index_sizes as string[]).join(
          ', ',
        )}`,
        impact: 'Drop all but one — identical coverage, wasted space + write cost',
        table: dup.table_name,
      })
    }
  }

  if (props.bloat) {
    for (const b of props.bloat) {
      if (b.bloat_pct > 50 && b.bloat_size_bytes > 50 * 1024 * 1024) {
        items.push({
          severity: 'critical',
          category: 'reindex',
          title: `Reindex "${b.index_name}" — ${b.bloat_pct}% bloated`,
          detail: `On table "${b.table_name}". Index size: ${b.index_size}`,
          impact: `Reclaim ~${b.bloat_size} of wasted space`,
          table: b.table_name,
        })
      } else if (b.bloat_pct > 30) {
        items.push({
          severity: 'warning',
          category: 'reindex',
          title: `Consider reindexing "${b.index_name}" — ${b.bloat_pct}% bloated`,
          detail: `On table "${b.table_name}". Index size: ${b.index_size}`,
          impact: `Reclaim ~${b.bloat_size}`,
          table: b.table_name,
        })
      }
    }
  }

  if (props.idxRatio) {
    for (const r of props.idxRatio) {
      if (r.ratio > 3 && r.indexes_size_bytes > 50 * 1024 * 1024) {
        items.push({
          severity: 'critical',
          category: 'review',
          title: `"${r.table_name}" indexes are ${r.ratio}x the table size`,
          detail: `Table: ${r.table_size}, Indexes: ${r.indexes_size}, ${r.index_count} indexes`,
          impact: 'Over-indexed — review which indexes are actually used',
          table: r.table_name,
        })
      } else if (r.ratio > 2 && r.indexes_size_bytes > 10 * 1024 * 1024) {
        items.push({
          severity: 'warning',
          category: 'review',
          title: `"${r.table_name}" indexes are ${r.ratio}x the table size`,
          detail: `Table: ${r.table_size}, Indexes: ${r.indexes_size}, ${r.index_count} indexes`,
          impact: 'Likely over-indexed',
          table: r.table_name,
        })
      }
    }
  }

  if (props.writeOverhead) {
    for (const w of props.writeOverhead) {
      if (w.index_count > 10 && w.total_writes > 100000) {
        items.push({
          severity: w.index_count > 15 ? 'critical' : 'warning',
          category: 'review',
          title: `"${w.table_name}" has ${w.index_count} indexes with heavy writes`,
          detail: `${Number(w.total_writes).toLocaleString()} total writes (${Number(
            w.inserts,
          ).toLocaleString()} INS, ${Number(w.updates).toLocaleString()} UPD, ${Number(
            w.deletes,
          ).toLocaleString()} DEL)`,
          impact: `Each write updates ${w.index_count} indexes — review if all are needed`,
          table: w.table_name,
        })
      }
      if (w.hot_update_pct < 20 && w.updates > 50000) {
        items.push({
          severity: 'warning',
          category: 'review',
          title: `Low HOT update rate on "${w.table_name}" (${w.hot_update_pct}%)`,
          detail: `${Number(w.updates).toLocaleString()} updates, but only ${w.hot_update_pct}% are HOT (heap-only)`,
          impact: 'Indexes on frequently-updated columns force full tuple rewrites',
          table: w.table_name,
        })
      }
    }
  }

  if (props.tableSizes) {
    for (const t of props.tableSizes) {
      if (t.dead_row_pct > 20 && t.dead_rows > 10000) {
        items.push({
          severity: t.dead_row_pct > 40 ? 'critical' : 'warning',
          category: 'vacuum',
          title: `"${t.table_name}" has ${t.dead_row_pct}% dead rows`,
          detail: `${Number(t.dead_rows).toLocaleString()} dead rows out of ${Number(
            t.live_rows + t.dead_rows,
          ).toLocaleString()} total. Last vacuum: ${t.last_autovacuum || t.last_vacuum || 'Never'}`,
          impact: 'Dead rows cause index and table bloat — run VACUUM ANALYZE',
          table: t.table_name,
        })
      }
    }
  }

  if (props.missing) {
    for (const m of props.missing) {
      if (m.live_rows > 100000 && m.seq_scan > 1000) {
        items.push({
          severity: 'warning',
          category: 'add',
          title: `"${m.table_name}" likely needs an index`,
          detail: `${Number(m.live_rows).toLocaleString()} rows, ${Number(
            m.seq_scan,
          ).toLocaleString()} seq scans, avg ${Number(m.avg_seq_tup_read).toLocaleString()} rows per scan`,
          impact: 'Check slow query logs to identify which columns to index',
          table: m.table_name,
        })
      }
    }
  }

  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
  return items
}

export function ActionItems(props: ActionItemsProps) {
  const items = useMemo(() => computeActions(props), [props])
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let result = items
    if (filter !== 'all') result = result.filter((i) => i.category === filter)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((i) => i.title.toLowerCase().includes(q) || i.table.toLowerCase().includes(q))
    }
    return result
  }, [items, filter, search])

  const counts = useMemo(
    () => ({
      critical: items.filter((i) => i.severity === 'critical').length,
      warning: items.filter((i) => i.severity === 'warning').length,
      info: items.filter((i) => i.severity === 'info').length,
    }),
    [items],
  )

  const categoryFilters: (Category | 'all')[] = ['all', 'drop', 'reindex', 'add', 'vacuum', 'review']

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ background: '#3b1219', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#f87171', textTransform: 'uppercase', letterSpacing: 1 }}>Critical</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#f87171' }}>{counts.critical}</div>
        </div>
        <div style={{ background: '#3b2f12', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#facc15', textTransform: 'uppercase', letterSpacing: 1 }}>Warning</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#facc15' }}>{counts.warning}</div>
        </div>
        <div style={{ background: '#12233b', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 1 }}>Info</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#60a5fa' }}>{counts.info}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {categoryFilters.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: filter === c ? '#3b3b5a' : '#2a2a3a',
              color: filter === c ? '#fff' : '#888',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {c === 'all' ? 'All' : categoryLabels[c]}
            {c !== 'all' && ` (${items.filter((i) => i.category === c).length})`}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter by table..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            background: '#2a2a3a',
            border: '1px solid #444',
            borderRadius: 6,
            color: '#e0e0e0',
            fontSize: 13,
            outline: 'none',
            width: 200,
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20, color: '#4ade80', background: '#123b1e', borderRadius: 8 }}>
          No action items found — looking good!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item, i) => (
            <div
              key={i}
              style={{
                background: '#1e1e2e',
                borderRadius: 10,
                padding: '14px 18px',
                borderLeft: `4px solid ${
                  item.severity === 'critical' ? '#f87171' : item.severity === 'warning' ? '#facc15' : '#60a5fa'
                }`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Badge color={severityColor[item.severity]}>{item.severity.toUpperCase()}</Badge>
                <Badge color={categoryColor[item.category]}>{categoryLabels[item.category]}</Badge>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>{item.title}</span>
              </div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{item.detail}</div>
              <div style={{ fontSize: 12, color: '#4ade80' }}>{item.impact}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: '#666', marginTop: 12 }}>
        {filtered.length} action item{filtered.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
