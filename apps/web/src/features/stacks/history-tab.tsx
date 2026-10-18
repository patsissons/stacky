import { useQuery } from '@tanstack/react-query'
import type { OperationSummary } from '@stacky/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { actionLabel } from '@/features/operations/actions'
import { OperationStateIcon } from '@/features/operations/operation-view'
import { operationStore } from '@/features/operations/store'
import { api } from '@/lib/api'
import { formatDuration, formatRelative } from '@/lib/format'

/** Every operation run against this stack, newest first. */
export function HistoryTab({
  stack,
  activeOperationId,
}: {
  stack: string
  activeOperationId?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['operations', stack, activeOperationId],
    queryFn: () => api.get<OperationSummary[]>(`/api/operations?stack=${stack}&limit=100`),
  })
  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (!data?.length)
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        Nothing has been run on this stack yet.
      </p>
    )
  return (
    <ul className="bg-card divide-y rounded-xl border">
      {data.map((op) => (
        <li key={op.id}>
          <button
            type="button"
            className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
            onClick={() => operationStore.open(op.id)}
          >
            <OperationStateIcon op={op} />
            <span className="font-medium">{actionLabel(op.action, op.state === 'succeeded')}</span>
            {op.error && (
              <span className="text-destructive min-w-0 flex-1 truncate">{op.error.message}</span>
            )}
            <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
              {op.finishedAt && op.startedAt
                ? `${formatDuration(op.finishedAt - op.startedAt)} · `
                : ''}
              {formatRelative(op.createdAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
