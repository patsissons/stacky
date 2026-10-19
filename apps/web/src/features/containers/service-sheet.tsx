import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, FileCode2, Info, Loader2, Rocket, Save, Undo2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { blockLine, extractService, replaceService } from '@stacky/shared/compose-service'
import type { StackFiles, StackSummary, ValidationIssue, ValidationResult } from '@stacky/shared'
import { AppIcon } from '@/components/icons'
import { ServiceStateBadge } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { SERVICE_FILE_SUFFIX } from '@/features/editor/schema'
import { IssueList, ValidationStatus } from '@/features/editor/validation'
import { runStackAction } from '@/features/operations/actions'
import { useStacks } from '@/hooks/use-stacks'
import { api, ApiError } from '@/lib/api'
import { serviceSheetStore, useServiceSheet, type ServiceSheetTarget } from './service-sheet-store'

const CodeEditor = lazy(() => import('@/features/editor/code-editor'))
const CodeDiff = lazy(() =>
  import('@/features/editor/code-editor').then((m) => ({ default: m.CodeDiff })),
)

/** Bottom sheet with one service's compose definition, viewable and (optionally) editable. */
export default function ServiceSheet() {
  const target = useServiceSheet()
  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && serviceSheetStore.close()}>
      <SheetContent side="bottom" className="flex h-[80svh] flex-col gap-3 p-4 sm:p-5">
        {target && (
          <SheetBody
            key={`${target.managed}:${target.stack}/${target.service}/${target.containerId}`}
            target={target}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ target }: { target: ServiceSheetTarget }) {
  const { data: stacks } = useStacks()
  const stack = stacks?.find((s) => s.name === target.stack && s.managed === target.managed)
  const service = stack?.services.find((s) => s.name === target.service)
  const container =
    service?.containers.find((c) => c.id === target.containerId) ?? service?.containers[0]

  return (
    <>
      <div className="flex min-w-0 items-start gap-3 pr-8">
        <AppIcon icon={container?.icon} name={target.service} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate text-base">
              {container?.name ?? target.service}
            </SheetTitle>
            {service && <ServiceStateBadge state={service.state} />}
          </div>
          <SheetDescription className="truncate text-xs">
            Service <span className="font-mono">{target.service}</span> in{' '}
            {target.managed ? (
              <Link
                to="/stacks/$name"
                params={{ name: target.stack }}
                onClick={() => serviceSheetStore.close()}
                className="hover:text-foreground font-mono underline-offset-2 hover:underline"
              >
                {target.stack}
              </Link>
            ) : (
              <span className="font-mono">{target.stack}</span>
            )}
          </SheetDescription>
        </div>
      </div>
      {target.managed ? (
        <ManagedService stack={stack} target={target} />
      ) : (
        <Note>
          This compose project was started outside the stacks directory, so its compose file is not
          available here.
        </Note>
      )}
    </>
  )
}

