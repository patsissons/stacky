import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  FileImage,
  FileQuestion,
  Folder,
  FolderOpen,
  Loader2,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { BrowseListing, FilePreview, FileRoot, FileRootInfo } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { hasSecrets, languageFor, maskEnv } from '@/features/editor/language'
import { api } from '@/lib/api'
import { formatBytes, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FileButton } from './file-button'

const CodeEditor = lazy(() => import('@/features/editor/code-editor'))

export interface FilesSearch {
  root?: FileRoot
  /** The selected file, relative to the root. */
  path?: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i
const ENV_FILE = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.env)$/i

const query = (root: FileRoot, path = '') =>
  `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`

/** Read-only view of the stacks directory and stacky's data directory. */
export function FilesPage() {
  const search = useSearch({ strict: false }) as FilesSearch
  const navigate = useNavigate()
  const root = search.root ?? 'stacks'
  const selected = search.path
  const setSearch = (next: FilesSearch) =>
    void navigate({
      to: '/files',
      search: { root: next.root === 'stacks' ? undefined : next.root, path: next.path },
      replace: true,
    })
  const { data: roots } = useQuery({
    queryKey: ['file-roots'],
    queryFn: () => api.get<FileRootInfo[]>('/api/files/roots'),
    staleTime: Infinity,
  })
  const info = roots?.find((r) => r.id === root)

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="text-muted-foreground truncate font-mono text-xs" title={info?.path}>
            {info?.path ?? ' '}
          </p>
        </div>
        <Tabs value={root} onValueChange={(v) => setSearch({ root: v as FileRoot })}>
          <TabsList>
            <TabsTrigger value="stacks">Stacks directory</TabsTrigger>
            <TabsTrigger value="data">Data directory</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex min-h-[480px] min-w-0 flex-1 gap-3">
        <aside
          aria-label="Files"
          className={cn(
            'bg-card min-w-0 flex-col overflow-hidden rounded-lg border lg:flex lg:w-64 lg:shrink-0',
            // on small screens the tree and the viewer take turns
            selected ? 'hidden' : 'flex flex-1',
          )}
        >
          <div className="text-muted-foreground border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase">
            {info?.label ?? 'Files'}
          </div>
          <div className="flex-1 overflow-y-auto p-1 text-sm">
            <Tree
              key={root}
              root={root}
              selected={selected}
              onSelect={(path) => setSearch({ root, path })}
            />
          </div>
        </aside>

        <section
          aria-label="File contents"
          className={cn(
            'bg-card relative min-w-0 flex-1 flex-col overflow-hidden rounded-lg border',
            selected ? 'flex' : 'hidden lg:flex',
          )}
        >
          {selected ? (
            <Viewer root={root} path={selected} onBack={() => setSearch({ root })} />
          ) : (
            <div className="text-muted-foreground m-auto p-6 text-center text-sm">
              Pick a file to see its contents.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Directory tree; folders load their entries when first opened. */
function Tree({
  root,
  selected,
  onSelect,
}: {
  root: FileRoot
  selected?: string
  onSelect: (path: string) => void
}) {
  // the folders leading to the selected file start open
  const [open, setOpen] = useState(() => {
    const parts = (selected ?? '').split('/').slice(0, -1)
    return new Set(parts.map((_, i) => parts.slice(0, i + 1).join('/')))
  })
  const toggle = (dir: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  return (
    <Directory
      root={root}
      dir=""
      depth={0}
      open={open}
      toggle={toggle}
      selected={selected}
      onSelect={onSelect}
    />
  )
}

function Directory({
  root,
  dir,
  depth,
  open,
  toggle,
  selected,
  onSelect,
}: {
  root: FileRoot
  dir: string
  depth: number
  open: Set<string>
  toggle: (dir: string) => void
  selected?: string
  onSelect: (path: string) => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['files', root, dir],
    queryFn: () => api.get<BrowseListing>(`/api/files?${query(root, dir)}`),
  })
  const pad = { paddingLeft: 8 + depth * 12 }
  if (isLoading)
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1" style={pad}>
        <Loader2 className="size-3.5 animate-spin" /> Loading…
      </div>
    )
  if (error)
    return (
      <div className="text-destructive px-2 py-1 text-xs" style={pad}>
        {error.message}
      </div>
    )
  if (!data?.entries.length)
    return (
      <div className="text-muted-foreground px-2 py-1 text-xs italic" style={pad}>
        empty
      </div>
    )
  return (
    <>
      {data.entries.map((e) =>
        e.type === 'dir' ? (
          <div key={e.path}>
            <button
              type="button"
              onClick={() => toggle(e.path)}
              aria-expanded={open.has(e.path)}
              title={e.path}
              className="hover:bg-muted flex w-full items-center gap-1 truncate rounded px-2 py-1 text-left"
              style={{ paddingLeft: 4 + depth * 12 }}
            >
              {open.has(e.path) ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              {open.has(e.path) ? (
                <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <Folder className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="truncate">{e.name}</span>
            </button>
            {open.has(e.path) && (
              <Directory
                root={root}
                dir={e.path}
                depth={depth + 1}
                open={open}
                toggle={toggle}
                selected={selected}
                onSelect={onSelect}
              />
            )}
          </div>
        ) : (
          <FileButton
            key={e.path}
            label={e.name}
            title={e.path}
            indent={depth + 1}
            active={selected === e.path}
            onClick={() => onSelect(e.path)}
            icon={IMAGE_EXT.test(e.name) ? FileImage : FileCode2}
          />
        ),
      )}
      {data.truncated && (
        <div className="text-muted-foreground px-2 py-1 text-xs" style={pad}>
          … more entries not shown
        </div>
      )}
    </>
  )
}

function Viewer({ root, path, onBack }: { root: FileRoot; path: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['file-preview', root, path],
    queryFn: () => api.get<FilePreview>(`/api/files/preview?${query(root, path)}`),
  })
  const [revealed, setRevealed] = useState(false)
  const masked = data?.kind === 'text' && ENV_FILE.test(path) && hasSecrets(data.content)

  return (
    <>
      <div className="flex min-w-0 items-center gap-2 border-b px-2 py-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="lg:hidden"
          onClick={onBack}
          aria-label="Back to files"
        >
          <ArrowLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </span>
        {data && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatBytes(data.size)} · {formatRelative(data.mtime)}
          </span>
        )}
        {masked && (
          <Button size="sm" variant="ghost" onClick={() => setRevealed((r) => !r)}>
            {revealed ? <EyeOff /> : <Eye />} {revealed ? 'Mask' : 'Reveal'}
          </Button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {isLoading && <Skeleton className="m-3 h-40" />}
        {error && <Notice title="Cannot open this file">{error.message}</Notice>}
        {data?.kind === 'text' &&
          (masked && !revealed ? (
            <pre
              className="h-full overflow-auto p-4 font-mono text-[13px] leading-5"
              aria-label={`${path} (masked)`}
            >
              {maskEnv(data.content)}
            </pre>
          ) : (
            <Suspense
              fallback={<div className="text-muted-foreground p-4 text-sm">Loading viewer…</div>}
            >
              <CodeEditor
                path={`browse/${root}/${path}`}
                language={languageFor(path)}
                value={data.content}
                readOnly
              />
            </Suspense>
          ))}
        {data?.kind === 'image' && (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            <img
              src={`/api/files/raw?${query(root, path)}`}
              alt={path.split('/').pop()}
              className="max-h-full max-w-full rounded border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
            />
          </div>
        )}
        {data?.kind === 'binary' && (
          <Notice title={`Binary data (${formatBytes(data.size)})`}>
            This file is not text, so it cannot be shown here.
          </Notice>
        )}
        {data?.kind === 'too_large' && (
          <Notice title={`Too large to show (${formatBytes(data.size)})`}>
            Text files up to 1 MB can be viewed here.
          </Notice>
        )}
      </div>
    </>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <FileQuestion className="text-muted-foreground size-8" />
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  )
}
