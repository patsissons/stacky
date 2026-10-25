import { useEffect } from 'react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { liveSocket } from '@/lib/ws'
import { actionLabel } from './actions'
import { OperationStateIcon, OperationView } from './operation-view'
import { operationStore, useOperationStore } from './store'
import { useOperation } from './use-operation'

/** Bottom drawer showing the open operations' live output, one tab each when there are several. */
export function OperationDrawer() {
  const { openIds, openId } = useOperationStore()
  return (
    <Sheet open={!!openId} onOpenChange={(open) => !open && operationStore.close()}>
      <SheetContent side="bottom" className="flex h-[70svh] flex-col gap-0 p-4 sm:p-5">
        <SheetTitle className="sr-only">Operation output</SheetTitle>
        <SheetDescription className="sr-only">
          Live output of a docker compose operation
        </SheetDescription>
        {openIds.length > 1 && (
          <Tabs value={openId} onValueChange={operationStore.select} className="pr-8">
            <TabsList
              variant="line"
              aria-label="Operations"
              className="w-full justify-start overflow-x-auto"
            >
              {openIds.map((id) => (
                <OperationTab key={id} id={id} />
              ))}
            </TabsList>
          </Tabs>
        )}
        {openId && <OperationView key={openId} id={openId} className="min-h-0 flex-1 pt-2" />}
      </SheetContent>
    </Sheet>
  )
}

function OperationTab({ id }: { id: string }) {
  const op = useOperation(id)
  return (
    <TabsTrigger value={id} className="flex-none">
      <OperationStateIcon op={op} />
      {op?.stack ?? '…'}
    </TabsTrigger>
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
        // the drawer already shows this result (and the toast would cover it on phones)
        if (operationStore.get().openIds.includes(op.id)) return
        const title = `${actionLabel(op.action, true)} ${op.stack}`
        const view = { label: 'View output', onClick: () => operationStore.open(op.id) }
        if (op.state === 'succeeded') toast.success(title, { action: view })
        else if (op.state === 'cancelled')
          toast.message(`${actionLabel(op.action, 'verb')} ${op.stack} cancelled`)
        else
          toast.error(op.error?.message ?? `${actionLabel(op.action, 'verb')} ${op.stack} failed`, {
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
