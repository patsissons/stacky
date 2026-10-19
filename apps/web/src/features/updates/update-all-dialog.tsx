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

/** `deploy` applies the updates; `pull` only downloads the newer images. */
export type UpdateAllMode = 'pull' | 'deploy'

const COPY: Record<UpdateAllMode, { title: string; description: string; verb: string }> = {
  deploy: {
    title: 'Update all containers',
    description:
      "New version tags are written to each stack's compose file. Images with a new build behind the same tag are pulled again. Changed containers are then recreated.",
    verb: 'Update',
  },
  pull: {
    title: 'Pull all updates',
    description:
      'Downloads the newer images ahead of time. Compose files and running containers are left as they are, so nothing changes until you update.',
    verb: 'Pull',
  },
}

/** Confirms and applies (or prefetches) every available update, one operation per stack. */
export function UpdateAllDialog({
  plan,
  mode,
  onClose,
}: {
  plan: UpdatePlan
  mode: UpdateAllMode | undefined
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const count = plan.steps.length
  const copy = COPY[mode ?? 'deploy']

  const apply = async () => {
    setBusy(true)
    let started = 0
    for (const { stack, services } of groupByStack(plan.steps)) {
      try {
        await runStackAction(
          stack,
          mode === 'pull' ? 'pull-updates' : 'deploy-updates',
          { services, prune: mode === 'deploy' },
          undefined,
          { openDrawer: false },
        )
        started++
      } catch (err) {
        toast.error(`${stack}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setBusy(false)
    onClose()
    if (started > 0) {
      toast.message(
        `${mode === 'pull' ? 'Pulling' : 'Updating'} ${started} stack${started === 1 ? '' : 's'}`,
        {
          description: 'Each one reports back when it finishes.',
        },
      )
    }
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
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
