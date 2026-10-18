import { ArrowUp, TriangleAlert } from 'lucide-react'
import type { ImageUpdate, UpdateKind } from '@stacky/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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
  if (update.status !== 'update_available' || update.ignored || !update.kind) return null
  const meta = KIND[update.kind]
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
