// Read-only database tools for the Index Doctor agent.
//
// Safety model: every connection sets default_transaction_read_only=on, so
// even a malformed tool call cannot mutate the database. DDL is never executed
// by the agent — it only ships as text in the remediation plan, and apply.ts
// gates execution behind human approval against a cloned database.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { Pool } from 'pg'
import { createDbPool } from '../shared/db.js'

export type TrajectoryLogger = (entry: Record<string, unknown>) => void

const ROW_LIMIT = 50

function formatRows(rows: Record<string, unknown>[]): string {
  const shown = rows.slice(0, ROW_LIMIT)
  const body = JSON.stringify(shown, null, 1)
  const note = rows.length > ROW_LIMIT ? `\n(${rows.length - ROW_LIMIT} more rows truncated)` : ''
  return `${rows.length} row(s)\n${body}${note}`
}

function assertReadOnlySelect(sql: string, label: string) {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (trimmed.includes(';')) throw new Error(`${label}: a single statement is required`)
  if (!/^(select|with|explain|show)\b/i.test(trimmed)) {
    throw new Error(`${label}: only SELECT / WITH / EXPLAIN / SHOW statements are allowed`)
  }
  return trimmed
}

export function createPool(url: string): Pool {
  return createDbPool(url, { readOnly: true, statementTimeout: '20s', max: 4 })
}

