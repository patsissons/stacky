import { useEffect } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { liveSocket } from '@/lib/ws'
import { actionLabel } from './actions'
import { OperationView } from './operation-view'
import { operationStore, useOperationStore } from './store'

/** Bottom drawer showing the selected operation's live output. */
export function OperationDrawer() {
  const { openId } = useOperationStore()
  return (
    <Sheet open={!!openId} onOpenChange={(open) => !open && operationStore.close()}>
      <SheetContent side="bottom" className="flex h-[70svh] flex-col gap-0 p-4 sm:p-5">
        <SheetTitle className="sr-only">Operation output</SheetTitle>
        <SheetDescription className="sr-only">
          Live output of a docker compose operation
        </SheetDescription>
        {openId && <OperationView key={openId} id={openId} className="h-full pt-2" />}
      </SheetContent>
    </Sheet>
  )
}

/** Toasts the result of every operation started from this tab. */
export function OperationWatcher() {
  const { watching } = useOperationStore()
  useEffect(() => {
    const unsubs = [...watching].map((id) =>
      liveSocket.subscribe(`op:${id}`, (msg) => {
        if (msg.type !== 'op') return
        const op = msg.operation
        if (op.state === 'queued' || op.state === 'running') return
        operationStore.unwatch(id)
        const title = `${actionLabel(op.action, true)} ${op.stack}`
        const view = { label: 'View output', onClick: () => operationStore.open(op.id) }
        if (op.state === 'succeeded') toast.success(title, { action: view })
        else if (op.state === 'cancelled')
          toast.message(`${actionLabel(op.action, false)} ${op.stack} cancelled`)
        else
          toast.error(op.error?.message ?? `${actionLabel(op.action, false)} ${op.stack} failed`, {
            description: op.error?.hint,
            action: view,
            duration: 15_000,
          })
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [watching])
  return null
}
