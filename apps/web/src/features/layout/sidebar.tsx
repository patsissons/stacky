import { Link, useRouterState } from '@tanstack/react-router'
import { Boxes, FolderTree, Layers, Loader2, Plus, Search, Settings } from 'lucide-react'
import { useUpdates } from '@/hooks/use-updates'
import { useMemo, useState } from 'react'
import type { StackSummary } from '@stacky/shared'
import { stackHasUpdate } from '@/features/containers/rows'
import { UpdateAvailableIcon } from '@/features/updates/update-badge'
import { Logo } from '@/components/logo'
import { VersionLink } from '@/components/version-link'
import { stackStatusMeta, StatusDot } from '@/components/status'
import { Input } from '@/components/ui/input'
import { useSocketStatus } from '@/hooks/use-socket-status'
import { useStacks } from '@/hooks/use-stacks'
import { useSystem } from '@/hooks/use-system'
import { cn } from '@/lib/utils'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: stacks, isLoading } = useStacks()
  const [query, setQuery] = useState('')
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (stacks ?? []).filter((s) => !q || s.name.includes(q))
  }, [stacks, query])
  const managed = filtered.filter((s) => s.managed)
  const external = filtered.filter((s) => !s.managed)

  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full flex-col">
      <Link
        to="/"
        onClick={onNavigate}
        aria-label="stacky home"
        className="flex h-14 items-center gap-2.5 px-4"
      >
        <Logo />
        <span className="text-lg font-semibold tracking-tight">stacky</span>
      </Link>

      <nav className="space-y-0.5 px-2">
        <NavLink to="/" active={pathname === '/'} icon={Boxes} onClick={onNavigate}>
          Containers
        </NavLink>
        <NavLink to="/new" active={pathname === '/new'} icon={Plus} onClick={onNavigate}>
          New stack
        </NavLink>
      </nav>

      <div className="mt-4 px-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter stacks"
            aria-label="Filter stacks"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        <SectionLabel>
          Stacks{stacks ? ` · ${stacks.filter((s) => s.managed).length}` : ''}
        </SectionLabel>
        {isLoading && <p className="text-muted-foreground px-2 py-1 text-sm">Loading…</p>}
        {managed.map((s) => (
          <StackLink key={s.name} stack={s} pathname={pathname} onClick={onNavigate} />
        ))}
        {!isLoading && managed.length === 0 && (
          <p className="text-muted-foreground px-2 py-1 text-sm">
            {query ? 'No matching stacks' : 'No stacks yet'}
          </p>
        )}
        {external.length > 0 && (
          <>
            <SectionLabel className="mt-3">External</SectionLabel>
            {external.map((s) => (
              <StackLink key={`ext-${s.name}`} stack={s} pathname={pathname} onClick={onNavigate} />
            ))}
          </>
        )}
      </div>

      <div className="border-sidebar-border space-y-0.5 border-t p-2">
        <NavLink
          to="/files"
          active={pathname.startsWith('/files')}
          icon={FolderTree}
          onClick={onNavigate}
        >
          Files
        </NavLink>
        <NavLink
          to="/settings"
          active={pathname.startsWith('/settings')}
          icon={Settings}
          onClick={onNavigate}
        >
          Settings
        </NavLink>
        <ConnectionFooter />
      </div>
    </div>
  )
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase',
        className,
      )}
    >
      {children}
    </div>
  )
}

function NavLink({
  to,
  active,
  icon: Icon,
  children,
  onClick,
}: {
  to: string
  active: boolean
  icon: typeof Layers
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  )
}

function StackLink({
  stack,
  pathname,
  onClick,
}: {
  stack: StackSummary
  pathname: string
  onClick?: () => void
}) {
  const meta = stackStatusMeta(stack.status)
  const { byRef } = useUpdates()
  const hasUpdate = stackHasUpdate(stack, byRef)
  const active = pathname === `/stacks/${stack.name}`
  const running = stack.services.filter((s) =>
    ['running', 'healthy', 'completed'].includes(s.state),
  ).length
  return (
    <Link
      to="/stacks/$name"
      params={{ name: stack.name }}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'hover:bg-sidebar-accent/60',
      )}
      title={`${stack.name}: ${meta.label}`}
    >
      {stack.activeOperationId ? (
        <Loader2 className="text-primary size-2.5 animate-spin" />
      ) : (
        <StatusDot tone={meta.tone} pulse={meta.pulse} />
      )}
      <span className={cn('flex-1 truncate', !stack.managed && 'text-muted-foreground')}>
        {stack.name}
      </span>
      {hasUpdate && <UpdateAvailableIcon />}
      {stack.isSelf && (
        <span className="bg-primary/10 text-primary rounded px-1 text-[10px] font-semibold">
          SELF
        </span>
      )}
      <span className="text-muted-foreground text-xs tabular-nums">
        {running}/{stack.services.length}
      </span>
    </Link>
  )
}

function ConnectionFooter() {
  const status = useSocketStatus()
  const { data: system } = useSystem()
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs">
      <StatusDot
        tone={status === 'open' ? 'running' : status === 'connecting' ? 'warning' : 'error'}
        pulse={status === 'connecting'}
        className="size-2 [&>span]:size-2"
      />
      <span>
        {status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}
      </span>
      {system && <VersionLink version={system.version} className="ml-auto font-mono" />}
    </div>
  )
}
