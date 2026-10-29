import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from './Badge.js'
import { Section } from './Section.js'

type PlanAction = 'add_index' | 'drop_index' | 'reindex' | 'vacuum' | 'review'

interface Recommendation {
  action: PlanAction
  table: string
  candidate_id?: string
  index_candidates?: string[]
  columns?: string[]
  ddl?: string
  rollback?: string
  severity: 'critical' | 'warning' | 'info'
  reason: string
  evidence?: string[]
  confidence?: 'high' | 'medium' | 'low'
}

interface ClearedItem {
  action: string
  table: string
  candidate_id?: string
  index?: string
  evidence?: string[]
  reason?: string
}

interface AgentPlan {
  tool: string
  model?: string
  generated_at: string
  usage?: { input: number; output: number; estimated_cost_usd: number }
  recommendations: Recommendation[]
  cleared?: ClearedItem[]
}

interface Score {
  tool: string
  rows: { id: string; kind: string; result: string; detail: string }[]
  summary: Record<string, string | number | string[]>
}

interface RunStatus {
  kind: 'agent' | 'baseline' | null
  running: boolean
  log: string[]
  startedAt: string | null
  exitCode: number | null
}

const actionColor: Record<PlanAction, 'red' | 'yellow' | 'green' | 'blue' | 'gray'> = {
  drop_index: 'red',
  reindex: 'yellow',
  add_index: 'green',
  vacuum: 'blue',
  review: 'gray',
}
const severityColor: Record<string, 'red' | 'yellow' | 'blue'> = { critical: 'red', warning: 'yellow', info: 'blue' }

const METRIC_LABELS: [string, string][] = [
  ['correct_decisions', 'Correct decisions'],
  ['recall', 'Issues found (recall)'],
  ['traps_passed', 'Traps passed'],
  ['controls_passed', 'Healthy tables untouched'],
  ['precision', 'Precision'],
  ['recs_with_executable_ddl', 'Recommendations with runnable DDL'],
]

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

interface EvidenceEntry {
  type: 'tool_call' | 'verdict'
  tool?: string
  input?: string
  output?: string
  verdict?: { verdict: string; action: string; confidence?: string }
}

/** The verification trajectory behind one plan item: every tool call the
 *  verifier made, straight from the run's logs (deliverable: agent
 *  trajectories, rendered where the user reads the recommendation). */
function EvidenceTrail({ candidateId }: { candidateId: string }) {
  const [entries, setEntries] = useState<EvidenceEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = async () => {
    if (entries || failed) return
    const data = await fetchJson<{ entries: EvidenceEntry[] }>(`/api/doctor/evidence/${candidateId}`)
    if (data) setEntries(data.entries)
    else setFailed(true)
  }

  return (
    <details className="evidence" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>evidence trail · how this was verified</summary>
      {failed && <div className="ev-step">trajectory not available for this plan</div>}
      {!entries && !failed && <div className="ev-step">loading…</div>}
      {entries?.map((e, i) =>
        e.type === 'tool_call' ? (
          <div key={i} className="ev-step">
            <span className="ev-tool">{e.tool}</span>
            <span className="ev-input">{e.input}</span>
            <pre className="ev-out">{e.output}</pre>
          </div>
        ) : (
          <div key={i} className="ev-step ev-verdict">
            verdict: <b>{e.verdict?.verdict}</b> → {e.verdict?.action}
            {e.verdict?.confidence ? ` (confidence: ${e.verdict.confidence})` : ''}
          </div>
        ),
      )}
    </details>
  )
}

