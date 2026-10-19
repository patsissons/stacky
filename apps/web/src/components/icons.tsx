import { useState } from 'react'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'
import { iconSrc, isMonoIcon } from './icon-src'

/** Small brand-neutral registry glyphs (no external icon fetches). */
export function RegistryIcon({ registry, className }: { registry: string; className?: string }) {
  const cls = cn('size-4 shrink-0', className)
  if (registry === 'docker.io')
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn(cls, 'text-[#1d63ed]')}
        aria-hidden
        fill="currentColor"
      >
        <path d="M13.98 11.08h2.12a.19.19 0 0 0 .19-.19V9a.19.19 0 0 0-.19-.19h-2.12a.18.18 0 0 0-.18.18v1.9c0 .1.08.19.18.19m-2.95-5.43h2.12a.19.19 0 0 0 .18-.19V3.57a.19.19 0 0 0-.18-.18h-2.12a.18.18 0 0 0-.19.18v1.9c0 .1.09.19.19.19m0 2.71h2.12a.19.19 0 0 0 .18-.18V6.27a.18.18 0 0 0-.18-.18h-2.12a.18.18 0 0 0-.19.18v1.91c0 .1.09.18.19.18m-2.93 0h2.12a.19.19 0 0 0 .18-.18V6.27a.18.18 0 0 0-.18-.18H8.1a.18.18 0 0 0-.18.18v1.91c0 .1.08.18.18.18m-2.96 0h2.11a.19.19 0 0 0 .19-.18V6.27a.18.18 0 0 0-.19-.18H5.14a.19.19 0 0 0-.19.18v1.91c0 .1.09.18.19.18m5.89 2.72h2.12a.19.19 0 0 0 .18-.19V9a.19.19 0 0 0-.18-.19h-2.12a.18.18 0 0 0-.19.18v1.9c0 .1.09.19.19.19m-2.93 0h2.12a.18.18 0 0 0 .18-.19V9a.18.18 0 0 0-.18-.19H8.1a.18.18 0 0 0-.18.18v1.9c0 .1.08.19.18.19m-2.96 0h2.11a.18.18 0 0 0 .19-.19V9a.18.18 0 0 0-.18-.19H5.14a.19.19 0 0 0-.19.19v1.88c0 .1.09.19.19.19m-2.92 0h2.12a.18.18 0 0 0 .18-.19V9a.18.18 0 0 0-.18-.19H2.22a.18.18 0 0 0-.19.18v1.9c0 .1.08.19.19.19M23.76 9.9c-.07-.05-.67-.51-1.94-.51-.34 0-.67.03-1 .09a3.4 3.4 0 0 0-1.46-2.27l-.29-.17-.2.27a4 4 0 0 0-.53 1.23c-.23.91-.09 1.77.37 2.5-.56.32-1.46.39-1.64.4H.75a.75.75 0 0 0-.75.75 11.4 11.4 0 0 0 .7 4.06 6 6 0 0 0 2.4 3.13c1.18.73 3.1 1.14 5.28 1.14q1.47 0 2.92-.27a12 12 0 0 0 3.81-1.38 10.5 10.5 0 0 0 2.6-2.13c1.25-1.41 1.99-2.98 2.54-4.37h.22c1.36 0 2.2-.55 2.66-1l.28-.4z" />
      </svg>
    )
  if (registry === 'ghcr.io')
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden fill="currentColor">
        <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.6 4.6 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3" />
      </svg>
    )
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(cls, 'text-muted-foreground')}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" strokeLinecap="round" />
    </svg>
  )
}

/** Friendly short names for well-known registries. */
export function registryLabel(registry: string) {
  const known: Record<string, string> = {
    'docker.io': 'Docker Hub',
    'ghcr.io': 'GHCR',
    'lscr.io': 'LinuxServer',
    'quay.io': 'Quay',
    'gcr.io': 'GCR',
    'registry.gitlab.com': 'GitLab',
    'public.ecr.aws': 'ECR Public',
  }
  return known[registry] ?? registry
}

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
]

/** The app's icon (served and cached by stacky), falling back to a letter avatar. */
export function AppIcon({
  icon,
  name,
  className,
}: {
  icon?: string
  name: string
  className?: string
}) {
  const [failed, setFailed] = useState<string>()
  if (icon === 'stacky') return <Logo className={cn('size-6 shrink-0', className)} />
  const src = icon ? iconSrc(icon) : undefined
  if (!icon || !src || failed === icon) return <AppAvatar name={name} className={className} />
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(icon)}
      className={cn(
        'size-6 shrink-0 rounded-md object-contain',
        // single-color glyphs are drawn black; keep them visible in dark mode
        isMonoIcon(icon) && 'dark:invert',
        className,
      )}
    />
  )
}

/** Letter avatar used when a container has no icon. */
export function AppAvatar({ name, className }: { name: string; className?: string }) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white uppercase',
        className,
      )}
      style={{ backgroundColor: PALETTE[hash % PALETTE.length] }}
      aria-hidden
    >
      {name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?'}
    </span>
  )
}
