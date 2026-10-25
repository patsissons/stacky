import { ArrowDownToLine, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
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
import { groupByStack, type UpdatePlan } from '@/features/containers/rows'
import { runStackAction } from '@/features/operations/actions'
import { operationStore } from '@/features/operations/store'
import { isSelfOperation } from '@/features/self-update/store'

/** `deploy` applies the updates; `pull` only downloads the newer images. */
export type UpdateAllMode = 'pull' | 'deploy'

const COPY: Record<
  UpdateAllMode,
  { title: string; stackTitle: (stack: string) => string; description: string; verb: string }
> = {
  deploy: {
    title: 'Update all containers',
    stackTitle: (stack) => `Update ${stack}`,
    description:
      'New version tags are written to the compose file (only the image: lines). Images with a new build behind the same tag are pulled again. Changed containers are then recreated.',
    verb: 'Update',
  },
  pull: {
    title: 'Pull all updates',
    stackTitle: (stack) => `Pull updates for ${stack}`,
    description:
      'Downloads the newer images ahead of time. Compose files and running containers are left as they are, so nothing changes until you update.',
    verb: 'Pull',
  },
}

/**
 * Confirms and applies (or prefetches) every available update, one operation per stack.
 * With `stack` the plan covers that stack only and the title names it. The output drawer opens
 * with a tab per stack.
 */
export function UpdateAllDialog({
  plan,
  mode,
  stack,
  onClose,
}: {
  plan: UpdatePlan
  mode: UpdateAllMode | undefined
  stack?: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const count = plan.steps.length
  const copy = COPY[mode ?? 'deploy']
  const title = stack ? copy.stackTitle(stack) : copy.title

  const apply = async () => {
    setBusy(true)
    // one tab per stack in the output drawer
    const ids: string[] = []
    for (const { stack: name, services } of groupByStack(plan.steps)) {
      try {
        const op = await runStackAction(
          name,
          mode === 'pull' ? 'pull-updates' : 'deploy-updates',
          { services, prune: mode === 'deploy' },
          undefined,
          { openDrawer: false },
        )
        if (!isSelfOperation(op.action)) ids.push(op.id)
      } catch (err) {
        toast.error(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setBusy(false)
    onClose()
    operationStore.openAll(ids)
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
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
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : mode === 'pull' ? (
              <ArrowDownToLine />
            ) : (
              <RefreshCw />
            )}{' '}
            {copy.verb} {count} service{count === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
