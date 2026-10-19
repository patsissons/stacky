import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { FolderOpen, Info } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { StackStatusBadge } from '@/components/status'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogViewer } from '@/features/logs/log-viewer'
import { ShellTab } from '@/features/terminal/shell-tab'
import { useStack } from '@/hooks/use-stacks'
import { HistoryTab } from './history-tab'
import { OverviewTab } from './overview-tab'
import { SelfActions } from '@/features/self-update/self-actions'
import { StackActions } from './stack-actions'

const StackEditor = lazy(() =>
  import('@/features/editor/stack-editor').then((m) => ({ default: m.StackEditor })),
)

export interface StackSearch {
  tab?: 'overview' | 'editor' | 'logs' | 'terminal' | 'history'
  service?: string
  container?: string
}

export function StackPage() {
  const { name } = useParams({ strict: false }) as { name: string }
  const search = useSearch({ strict: false }) as StackSearch
  const navigate = useNavigate()
  const { stack, isLoading } = useStack(name)
  const tab = search.tab ?? 'overview'
  const setSearch = (patch: Partial<StackSearch>) =>
    void navigate({
      to: '/stacks/$name',
      params: { name },
      search: (prev: StackSearch) => ({ ...prev, ...patch }),
      replace: true,
    })

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (!stack) {
    return (
      <div className="text-muted-foreground p-10 text-center">
        Stack <span className="font-mono">{name}</span> was not found.
      </div>
    )
  }

  const generation = stack.services.flatMap((s) => s.containers.map((c) => c.id)).join(',')

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* grows so the path can truncate instead of pushing the actions onto a second row */}
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{stack.name}</h1>
            <StackStatusBadge status={stack.status} />
            {stack.isSelf && (
              <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-xs font-semibold">
                stacky itself
              </span>
            )}
          </div>
          {stack.path && (
            <p
              className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 font-mono text-xs"
              title={`${stack.path}${stack.composeFile ? `/${stack.composeFile}` : ''}`}
            >
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="truncate">
                {stack.path}
                {stack.composeFile ? `/${stack.composeFile}` : ''}
              </span>
            </p>
          )}
        </div>
        {stack.managed && !stack.isSelf && <StackActions stack={stack} />}
        {stack.isSelf && <SelfActions />}
      </div>

      {!stack.managed && (
        <div className="bg-muted/50 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p>
            This compose project was started outside the stacks directory, so stacky shows it
            read-only. To manage it here, stop it, move its folder into the stacks directory and
            deploy it from stacky.
          </p>
        </div>
      )}
      {stack.isSelf && (
        <div className="bg-primary/5 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Info className="text-primary mt-0.5 size-4 shrink-0" />
          <p>
            This stack runs stacky itself. Updates, redeploys and restarts hand over to a
            short-lived updater container that replaces stacky and rolls back automatically if the
            new version does not start. Stopping or removing stacky has to be done on the host.
          </p>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearch({ tab: v === 'overview' ? undefined : (v as StackSearch['tab']) })
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-full shrink-0 justify-start overflow-x-auto overflow-y-hidden sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {stack.managed && <TabsTrigger value="editor">Editor</TabsTrigger>}
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="terminal">Shell</TabsTrigger>
          {stack.managed && <TabsTrigger value="history">History</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="mt-3">
          <OverviewTab stack={stack} />
        </TabsContent>
        {stack.managed && (
          <TabsContent value="editor" className="mt-3 flex min-h-[560px] flex-1 flex-col">
            <Suspense fallback={<Skeleton className="h-96 w-full" />}>
              <StackEditor stack={stack} />
            </Suspense>
          </TabsContent>
        )}
        <TabsContent value="logs" className="mt-3 flex min-h-[480px] flex-1 flex-col">
          <LogViewer
            stack={stack.name}
            services={stack.services.map((s) => s.name)}
            service={search.service}
            onServiceChange={(service) => setSearch({ service })}
            generation={generation}
          />
        </TabsContent>
        <TabsContent value="terminal" className="mt-3 flex min-h-[480px] flex-1 flex-col">
          <ShellTab
            stack={stack}
            containerId={search.container}
            onContainerChange={(container) => setSearch({ container })}
          />
        </TabsContent>
        {stack.managed && (
          <TabsContent value="history" className="mt-3">
            <HistoryTab stack={stack.name} activeOperationId={stack.activeOperationId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
