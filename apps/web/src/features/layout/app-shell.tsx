import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, LogOut, Menu, Search, ShieldOff, User } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from '@/features/command-palette/command-palette'
import { useSession } from '@/hooks/use-session'
import { useLiveStacksBridge } from '@/hooks/use-stacks'
import { useLiveUpdatesBridge } from '@/hooks/use-updates'
import { useSystem } from '@/hooks/use-system'
import { api } from '@/lib/api'
import { UpdateBanner } from '@/features/self-update/self-actions'
import { Sidebar } from './sidebar'
import { ThemeToggle } from './theme-toggle'

export function AppShell() {
  useLiveStacksBridge()
  useLiveUpdatesBridge()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useCommandPaletteShortcut()

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="border-sidebar-border hidden w-64 shrink-0 border-r md:block">
        <Sidebar />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur md:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </Button>
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground hidden h-8 w-64 justify-start gap-2 font-normal sm:flex"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="size-3.5" />
              <span className="truncate">Search or run a command</span>
              <kbd className="bg-muted ml-auto rounded px-1.5 font-mono text-[10px]">⌘K</kbd>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
            >
              <Search className="size-4" />
            </Button>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <Banners />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const parts: { label: string; to?: string }[] = []
  if (pathname === '/') parts.push({ label: 'Containers' })
  else if (pathname === '/new') parts.push({ label: 'New stack' })
  else if (pathname.startsWith('/settings')) parts.push({ label: 'Settings' })
  else if (pathname.startsWith('/stacks/')) {
    parts.push({ label: 'Stacks', to: '/' })
    parts.push({ label: decodeURIComponent(pathname.split('/')[2] ?? '') })
  }
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
          {p.to ? (
            <Link to={p.to} className="text-muted-foreground hover:text-foreground truncate">
              {p.label}
            </Link>
          ) : (
            <span className="truncate font-medium">{p.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function UserMenu() {
  const { data: session } = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  if (!session || session.authDisabled) return null
  const signOut = async () => {
    await api.post('/api/auth/sign-out').catch(() => {})
    await qc.invalidateQueries({ queryKey: ['session'] })
    qc.clear()
    void navigate({ to: '/login' })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account">
          <User className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="font-normal">
          Signed in as <span className="font-semibold">{session.user?.username}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Banners() {
  const { data: session } = useSession()
  const { data: system } = useSystem()
  const problems = system?.preflight.filter((c) => !c.ok && c.severity === 'error') ?? []
  return (
    <>
      <UpdateBanner />
      {session?.authDisabled && (
        <div className="bg-status-warning/12 text-foreground flex items-center gap-2 border-b px-4 py-1.5 text-xs">
          <ShieldOff className="text-status-warning size-3.5" />
          Authentication is disabled (STACKY_AUTH_DISABLED). Only run stacky like this behind a
          proxy that authenticates users.
        </div>
      )}
      {problems.map((p) => (
        <div
          key={p.id}
          role="alert"
          className="bg-destructive/10 flex items-start gap-2 border-b px-4 py-2 text-sm"
        >
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{p.message}</p>
            {p.hint && <p className="text-muted-foreground text-xs">{p.hint}</p>}
          </div>
        </div>
      ))}
    </>
  )
}
