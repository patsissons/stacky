import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  GitBranch,
  Loader2,
  XCircle,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'

interface GitResult {
  at: number
  ok: boolean
  error?: string
  stacks?: string[]
}

interface GitView {
  settings: {
    enabled: boolean
    includeEnv: boolean
    push: boolean
    pull: { enabled: boolean; intervalMinutes: number; autoDeploy: boolean }
    remote?: { url: string; branch: string; username?: string; hasToken: boolean }
    webhookSecret: string
  }
  status: {
    enabled: boolean
    isRepo: boolean
    lastCommit?: { hash: string; ts: number; subject: string }
    lastPush?: GitResult
    lastPull?: GitResult
  }
}

/** Keeps the stacks directory in git: history, backups (push) and GitOps (pull + deploy). */
export function GitCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['git'], queryFn: () => api.get<GitView>('/api/git') })
  const [draft, setDraft] = useState<Partial<GitView['settings']> & { token?: string }>({})
  const [busy, setBusy] = useState<string>()
  if (!data) return null
  const s = { ...data.settings, ...draft, pull: { ...data.settings.pull, ...draft.pull } }
  const remoteUrl = draft.remote?.url ?? data.settings.remote?.url ?? ''
  const branch = draft.remote?.branch ?? data.settings.remote?.branch ?? 'main'
  const webhook = `${window.location.origin}/api/git/webhook/${data.settings.webhookSecret}`

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    try {
      const next = await api.put<GitView>('/api/git', {
        enabled: s.enabled,
        includeEnv: s.includeEnv,
        push: s.push,
        pull: s.pull,
        remote: remoteUrl ? { url: remoteUrl, branch, token: draft.token } : undefined,
      })
      qc.setQueryData(['git'], next)
      setDraft({})
      toast.success('Saved git settings')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const sync = async (what: 'push' | 'pull') => {
    setBusy(what)
    try {
      const r = await api.post<GitResult>(`/api/git/${what}`)
      if (r.ok)
        toast.success(
          what === 'pull'
            ? `Pulled${r.stacks?.length ? `; changed: ${r.stacks.join(', ')}` : ', nothing new'}`
            : 'Pushed',
        )
      else toast.error(r.error ?? `${what} failed`)
      await qc.invalidateQueries({ queryKey: ['git'] })
    } finally {
      setBusy(undefined)
    }
  }

  const set = (patch: Partial<GitView['settings']>) => setDraft((d) => ({ ...d, ...patch }))
  const setRemote = (patch: { url?: string; branch?: string }) =>
    setDraft((d) => ({
      ...d,
      remote: { url: remoteUrl, branch, hasToken: false, ...d.remote, ...patch },
    }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4" /> Git
        </CardTitle>
        <CardDescription>
          Keep the stacks directory in a git repository. Every change made in stacky becomes a
          commit (compose files only; data folders are never added). Optionally push to a remote as
          a backup, or pull from it and redeploy what changed (GitOps).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid max-w-xl gap-4">
          <Toggle
            id="git-enabled"
            checked={s.enabled}
            onChange={(v) => set({ enabled: v })}
            label="Track stacks in git"
          />
          {s.enabled && (
            <>
              <Toggle
                id="git-env"
                checked={s.includeEnv}
                onChange={(v) => set({ includeEnv: v })}
                label="Also commit .env files and global.env (they usually contain secrets)"
              />
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="git-remote">Remote (optional)</Label>
                  <Input
                    id="git-remote"
                    placeholder="https://github.com/you/homelab-stacks.git or git@…"
                    value={remoteUrl}
                    onChange={(e) => setRemote({ url: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="git-branch">Branch</Label>
                  <Input
                    id="git-branch"
                    value={branch}
                    onChange={(e) => setRemote({ branch: e.target.value })}
                  />
                </div>
              </div>
              {remoteUrl.startsWith('http') && (
                <div className="space-y-1.5">
                  <Label htmlFor="git-token">Access token (HTTPS)</Label>
                  <Input
                    id="git-token"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      data.settings.remote?.hasToken
                        ? '•••••••• (saved)'
                        : 'Personal access token with repo access'
                    }
                    value={draft.token ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
                  />
                </div>
              )}
              {remoteUrl && (
                <>
                  <Toggle
                    id="git-push"
                    checked={s.push}
                    onChange={(v) => set({ push: v })}
                    label="Push every commit (backup)"
                  />
                  <Toggle
                    id="git-pull"
                    checked={s.pull.enabled}
                    onChange={(v) => set({ pull: { ...s.pull, enabled: v } })}
                    label="Pull from the remote (GitOps)"
                  />
                  {s.pull.enabled && (
                    <div className="border-muted space-y-3 border-l-2 pl-4">
                      <div className="flex items-center gap-2 text-sm">
                        Every
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-20"
                          aria-label="Pull interval in minutes"
                          value={s.pull.intervalMinutes}
                          onChange={(e) =>
                            set({
                              pull: { ...s.pull, intervalMinutes: Number(e.target.value) || 5 },
                            })
                          }
                        />
                        minutes, or instantly with a push webhook:
                      </div>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={webhook}
                          className="font-mono text-xs"
                          aria-label="Webhook URL"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Copy webhook URL"
                          onClick={() =>
                            void navigator.clipboard
                              ?.writeText(webhook)
                              .then(() => toast.success('Copied'))
                          }
                        >
                          <Copy />
                        </Button>
                      </div>
                      <Toggle
                        id="git-autodeploy"
                        checked={s.pull.autoDeploy}
                        onChange={(v) => set({ pull: { ...s.pull, autoDeploy: v } })}
                        label="Deploy stacks whose files changed"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!!busy}>
              {busy === 'save' && <Loader2 className="animate-spin" />} Save
            </Button>
            {data.settings.enabled && data.settings.remote && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void sync('push')}
                  disabled={!!busy}
                >
                  {busy === 'push' ? <Loader2 className="animate-spin" /> : <ArrowUpFromLine />}{' '}
                  Push now
                </Button>
                {data.settings.pull.enabled && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void sync('pull')}
                    disabled={!!busy}
                  >
                    {busy === 'pull' ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}{' '}
                    Pull now
                  </Button>
                )}
              </>
            )}
          </div>
        </form>

        {data.status.enabled && (
          <dl className="text-muted-foreground mt-4 grid gap-1 text-xs">
            {data.status.lastCommit && (
              <div>
                Last commit <code>{data.status.lastCommit.hash.slice(0, 7)}</code>{' '}
                {data.status.lastCommit.subject} · {formatRelative(data.status.lastCommit.ts)}
              </div>
            )}
            <Result label="Last push" r={data.status.lastPush} />
            <Result label="Last pull" r={data.status.lastPull} />
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function Result({ label, r }: { label: string; r?: GitResult }) {
  if (!r) return null
  return (
    <div className="flex items-start gap-1.5">
      {r.ok ? (
        <CheckCircle2 className="text-status-running mt-0.5 size-3.5" />
      ) : (
        <XCircle className="text-destructive mt-0.5 size-3.5" />
      )}
      <span>
        {label} {formatRelative(r.at)}
        {r.error ? `: ${r.error}` : r.stacks?.length ? ` (changed: ${r.stacks.join(', ')})` : ''}
      </span>
    </div>
  )
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}