export function createTools(pool: Pool, queryCatalogDir: string | null, log: TrajectoryLogger) {
  const wrap = <I,>(name: string, fn: (input: I) => Promise<string>) => {
    return async (input: I): Promise<string> => {
      let output: string
      try {
        output = await fn(input)
      } catch (err) {
        output = `ERROR: ${err instanceof Error ? err.message : String(err)}`
      }
      log({ type: 'tool_call', tool: name, input, output })
      return output
    }
  }

  const runSql = betaZodTool({
    name: 'run_sql',
    description:
      'Run a single read-only SQL statement (SELECT / WITH / EXPLAIN / SHOW) against the target database. Use for pg_catalog / pg_stat inspection. Results are capped at 50 rows.',
    inputSchema: z.object({
      sql: z.string().describe('One read-only SQL statement'),
    }),
    run: wrap('run_sql', async ({ sql }) => {
      const stmt = assertReadOnlySelect(sql, 'run_sql')
      const res = await pool.query(stmt)
      return formatRows(res.rows)
    }),
  })

  const explainQuery = betaZodTool({
    name: 'explain_query',
    description:
      'EXPLAIN a query and return the plan. Supports parameterized queries with $1/$2 placeholders (planned via GENERIC_PLAN). Use this to see how the planner executes an application query today.',
    inputSchema: z.object({
      sql: z.string().describe('The query to explain (may contain $n placeholders)'),
    }),
    run: wrap('explain_query', async ({ sql }) => {
      const stmt = assertReadOnlySelect(sql, 'explain_query').replace(/^explain\s+/i, '')
      const generic = /\$\d/.test(stmt) ? ', GENERIC_PLAN' : ''
      const res = await pool.query(`EXPLAIN (FORMAT TEXT${generic}) ${stmt}`)
      return res.rows.map((r) => r['QUERY PLAN']).join('\n')
    }),
  })

  const testHypotheticalIndex = betaZodTool({
    name: 'test_hypothetical_index',
    description:
      'Test whether the planner would use a proposed index, WITHOUT building it (HypoPG). Provide the CREATE INDEX statement and a query; returns the plan before and after the hypothetical index exists, and whether the planner chose it. This is the required evidence for any add_index recommendation.',
    inputSchema: z.object({
      index_ddl: z.string().describe("e.g. CREATE INDEX ON orders (user_id)"),
      query_sql: z.string().describe('The query to plan (may contain $n placeholders)'),
    }),
    run: wrap('test_hypothetical_index', async ({ index_ddl, query_sql }) => {
      const ddl = index_ddl.trim().replace(/;\s*$/, '')
      if (!/^create\s+index\b/i.test(ddl) || ddl.includes(';')) {
        throw new Error('index_ddl must be a single CREATE INDEX statement')
      }
      const query = assertReadOnlySelect(query_sql, 'query_sql')
      const generic = /\$\d/.test(query) ? ', GENERIC_PLAN' : ''
      const client = await pool.connect()
      try {
        await client.query('SELECT hypopg_reset()')
        const before = await client.query(`EXPLAIN (FORMAT TEXT${generic}) ${query}`)
        const created = await client.query('SELECT indexname FROM hypopg_create_index($1)', [ddl])
        const hypoName: string = created.rows[0].indexname
        const after = await client.query(`EXPLAIN (FORMAT TEXT${generic}) ${query}`)
        await client.query('SELECT hypopg_reset()')
        const beforeTxt = before.rows.map((r) => r['QUERY PLAN']).join('\n')
        const afterTxt = after.rows.map((r) => r['QUERY PLAN']).join('\n')
        const used = afterTxt.includes(hypoName)
        return [
          `hypothetical index: ${hypoName}`,
          `planner_used_it: ${used}`,
          `--- plan WITHOUT index ---`,
          beforeTxt,
          `--- plan WITH hypothetical index ---`,
          afterTxt,
        ].join('\n')
      } finally {
        client.release()
      }
    }),
  })

  const getQueryStats = betaZodTool({
    name: 'get_query_stats',
    description:
      'Top statements from pg_stat_statements for the observation window, ordered by total execution time. Shows what the database actually spends its time on — including expensive queries that never show up as seq scans.',
    inputSchema: z.object({}),
    run: wrap('get_query_stats', async () => {
      const res = await pool.query(`
        SELECT left(query, 400) AS query, calls,
               round(mean_exec_time::numeric, 2) AS mean_ms,
               round(total_exec_time::numeric) AS total_ms,
               rows
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT ILIKE '%pg_stat%'
          AND query NOT ILIKE '%hypopg%'
          AND query NOT ILIKE 'explain%'
        ORDER BY total_exec_time DESC
        LIMIT 20`)
      return formatRows(res.rows)
    }),
  })

  const inspectIndex = betaZodTool({
    name: 'inspect_index',
    description:
      'Full detail for one index: definition, size, scan count, uniqueness, partial predicate, whether it backs a constraint, and table stats. Required evidence before recommending a drop.',
    inputSchema: z.object({
      index_name: z.string(),
    }),
    run: wrap('inspect_index', async ({ index_name }) => {
      const res = await pool.query(
        `SELECT c.relname AS index_name,
                t.relname AS table_name,
                pg_get_indexdef(c.oid) AS definition,
                pg_size_pretty(pg_relation_size(c.oid)) AS size,
                s.idx_scan,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                pg_get_expr(ix.indpred, ix.indrelid) AS partial_predicate,
                con.conname AS backing_constraint,
                con.contype AS constraint_type,
                t2.n_live_tup AS table_rows,
                t2.seq_scan AS table_seq_scans
         FROM pg_class c
         JOIN pg_index ix ON ix.indexrelid = c.oid
         JOIN pg_class t ON t.oid = ix.indrelid
         LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = c.oid
         LEFT JOIN pg_constraint con ON con.conindid = c.oid
         LEFT JOIN pg_stat_user_tables t2 ON t2.relid = t.oid
         WHERE c.relname = $1`,
        [index_name],
      )
      if (res.rows.length === 0) return `No index named "${index_name}" found`
      return formatRows(res.rows)
    }),
  })

  const listAppQueries = betaZodTool({
    name: 'list_app_queries',
    description:
      "The application's known query catalog — every query the codebase and its scheduled jobs run, including rare ones (cron jobs, monthly reports) that may not appear in the current stats window. Check this before declaring an index unused.",
    inputSchema: z.object({}),
    run: wrap('list_app_queries', async () => {
      if (!queryCatalogDir) {
        return 'No application query catalog is configured for this database (set QUERY_CATALOG_DIR to a directory of the application\'s .sql queries). Without it, rare scheduled queries cannot be checked — treat "zero scans in the window" as weak evidence and be conservative with drop recommendations.'
      }
      const files = readdirSync(queryCatalogDir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
      return files
        .map((f) => `===== ${f} =====\n${readFileSync(join(queryCatalogDir, f), 'utf8').trim()}`)
        .join('\n\n')
    }),
  })

  return [runSql, explainQuery, testHypotheticalIndex, getQueryStats, inspectIndex, listAppQueries]
}
