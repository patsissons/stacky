import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCompare, History, Loader2, RotateCcw } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import type { OperationSummary, StackFiles, StackRevision } from '@stacky/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { actionLabel, operationTense } from '@/features/operations/actions'
import { OperationStateIcon } from '@/features/operations/operation-view'
import { operationStore } from '@/features/operations/store'
import { api, ApiError } from '@/lib/api'
import { formatDuration, formatRelative } from '@/lib/format'

const CodeDiff = lazy(() =>
  import('@/features/editor/code-editor').then((m) => ({ default: m.CodeDiff })),
)

/** Deployed versions (with diff and rollback) and every operation run on the stack. */
export function HistoryTab({
  stack,
  activeOperationId,
}: {
  stack: string
  activeOperationId?: string
}) {
  return (
    <div className="space-y-6">
      <Revisions stack={stack} activeOperationId={activeOperationId} />
      <Operations stack={stack} activeOperationId={activeOperationId} />
    </div>
  )
}

function Revisions({ stack, activeOperationId }: { stack: string; activeOperationId?: string }) {
  const qc = useQueryClient()
  const { data: revisions, isLoading } = useQuery({
    queryKey: ['revisions', stack, activeOperationId],
    queryFn: () => api.get<StackRevision[]>(`/api/stacks/${stack}/revisions`),
  })
  const { data: current } = useQuery({
    queryKey: ['stack-files', stack],
    queryFn: () => api.get<{ files: StackFiles }>(`/api/stacks/${stack}`).then((r) => r.files),
  })
  const [diff, setDiff] = useState<StackRevision>()
  const [restore, setRestore] = useState<StackRevision>()
  const [busy, setBusy] = useState(false)

  const isCurrent = (r: StackRevision) =>
    !!current &&
    r.compose === current.compose &&
    (r.env ?? '') === (current.hasEnv ? current.env : '')

  const doRestore = async () => {
    if (!restore) return
    setBusy(true)
    try {
      const op = await api.post<OperationSummary>(
        `/api/stacks/${stack}/revisions/${restore.id}/restore`,
      )
      operationStore.watch(op.id)
      operationStore.open(op.id)
      await qc.invalidateQueries({ queryKey: ['stack-files', stack] })
      setRestore(undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        description: err instanceof ApiError ? err.hint : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="size-4" /> Deployed versions
      </h2>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !revisions?.length ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          Every successful deploy saves the files it used here, so you can compare and roll back.
        </p>
      ) : (
        <ul className="bg-card divide-y rounded-xl border" aria-label="Deployed versions">
          {revisions.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{new Date(r.createdAt).toLocaleString()}</span>
              <span className="text-muted-foreground text-xs">{formatRelative(r.createdAt)}</span>
              {isCurrent(r) && (
                <span className="bg-status-running/12 text-status-running rounded-full px-2 py-0.5 text-xs font-medium">
                  current
                </span>
              )}
              {i === 0 && !isCurrent(r) && (
                <span className="text-muted-foreground text-xs">
                  last deployed · files changed since
                </span>
              )}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setDiff(r)} disabled={!current}>
                  <GitCompare /> Compare
                </Button>
                {!isCurrent(r) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRestore(r)}
                    disabled={!!activeOperationId}
                  >
                    <RotateCcw /> Restore
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(undefined)}>
        <DialogContent className="flex h-[80svh] max-w-6xl flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Compare with the current files</DialogTitle>
            <DialogDescription>
              Deployed {diff && formatRelative(diff.createdAt)} on the left, the files on disk now
              on the right.
            </DialogDescription>
          </DialogHeader>
          {diff && current && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
              <Suspense fallback={null}>
                <CodeDiff original={diff.compose} modified={current.compose} language="yaml" />
              </Suspense>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!restore} onOpenChange={(o) => !o && setRestore(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              The compose file and .env from{' '}
              {restore && new Date(restore.createdAt).toLocaleString()} replace the current ones and
              the stack is deployed. The current files stay in the history if they were deployed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRestore} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Restore &amp; deploy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function Operations({ stack, activeOperationId }: { stack: string; activeOperationId?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['operations', stack, activeOperationId],
    queryFn: () => api.get<OperationSummary[]>(`/api/operations?stack=${stack}&limit=100`),
  })
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Activity</h2>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data?.length ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          Nothing has been run on this stack yet.
        </p>
      ) : (
        <ul className="bg-card divide-y rounded-xl border" aria-label="Activity">
          {data.map((op) => (
            <li key={op.id}>
              <button
                type="button"
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                onClick={() => operationStore.open(op.id)}
              >
                <OperationStateIcon op={op} />
                <span className="font-medium">
                  {actionLabel(op.action, operationTense(op.state))}
                </span>
                {op.error && (
                  <span className="text-destructive min-w-0 flex-1 truncate">
                    {op.error.message}
                  </span>
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
      )}
    </section>
  )
}
