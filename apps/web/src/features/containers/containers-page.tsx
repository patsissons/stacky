import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpCircle,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Layers,
  MoreHorizontal,
  Play,
  RotateCw,
  ScrollText,
  Search,
  Square,
  SquareTerminal,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ImageUpdate, StackSummary } from '@stacky/shared'
import { UpdateBadge } from '@/features/updates/update-badge'
import { UpdateAllDialog, type UpdateAllMode } from '@/features/updates/update-all-dialog'
import { UpdateDialog, type UpdateTarget } from '@/features/updates/update-dialog'
import { checkForUpdates, isActionable, useUpdates } from '@/hooks/use-updates'
import { formatRelative } from '@/lib/format'
import { AppIcon, RegistryIcon, registryLabel } from '@/components/icons'
import { ServiceStateBadge, StackStatusBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { runServiceAction } from '@/features/operations/actions'
import { useStacks } from '@/hooks/use-stacks'
import { cn } from '@/lib/utils'
import {
  buildRows,
  matchesStatus,
  planUpdates,
  portUrl,
  type ContainerRow,
  type StatusFilter,
} from './rows'

export interface ContainersSearch {
  q?: string
  stack?: string
  status?: StatusFilter
  group?: boolean
  size?: number
  page?: number
  sort?: string
}

const PAGE_SIZES = [10, 25, 50, 0]

function serviceAction(row: ContainerRow, action: 'start' | 'stop' | 'restart') {
  runServiceAction(row.stack, row.service, action).catch((err: Error) =>
    toast.error(err.message, { description: (err as { hint?: string }).hint }),
  )
}

type OpenUpdate = (row: ContainerRow, update: ImageUpdate) => void

function makeColumns(
  byRef: Map<string, ImageUpdate>,
  openUpdate: OpenUpdate,
): ColumnDef<ContainerRow>[] {
  return [
    {
      id: 'status',
      accessorKey: 'state',
      header: 'Status',
      cell: ({ row }) => <ServiceStateBadge state={row.original.state} />,
      sortingFn: (a, b) => a.original.state.localeCompare(b.original.state),
    },
    {
      id: 'container',
      accessorKey: 'name',
      header: 'Container',
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <AppIcon icon={row.original.icon} name={row.original.service} />
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="text-muted-foreground truncate text-xs">
              {row.original.service}
              {row.original.number > 1 ? ` #${row.original.number}` : ''}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'stack',
      accessorKey: 'stack',
      header: 'Stack',
      cell: ({ row }) =>
        row.original.managed ? (
          <Link
            to="/stacks/$name"
            params={{ name: row.original.stack }}
            className="bg-accent text-accent-foreground hover:bg-accent/70 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
          >
            <Layers className="size-3" />
            {row.original.stack}
          </Link>
        ) : (
          <span
            className="text-muted-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-xs"
            title="Compose project outside the stacks directory"
          >
            {row.original.stack}
            <span className="text-[10px] uppercase">external</span>
          </span>
        ),
    },
    {
      id: 'registry',
      accessorKey: 'registry',
      header: 'Registry',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 text-sm" title={row.original.registry}>
          <RegistryIcon registry={row.original.registry} />
          {registryLabel(row.original.registry)}
        </span>
      ),
    },
    {
      id: 'image',
      accessorKey: 'repository',
      header: 'Image',
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-xs" title={row.original.image}>
          {row.original.repository.replace(/^library\//, '')}
        </span>
      ),
    },
    {
      id: 'version',
      accessorKey: 'tag',
      header: 'Version',
      cell: ({ row }) => (
        <span className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs">
          {row.original.tag}
        </span>
      ),
    },
    {
      id: 'update',
      header: 'Update',
      accessorFn: (r) => (isActionable(byRef.get(r.image)) ? 1 : 0),
      cell: ({ row }) => {
        const update = byRef.get(row.original.image)
        return (
          <UpdateBadge update={update} onClick={() => update && openUpdate(row.original, update)} />
        )
      },
    },
    {
      id: 'ports',
      header: 'Ports',
      enableSorting: false,
      cell: ({ row }) => <Ports row={row.original} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) => <RowActions row={row.original} />,
    },
  ]
}

