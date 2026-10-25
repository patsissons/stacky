import { useNavigate } from '@tanstack/react-router'
import {
  Cpu,
  ExternalLink,
  Link2,
  Loader2,
  MemoryStick,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Square,
  SquareTerminal,
  Telescope,
} from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'
import type {
  ImageUpdate,
  PortMapping,
  ServiceAction,
  ServiceSummary,
  StackSummary,
} from '@stacky/shared'
import { checkImageNow } from '@/features/updates/check-image'
import { CheckedAt, UpdateBadge } from '@/features/updates/update-badge'
import { UpdateDialog, type UpdateTarget } from '@/features/updates/update-dialog'
import { useUpdates } from '@/hooks/use-updates'
import { AppIcon } from '@/components/icons'
import { Sparkline } from '@/components/sparkline'
import { ServiceStateBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
import { ViewToggle } from '@/components/view-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { portUrl } from '@/features/containers/rows'
import { openFromClick, serviceSheetStore } from '@/features/containers/service-sheet-store'
import { runServiceAction } from '@/features/operations/actions'
import { useStackStats } from '@/hooks/use-stats'
import { totalStats, type Stats } from './stack-stats'
import { useDockerHost } from '@/hooks/use-system'
import { ApiError } from '@/lib/api'
import { useViewMode, type ViewMode } from '@/hooks/use-view-mode'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const UP = new Set(['running', 'healthy', 'unhealthy', 'starting', 'restarting', 'paused'])

export function OverviewTab({
  stack,
  view: urlView,
  onViewChange,
}: {
  stack: StackSummary
  /** `?view=` from the URL, which wins over the view saved in this browser. */
  view?: ViewMode
  onViewChange?: (view: ViewMode) => void
}) {
  const { byRef } = useUpdates()
  const [updateTarget, setUpdateTarget] = useState<UpdateTarget>()
  const [view, setView] = useViewMode('stacky.view.stack', 'cards', urlView, onViewChange)
  const openUpdate = (service: ServiceSummary, update: ImageUpdate) =>
    setUpdateTarget({ update, stack: stack.name, service: service.name, managed: stack.managed })
  const runningIds = stack.services.flatMap((s) =>
    s.containers.filter((c) => UP.has(c.state)).map((c) => c.id),
  )
  const stats = useStackStats(stack.name, runningIds.length > 0, runningIds.join(','))

  return (
    <div className="space-y-4">
      {stack.parseError && (
        <div className="border-destructive/30 bg-destructive/8 rounded-lg border p-3 text-sm">
          <span className="font-medium">The compose file could not be parsed: </span>
          {stack.parseError}
        </div>
      )}
      {(stack.urls.length > 0 || stack.services.length > 0) && (
        <div className="flex flex-wrap items-start gap-2">
          {stack.urls.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noreferrer"
              className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
            >
              <Link2 className="size-3.5" />
              {u.replace(/^https?:\/\//, '')}
            </a>
          ))}
          {stack.services.length > 0 && (
            <ViewToggle value={view} onChange={setView} className="ml-auto" />
          )}
        </div>
      )}
      {runningIds.length > 0 && <StackStats stack={stack} runningIds={runningIds} stats={stats} />}
      {stack.services.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          This stack defines no services yet. Open the editor to add one.
        </p>
      )}
      {/* phones always get cards */}
      <div className={cn('grid gap-3 lg:grid-cols-2', view === 'table' && 'md:hidden')}>
        {stack.services.map((service) => (
          <ServiceCard
            key={service.name}
            stack={stack}
            service={service}
            stats={stats}
            update={byRef.get(imageRef(service))}
            onUpdate={(update) => openUpdate(service, update)}
          />
        ))}
      </div>
      {view === 'table' && stack.services.length > 0 && (
        <ServiceTable stack={stack} stats={stats} byRef={byRef} onUpdate={openUpdate} />
      )}
      <UpdateDialog target={updateTarget} onClose={() => setUpdateTarget(undefined)} />
    </div>
  )
}

/** The reference the update checker knows the service by (the engine may report a bare id). */
function imageRef(service: ServiceSummary) {
  const running = service.containers[0]?.image
  return running && !running.startsWith('sha256:') ? running : (service.image ?? '')
}