export function Doctor() {
  const [connection, setConnection] = useState<string>('')
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [plan, setPlan] = useState<AgentPlan | null>(null)
  const [scores, setScores] = useState<{ sandbox?: boolean; agent: Score | null; baseline: Score | null } | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [vitals, setVitals] = useState<{ total_tables: number; total_indexes: number; total_db_size: string } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const refreshResults = useCallback(async () => {
    setPlan(await fetchJson<AgentPlan>('/api/doctor/plan/agent'))
    setScores(await fetchJson<{ sandbox?: boolean; agent: Score | null; baseline: Score | null }>('/api/doctor/scores'))
    const rep = await fetchJson<{ markdown: string }>('/api/doctor/report')
    setReport(rep?.markdown ?? null)
  }, [])

  useEffect(() => {
    fetchJson<{ url: string }>('/api/doctor/connection').then((c) => c && setConnection(c.url))
    fetchJson<RunStatus>('/api/doctor/status').then(setStatus)
    fetchJson<{ total_tables: number; total_indexes: number; total_db_size: string }>('/api/overview').then(setVitals)
    refreshResults()
  }, [refreshResults])

  // Poll while a run is in progress
  useEffect(() => {
    if (!status?.running) return
    const t = setInterval(async () => {
      const s = await fetchJson<RunStatus>('/api/doctor/status')
      if (s) {
        setStatus(s)
        if (!s.running) refreshResults()
      }
    }, 2000)
    return () => clearInterval(t)
  }, [status?.running, refreshResults])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [status?.log?.length])

  const startRun = async (kind: 'agent' | 'baseline') => {
    const res = await fetch(`/api/doctor/run/${kind}`, { method: 'POST' })
    if (res.ok) setStatus({ kind, running: true, log: [], startedAt: new Date().toISOString(), exitCode: null })
  }

  return (
    <div>
      <Section
        kicker="01 · target"
        title="Target Database"
        subtitle="Configured server-side via DATABASE_URL — credentials never pass through the browser. Access is read-only; the agent never executes DDL."
      >
        <div className="card">
          <div className="patient-strip">
            <span className="dot" style={connection ? undefined : { background: 'var(--ink-3)', boxShadow: 'none' }} />
            <span>
              patient:{' '}
              <b>{connection || 'not connected — no DATABASE_URL configured'}</b>
            </span>
            {vitals && (
              <>
                <span>
                  tables <b>{vitals.total_tables}</b>
                </span>
                <span>
                  indexes <b>{vitals.total_indexes}</b>
                </span>
                <span>
                  size <b>{vitals.total_db_size}</b>
                </span>
              </>
            )}
          </div>
          {!connection && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              Set <code>DATABASE_URL</code> in <code>.env</code> and restart the server. For the eval sandbox:{' '}
              <code>postgres://postgres:postgres@localhost:5499/indexdoctor</code>
            </div>
          )}
        </div>
      </Section>

      <Section
        kicker="02 · examine"
        title="Run Analysis"
        subtitle="The agent triages this database's statistics, then verifies every candidate with read-only tools (HypoPG hypothetical indexes, EXPLAIN, exact bloat measurement) before recommending anything. It never executes changes."
      >
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => startRun('agent')} disabled={status?.running || !connection} className="btn btn-primary">
            {status?.running && <span className="spinner" />}
            {status?.running ? `Running ${status.kind}...` : 'Run Index Doctor agent'}
            {!status?.running && <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>~10 min · ~$5 API</span>}
          </button>
          {scores?.sandbox && (
            <button onClick={() => startRun('baseline')} disabled={status?.running || !connection} className="btn">
              Run heuristic baseline <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>eval · seconds · free</span>
            </button>
          )}
          {status && !status.running && status.exitCode !== null && (
            <Badge color={status.exitCode === 0 ? 'green' : 'red'}>
              last {status.kind} run: {status.exitCode === 0 ? 'completed' : `exit ${status.exitCode}`}
            </Badge>
          )}
        </div>
        {status && status.log.length > 0 && (
          <pre ref={logRef} className="log">
            {status.log.join('\n')}
          </pre>
        )}
      </Section>

      {!plan && !status?.running && (
        <Section kicker="03 · diagnosis" title="Verified Remediation Plan">
          <div className="empty-card">
            No diagnosis yet for this database — run the Index Doctor agent above. Every recommendation it
            produces will carry tool-verified evidence, exact DDL, and a rollback.
          </div>
        </Section>
      )}

      {plan && (
        <Section
          kicker="03 · diagnosis"
          title={`Verified Remediation Plan (${plan.recommendations.length})`}
          subtitle={`Generated ${new Date(plan.generated_at).toLocaleString()}${plan.model ? ` by ${plan.model}` : ''} — every item carries the evidence that justifies it`}
        >
          <div className="sev-chips">
            {(['critical', 'warning', 'info'] as const).map((sev) => {
              const n = plan.recommendations.filter((r) => r.severity === sev).length
              return n > 0 ? (
                <Badge key={sev} color={severityColor[sev] ?? 'blue'}>
                  {n} {sev}
                </Badge>
              ) : null
            })}
            {plan.usage && <Badge color="gray">verified for ${plan.usage.estimated_cost_usd}</Badge>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plan.recommendations.map((r, i) => (
              <div
                key={i}
                className="card"
                style={{
                  borderLeft: `3px solid ${r.severity === 'critical' ? 'var(--crit)' : r.severity === 'warning' ? 'var(--warn)' : 'var(--info)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge color={severityColor[r.severity] ?? 'blue'}>{r.severity.toUpperCase()}</Badge>
                  <Badge color={actionColor[r.action]}>{r.action.replace('_', ' ').toUpperCase()}</Badge>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                    {r.table}
                    {r.index_candidates?.length ? `.${r.index_candidates.join(', ')}` : ''}
                    {r.columns?.length ? ` (${r.columns.join(', ')})` : ''}
                  </span>
                  {r.confidence && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>confidence: {r.confidence}</span>
                  )}
                </div>
                {r.ddl && (
                  <pre className="codeblock">
                    {r.ddl}
                    {r.rollback ? `\n-- rollback: ${r.rollback}` : ''}
                  </pre>
                )}
                {r.evidence && r.evidence.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {r.evidence.map((e, j) => (
                      <li key={j} style={{ marginBottom: 2 }}>
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>{r.reason}</div>
                {r.candidate_id && <EvidenceTrail candidateId={r.candidate_id} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {plan?.cleared && plan.cleared.length > 0 && (
        <Section
          kicker="04 · cleared"
          title={`Examined and Deliberately Left Alone (${plan.cleared.length})`}
          subtitle="Objects the heuristics would flag — or a human might worry about — that the agent verified and cleared. These prevent bad changes."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plan.cleared.map((c, i) => (
              <div key={i} className="card" style={{ borderLeft: '3px solid var(--good)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge color="green">{c.action.replace('_', ' ').toUpperCase()}</Badge>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                    {c.table}
                    {c.index ? `.${c.index}` : ''}
                  </span>
                </div>
                {c.evidence && c.evidence.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)' }}>
                    {c.evidence.map((e, j) => (
                      <li key={j} style={{ marginBottom: 2 }}>
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
                {c.reason && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>{c.reason}</div>}
                {c.candidate_id && <EvidenceTrail candidateId={c.candidate_id} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      {report && (
        <Section kicker="05 · document" title="Full Report" subtitle="The remediation document the agent wrote (eval/results/REPORT.md)">
          <details className="card">
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              Show REPORT.md
            </summary>
            <pre style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>{report}</pre>
          </details>
        </Section>
      )}
      {scores && scores.sandbox && scores.agent && scores.baseline && (
        <Section
          kicker="appendix · eval harness"
          title="Scoreboard — Agent vs. Heuristics"
          subtitle="Only shown on the eval sandbox: both tools scored against its 14 planted ground-truth cases"
        >
          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 16px 8px 0', color: 'var(--ink-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metric</th>
                  <th style={{ textAlign: 'left', padding: '6px 16px 8px', color: 'var(--ink-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Heuristic baseline</th>
                  <th style={{ textAlign: 'left', padding: '6px 16px 8px', color: 'var(--ink-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Index Doctor agent</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_LABELS.map(([key, label]) => (
                  <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 16px 9px 0', color: 'var(--ink-2)' }}>{label}</td>
                    <td style={{ padding: '9px 16px', color: 'var(--warn)', fontVariantNumeric: 'tabular-nums' }}>{String(scores.baseline?.summary[key] ?? '—')}</td>
                    <td style={{ padding: '9px 16px', color: '#5fd374', fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{String(scores.agent?.summary[key] ?? '—')}</td>
                  </tr>
                ))}
                {plan?.usage && (
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 16px 9px 0', color: 'var(--ink-2)' }}>Measured cost</td>
                    <td style={{ padding: '9px 16px', color: 'var(--warn)' }}>free</td>
                    <td style={{ padding: '9px 16px', color: '#5fd374' }}>${plan.usage.estimated_cost_usd}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

    </div>
  )
}
