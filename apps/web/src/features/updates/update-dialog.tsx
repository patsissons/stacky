import { ArrowRight, ExternalLink, Eye, EyeOff, Loader2, RefreshCw, Telescope } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { ImageUpdate } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { bumpServiceImage, runServiceAction } from '@/features/operations/actions'
import { operationStore } from '@/features/operations/store'
import { isSelfOperation } from '@/features/self-update/store'
import { api, ApiError } from '@/lib/api'
import { checkImageNow } from './check-image'
import { registryPage } from './registry-link'
import { updateKindMeta } from './update-badge'

export interface UpdateTarget {
  update: ImageUpdate
  stack: string
  service: string
  managed: boolean
}

/** Details of one available update, with the actions that apply it. */
export function UpdateDialog({ target, onClose }: { target?: UpdateTarget; onClose: () => void }) {
  const [busy, setBusy] = useState<string>()
  if (!target) return null
  const { update, stack, service, managed } = target
  const page = registryPage(update)
  const short = (d?: string) => (d ? d.replace('sha256:', '').slice(0, 12) : '?')

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        description: err instanceof ApiError ? err.hint : undefined,
      })
    } finally {
      setBusy(undefined)
    }
  }

  const bump = () =>
    run('bump', async () => {
      const op = await bumpServiceImage(stack, service, update.newerTag!)
      if (!isSelfOperation(op.action)) operationStore.open(op.id)
    })
  const pull = () =>
    run('pull', () =>
      runServiceAction(stack, service, 'update').then((op) => operationStore.open(op.id)),
    )
  // no value clears the ignore
  const ignore = () =>
    run('ignore', () =>
      api.post('/api/updates/ignore', {
        ref: update.ref,
        value: update.ignored ? undefined : (update.newerTag ?? update.remoteDigest),
      }),
    )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update {service}</DialogTitle>
          <DialogDescription>
            {update.kind ? updateKindMeta(update.kind).label : 'Update'} for{' '}
            <span className="font-mono">{update.ref}</span> in stack{' '}
            <span className="font-medium">{stack}</span>
            {update.source === 'wud' ? ' (reported by What’s Up Docker)' : ''}
            {update.ignored ? ', which you chose to ignore' : ''}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {update.newerTag && (
            <div className="flex items-center gap-2 font-mono">
              <span className="bg-muted rounded px-2 py-0.5">{update.tag}</span>
              <ArrowRight className="text-muted-foreground size-4" />
              <span className="bg-primary/15 text-primary rounded px-2 py-0.5 font-semibold">
                {update.newerTag}
              </span>
            </div>
          )}
          {update.digestChanged && (
            <p className="text-muted-foreground">
              <span className="font-mono">{update.tag}</span> now points to a new image (
              {short(update.localDigest)} → {short(update.remoteDigest)}).
            </p>
          )}
          {page && (
            <a
              href={page}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              Tags and release notes <ExternalLink className="size-3.5" />
            </a>
          )}
          {!managed && (
            <p className="text-muted-foreground">
              This container belongs to a stack outside the stacks directory, so stacky can only
              report the update.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-1">
            <Button variant="ghost" onClick={ignore} disabled={!!busy}>
              {busy === 'ignore' ? (
                <Loader2 className="animate-spin" />
              ) : update.ignored ? (
                <Eye />
              ) : (
                <EyeOff />
              )}
              {update.ignored ? 'Stop ignoring' : 'Ignore this update'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Check again"
              title="Check again"
              disabled={!!busy}
              onClick={() => {
                onClose()
                void checkImageNow(update.ref, update.checkedAt)
              }}
            >
              <Telescope />
            </Button>
          </div>
          {managed && (
            <div className="flex gap-2">
              {update.digestChanged && (
                <Button
                  variant={update.newerTag ? 'outline' : 'default'}
                  onClick={pull}
                  disabled={!!busy}
                >
                  {busy === 'pull' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Pull{' '}
                  {update.tag}
                </Button>
              )}
              {update.newerTag && (
                <Button onClick={bump} disabled={!!busy}>
                  {busy === 'bump' ? <Loader2 className="animate-spin" /> : <ArrowRight />} Update
                  to {update.newerTag}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