function ServiceCard({
  stack,
  service,
  stats,
  update,
  onUpdate,
}: {
  stack: StackSummary
  service: ServiceSummary
  stats: Stats
  update?: ImageUpdate
  onUpdate: (update: ImageUpdate) => void
}) {
  const dockerHost = useDockerHost()
  const up = service.containers.some((c) => UP.has(c.state))
  const { cpuHistory, memHistory, sampled, cpu, mem } = serviceStats(service, stats)
  const first = service.containers[0]
  const target = sheetTarget(stack, service)

  return (
    <div
      className="bg-card cursor-pointer rounded-xl border p-4"
      data-testid={`service-${service.name}`}
      onClick={(e) => openFromClick(e, target)}
    >
      <div className="flex items-start gap-3">
        <AppIcon icon={first?.icon} name={service.name} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="font-semibold hover:underline"
              onClick={() => serviceSheetStore.open(target)}
              title={`Show the compose definition of ${service.name}`}
            >
              {service.name}
            </button>
            <ServiceStateBadge state={service.state} />
            <UpdateBadge update={update} onClick={() => update && onUpdate(update)} />
            {service.containers.length > 1 && (
              <span className="text-muted-foreground text-xs">
                {service.containers.length} replicas
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <span className="text-muted-foreground truncate font-mono" title={service.image}>
              {service.image ?? 'built locally'}
            </span>
            {imageRef(service) && (
              <>
                <span className="text-muted-foreground">·</span>
                <CheckedAt update={update} />
              </>
            )}
          </div>
        </div>
        <ServiceMenu stack={stack} service={service} update={update} />
      </div>

      {service.containers.length > 0 && (
        <div className="mt-3 space-y-2">
          {service.containers.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground font-mono">{c.name}</span>
              <span className="text-muted-foreground">{c.statusText}</span>
              <PortLinks ports={c.ports} host={dockerHost} className="ml-auto" />
            </div>
          ))}
        </div>
      )}

      {/* reserved while the first sample is on its way, so the card does not jump */}
      {up && (
        <div
          className="text-muted-foreground mt-3 flex items-center gap-4 border-t pt-3 text-xs"
          data-testid="service-stats"
        >
          <span className="flex items-center gap-1.5" title="CPU">
            <Cpu className="size-3.5" />
            {sampled > 0 ? (
              <span className="text-foreground min-w-10 tabular-nums">{cpu.toFixed(1)}%</span>
            ) : (
              <Loader2 className="min-w-10 animate-spin" aria-label="Loading CPU" />
            )}
            <Sparkline className="text-primary" values={cpuHistory} max={100} />
          </span>
          <span className="flex items-center gap-1.5" title="Memory">
            <MemoryStick className="size-3.5" />
            {sampled > 0 ? (
              <span className="text-foreground min-w-14 tabular-nums">{formatBytes(mem)}</span>
            ) : (
              <Loader2 className="min-w-14 animate-spin" aria-label="Loading memory" />
            )}
            <Sparkline className="text-status-info" values={memHistory} max={0} />
          </span>
        </div>
      )}
    </div>
  )
}

/** The whole stack's CPU and memory, summed over its running containers. */
function StackStats({
  stack,
  runningIds,
  stats,
}: {
  stack: StackSummary
  runningIds: string[]
  stats: Stats
}) {
  const { cpuHistory, memHistory, sampled, cpu, mem } = totalStats(runningIds, stats)
  const total = stack.services.reduce((n, s) => n + s.containers.length, 0)
  return (
    <div
      className="bg-card text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-xs"
      data-testid="stack-stats"
    >
      <span className="text-foreground text-sm font-semibold">Stack</span>
      <span className="ml-auto sm:order-last">
        {runningIds.length} of {total} {total === 1 ? 'container' : 'containers'} running
      </span>
      <div className="flex basis-full items-center gap-4 sm:basis-auto">
        <span className="flex items-center gap-1.5" title="Total CPU">
          <Cpu className="size-3.5" />
          {sampled > 0 ? (
            <span className="text-foreground min-w-10 tabular-nums">{cpu.toFixed(1)}%</span>
          ) : (
            <Loader2 className="min-w-10 animate-spin" aria-label="Loading total CPU" />
          )}
          <Sparkline className="text-primary" values={cpuHistory} max={100} />
        </span>
        <span className="flex items-center gap-1.5" title="Total memory">
          <MemoryStick className="size-3.5" />
          {sampled > 0 ? (
            <span className="text-foreground min-w-14 tabular-nums">{formatBytes(mem)}</span>
          ) : (
            <Loader2 className="min-w-14 animate-spin" aria-label="Loading total memory" />
          )}
          <Sparkline className="text-status-info" values={memHistory} max={0} />
        </span>
      </div>
    </div>
  )
}

function sheetTarget(stack: StackSummary, service: ServiceSummary) {
  return {
    stack: stack.name,
    managed: stack.managed,
    service: service.name,
    containerId: service.containers[0]?.id,
  }
}

/** The service's CPU and memory history, and its latest totals across replicas. */
function serviceStats(service: ServiceSummary, stats: Stats) {
  return totalStats(
    service.containers.map((c) => c.id),
    stats,
  )
}

function PortLinks({
  ports,
  host,
  className,
}: {
  ports: PortMapping[]
  host: string | undefined
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {ports
        .filter((p) => p.hostPort)
        .map((p) => (
          <a
            key={`${p.hostPort}/${p.protocol}`}
            href={portUrl(p, host)}
            target="_blank"
            rel="noreferrer"
            className="hover:bg-accent inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[11px]"
            title={`${p.hostPort} → ${p.containerPort}/${p.protocol}`}
          >
            {p.hostPort}
            <ExternalLink className="size-2.5" />
          </a>
        ))}
    </div>
  )
}

