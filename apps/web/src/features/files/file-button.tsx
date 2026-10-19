import { FileCode2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One row of a file tree (the stack editor's Files panel and the file browser). */
export function FileButton({
  label,
  title,
  active,
  onClick,
  indent = 0,
  disabled,
  muted,
  className,
  icon: Icon = FileCode2,
}: {
  label: string
  title?: string
  active: boolean
  onClick: () => void
  indent?: number
  disabled?: boolean
  muted?: boolean
  className?: string
  icon?: typeof FileCode2
}) {
  return (
    <button
      type="button"
      title={disabled ? `${title ?? label} (too large or binary)` : (title ?? label)}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left',
        active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted',
        (disabled || muted) && 'text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
      style={{ paddingLeft: 8 + indent * 12 }}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}
