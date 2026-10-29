import dotenv from 'dotenv'
import type { Pool } from 'pg'
import { createDbPool } from '../shared/db.js'

dotenv.config()

// The dashboard only ever reads; enforcement lives in the shared pool factory.
const DASHBOARD_POOL_OPTS = { readOnly: true, statementTimeout: '30s', max: 10 } as const

// There is deliberately no default database, and the target is configured
// server-side only (DATABASE_URL) — credentials never pass through the browser.
const currentUrl = process.env.DATABASE_URL || ''
const currentPool: Pool | null = currentUrl ? createDbPool(currentUrl, DASHBOARD_POOL_OPTS) : null

export function getDatabaseUrl(): string {
  return currentUrl
}

// Shim keeps every existing `pool.query(...)` call site working whether or not
// a database is configured.
export const pool = {
  query: (text: string, params?: unknown[]) => {
    if (!currentPool) {
      return Promise.reject(new Error('No database configured — set DATABASE_URL in .env and restart the server.'))
    }
    return currentPool.query(text, params)
  },
}
