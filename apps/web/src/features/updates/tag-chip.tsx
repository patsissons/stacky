import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A version tag, linked to its release notes when a `stacky.link.template` label gives one. */
export function TagChip({
  tag,
  href,
  className,
}: {
  tag: string
  href?: string
  className: string
}) {
  if (!href) return <span className={className}>{tag}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Release notes for ${tag}`}
      className={cn(className, 'hover:underline')}
    >
      {tag}
    </a>
  )
}

/** An icon link to the release notes of the version in use, for places that show the full ref. */
export function ReleaseNotesLink({
  tag,
  href,
  className,
}: {
  tag?: string
  href?: string
  className?: string
}) {
  if (!href) return null
  const label = tag ? `Release notes for ${tag}` : 'Release notes'
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className={cn('text-muted-foreground hover:text-primary shrink-0', className)}
    >
      <ExternalLink className="size-3.5" />
    </a>
  )
}
