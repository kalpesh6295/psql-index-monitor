import type { Overview } from '../types/index.js'

export function OverviewCards({ data }: { data: Overview }) {
  const cards = [
    { label: 'Total Indexes', value: data.total_indexes },
    { label: 'Total Tables', value: data.total_tables },
    { label: 'Index Size', value: data.total_index_size },
    { label: 'Table Size', value: data.total_table_size },
    { label: 'Total DB Size', value: data.total_db_size },
    {
      label: 'Cache Hit Ratio',
      value: data.cache_hit_ratio ? `${data.cache_hit_ratio}%` : 'N/A',
      color: data.cache_hit_ratio >= 99 ? 'var(--good)' : data.cache_hit_ratio >= 95 ? 'var(--warn)' : 'var(--crit)',
    },
  ]

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {cards.map((c) => (
        <div key={c.label} className="tile">
          <div className="tile-label">{c.label}</div>
          <div className="tile-value" style={c.color ? { color: c.color } : undefined}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}
