import type { Overview } from '../types/index.js'

const cardStyle: React.CSSProperties = {
  background: '#1e1e2e',
  borderRadius: 12,
  padding: '20px 24px',
  minWidth: 180,
  flex: '1 1 180px',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
}

const valueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: '#e0e0e0',
}

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
      color: data.cache_hit_ratio >= 99 ? '#4ade80' : data.cache_hit_ratio >= 95 ? '#facc15' : '#f87171',
    },
  ]

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {cards.map((c) => (
        <div key={c.label} style={cardStyle}>
          <div style={labelStyle}>{c.label}</div>
          <div style={{ ...valueStyle, color: c.color || valueStyle.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}
