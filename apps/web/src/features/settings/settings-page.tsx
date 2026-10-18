import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Info, Loader2, TriangleAlert, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { PreflightCheck } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { maskEnv } from '@/features/editor/language'
import { useSession } from '@/hooks/use-session'
import { useSystem } from '@/hooks/use-system'
import { api } from '@/lib/api'

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <SystemCard />
      <GlobalEnvCard />
      <PasswordCard />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono text-[13px] break-all">{children}</span>
    </div>
  )
}

function CheckIcon({ check }: { check: PreflightCheck }) {
  if (check.ok) return <CheckCircle2 className="text-status-running size-4" />
  if (check.severity === 'error') return <XCircle className="text-destructive size-4" />
  if (check.severity === 'warning') return <TriangleAlert className="text-status-warning size-4" />
  return <Info className="text-muted-foreground size-4" />
}

function SystemCard() {
  const { data: system, isLoading } = useSystem()
  return (
    <Card>
      <CardHeader>
        <CardTitle>System</CardTitle>
        <CardDescription>How stacky is running and whether its setup is healthy.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !system ? (
          <Loader2 className="text-muted-foreground animate-spin" />
        ) : (
          <>
            <div className="divide-y">
              <Row label="stacky">{system.version}</Row>
              <Row label="Stacks directory">{system.stacksDir}</Row>
              <Row label="Docker engine">
                {system.docker
                  ? `${system.docker.version} (API ${system.docker.apiVersion}, ${system.docker.os}/${system.docker.arch})`
                  : 'unreachable'}
              </Row>
              <Row label="Docker Compose">{system.docker?.composeVersion ?? 'not found'}</Row>
              <Row label="Container">
                {system.self
                  ? `${system.self.containerId.slice(0, 12)} · ${system.self.image}`
                  : 'not running in a container'}
              </Row>
            </div>
            <ul className="space-y-2" aria-label="Preflight checks">
              {system.preflight.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5">
                    <CheckIcon check={c} />
                  </span>
                  <div>
                    <p>{c.message}</p>
                    {c.hint && !c.ok && <p className="text-muted-foreground text-xs">{c.hint}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function GlobalEnvCard() {
  const { data, refetch } = useQuery({
    queryKey: ['global-env'],
    queryFn: () => api.get<{ content: string }>('/api/global-env'),
  })
  const [edited, setText] = useState<string>()
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const text = edited ?? data?.content

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/global-env', { content: text ?? '' })
      await refetch()
      toast.success('Saved global.env', { description: 'Redeploy stacks to apply the new values.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const dirty = data !== undefined && text !== undefined && text !== data.content
  return (
    <Card>
      <CardHeader>
        <CardTitle>Global environment</CardTitle>
        <CardDescription>
          Variables in <code>global.env</code> are available to every stack; a stack&apos;s own{' '}
          <code>.env</code> overrides them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {reveal ? (
          <Textarea
            value={text ?? ''}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="font-mono text-sm"
            placeholder="TZ=Europe/Amsterdam"
            aria-label="global.env"
          />
        ) : (
          <pre className="bg-muted/40 min-h-24 overflow-auto rounded-md border p-3 font-mono text-sm">
            {maskEnv(text ?? '') || <span className="text-muted-foreground"># empty</span>}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setReveal((r) => !r)}>
            {reveal ? 'Hide values' : 'Edit'}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const { data: session } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  if (!session || session.authDisabled) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) return toast.error('Use at least 8 characters.')
    setBusy(true)
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      setCurrent('')
      setNext('')
      toast.success('Password changed', { description: 'Other sessions were signed out.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Signed in as {session.user?.username}.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-sm gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="justify-self-start" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