function ManagedService({
  stack,
  target,
}: {
  stack: StackSummary | undefined
  target: ServiceSheetTarget
}) {
  const qc = useQueryClient()
  const name = target.stack
  const filesKey = ['stack-files', name]
  const { data: files, isLoading } = useQuery({
    queryKey: filesKey,
    queryFn: () => api.get<{ files: StackFiles }>(`/api/stacks/${name}`).then((r) => r.files),
  })
  const block = useMemo(
    () => (files ? extractService(files.compose, target.service) : undefined),
    [files, target.service],
  )

  // editing state: the compose text the edit started from, and the edited block
  const [base, setBase] = useState<string>()
  const [draft, setDraft] = useState<string>()
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState<'save' | 'deploy'>()
  const [stale, setStale] = useState(false)
  const editing = draft !== undefined
  const baseBlock = useMemo(
    () => (base !== undefined ? extractService(base, target.service) : undefined),
    [base, target.service],
  )
  const dirty = editing && !!baseBlock && draft.replace(/\n+$/, '') !== baseBlock.text

  const spliced = useMemo(() => {
    if (!editing || base === undefined) return undefined
    try {
      return { compose: replaceService(base, target.service, draft) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [editing, base, draft, target.service])

  const debounced = useDebounced(dirty ? spliced?.compose : undefined, 600)
  const { data: validation, isFetching: validating } = useQuery({
    queryKey: ['validate', name, debounced],
    queryFn: () =>
      api.post<ValidationResult>(`/api/stacks/${name}/validate`, {
        compose: debounced,
        env: files?.hasEnv ? files.env : undefined,
      }),
    enabled: debounced !== undefined,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })
  // positions inside the block are re-based to the block; the rest keep no line
  const issues: ValidationIssue[] = useMemo(() => {
    if (!dirty || !baseBlock) return []
    const lines = (draft ?? '').replace(/\n+$/, '').split('\n').length
    const own: ValidationIssue[] = spliced?.error
      ? [{ severity: 'error', message: spliced.error, source: 'yaml' }]
      : []
    const server = (validation?.issues ?? []).map((i) => ({
      ...i,
      line: blockLine(baseBlock.line, lines, i.line),
      column: blockLine(baseBlock.line, lines, i.line) ? i.column : undefined,
    }))
    return [...own, ...server]
  }, [dirty, baseBlock, draft, spliced, validation])
  const errors = issues.filter((i) => i.severity === 'error')

  const startEditing = (on: boolean) => {
    if (!on) {
      if (dirty && !window.confirm('Discard your changes to this service?')) return
      setDraft(undefined)
      setBase(undefined)
      setReviewing(false)
      setStale(false)
      return
    }
    if (!files || !block) return
    setBase(files.compose)
    setDraft(block.text)
  }

  /** The new file, unless the compose file changed on disk since editing began. */
  const prepare = async (): Promise<string | undefined> => {
    if (!spliced?.compose || base === undefined) return undefined
    const fresh = await qc.fetchQuery({
      queryKey: filesKey,
      queryFn: () => api.get<{ files: StackFiles }>(`/api/stacks/${name}`).then((r) => r.files),
      staleTime: 0,
    })
    if (fresh.compose !== base) {
      setStale(true)
      toast.error('The compose file changed on disk', {
        description: 'Reload it to edit the current version.',
      })
      return undefined
    }
    return spliced.compose
  }

  const settle = (compose: string) => {
    if (files) qc.setQueryData(filesKey, { ...files, compose })
    setBase(compose)
    setDraft(extractService(compose, target.service)?.text ?? draft)
  }

  const save = async () => {
    setBusy('save')
    try {
      const compose = await prepare()
      if (compose === undefined) return
      await api.put(`/api/stacks/${name}`, { compose })
      settle(compose)
      toast.success(`Saved ${target.service}`, {
        description: errors.length
          ? 'Saved with validation errors; deploy will fail until they are fixed.'
          : undefined,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const deploy = async () => {
    setBusy('deploy')
    try {
      const compose = dirty ? await prepare() : undefined
      if (dirty && compose === undefined) return
      await runStackAction(name, 'deploy', {}, compose !== undefined ? { compose } : undefined)
      if (compose !== undefined) settle(compose)
      serviceSheetStore.close()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_compose') {
        toast.error('Fix the compose file before deploying', {
          description: (err.details as ValidationResult | undefined)?.issues[0]?.message,
        })
      } else toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const reload = () => {
    if (!files || !block) return
    setBase(files.compose)
    setDraft(block.text)
    setStale(false)
  }

  if (isLoading) return <div className="text-muted-foreground p-4 text-sm">Loading…</div>
  const canEdit = !!stack && !stack.isSelf && !!block

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <div className="flex items-center gap-2">
            <Switch id="edit-service" checked={editing} onCheckedChange={startEditing} />
            <Label htmlFor="edit-service" className="text-sm font-normal">
              Edit
            </Label>
          </div>
        )}
        {dirty && <ValidationStatus validating={validating} issues={issues} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" asChild>
            <Link
              to="/stacks/$name"
              params={{ name }}
              search={{ tab: 'editor' }}
              onClick={() => serviceSheetStore.close()}
            >
              <FileCode2 /> Open in editor
            </Link>
          </Button>
          {editing && (
            <>
              {dirty && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(baseBlock?.text)
                    setReviewing(false)
                  }}
                >
                  <Undo2 /> Discard
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void save()}
                disabled={!dirty || !!busy || !!spliced?.error}
              >
                {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} Save
              </Button>
              <Button
                size="sm"
                onClick={() => (dirty && !reviewing ? setReviewing(true) : void deploy())}
                disabled={
                  !!busy ||
                  !!stack?.activeOperationId ||
                  (dirty && (!!spliced?.error || errors.length > 0))
                }
              >
                {busy === 'deploy' ? <Loader2 className="animate-spin" /> : <Rocket />}
                {dirty ? (reviewing ? 'Save & deploy' : 'Review & deploy') : 'Deploy'}
              </Button>
            </>
          )}
        </div>
      </div>

      {stale && (
        <div className="bg-status-warning/12 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="text-status-warning size-4" />
          The compose file changed on disk while you were editing.
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={reload}>
            Load disk version
          </Button>
        </div>
      )}
      {stack?.isSelf && (
        <Note>
          This is stacky&apos;s own service. Edit it from its stack&apos;s editor, which redeploys
          stacky safely.
        </Note>
      )}

      {!block ? (
        <Note>
          This service is not defined in the compose file on its own (it may only exist as a
          container, or the file lists its services in flow style). Open the editor to see the whole
          file.
        </Note>
      ) : (
        <div className="bg-card relative min-h-0 flex-1 overflow-hidden rounded-lg border">
          <Suspense fallback={<div className="text-muted-foreground p-4 text-sm">Loading…</div>}>
            {reviewing && dirty && baseBlock ? (
              <CodeDiff original={baseBlock.text} modified={draft} language="yaml" />
            ) : (
              <CodeEditor
                path={`sheet/${name}/${target.service}${SERVICE_FILE_SUFFIX}`}
                language="yaml"
                value={editing ? draft : block.text}
                onChange={editing ? setDraft : undefined}
                readOnly={!editing}
                issues={issues}
                onSave={() => dirty && void save()}
              />
            )}
          </Suspense>
        </div>
      )}
      {reviewing && dirty && (
        <p className="text-muted-foreground text-sm">
          Your changes to <span className="font-mono">{target.service}</span>. Save &amp; deploy
          writes them to {files?.composeFile ?? 'the compose file'} and runs{' '}
          <code>docker compose up -d</code>.{' '}
          <button type="button" className="underline" onClick={() => setReviewing(false)}>
            Keep editing
          </button>
        </p>
      )}
      {issues.length > 0 && <IssueList issues={issues} />}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/50 flex items-start gap-2 rounded-lg border p-3 text-sm">
      <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
