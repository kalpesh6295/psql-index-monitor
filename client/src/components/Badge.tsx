interface BadgeProps {
  children: React.ReactNode
  color: 'red' | 'yellow' | 'green' | 'blue' | 'gray'
}

const colors = {
  red: { bg: '#3b1219', text: '#f87171' },
  yellow: { bg: '#3b2f12', text: '#facc15' },
  green: { bg: '#123b1e', text: '#4ade80' },
  blue: { bg: '#12233b', text: '#60a5fa' },
  gray: { bg: '#2a2a3a', text: '#888' },
}

export function Badge({ children, color }: BadgeProps) {
  const c = colors[color]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.text,
      }}
    >
      {children}
    </span>
  )
}
