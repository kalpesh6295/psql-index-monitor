interface BadgeProps {
  children: React.ReactNode
  color: 'red' | 'yellow' | 'green' | 'blue' | 'gray'
}

export function Badge({ children, color }: BadgeProps) {
  return <span className={`badge ${color}`}>{children}</span>
}
