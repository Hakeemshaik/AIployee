interface Props {
  /** 0–1, values above 1 are allowed and shown as a full ring. */
  progress: number
  size?: number
  thickness?: number
  color?: string
  trackColor?: string
  children?: React.ReactNode
}

export function Ring({
  progress,
  size = 112,
  thickness = 11,
  color = 'var(--kcal)',
  trackColor = 'var(--surface-2)',
  children,
}: Props) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const over = progress > 1.0001

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={over ? 'var(--warn)' : color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 0.45s cubic-bezier(.2,.8,.3,1)' }}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  )
}