const COLUMN_COUNT = 10

function Ports({ row }: { row: ContainerRow }) {
  const published = row.ports.filter((p) => p.hostPort)
  if (published.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {published.slice(0, 3).map((p) => (
        <a
          key={`${p.hostPort}/${p.protocol}`}
          href={portUrl(p)}
          target="_blank"
          rel="noreferrer"
          className="hover:bg-accent inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[11px]"
          title={`${p.hostPort} → ${p.containerPort}/${p.protocol}`}
        >
          {p.hostPort}
          <ExternalLink className="size-2.5" />
        </a>
      ))}
      {published.length > 3 && (
        <span className="text-muted-foreground text-xs">+{published.length - 3}</span>
      )}
    </div>
  )
}

function RowActions({ row }: { row: ContainerRow }) {
  const navigate = useNavigate()
  const up = ['running', 'healthy', 'unhealthy', 'starting', 'restarting', 'paused'].includes(
    row.state,
  )
  const canAct = row.managed && !row.isSelf
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Actions for ${row.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {row.managed && (
          <>
            <DropdownMenuItem
              onSelect={() =>
                void navigate({
                  to: '/stacks/$name',
                  params: { name: row.stack },
                  search: { tab: 'logs', service: row.service },
                })
              }
            >
              <ScrollText className="size-4" /> Logs
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!up}
              onSelect={() =>
                void navigate({
                  to: '/stacks/$name',
                  params: { name: row.stack },
                  search: { tab: 'terminal', container: row.id },
                })
              }
            >
              <SquareTerminal className="size-4" /> Shell
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {up ? (
          <>
            <DropdownMenuItem disabled={!canAct} onSelect={() => serviceAction(row, 'restart')}>
              <RotateCw className="size-4" /> Restart
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canAct} onSelect={() => serviceAction(row, 'stop')}>
              <Square className="size-4" /> Stop
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem disabled={!canAct} onSelect={() => serviceAction(row, 'start')}>
            <Play className="size-4" /> Start
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ContainersPage() {
  const search = useSearch({ strict: false }) as ContainersSearch
  const navigate = useNavigate()
  const { data: stacks, isLoading } = useStacks()
  const setSearch = (patch: Partial<ContainersSearch>) =>
    void navigate({
      to: '/',
      search: (prev: ContainersSearch) => clean({ ...prev, ...patch }),
      replace: true,
    })

  const { byRef, data: updates } = useUpdates()
  const [updateTarget, setUpdateTarget] = useState<UpdateTarget>()
  const columns = useMemo(
    () =>
      makeColumns(byRef, (row, update) =>
        setUpdateTarget({ update, stack: row.stack, service: row.service, managed: row.managed }),
      ),
    [byRef],
  )
  const allRows = useMemo(() => buildRows(stacks ?? []), [stacks])
  const updateCount = allRows.filter((r) => isActionable(byRef.get(r.image))).length
  const updatePlan = useMemo(() => planUpdates(allRows, byRef), [allRows, byRef])
  const [updateAllMode, setUpdateAllMode] = useState<UpdateAllMode>()
  const status = search.status ?? 'all'
  const q = (search.q ?? '').trim().toLowerCase()
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          (!search.stack || r.stack === search.stack) &&
          (status === 'updates'
            ? isActionable(byRef.get(r.image))
            : matchesStatus(r.state, status)) &&
          (!q || [r.name, r.service, r.stack, r.image].some((v) => v.toLowerCase().includes(q))),
      ),
    [allRows, search.stack, status, q, byRef],
  )

  const sorting: SortingState = search.sort
    ? [{ id: search.sort.replace(/^-/, ''), desc: search.sort.startsWith('-') }]
    : [{ id: 'stack', desc: false }]
  const size = search.size ?? 25
  const grouped = search.group ?? false

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      pagination: {
        pageIndex: search.page ?? 0,
        pageSize: grouped || size === 0 ? Math.max(rows.length, 1) : size,
      },
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const s = next[0]
      setSearch({ sort: s ? `${s.desc ? '-' : ''}${s.id}` : undefined, page: undefined })
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex: search.page ?? 0, pageSize: size })
          : updater
      setSearch({ page: next.pageIndex || undefined })
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (r) => r.id,
  })

  const stackNames = useMemo(() => [...new Set(allRows.map((r) => r.stack))].sort(), [allRows])
  const visible = table.getRowModel().rows.map((r) => r.original)
  const byStack = useMemo(() => {
    const map = new Map<string, ContainerRow[]>()
    for (const r of visible) map.set(r.stack, [...(map.get(r.stack) ?? []), r])
    return map
  }, [visible])
  const stackByName = new Map((stacks ?? []).map((s) => [`${s.managed}:${s.name}`, s]))

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Containers</h1>
          <p className="text-muted-foreground text-sm">
            {plural(allRows.length, 'container')} across {plural(stackNames.length, 'stack')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CheckUpdatesButton
            checking={!!updates?.checking}
            lastCheckAt={updates?.lastCheckAt}
            count={updateCount}
            onShow={() => setSearch({ status: 'updates', page: undefined })}
            canUpdateAll={updatePlan.steps.length > 0}
            onUpdateAll={setUpdateAllMode}
          />
          <Button size="sm" asChild>
            <Link to="/new">New stack</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search.q ?? ''}
            onChange={(e) => setSearch({ q: e.target.value || undefined, page: undefined })}
            placeholder="Search containers, images, stacks"
            aria-label="Search containers"
            className="pl-8"
          />
        </div>
        <Select
          value={search.stack ?? '__all'}
          onValueChange={(v) =>
            setSearch({ stack: v === '__all' ? undefined : v, page: undefined })
          }
        >
          <SelectTrigger className="w-40" aria-label="Filter by stack">
            <SelectValue placeholder="All stacks" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All stacks</SelectItem>
            {stackNames.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) =>
            setSearch({ status: v === 'all' ? undefined : (v as StatusFilter), page: undefined })
          }
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="problems">Problems</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="updates">Updates available</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="group-by-stack"
            checked={grouped}
            onCheckedChange={(v) => setSearch({ group: v || undefined, page: undefined })}
          />
          <Label htmlFor="group-by-stack" className="text-sm font-normal">
            Group by stack
          </Label>
        </div>
      </div>

      {/* desktop table */}
      <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  return (
                    <TableHead key={h.id} className="h-10">
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="hover:text-foreground inline-flex items-center gap-1"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === 'asc' && <ArrowUp className="size-3" />}
                          {sorted === 'desc' && <ArrowDown className="size-3" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={COLUMN_COUNT}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-muted-foreground h-24 text-center"
                >
                  {allRows.length === 0
                    ? 'No containers yet. Deploy a stack to see it here.'
                    : 'No containers match the filters.'}
                </TableCell>
              </TableRow>
            )}
            {grouped
              ? [...byStack].map(([name, list]) => {
                  const stack = stackByName.get(`${list[0]!.managed}:${name}`)
                  return (
                    <GroupRows key={name} stack={stack} name={name} count={list.length}>
                      {table
                        .getRowModel()
                        .rows.filter((r) => r.original.stack === name)
                        .map((r) => (
                          <TableRow key={r.id}>
                            {r.getVisibleCells().map((cell) => (
                              <TableCell
                                key={cell.id}
                                className={cell.column.id === 'container' ? 'pl-8' : ''}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                    </GroupRows>
                  )
                })
              : table.getRowModel().rows.map((r) => (
                  <TableRow key={r.id}>
                    {r.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <UpdateDialog target={updateTarget} onClose={() => setUpdateTarget(undefined)} />
      <UpdateAllDialog
        plan={updatePlan}
        mode={updateAllMode}
        onClose={() => setUpdateAllMode(undefined)}
      />

      {/* mobile cards */}
      <div className="space-y-2 md:hidden" data-testid="container-cards">
        {table.getRowModel().rows.map(({ original: r }) => (
          <div key={r.id} className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <AppIcon icon={r.icon} name={r.service} className="size-8" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{r.name}</span>
              </div>
              <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                <RegistryIcon registry={r.registry} className="size-3" />
                <span className="truncate">{r.stack}</span>
                <span>·</span>
                <span className="font-mono">{r.tag}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <ServiceStateBadge state={r.state} />
              <UpdateBadge
                update={byRef.get(r.image)}
                onClick={() => {
                  const update = byRef.get(r.image)
                  if (update)
                    setUpdateTarget({
                      update,
                      stack: r.stack,
                      service: r.service,
                      managed: r.managed,
                    })
                }}
              />
            </div>
            <RowActions row={r} />
          </div>
        ))}
        {!isLoading && rows.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">No containers to show.</p>
        )}
      </div>

      {!grouped && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page</span>
            <Select
              value={String(size)}
              onValueChange={(v) =>
                setSearch({ size: Number(v) === 25 ? undefined : Number(v), page: undefined })
              }
            >
              <SelectTrigger className="h-8 w-20" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? 'All' : n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-muted-foreground tabular-nums">
            {pageRange(
              table.getState().pagination.pageIndex,
              table.getState().pagination.pageSize,
              rows.length,
            )}
          </span>
          <div className="flex items-center gap-1">
            <PageButton
              label="First page"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
              icon={ChevronsLeft}
            />
            <PageButton
              label="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              icon={ChevronLeft}
            />
            <PageButton
              label="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              icon={ChevronRight}
            />
            <PageButton
              label="Last page"
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
              icon={ChevronsRight}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function CheckUpdatesButton({
  checking,
  lastCheckAt,
  count,
  onShow,
  canUpdateAll,
  onUpdateAll,
}: {
  checking: boolean
  lastCheckAt?: number
  count: number
  onShow: () => void
  canUpdateAll: boolean
  onUpdateAll: (mode: UpdateAllMode) => void
}) {
  const check = () => checkForUpdates().catch((err: Error) => toast.error(err.message))
  return (
    <div className="flex items-center gap-2">
      {count > 0 && (
        <Button variant="secondary" size="sm" onClick={onShow}>
          <ArrowUpCircle className="text-primary" /> {count} update{count === 1 ? '' : 's'}
        </Button>
      )}
      {canUpdateAll && (
        <div className="flex">
          <Button
            variant="outline"
            size="sm"
            className="rounded-r-none"
            onClick={() => onUpdateAll('deploy')}
          >
            <ArrowUpCircle /> Update all
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="rounded-l-none border-l-0 px-2"
                aria-label="Update all options"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onUpdateAll('pull')}>
                <ArrowDownToLine className="size-4" /> Pull all updates
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={check}
        disabled={checking}
        title={lastCheckAt ? `Last checked ${formatRelative(lastCheckAt)}` : 'Not checked yet'}
      >
        <RefreshCw className={cn(checking && 'animate-spin')} />
        {checking ? 'Checking…' : 'Check for updates'}
      </Button>
    </div>
  )
}

function GroupRows({
  stack,
  name,
  count,
  children,
}: {
  stack?: StackSummary
  name: string
  count: number
  children: React.ReactNode
}) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={COLUMN_COUNT} className="py-2">
          <div className="flex items-center gap-3">
            {stack?.managed ? (
              <Link to="/stacks/$name" params={{ name }} className="font-semibold hover:underline">
                {name}
              </Link>
            ) : (
              <span className="font-semibold">{name}</span>
            )}
            {stack && <StackStatusBadge status={stack.status} />}
            <span className="text-muted-foreground text-xs">
              {count} container{count === 1 ? '' : 's'}
            </span>
          </div>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}

function PageButton({
  label,
  onClick,
  disabled,
  icon: Icon,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  icon: typeof ChevronLeft
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={cn('size-8')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <Icon className="size-4" />
    </Button>
  )
}

function pageRange(index: number, size: number, total: number) {
  const start = index * size + 1
  const end = Math.min(total, (index + 1) * size)
  return `${start}–${end} of ${total}`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function clean(search: ContainersSearch): ContainersSearch {
  return Object.fromEntries(
    Object.entries(search).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  ) as ContainersSearch
}
