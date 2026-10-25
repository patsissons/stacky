import { ArrowUp, EyeOff, TriangleAlert } from 'lucide-react'
import type { ImageUpdate, UpdateKind } from '@stacky/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { checkedLabel } from './checked'

const KIND: Record<UpdateKind, { label: string; className: string }> = {
  major: { label: 'Major update', className: 'bg-update-major text-white' },
  minor: { label: 'Minor update', className: 'bg-update-minor text-black' },
  patch: { label: 'Patch update', className: 'bg-update-patch text-white' },
  prerelease: { label: 'New build', className: 'bg-update-prerelease text-white' },
  digest: { label: 'New image for the same tag', className: 'bg-update-digest text-white' },
}

export function updateKindMeta(kind: UpdateKind) {
  return KIND[kind]
}

/** WUD-style badge: ↑ new version, coloured by how big the change is. */
export function UpdateBadge({
  update,
  onClick,
  className,
}: {
  update: ImageUpdate | undefined
  onClick?: () => void
  className?: string
}) {
  if (!update) return null
  if (update.status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-status-warning inline-flex items-center gap-1 text-xs"
            aria-label="Update check failed"
          >
            <TriangleAlert className="size-3.5" /> check failed
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{update.message}</TooltipContent>
      </Tooltip>
    )
  }
  if (update.status !== 'update_available' || !update.kind) return null
  const meta = KIND[update.kind]
  if (update.ignored) {
    // still reachable, so the user can stop ignoring it from the dialog
    return (
      <button
        type="button"
        onClick={onClick}
        title={`${meta.label} (ignored)`}
        className={cn(
          'text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 font-mono text-xs',
          className,
        )}
      >
        <EyeOff className="size-3" />
        {update.newerTag ?? 'new digest'}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={meta.label}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold shadow-sm transition-opacity hover:opacity-85',
        meta.className,
        className,
      )}
    >
      <ArrowUp className="size-3" strokeWidth={3} />
      {update.newerTag ?? 'new digest'}
    </button>
  )
}

/** "checked 3h ago" for an image, with the exact time on hover. */
export function CheckedAt({
  update,
  className,
}: {
  update: ImageUpdate | undefined
  className?: string
}) {
  const now = useNow()
  const label = checkedLabel(update, now)
  if (!label) return null
  return (
    <span
      className={cn('text-muted-foreground text-xs whitespace-nowrap', className)}
      title={update ? `Last checked ${new Date(update.checkedAt).toLocaleString()}` : undefined}
    >
      {label}
    </span>
  )
}
