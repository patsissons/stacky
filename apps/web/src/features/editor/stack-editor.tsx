import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus2,
  Folder,
  Loader2,
  Rocket,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  ActionOptions,
  StackFiles,
  StackSummary,
  ValidationIssue,
  ValidationResult,
} from '@stacky/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileButton } from '@/features/files/file-button'
import { runStackAction } from '@/features/operations/actions'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { hasSecrets, languageFor, maskEnv } from './language'
import { editorStore } from './store'

const CodeEditor = lazy(() => import('./code-editor'))
const CodeDiff = lazy(() => import('./code-editor').then((m) => ({ default: m.CodeDiff })))

interface FileEntry {
  path: string
  type: 'file' | 'dir'
  size?: number
  editable?: boolean
}

interface OpenFile {
  path: string
  original: string
  draft: string
}

const ENV = '.env'

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Edits a stack's compose file, .env and other files; validates live; deploys with a diff. */
export function StackEditor({ stack }: { stack: StackSummary }) {
  const qc = useQueryClient()
  const name = stack.name
  const { data, isLoading } = useQuery({
    queryKey: ['stack-files', name],
    queryFn: () => api.get<{ files: StackFiles }>(`/api/stacks/${name}`).then((r) => r.files),
  })
  const { data: tree } = useQuery({
    queryKey: ['stack-tree', name],
    queryFn: () => api.get<FileEntry[]>(`/api/stacks/${name}/files`),
  })

  const [compose, setCompose] = useState<string>()
  const [env, setEnv] = useState<string>()
  const [base, setBase] = useState<StackFiles>()
  const [active, setActive] = useState<string>('compose')
  const [extra, setExtra] = useState<OpenFile[]>([])
  const [masked, setMasked] = useState(true)
  const [saving, setSaving] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  // deploy options chosen before the review dialog opened (e.g. pull images first)
  const [deployOptions, setDeployOptions] = useState<ActionOptions>({})
  const [deploying, setDeploying] = useState(false)
  const [newFile, setNewFile] = useState<string>()
  const [deleting, setDeleting] = useState<string>()

  // Adopt server contents when we have no unsaved edits; otherwise flag the conflict.
  const dirtyCompose = base !== undefined && compose !== base.compose
  const dirtyEnv = base !== undefined && env !== base.env
  const dirty = dirtyCompose || dirtyEnv
  const changedOnDisk = !!data && !!base && (data.compose !== base.compose || data.env !== base.env)
  const [seen, setSeen] = useState<StackFiles>()
  if (data && data !== seen) {
    // derived state: adjust during render rather than in an effect
    setSeen(data)
    if (!base || !dirty) {
      setBase(data)
      setCompose(data.compose)
      setEnv(data.env)
    }
  }

  // Live validation of the unsaved text.
  const debouncedCompose = useDebounced(compose, 700)
  const debouncedEnv = useDebounced(env, 700)
  const { data: validation, isFetching: validating } = useQuery({
    queryKey: ['validate', name, debouncedCompose, debouncedEnv],
    queryFn: () =>
      api.post<ValidationResult>(`/api/stacks/${name}/validate`, {
        compose: debouncedCompose,
        env: base?.hasEnv || debouncedEnv ? debouncedEnv : undefined,
      }),
    enabled: debouncedCompose !== undefined,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })
  const issues = validation?.issues ?? []
  const errors = issues.filter((i) => i.severity === 'error')

  const save = useCallback(async () => {
    if (active !== 'compose' && active !== ENV) {
      const file = extra.find((f) => f.path === active)
      if (!file) return
      setSaving(true)
      try {
        await api.put(`/api/stacks/${name}/file`, { path: file.path, content: file.draft })
        setExtra((list) =>
          list.map((f) => (f.path === file.path ? { ...f, original: f.draft } : f)),
        )
        // a new file (and any new directory) shows up in the tree
        void qc.invalidateQueries({ queryKey: ['stack-tree', name] })
        toast.success(`Saved ${file.path}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
      return
    }
    if (!dirty) return
    setSaving(true)
    try {
      await api.put(`/api/stacks/${name}`, {
        compose: dirtyCompose ? compose : undefined,
        env: dirtyEnv ? env : undefined,
      })
      const next = { ...base!, compose: compose!, env: env!, hasEnv: env !== '' }
      setBase(next)
      qc.setQueryData(['stack-files', name], next)
      toast.success('Saved', {
        description: errors.length
          ? 'Saved with validation errors; deploy will fail until they are fixed.'
          : undefined,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [active, extra, name, dirty, dirtyCompose, dirtyEnv, compose, env, base, qc, errors.length])

  const deploy = async (options: ActionOptions = {}) => {
    setDeploying(true)
    try {
      await runStackAction(
        name,
        'deploy',
        options,
        dirty
          ? { compose: dirtyCompose ? compose : undefined, env: dirtyEnv ? env : undefined }
          : undefined,
      )
      if (dirty) {
        const next = { ...base!, compose: compose!, env: env!, hasEnv: env !== '' }
        setBase(next)
        qc.setQueryData(['stack-files', name], next)
      }
      setDiffOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_compose') {
        toast.error('Fix the compose file before deploying', {
          description: (err.details as ValidationResult | undefined)?.issues[0]?.message,
        })
      } else toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDeploying(false)
    }
  }

  const requestDeploy = (options: ActionOptions = {}) => {
    if (!dirty) return void deploy(options)
    setDeployOptions(options)
    setDiffOpen(true)
  }

  // Let the stack's action bar deploy through the review dialog instead of the files on disk.
  const requestDeployRef = useRef(requestDeploy)
  useEffect(() => {
    requestDeployRef.current = requestDeploy
  })
  useEffect(() => {
    editorStore.register({ stack: name, dirty, deploy: (o) => requestDeployRef.current(o) })
    return () => editorStore.unregister(name)
  }, [name, dirty])

  const discard = () => {
    if (!base) return
    setCompose(base.compose)
    setEnv(base.env)
  }

  const reloadFromDisk = () => {
    if (!data) return
    setBase(data)
    setCompose(data.compose)
    setEnv(data.env)
  }

  const openFile = async (path: string) => {
    if (path === base?.composeFile) return setActive('compose')
    if (path === ENV) return setActive(ENV)
    if (!extra.some((f) => f.path === path)) {
      try {
        const { content } = await api.get<{ content: string }>(
          `/api/stacks/${name}/file?path=${encodeURIComponent(path)}`,
        )
        setExtra((list) => [...list, { path, original: content, draft: content }])
      } catch (err) {
        return toast.error(err instanceof Error ? err.message : String(err))
      }
    }
    setActive(path)
  }

  const createFile = async (path: string) => {
    const clean = path.trim().replace(/^\/+/, '')
    if (!clean) return
    setExtra((list) => [...list, { path: clean, original: '\u0000new', draft: '' }])
    setActive(clean)
    setNewFile(undefined)
  }

  const deleteFile = async (path: string) => {
    try {
      await api.delete(`/api/stacks/${name}/file?path=${encodeURIComponent(path)}`)
      setExtra((list) => list.filter((x) => x.path !== path))
      if (active === path) setActive('compose')
      void qc.invalidateQueries({ queryKey: ['stack-tree', name] })
      toast.success(`Deleted ${path}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const closeFile = (path: string) => {
    const f = extra.find((x) => x.path === path)
    if (f && f.draft !== f.original && !window.confirm(`Discard unsaved changes to ${path}?`))
      return
    setExtra((list) => list.filter((x) => x.path !== path))
    if (active === path) setActive('compose')
  }

  // ⌘S anywhere on the page saves the active file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const anyDirty = dirty || extra.some((f) => f.draft !== f.original)
    if (!anyDirty) return
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [dirty, extra])

  const files = useMemo(
    () => (tree ?? []).filter((f) => f.path !== base?.composeFile && f.path !== ENV),
    [tree, base],
  )

  if (isLoading || compose === undefined || env === undefined || !base) {
    return <div className="text-muted-foreground p-4 text-sm">Loading files…</div>
  }

  const extraFile = extra.find((f) => f.path === active)
  const showMasked = active === ENV && masked && hasSecrets(env)
  // Typing a secret into an unmasked .env must not swap the editor for the masked preview
  // mid-keystroke; the user just wrote the value, so keep it revealed until they mask it.
  const editEnv = (value: string) => {
    setEnv(value)
    if (masked && hasSecrets(value)) setMasked(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {changedOnDisk && dirty && (
        <div className="bg-status-warning/12 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="text-status-warning size-4" />
          The files changed on disk while you were editing.
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={reloadFromDisk}>
            Load disk version
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={extraFile ? 'extra' : active}
          onValueChange={(v) => v !== 'extra' && setActive(v)}
        >
          <TabsList>
            <TabsTrigger value="compose" className="gap-1.5">
              <FileCode2 className="size-3.5" />
              {base.composeFile}
              {dirtyCompose && <DirtyDot />}
            </TabsTrigger>
            <TabsTrigger value={ENV} className="gap-1.5">
              .env
              {dirtyEnv && <DirtyDot />}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {/* the Files panel only fits from lg up; this menu stands in for it below that */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="lg:hidden" aria-label="Files">
              <Folder /> Files <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {files
              .filter((f) => f.type === 'file')
              .map((f) => (
                <DropdownMenuItem
                  key={f.path}
                  disabled={!f.editable}
                  onSelect={() => void openFile(f.path)}
                  className="font-mono text-xs"
                >
                  <FileCode2 className="size-3.5" /> {f.path}
                </DropdownMenuItem>
              ))}
            {files.some((f) => f.type === 'file') && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => setNewFile('')}>
              <FilePlus2 className="size-4" /> New file…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {extra.map((f) => (
          <span
            key={f.path}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-md border px-2 text-sm',
              active === f.path && 'bg-accent text-accent-foreground',
            )}
          >
            <button type="button" onClick={() => setActive(f.path)} className="max-w-48 truncate">
              {f.path}
            </button>
            {f.draft !== f.original && <DirtyDot />}
            <button type="button" aria-label={`Close ${f.path}`} onClick={() => closeFile(f.path)}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <ValidationStatus validating={validating} issues={issues} />
          {active === ENV && hasSecrets(env) && (
            <Button size="sm" variant="ghost" onClick={() => setMasked((m) => !m)}>
              {masked ? <Eye /> : <EyeOff />} {masked ? 'Reveal' : 'Mask'}
            </Button>
          )}
          {dirty && (
            <Button size="sm" variant="ghost" onClick={discard}>
              <Undo2 /> Discard
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={saving || (!dirty && !(extraFile && extraFile.draft !== extraFile.original))}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          <Button
            size="sm"
            onClick={() => requestDeploy()}
            disabled={deploying || !!stack.activeOperationId}
          >
            {deploying ? <Loader2 className="animate-spin" /> : <Rocket />}
            {dirty ? 'Review & deploy' : 'Deploy'}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <aside
          className="bg-card hidden w-52 shrink-0 flex-col overflow-hidden rounded-lg border lg:flex"
          aria-label="Files"
        >
          <div className="text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase">
            Files
            <button type="button" aria-label="New file" onClick={() => setNewFile('')}>
              <FilePlus2 className="size-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-1 text-sm">
            <FileButton
              label={base.composeFile}
              active={active === 'compose'}
              onClick={() => setActive('compose')}
            />
            <FileButton
              label=".env"
              active={active === ENV}
              onClick={() => setActive(ENV)}
              muted={!base.hasEnv && env === ''}
            />
            {files.map((f) =>
              f.type === 'dir' ? (
                <div
                  key={f.path}
                  className="text-muted-foreground flex items-center gap-1.5 px-2 py-1"
                  style={{ paddingLeft: 8 + depth(f.path) * 12 }}
                >
                  <Folder className="size-3.5" />
                  {f.path.split('/').pop()}
                </div>
              ) : (
                <div key={f.path} className="group flex items-center">
                  <FileButton
                    label={f.path.split('/').pop()!}
                    title={f.path}
                    indent={depth(f.path)}
                    active={active === f.path}
                    disabled={!f.editable}
                    onClick={() => void openFile(f.path)}
                    className="min-w-0 flex-1"
                  />
                  {f.editable && (
                    <button
                      type="button"
                      aria-label={`Delete ${f.path}`}
                      title="Delete file"
                      onClick={() => setDeleting(f.path)}
                      className="text-muted-foreground hover:text-destructive mr-1 rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        </aside>

        <Dialog open={newFile !== undefined} onOpenChange={(o) => !o && setNewFile(undefined)}>
          <DialogContent className="sm:max-w-sm">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void createFile(newFile ?? '')
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>New file</DialogTitle>
                <DialogDescription>
                  A path inside the stack directory; folders are created as needed.
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                value={newFile ?? ''}
                onChange={(e) => setNewFile(e.target.value)}
                placeholder="config/app.conf"
                aria-label="File path"
              />
              <DialogFooter>
                <Button type="submit" disabled={!newFile?.trim()}>
                  <FilePlus2 /> Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleting}?</AlertDialogTitle>
              <AlertDialogDescription>
                The file is removed from the stack directory. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-white"
                onClick={() => {
                  const path = deleting!
                  setDeleting(undefined)
                  void deleteFile(path)
                }}
              >
                Delete file
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="bg-card relative min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-lg border">
          <Suspense
            fallback={<div className="text-muted-foreground p-4 text-sm">Loading editor…</div>}
          >
            {active === 'compose' && (
              <CodeEditor
                path={`${name}/${base.composeFile}`}
                language="yaml"
                value={compose}
                onChange={setCompose}
                issues={issues}
                onSave={() => void save()}
                onDeploy={() => requestDeploy()}
              />
            )}
            {active === ENV &&
              (showMasked ? (
                <pre
                  className="h-full overflow-auto p-4 font-mono text-[13px] leading-5"
                  aria-label=".env (masked)"
                >
                  {maskEnv(env) || <span className="text-muted-foreground"># no variables</span>}
                </pre>
              ) : (
                <CodeEditor
                  path={`${name}/.env`}
                  language="ini"
                  value={env}
                  onChange={editEnv}
                  onSave={() => void save()}
                  onDeploy={() => requestDeploy()}
                />
              ))}
            {extraFile && (
              <CodeEditor
                path={`${name}/${extraFile.path}`}
                language={languageFor(extraFile.path)}
                value={extraFile.draft}
                onChange={(v) =>
                  setExtra((list) =>
                    list.map((f) => (f.path === extraFile.path ? { ...f, draft: v } : f)),
                  )
                }
                onSave={() => void save()}
              />
            )}
          </Suspense>
        </div>
      </div>

      {issues.length > 0 && <IssueList issues={issues} />}

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="flex h-[85svh] max-w-6xl flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Review changes to {name}</DialogTitle>
            <DialogDescription>
              Saved files on the left, your edits on the right. Deploying saves them and runs
              <code className="mx-1">docker compose up -d</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {dirtyCompose && (
              <DiffBlock title={base.composeFile}>
                <CodeDiff original={base.compose} modified={compose} language="yaml" />
              </DiffBlock>
            )}
            {dirtyEnv && (
              <DiffBlock title=".env">
                <CodeDiff
                  original={masked ? maskEnv(base.env) : base.env}
                  modified={masked ? maskEnv(env) : env}
                  language="ini"
                />
              </DiffBlock>
            )}
          </div>
          {errors.length > 0 && (
            <p className="text-destructive text-sm">
              {errors.length} validation error{errors.length > 1 ? 's' : ''}; the deploy will be
              rejected.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffOpen(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => void deploy(deployOptions)}
              disabled={deploying || errors.length > 0}
            >
              {deploying ? <Loader2 className="animate-spin" /> : <Rocket />} Save &amp; deploy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function depth(path: string) {
  return path.split('/').length - 1
}

function DirtyDot() {
  return <span className="bg-primary size-1.5 rounded-full" aria-label="unsaved changes" />
}

function ValidationStatus({
  validating,
  issues,
}: {
  validating: boolean
  issues: ValidationIssue[]
}) {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  if (validating && issues.length === 0)
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Validating
      </span>
    )
  if (errors)
    return (
      <span className="text-destructive flex items-center gap-1 text-xs font-medium">
        <AlertTriangle className="size-3.5" /> {errors} error{errors > 1 ? 's' : ''}
      </span>
    )
  return (
    <span
      className="text-status-running flex items-center gap-1 text-xs font-medium"
      data-testid="validation-ok"
    >
      <CheckCircle2 className="size-3.5" /> Valid
      {warnings ? ` · ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}
    </span>
  )
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul
      className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm"
      aria-label="Validation issues"
    >
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-2">
          <AlertTriangle
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              issue.severity === 'error' ? 'text-destructive' : 'text-status-warning',
            )}
          />
          <span className="min-w-0 break-words">
            {issue.line && (
              <span className="text-muted-foreground mr-1.5 font-mono text-xs">
                line {issue.line}
              </span>
            )}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DiffBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="bg-muted/50 border-b px-3 py-1.5 font-mono text-xs">{title}</div>
      <div className="min-h-56 flex-1">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </div>
  )
}
