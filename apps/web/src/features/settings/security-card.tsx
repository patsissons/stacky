import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/hooks/use-session'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'

/** Two-factor authentication for the admin account. */
export function TwoFactorCard() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ uri: string; qr: string; backupCodes: string[] }>()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  if (!session?.user) return null
  const enabled = !!session.user.twoFactorEnabled

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const res = await api.post<{ totpURI: string; backupCodes: string[] }>(
        '/api/auth/two-factor/enable',
        { password },
      )
      setSetup({
        uri: res.totpURI,
        qr: await QRCode.toDataURL(res.totpURI, { margin: 1, width: 220 }),
        backupCodes: res.backupCodes,
      })
      setPassword('')
    })
  }

  const confirm = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await api.post('/api/auth/two-factor/verify-totp', { code: code.trim() })
      setSetup(undefined)
      setCode('')
      await qc.invalidateQueries({ queryKey: ['session'] })
      toast.success('Two-factor authentication is on')
    })
  }

  const disable = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await api.post('/api/auth/two-factor/disable', { password })
      setPassword('')
      await qc.invalidateQueries({ queryKey: ['session'] })
      toast.success('Two-factor authentication is off')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication{' '}
          {enabled && <ShieldCheck className="text-status-running size-4" />}
        </CardTitle>
        <CardDescription>
          {enabled
            ? 'Signing in asks for a code from your authenticator app.'
            : 'Require a code from an authenticator app (1Password, Bitwarden, Aegis…) when signing in.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={enabled ? disable : start}
          className="flex max-w-md flex-wrap items-end gap-2"
        >
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="tfa-password">Confirm with your password</Label>
            <Input
              id="tfa-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant={enabled ? 'outline' : 'default'} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} {enabled ? 'Turn off' : 'Set up'}
          </Button>
        </form>
      </CardContent>

      <Dialog open={!!setup} onOpenChange={(o) => !o && setSetup(undefined)}>
        {setup && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Scan with your authenticator app</DialogTitle>
              <DialogDescription>
                Then enter the code it shows to finish turning on two-factor authentication.
              </DialogDescription>
            </DialogHeader>
            <img
              src={setup.qr}
              alt="Two-factor QR code"
              className="mx-auto rounded-lg bg-white p-2"
              width={220}
              height={220}
            />
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">
                Can't scan? Copy the setup key
              </summary>
              <code className="mt-1 block break-all">
                {new URL(setup.uri).searchParams.get('secret')}
              </code>
            </details>
            <div className="space-y-1">
              <p className="text-sm font-medium">Backup codes</p>
              <p className="text-muted-foreground text-xs">
                Each works once if you lose your device. Store them somewhere safe.
              </p>
              <pre className="bg-muted grid grid-cols-2 gap-1 rounded-md p-2 font-mono text-xs">
                {setup.backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </pre>
            </div>
            <form onSubmit={confirm} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="tfa-code">Code</Label>
                <Input
                  id="tfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Turn on
              </Button>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}

interface TokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt?: number
}

/** Long-lived tokens for scripts: `Authorization: Bearer stk_…`. */
export function ApiTokensCard() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: tokens = [] } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.get<TokenInfo[]>('/api/tokens'),
  })
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string>()
  const [copied, setCopied] = useState(false)
  if (session?.authDisabled) return null

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const res = await api.post<{ token: string }>('/api/tokens', { name })
      setCreated(res.token)
      setName('')
      await qc.invalidateQueries({ queryKey: ['tokens'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const revoke = async (id: string) => {
    await api.delete(`/api/tokens/${id}`).catch((err: Error) => toast.error(err.message))
    await qc.invalidateQueries({ queryKey: ['tokens'] })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For scripts and automation, e.g.{' '}
          <code>curl -H &quot;Authorization: Bearer stk_…&quot; …/api/stacks</code>. A token can do
          everything you can, except manage tokens.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={create} className="flex max-w-md gap-2">
          <Input
            placeholder="Token name, e.g. home-assistant"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Token name"
            required
          />
          <Button type="submit">
            <KeyRound /> Create
          </Button>
        </form>
        {tokens.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm" aria-label="API tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="font-medium">{t.name}</span>
                <code className="text-muted-foreground text-xs">{t.prefix}…</code>
                <span className="text-muted-foreground ml-auto text-xs">
                  {t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : 'never used'}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Revoke ${t.name}`}
                  onClick={() => void revoke(t.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog
        open={!!created}
        onOpenChange={(o) => !o && (setCreated(undefined), setCopied(false))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>
              It is shown only once. Stacky stores just a hash of it.
            </DialogDescription>
          </DialogHeader>
          <code
            className="bg-muted block rounded-md p-3 font-mono text-sm break-all"
            data-testid="new-token"
          >
            {created}
          </code>
          <DialogFooter>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(created ?? '')
                setCopied(true)
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

interface AuditEntry {
  id: number
  ts: number
  actor: string
  method: string
  path: string
  status: number
}

/** The last changes made through the API, newest first. */
export function AuditCard() {
  const [open, setOpen] = useState(false)
  const { data = [], refetch } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<AuditEntry[]>('/api/audit?limit=200'),
    enabled: open,
  })
  useEffect(() => {
    if (open) void refetch()
  }, [open, refetch])
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Activity log</CardTitle>
          <CardDescription>
            Every change made through stacky: who, what, and whether it worked.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-xs" aria-label="Activity log">
              <tbody className="divide-y">
                {data.map((e) => (
                  <tr key={e.id}>
                    <td className="text-muted-foreground px-3 py-1.5 whitespace-nowrap">
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5">{e.actor}</td>
                    {/* the card scrolls sideways on phones; keep each request on one line */}
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                      {e.method} {e.path}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${e.status >= 400 ? 'text-destructive' : 'text-status-running'}`}
                    >
                      {e.status}
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td className="text-muted-foreground px-3 py-4 text-center">Nothing yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
