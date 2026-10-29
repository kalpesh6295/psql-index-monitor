// Single source of truth for database connection handling. Every entry point
// (dashboard server, agent, baseline, eval harness, workload driver) builds
// its pool here, so policies like remote SSL and read-only enforcement exist
// in exactly one place.

import { join } from 'node:path'
import { Pool } from 'pg'

/**
 * The eval sandbox's address — these throwaway credentials are defined by
 * eval/sandbox/docker-compose.yml itself. This constant exists so sandbox-owned
 * scripts and docs can reference it EXPLICITLY; nothing connects to it by
 * default.
 */
export const SANDBOX_URL = 'postgres://postgres:postgres@localhost:5499/indexdoctor'

/** The explicitly configured analysis target, or null — there is no default. */
export function targetUrl(): string | null {
  return process.env.SANDBOX_DATABASE_URL || null
}

/** Resolve the target or exit with actionable guidance. For CLI entry points. */
export function requireTargetUrl(toolName: string): string {
  const url = targetUrl()
  if (!url) {
    console.error(
      `${toolName}: no target database configured — there is deliberately no default.\n` +
        `Set SANDBOX_DATABASE_URL, e.g. for the eval sandbox created by eval/sandbox/setup.sh:\n` +
        `  export SANDBOX_DATABASE_URL='${SANDBOX_URL}'`,
    )
    process.exit(1)
  }
  return url
}

/** True when a URL points at the eval sandbox database ("indexdoctor"). */
export function isSandboxUrl(url: string): boolean {
  return /\/indexdoctor(\?|$)/.test(url)
}

/** Hide the password when a URL is logged or returned to a client. */
export function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:@/]+):[^@/]+@/, '://$1:***@')
}

/**
 * Where run artifacts for a target belong. Sandbox runs are shareable
 * evidence (eval/results); anything else may describe a private schema and is
 * routed to the gitignored eval/local-private so it can never be committed
 * or end up in the submission by accident.
 */
export function resultsDirFor(root: string, url: string): string {
  return join(root, 'eval', isSandboxUrl(url) ? 'results' : 'local-private')
}

export function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1')
  // Managed Postgres almost always requires TLS; local containers don't offer it.
  return isLocalhost ? false : { rejectUnauthorized: false }
}

export interface PoolOptions {
  max?: number
  /** Enforce read-only at the session level — the database itself rejects writes. */
  readOnly?: boolean
  /** Per-statement timeout, e.g. '20s'. Always set one against shared databases. */
  statementTimeout?: string
}

export function createDbPool(url: string, opts: PoolOptions = {}): Pool {
  const settings: string[] = []
  if (opts.readOnly) settings.push('-c default_transaction_read_only=on')
  if (opts.statementTimeout) settings.push(`-c statement_timeout=${opts.statementTimeout}`)
  return new Pool({
    connectionString: url,
    max: opts.max ?? 4,
    ssl: sslFor(url),
    ...(settings.length ? { options: settings.join(' ') } : {}),
  })
}
