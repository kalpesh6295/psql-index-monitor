interface SectionProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
}

export function Section({ title, subtitle, children, loading, error }: SectionProps) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#e0e0e0', margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: '#666', margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {loading ? (
        <div style={{ color: '#666', padding: 20 }}>Loading...</div>
      ) : error ? (
        <div style={{ color: '#f87171', padding: 20, background: '#3b1219', borderRadius: 8 }}>Error: {error}</div>
      ) : (
        children
      )}
    </section>
  )
}
