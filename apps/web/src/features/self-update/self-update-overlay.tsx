import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SelfInfo } from '@stacky/shared'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { ErrorCard } from '@/features/operations/error-card'
import { OperationView } from '@/features/operations/operation-view'
import { useOperation } from '@/features/operations/use-operation'
import { api } from '@/lib/api'
import { selfUpdateStore, useSelfUpdate } from './store'

type Phase =
  | { kind: 'working' }
  | { kind: 'restarting' }
  | { kind: 'done'; version: string }
  | { kind: 'up-to-date' }
  | { kind: 'failed'; message: string; hint?: string }

/**
 * Follows a self-update: shows the pull output, then waits while stacky's
 * container is replaced, then reloads into the new version (or explains the
 * rollback).
 */
export function SelfUpdateOverlay() {
  const current = useSelfUpdate()
  if (!current) return null
  return <Overlay key={current.operationId} operationId={current.operationId} />
}

function Overlay({ operationId }: { operationId: string }) {
  const qc = useQueryClient()
  const op = useOperation(operationId)
  const [phase, setPhase] = useState<Phase>({ kind: 'working' })
  const opFailed = op?.state === 'failed' || op?.state === 'cancelled'
  const opDone = op?.state === 'succeeded'

  // After the hand-over, poll until the new instance reports the job's outcome.
  useEffect(() => {
    if (!opDone) return
    const finishedAt = op?.finishedAt ?? Date.now()
    let stopped = false
    const tick = async () => {
      let info: SelfInfo | undefined
      try {
        info = await api.get<SelfInfo>('/api/self')
      } catch {
        if (!stopped) setPhase({ kind: 'restarting' })
        return
      }
      const job = info.lastJob?.operationId === operationId ? info.lastJob : undefined
      if (!job) {
        // no updater was started: the image was already current
        if (Date.now() - finishedAt > 4000) setPhase({ kind: 'up-to-date' })
        return
      }
      if (job.state === 'succeeded') setPhase({ kind: 'done', version: info.version })
      else if (job.state === 'rolled_back' || job.state === 'failed' || job.state === 'stale')
        setPhase({
          kind: 'failed',
          message:
            job.state === 'rolled_back'
              ? 'The new version did not start, so stacky rolled back to the previous one.'
              : job.state === 'stale'
                ? 'The update did not finish in time.'
                : 'The update failed and the previous version could not be restored automatically.',
          hint: job.error,
        })
      else setPhase({ kind: 'restarting' })
    }
    void tick()
    const t = setInterval(() => void tick(), 1500)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [opDone, op?.finishedAt, operationId])

  useEffect(() => {
    if (phase.kind !== 'done') return
    // load the new version's UI
    const t = setTimeout(() => window.location.reload(), 1500)
    return () => clearTimeout(t)
  }, [phase.kind])

  const close = () => {
    selfUpdateStore.end()
    void qc.invalidateQueries({ queryKey: ['self'] })
  }
  const terminal = phase.kind === 'failed' || phase.kind === 'up-to-date' || opFailed

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Updating stacky"
      className="bg-background/85 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="bg-card flex max-h-[90svh] w-full max-w-2xl flex-col gap-4 rounded-2xl border p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Logo className="size-9" />
          <div>
            <h2 className="text-lg font-semibold">
              {phase.kind === 'done'
                ? `stacky ${phase.version} is up`
                : phase.kind === 'up-to-date'
                  ? 'stacky is up to date'
                  : phase.kind === 'failed' || opFailed
                    ? 'The update did not complete'
                    : phase.kind === 'restarting'
                      ? 'Restarting stacky…'
                      : 'Updating stacky…'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {phase.kind === 'restarting'
                ? 'The updater is replacing stacky’s container. This page reconnects when it is back.'
                : phase.kind === 'done'
                  ? 'Reloading…'
                  : phase.kind === 'working'
                    ? 'Pulling the image; stacky keeps running until it is ready.'
                    : ''}
            </p>
          </div>
          {(phase.kind === 'restarting' || (phase.kind === 'working' && !opFailed)) && (
            <Loader2 className="text-primary ml-auto size-5 animate-spin" />
          )}
          {phase.kind === 'done' && <CheckCircle2 className="text-status-running ml-auto size-6" />}
        </div>

        {phase.kind === 'failed' && (
          <ErrorCard error={{ message: phase.message, hint: phase.hint }} />
        )}
        {(phase.kind === 'working' || opFailed) && (
          <OperationView id={operationId} className="h-80" />
        )}

        {terminal && (
          <div className="flex justify-end gap-2">
            {phase.kind === 'failed' && (
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RotateCcw /> Reload
              </Button>
            )}
            <Button onClick={close}>Close</Button>
          </div>
        )}
      </div>
    </div>
  )
}
