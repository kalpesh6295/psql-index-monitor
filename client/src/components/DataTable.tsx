import { useState, useMemo } from 'react'

interface Column<T> {
  key: keyof T | string
  label: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  searchKeys?: (keyof T)[]
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: '#888',
  borderBottom: '1px solid #333',
  position: 'sticky',
  top: 0,
  background: '#1e1e2e',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 13,
  borderBottom: '1px solid #2a2a3a',
  color: '#ccc',
}

export function DataTable<T extends Record<string, unknown>>({ columns, data, searchKeys }: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const filtered = useMemo(() => {
    if (!search || !searchKeys) return data
    const q = search.toLowerCase()
    return data.filter((row) => searchKeys.some((key) => String(row[key]).toLowerCase().includes(q)))
  }, [data, search, searchKeys])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortKey as keyof T]
      const bv = b[sortKey as keyof T]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [filtered, sortKey, sortDir])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div>
      {searchKeys && (
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            marginBottom: 12,
            background: '#2a2a3a',
            border: '1px solid #444',
            borderRadius: 8,
            color: '#e0e0e0',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #333' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  style={{ ...thStyle, width: col.width }}
                  onClick={() => col.sortable !== false && handleSort(String(col.key))}
                >
                  {col.label}
                  {sortKey === String(col.key) && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: '#666' }}>
                  No data found
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#1a1a2a' }}>
                  {columns.map((col) => (
                    <td key={String(col.key)} style={tdStyle}>
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        {sorted.length} row{sorted.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
