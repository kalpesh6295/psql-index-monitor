interface SectionProps {
  title: string
  subtitle?: string
  /** Small mono label above the title, e.g. "01 · connect". */
  kicker?: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
}

export function Section({ title, subtitle, kicker, children, loading, error }: SectionProps) {
  return (
    <section className="section">
      <div className="section-head">
        {kicker && <div className="kicker">{kicker}</div>}
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-sub">{subtitle}</p>}
      </div>
      {loading ? (
        <div style={{ color: 'var(--ink-3)', padding: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#fff' }} /> Loading...
        </div>
      ) : error ? (
        <div
          style={{
            color: 'var(--crit)',
            padding: '14px 18px',
            background: 'rgba(224,82,82,0.09)',
            border: '1px solid rgba(224,82,82,0.25)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
        >
          Error: {error}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
