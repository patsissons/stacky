import type { Terminal } from '@xterm/xterm'
import { CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { OperationSummary } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Xterm } from '@/features/terminal/xterm'
import { actionLabel, operationTense } from './actions'
import { ErrorCard } from './error-card'
import { isFinished, useOperation } from './use-operation'

export function OperationStateIcon({
  op,
  className,
}: {
  op?: OperationSummary
  className?: string
}) {
  if (!op || op.state === 'queued' || op.state === 'running') {
    return <Loader2 className={cn('text-primary size-4 animate-spin', className)} />
  }
  if (op.state === 'succeeded')
    return <CheckCircle2 className={cn('text-status-running size-4', className)} />
  if (op.state === 'cancelled')
    return <CircleSlash className={cn('text-muted-foreground size-4', className)} />
  return <XCircle className={cn('text-destructive size-4', className)} />
}

function useElapsed(op: OperationSummary | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const running = !!op && !isFinished(op)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])
  if (!op?.startedAt) return undefined
  return (op.finishedAt ?? now) - op.startedAt
}

/** Live output, status and classified error for one operation. */
export function OperationView({ id, className }: { id: string; className?: string }) {
  const termRef = useRef<Terminal | null>(null)
  const pending = useRef<string[]>([])
  const op = useOperation(id, (chunk) => {
    if (termRef.current) termRef.current.write(chunk)
    else pending.current.push(chunk)
  })
  const elapsed = useElapsed(op)

  const cancel = () =>
    api.post(`/api/operations/${id}/cancel`).catch((err: Error) => toast.error(err.message))

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <OperationStateIcon op={op} />
        <span className="font-medium">
          {op ? `${actionLabel(op.action, operationTense(op.state))} ${op.stack}` : 'Loading…'}
        </span>
        {op?.state === 'failed' && <span className="text-destructive text-sm">failed</span>}
        {op?.state === 'cancelled' && (
          <span className="text-muted-foreground text-sm">cancelled</span>
        )}
        {elapsed !== undefined && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatDuration(elapsed)}
          </span>
        )}
        {op && !isFinished(op) && (
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
      {op?.error && <ErrorCard error={op.error} />}
      <Xterm
        className="min-h-48 flex-1"
        options={{
          disableStdin: true,
          cursorBlink: false,
          cursorStyle: 'bar',
          cursorInactiveStyle: 'none',
        }}
        onReady={(term) => {
          termRef.current = term
          for (const chunk of pending.current) term.write(chunk)
          pending.current = []
          return () => {
            termRef.current = null
          }
        }}
      />
    </div>
  )
}
