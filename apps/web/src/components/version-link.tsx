import { releaseUrl } from '@/lib/release'
import { cn } from '@/lib/utils'

/** stacky's version, linking to its GitHub release (plain text for dev builds). */
export function VersionLink({ version, className }: { version: string; className?: string }) {
  const href = releaseUrl(version)
  if (!href) return <span className={className}>{version}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Release notes for ${version}`}
      className={cn('hover:text-foreground underline-offset-2 hover:underline', className)}
    >
      {version}
    </a>
  )
}
