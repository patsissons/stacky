import { cn } from '@/lib/utils'

/** Tiny inline trend line; values are normalised to the given max. */
export function Sparkline({
  values,
  max,
  className,
}: {
  values: number[]
  max: number
  className?: string
}) {
  if (values.length < 2) return <span className={cn('inline-block h-5 w-16', className)} />
  const w = 64
  const h = 20
  const top = Math.max(max, ...values, 1e-9)
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / top) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-5 w-16 overflow-visible', className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
