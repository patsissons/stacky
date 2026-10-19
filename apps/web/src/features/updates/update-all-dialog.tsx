import { ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { UpdatePlan } from '@/features/containers/rows'
import { bumpServiceImage, runServiceAction } from '@/features/operations/actions'

/** Confirms and applies every available update, one service at a time. */
export function UpdateAllDialog({
  plan,
  open,
  onClose,
}: {
  plan: UpdatePlan
  open: boolean
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const count = plan.steps.length

  const apply = async () => {
    setBusy(true)
    const failed: string[] = []
    // Sequential on purpose: a tag bump rewrites the stack's compose file, so two at once
    // would race. The server queues the resulting operations per stack.
    for (const step of plan.steps) {
      try {
        if (step.kind === 'bump') await bumpServiceImage(step.stack, step.service, step.newerTag!)
        else await runServiceAction(step.stack, step.service, 'update')
      } catch (err) {
        failed.push(step.service)
        toast.error(
          `${step.stack} / ${step.service}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    setBusy(false)
    onClose()
    const started = count - failed.length
    if (started > 0) {
      toast.message(`Updating ${started} service${started === 1 ? '' : 's'}`, {
        description: 'Each one reports back when it finishes.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update all containers</DialogTitle>
          <DialogDescription>
            New version tags are written to each stack&apos;s compose file. Images with a new build
            behind the same tag are pulled again. Changed containers are then recreated.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm" aria-label="Updates to apply">
          {plan.steps.map((s) => (
            <li key={`${s.stack}/${s.service}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground">{s.stack} / </span>
                <span className="font-medium">{s.service}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
                <span className="bg-muted rounded px-1.5 py-0.5">{s.tag}</span>
                {s.kind === 'bump' ? (
                  <>
                    <ArrowRight className="text-muted-foreground size-3.5" />
                    <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-semibold">
                      {s.newerTag}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground font-sans">new image</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {plan.skipped.length > 0 && (
          <div className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
            <p className="font-medium">Not included:</p>
            {plan.skipped.map((s) => (
              <p key={`${s.stack}/${s.service}`}>
                {s.stack} / {s.service}: {s.reason}
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={busy || count === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update {count} service
            {count === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
