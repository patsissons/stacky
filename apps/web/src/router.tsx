import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { LoginPage, SetupPage } from '@/features/auth/auth-pages'
import { ContainersPage, type ContainersSearch } from '@/features/containers/containers-page'
import { AppShell } from '@/features/layout/app-shell'
import { OperationDrawer, OperationWatcher } from '@/features/operations/operation-drawer'
import { SelfUpdateOverlay } from '@/features/self-update/self-update-overlay'
import { SettingsPage } from '@/features/settings/settings-page'
import { NewStackPage } from '@/features/stacks/new-stack-page'
import { StackPage, type StackSearch } from '@/features/stacks/stack-page'
import { sessionQuery } from '@/hooks/use-session'

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof s.redirect === 'string' ? s.redirect : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery)
    if (session.authDisabled || session.user) throw redirect({ to: '/' })
    if (session.needsSetup) throw redirect({ to: '/setup' })
  },
  component: LoginPage,
})

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery)
    if (!session.needsSetup) throw redirect({ to: '/' })
  },
  component: SetupPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery)
    if (session.authDisabled) return
    if (session.needsSetup) throw redirect({ to: '/setup' })
    if (!session.user) throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  component: () => (
    <>
      <AppShell />
      <OperationDrawer />
      <OperationWatcher />
      <SelfUpdateOverlay />
    </>
  ),
})

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : undefined

const containersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): ContainersSearch => ({
    q: str(s.q),
    stack: str(s.stack),
    status: ['running', 'problems', 'stopped', 'updates'].includes(s.status as string)
      ? (s.status as ContainersSearch['status'])
      : undefined,
    group: s.group === true || s.group === 'true' ? true : undefined,
    size: num(s.size),
    page: num(s.page),
    sort: str(s.sort),
  }),
  component: ContainersPage,
})

const newStackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/new',
  component: NewStackPage,
})

const stackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/stacks/$name',
  validateSearch: (s: Record<string, unknown>): StackSearch => ({
    tab: ['overview', 'editor', 'logs', 'terminal', 'history'].includes(s.tab as string)
      ? (s.tab as StackSearch['tab'])
      : undefined,
    service: str(s.service),
    container: str(s.container),
  }),
  component: StackPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  appRoute.addChildren([containersRoute, newStackRoute, stackRoute, settingsRoute]),
])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultNotFoundComponent: () => (
      <div className="text-muted-foreground p-10 text-center">Page not found.</div>
    ),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
