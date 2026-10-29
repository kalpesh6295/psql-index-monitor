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

export function DataTable<T extends object>({ columns, data, searchKeys }: DataTableProps<T>) {
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

  // A column is numeric (right-aligned, tabular figures) when the underlying
  // values are numbers or purely numeric strings — sizes like "17 MB" stay left.
  const numericCols = useMemo(() => {
    const set = new Set<string>()
    const sample = data.slice(0, 20)
    for (const col of columns) {
      const vals = sample.map((r) => r[col.key as keyof T]).filter((v) => v !== null && v !== undefined && v !== '')
      if (vals.length > 0 && vals.every((v) => typeof v === 'number' || /^-?[\d,]+(\.\d+)?$/.test(String(v)))) {
        set.add(String(col.key))
      }
    }
    return set
  }, [columns, data])

  const colClass = (key: string) =>
    [numericCols.has(key) ? 'num' : '', sortKey === key ? 'sorted' : ''].filter(Boolean).join(' ') || undefined

  return (
    <div>
      {searchKeys && (
        <div className="search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            className="input"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      <div className="dt-wrap">
        <table className="dt">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={colClass(String(col.key))}
                  style={{ width: col.width }}
                  onClick={() => col.sortable !== false && handleSort(String(col.key))}
                >
                  {col.label}
                  {col.sortable !== false && (
                    <span className="sort-ind">
                      {sortKey === String(col.key) ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                  No data found
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={String(col.key)} className={numericCols.has(String(col.key)) ? 'num' : undefined}>
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
        {sorted.length} row{sorted.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
