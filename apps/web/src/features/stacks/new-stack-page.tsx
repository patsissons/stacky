import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Loader2, Rocket, Terminal, Wand2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { STACK_NAME_RE, type OperationSummary, type ValidationResult } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { operationStore } from '@/features/operations/store'
import { useStacks } from '@/hooks/use-stacks'
import { api, ApiError } from '@/lib/api'

const CodeEditor = lazy(() => import('@/features/editor/code-editor'))

const TEMPLATES: Record<string, { label: string; compose: string }> = {
  blank: {
    label: 'Blank',
    compose: `services:
  app:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
`,
  },
  'web-db': {
    label: 'App + Postgres',
    compose: `services:
  app:
    image: ghcr.io/example/app:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://app:\${DB_PASSWORD}@db:5432/app
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
`,
  },
}

export function NewStackPage() {
  const navigate = useNavigate()
  const { data: stacks } = useStacks()
  const [name, setName] = useState('')
  const [compose, setCompose] = useState(TEMPLATES.blank!.compose)
  const [env, setEnv] = useState('')
  const [dockerRun, setDockerRun] = useState('')
  const [converting, setConverting] = useState(false)
  const [busy, setBusy] = useState<'create' | 'deploy'>()
  const [debounced, setDebounced] = useState({ compose, env })

  useEffect(() => {
    const t = setTimeout(() => setDebounced({ compose, env }), 700)
    return () => clearTimeout(t)
  }, [compose, env])

  const nameValid = STACK_NAME_RE.test(name)
  const taken = !!stacks?.some((s) => s.managed && s.name === name)
  const nameError =
    name && !nameValid
      ? 'Use lowercase letters, digits, "-" and "_".'
      : taken
        ? 'A stack with this name already exists.'
        : undefined

  const { data: validation, isFetching } = useQuery({
    queryKey: ['validate-new', debounced],
    queryFn: () =>
      api.post<ValidationResult>(`/api/stacks/${nameValid ? name : 'new-stack'}/validate`, {
        compose: debounced.compose,
        env: debounced.env || undefined,
      }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  })
  const errors = validation?.issues.filter((i) => i.severity === 'error') ?? []

  const convert = async () => {
    setConverting(true)
    try {
      const { compose: out } = await api.post<{ compose: string }>('/api/convert/docker-run', {
        command: dockerRun,
      })
      setCompose(out)
      toast.success('Converted to compose')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setConverting(false)
    }
  }

  const create = async (deploy: boolean) => {
    setBusy(deploy ? 'deploy' : 'create')
    try {
      const res = await api.post<{ operation?: OperationSummary }>('/api/stacks', {
        name,
        compose,
        env: env || undefined,
        deploy,
      })
      if (res.operation) {
        operationStore.watch(res.operation.id)
        operationStore.open(res.operation.id)
      }
      toast.success(`Created ${name}`)
      void navigate({ to: '/stacks/$name', params: { name } })
    } catch (err) {
      const description =
        err instanceof ApiError
          ? ((err.details as ValidationResult | undefined)?.issues[0]?.message ?? err.hint)
          : undefined
      toast.error(err instanceof Error ? err.message : String(err), { description })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New stack</h1>
        <p className="text-muted-foreground text-sm">
          Creates a folder in the stacks directory with a <code>compose.yaml</code> and optional{' '}
          <code>.env</code>.
        </p>
      </div>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="stack-name">Name</Label>
        <Input
          id="stack-name"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="my-app"
          autoFocus
          aria-invalid={!!nameError}
        />
        {nameError && <p className="text-destructive text-sm">{nameError}</p>}
      </div>

      <Tabs defaultValue="template">
        <TabsList>
          <TabsTrigger value="template">
            <Wand2 className="size-3.5" /> Template
          </TabsTrigger>
          <TabsTrigger value="docker-run">
            <Terminal className="size-3.5" /> From docker run
          </TabsTrigger>
        </TabsList>
        <TabsContent value="template" className="mt-3 flex flex-wrap gap-2">
          {Object.entries(TEMPLATES).map(([key, t]) => (
            <Button key={key} variant="outline" size="sm" onClick={() => setCompose(t.compose)}>
              {t.label}
            </Button>
          ))}
        </TabsContent>
        <TabsContent value="docker-run" className="mt-3 space-y-2">
          <Textarea
            value={dockerRun}
            onChange={(e) => setDockerRun(e.target.value)}
            placeholder="docker run -d --name web -p 8080:80 nginx:alpine"
            className="font-mono text-sm"
            rows={3}
            aria-label="docker run command"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void convert()}
            disabled={!dockerRun.trim() || converting}
          >
            {converting && <Loader2 className="animate-spin" />} Convert to compose
          </Button>
        </TabsContent>
      </Tabs>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>compose.yaml</Label>
          {isFetching && !validation ? (
            <span className="text-muted-foreground text-xs">Validating…</span>
          ) : errors.length ? (
            <span className="text-destructive flex items-center gap-1 text-xs font-medium">
              <AlertTriangle className="size-3.5" />{' '}
              {errors[0]!.line ? `Line ${errors[0]!.line}: ` : ''}
              {errors[0]!.message}
            </span>
          ) : (
            <span className="text-status-running flex items-center gap-1 text-xs font-medium">
              <CheckCircle2 className="size-3.5" /> Valid
            </span>
          )}
        </div>
        <div className="bg-card h-96 overflow-hidden rounded-lg border">
          <Suspense
            fallback={<div className="text-muted-foreground p-4 text-sm">Loading editor…</div>}
          >
            <CodeEditor
              path={`__new__/compose.yaml`}
              language="yaml"
              value={compose}
              onChange={setCompose}
              issues={validation?.issues}
            />
          </Suspense>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-env">.env (optional)</Label>
        <Textarea
          id="new-env"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          placeholder="DB_PASSWORD=change-me"
          className="font-mono text-sm"
          rows={4}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!nameValid || taken || !!busy}
          onClick={() => void create(false)}
        >
          {busy === 'create' && <Loader2 className="animate-spin" />} Create
        </Button>
        <Button
          disabled={!nameValid || taken || !!busy || errors.length > 0}
          onClick={() => void create(true)}
        >
          {busy === 'deploy' ? <Loader2 className="animate-spin" /> : <Rocket />} Create &amp;
          deploy
        </Button>
      </div>
    </div>
  )
}
