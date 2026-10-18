import type { ServiceState, StackStatus } from '@stacky/shared'
import { cn } from '@/lib/utils'

type Tone = 'running' | 'warning' | 'error' | 'idle' | 'info'

const STACK: Record<StackStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  running: { label: 'Running', tone: 'running' },
  starting: { label: 'Starting', tone: 'info', pulse: true },
  partial: { label: 'Partial', tone: 'warning' },
  unhealthy: { label: 'Unhealthy', tone: 'error' },
  stopped: { label: 'Stopped', tone: 'idle' },
  error: { label: 'Error', tone: 'error' },
  inactive: { label: 'Inactive', tone: 'idle' },
}

const SERVICE: Record<ServiceState, { label: string; tone: Tone; pulse?: boolean }> = {
  running: { label: 'Running', tone: 'running' },
  healthy: { label: 'Healthy', tone: 'running' },
  unhealthy: { label: 'Unhealthy', tone: 'error' },
  starting: { label: 'Starting', tone: 'info', pulse: true },
  restarting: { label: 'Restarting', tone: 'warning', pulse: true },
  paused: { label: 'Paused', tone: 'idle' },
  completed: { label: 'Completed', tone: 'running' },
  exited: { label: 'Exited', tone: 'idle' },
  error: { label: 'Error', tone: 'error' },
  created: { label: 'Created', tone: 'idle' },
  not_created: { label: 'Not created', tone: 'idle' },
}

const DOT: Record<Tone, string> = {
  running: 'bg-status-running',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  idle: 'bg-status-idle',
  info: 'bg-status-info',
}

const BADGE: Record<Tone, string> = {
  running: 'bg-status-running/12 text-status-running ring-status-running/25',
  warning: 'bg-status-warning/15 text-status-warning ring-status-warning/30',
  error: 'bg-status-error/12 text-status-error ring-status-error/25',
  idle: 'bg-muted text-muted-foreground ring-border',
  info: 'bg-status-info/12 text-status-info ring-status-info/25',
}

export function stackStatusMeta(status: StackStatus) {
  return STACK[status]
}

export function serviceStateMeta(state: ServiceState) {
  return SERVICE[state]
}

export function StatusDot({
  tone,
  pulse,
  className,
  hollow,
}: {
  tone: Tone
  pulse?: boolean
  className?: string
  hollow?: boolean
}) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)} aria-hidden>
      {pulse && (
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOT[tone])} />
      )}
      <span
        className={cn(
          'relative inline-flex size-2.5 rounded-full',
          hollow ? 'border-status-idle border-2 border-dashed' : DOT[tone],
        )}
      />
    </span>
  )
}

export function StackStatusBadge({
  status,
  className,
}: {
  status: StackStatus
  className?: string
}) {
  const meta = STACK[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE[meta.tone],
        className,
      )}
    >
      <StatusDot tone={meta.tone} pulse={meta.pulse} className="size-1.5 [&>span]:size-1.5" />
      {meta.label}
    </span>
  )
}

export function ServiceStateBadge({
  state,
  className,
}: {
  state: ServiceState
  className?: string
}) {
  const meta = SERVICE[state]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE[meta.tone],
        className,
      )}
    >
      <StatusDot
        tone={meta.tone}
        pulse={meta.pulse}
        hollow={state === 'not_created'}
        className="size-1.5 [&>span]:size-1.5"
      />
      {meta.label}
    </span>
  )
}
