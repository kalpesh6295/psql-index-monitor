import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'index-monitor:privacy'

export function usePrivacy() {
  const [privacy, setPrivacy] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, privacy ? '1' : '0')
    } catch {}
  }, [privacy])

  const toggle = useCallback(() => setPrivacy((p) => !p), [])

  return { privacy, toggle }
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36).padStart(4, '0').slice(0, 4)
}

export function maskTable(name: string): string {
  if (!name) return name
  return `table_${hash(name)}`
}

export function maskIndex(name: string): string {
  if (!name) return name
  return `idx_${hash(name)}`
}

export function maskColumn(name: string): string {
  if (!name) return name
  return `col_${hash(name)}`
}

const SQL_KEYWORDS = new Set([
  'create', 'index', 'unique', 'on', 'using', 'where', 'and', 'or', 'not',
  'is', 'null', 'case', 'when', 'then', 'else', 'end', 'true', 'false',
  'btree', 'hash', 'gin', 'gist', 'brin', 'spgist',
  'public', 'text', 'bigint', 'integer', 'boolean', 'timestamp', 'timestamptz',
  'date', 'varchar', 'char', 'jsonb', 'json', 'uuid', 'numeric', 'real',
  'double', 'precision', 'in', 'like', 'ilike', 'as', 'desc', 'asc',
  'nulls', 'first', 'last', 'coalesce', 'lower', 'upper',
])

export function maskDefinition(def: string): string {
  if (!def) return def
  return def
    .replace(/'[^']*'/g, "'…'")
    .replace(/"([^"]+)"/g, (_, name: string) => {
      const lower = name.toLowerCase()
      if (lower.startsWith('idx_') || lower.includes('index')) return `"idx_${hash(name)}"`
      return `"col_${hash(name)}"`
    })
    .replace(/\bpublic\.([a-z_][a-z_0-9]*)/gi, (_, t: string) => `public.table_${hash(t)}`)
    .replace(/\b([a-z_][a-z_0-9]*)\b/gi, (m) => {
      if (SQL_KEYWORDS.has(m.toLowerCase())) return m
      if (/^idx_[0-9a-z]+$/i.test(m) || /^col_[0-9a-z]+$/i.test(m) || /^table_[0-9a-z]+$/i.test(m)) return m
      return `col_${hash(m)}`
    })
}

export function maskColumnList(cols: string): string {
  if (!cols) return cols
  return cols
    .split(/,\s*/)
    .map((c) => `col_${hash(c.trim())}`)
    .join(', ')
}

export function maskSize(size: string | null | undefined): string {
  if (!size) return size ?? ''
  return size.replace(/[\d.,]+/, '•••')
}
