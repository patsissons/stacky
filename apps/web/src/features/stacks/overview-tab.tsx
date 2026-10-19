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
import type { ImageUpdate, ServiceAction, ServiceSummary, StackSummary } from '@stacky/shared'
import { checkImageNow } from '@/features/updates/check-image'
import { UpdateBadge } from '@/features/updates/update-badge'
import { UpdateDialog, type UpdateTarget } from '@/features/updates/update-dialog'
import { useUpdates } from '@/hooks/use-updates'
import { AppIcon } from '@/components/icons'
import { Sparkline } from '@/components/sparkline'
import { ServiceStateBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
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
import { useDockerHost } from '@/hooks/use-system'
import { ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/format'

const UP = new Set(['running', 'healthy', 'unhealthy', 'starting', 'restarting', 'paused'])

export function OverviewTab({ stack }: { stack: StackSummary }) {
  const { byRef } = useUpdates()
  const [updateTarget, setUpdateTarget] = useState<UpdateTarget>()
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
      {stack.urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
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
        </div>
      )}
      {stack.services.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          This stack defines no services yet. Open the editor to add one.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {stack.services.map((service) => (
          <ServiceCard
            key={service.name}
            stack={stack}
            service={service}
            stats={stats}
            update={byRef.get(imageRef(service))}
            onUpdate={(update) =>
              setUpdateTarget({
                update,
                stack: stack.name,
                service: service.name,
                managed: stack.managed,
              })
            }
          />
        ))}
      </div>
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
  stats: ReturnType<typeof useStackStats>
  update?: ImageUpdate
  onUpdate: (update: ImageUpdate) => void
}) {
  const navigate = useNavigate()
  const dockerHost = useDockerHost()
  const up = service.containers.some((c) => UP.has(c.state))
  const canAct = stack.managed
  const act = (action: ServiceAction) =>
    runServiceAction(stack.name, service.name, action).catch((err) =>
      toast.error(err instanceof Error ? err.message : String(err), {
        description: err instanceof ApiError ? err.hint : undefined,
      }),
    )
  const samples = service.containers.flatMap((c) => stats[c.id] ?? [])
  const latest = service.containers.map((c) => stats[c.id]?.at(-1)).filter((s) => !!s)
  const cpu = latest.reduce((a, s) => a + s.cpuPercent, 0)
  const mem = latest.reduce((a, s) => a + s.memoryBytes, 0)
  const first = service.containers[0]
  const sheetTarget = {
    stack: stack.name,
    managed: stack.managed,
    service: service.name,
    containerId: first?.id,
  }

  return (
    <div
      className="bg-card cursor-pointer rounded-xl border p-4"
      data-testid={`service-${service.name}`}
      onClick={(e) => openFromClick(e, sheetTarget)}
    >
      <div className="flex items-start gap-3">
        <AppIcon icon={first?.icon} name={service.name} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="font-semibold hover:underline"
              onClick={() => serviceSheetStore.open(sheetTarget)}
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
          <div
            className="text-muted-foreground mt-0.5 truncate font-mono text-xs"
            title={service.image}
          >
            {service.image ?? 'built locally'}
          </div>
        </div>
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
      </div>

      {service.containers.length > 0 && (
        <div className="mt-3 space-y-2">
          {service.containers.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground font-mono">{c.name}</span>
              <span className="text-muted-foreground">{c.statusText}</span>
              <div className="ml-auto flex flex-wrap gap-1">
                {c.ports
                  .filter((p) => p.hostPort)
                  .map((p) => (
                    <a
                      key={`${p.hostPort}/${p.protocol}`}
                      href={portUrl(p, dockerHost)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:bg-accent inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono"
                      title={`${p.hostPort} → ${p.containerPort}/${p.protocol}`}
                    >
                      {p.hostPort}
                      <ExternalLink className="size-2.5" />
                    </a>
                  ))}
              </div>
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
            {latest.length > 0 ? (
              <span className="text-foreground min-w-10 tabular-nums">{cpu.toFixed(1)}%</span>
            ) : (
              <Loader2 className="min-w-10 animate-spin" aria-label="Loading CPU" />
            )}
            <Sparkline
              className="text-primary"
              values={samples.map((s) => s.cpuPercent)}
              max={100}
            />
          </span>
          <span className="flex items-center gap-1.5" title="Memory">
            <MemoryStick className="size-3.5" />
            {latest.length > 0 ? (
              <span className="text-foreground min-w-14 tabular-nums">{formatBytes(mem)}</span>
            ) : (
              <Loader2 className="min-w-14 animate-spin" aria-label="Loading memory" />
            )}
            <Sparkline
              className="text-status-info"
              values={samples.map((s) => s.memoryBytes)}
              max={0}
            />
          </span>
        </div>
      )}
    </div>
  )
}