/** The service's actions: logs, shell, lifecycle and an update check. */
function ServiceMenu({
  stack,
  service,
  update,
}: {
  stack: StackSummary
  service: ServiceSummary
  update?: ImageUpdate
}) {
  const navigate = useNavigate()
  const up = service.containers.some((c) => UP.has(c.state))
  const canAct = stack.managed
  const first = service.containers[0]
  const act = (action: ServiceAction) =>
    runServiceAction(stack.name, service.name, action).catch((err) =>
      toast.error(err instanceof Error ? err.message : String(err), {
        description: err instanceof ApiError ? err.hint : undefined,
      }),
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for ${service.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            void navigate({
              to: '/stacks/$name',
              params: { name: stack.name },
              search: { tab: 'logs', service: service.name },
            })
          }
        >
          <ScrollText className="size-4" /> Logs
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!up || !first}
          onSelect={() =>
            void navigate({
              to: '/stacks/$name',
              params: { name: stack.name },
              search: { tab: 'terminal', container: first?.id },
            })
          }
        >
          <SquareTerminal className="size-4" /> Shell
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {up ? (
          <>
            <DropdownMenuItem disabled={!canAct} onSelect={() => act('restart')}>
              <RotateCw className="size-4" /> Restart
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAct} onSelect={() => act('stop')}>
              <Square className="size-4" /> Stop
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem disabled={!canAct} onSelect={() => act('start')}>
            <Play className="size-4" /> Start
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!canAct} onSelect={() => act('recreate')}>
          <RefreshCw className="size-4" /> Recreate
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canAct} onSelect={() => act('update')}>
          <RefreshCw className="size-4" /> Pull &amp; recreate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!imageRef(service)}
          onSelect={() => void checkImageNow(imageRef(service), update?.checkedAt)}
        >
          <Telescope className="size-4" /> Check for updates
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The services as table rows, for wider screens in table view. */
function ServiceTable({
  stack,
  stats,
  byRef,
  onUpdate,
}: {
  stack: StackSummary
  stats: Stats
  byRef: Map<string, ImageUpdate>
  onUpdate: (service: ServiceSummary, update: ImageUpdate) => void
}) {
  const dockerHost = useDockerHost()
  return (
    <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10">Status</TableHead>
            <TableHead className="h-10">Service</TableHead>
            <TableHead className="hidden h-10 xl:table-cell">Image</TableHead>
            <TableHead className="h-10">Update</TableHead>
            <TableHead className="h-10">Containers</TableHead>
            <TableHead className="h-10">Ports</TableHead>
            <TableHead className="h-10">CPU</TableHead>
            <TableHead className="h-10">Memory</TableHead>
            <TableHead className="h-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stack.services.map((service) => {
            const update = byRef.get(imageRef(service))
            const target = sheetTarget(stack, service)
            const up = service.containers.some((c) => UP.has(c.state))
            const { sampled, cpu, mem } = serviceStats(service, stats)
            return (
              <TableRow
                key={service.name}
                className="cursor-pointer"
                data-testid={`service-row-${service.name}`}
                onClick={(e) => openFromClick(e, target)}
              >
                <TableCell>
                  <ServiceStateBadge state={service.state} />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AppIcon icon={service.containers[0]?.icon} name={service.name} />
                    <button
                      type="button"
                      className="truncate text-left font-medium hover:underline"
                      onClick={() => serviceSheetStore.open(target)}
                      title={`Show the compose definition of ${service.name}`}
                    >
                      {service.name}
                    </button>
                  </div>
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <span className="text-muted-foreground font-mono text-xs" title={service.image}>
                    {service.image ?? 'built locally'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-0.5">
                    <UpdateBadge
                      update={update}
                      onClick={() => update && onUpdate(service, update)}
                    />
                    {imageRef(service) && <CheckedAt update={update} />}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5 text-xs">
                    {service.containers.length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {service.containers.map((c) => (
                      <div key={c.id} className="flex flex-wrap gap-x-2">
                        <span className="text-muted-foreground font-mono">{c.name}</span>
                        <span className="text-muted-foreground">{c.statusText}</span>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {service.containers.some((c) => c.ports.some((p) => p.hostPort)) ? (
                    <PortLinks
                      ports={service.containers.flatMap((c) => c.ports)}
                      host={dockerHost}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {up ? (sampled > 0 ? `${cpu.toFixed(1)}%` : '…') : '—'}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {up ? (sampled > 0 ? formatBytes(mem) : '…') : '—'}
                </TableCell>
                <TableCell>
                  <ServiceMenu stack={stack} service={service} update={update} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
