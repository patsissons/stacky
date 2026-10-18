import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <g className="fill-primary-foreground">
        <rect x="7" y="8" width="18" height="4" rx="1.5" />
        <rect x="7" y="14" width="18" height="4" rx="1.5" opacity=".8" />
        <rect x="7" y="20" width="18" height="4" rx="1.5" opacity=".6" />
      </g>
    </svg>
  )
}
