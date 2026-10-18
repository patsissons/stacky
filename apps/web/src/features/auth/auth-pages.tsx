import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/hooks/use-session'
import { api, ApiError } from '@/lib/api'

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_top,var(--color-accent),transparent_60%)] p-4">
      <div className="flex items-center gap-2.5">
        <Logo className="size-9" />
        <span className="text-2xl font-semibold tracking-tight">stacky</span>
      </div>
      {children}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  )
}

export function LoginPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    redirect?: string
    error?: string
    local?: string
  }
  const { data: session } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [trustDevice, setTrustDevice] = useState(true)
  const [step, setStep] = useState<'password' | 'totp'>('password')
  const [error, setError] = useState<string | undefined>(
    search.error ? oidcError(search.error) : undefined,
  )
  const [busy, setBusy] = useState(false)
  const target = search.redirect?.startsWith('/') ? search.redirect : '/'
  const oidc = session?.oidc

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ['session'] })
    void navigate({ to: target })
  }

  const startSso = () => {
    if (!oidc) return
    setBusy(true)
    ssoUrl(oidc.providerId, target)
      .then((url) => window.location.assign(url))
      .catch((err: Error) => {
        setError(err.message)
        setBusy(false)
      })
  }

  // Auto-redirect to SSO unless the user came back with an error or asked for the local form.
  const autoRedirect = !!oidc?.autoRedirect && !search.error && !search.local
  useEffect(() => {
    if (!autoRedirect || !oidc) return
    ssoUrl(oidc.providerId, target)
      .then((url) => window.location.assign(url))
      .catch((err: Error) => setError(err.message))
  }, [autoRedirect, oidc, target])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      if (step === 'password') {
        const res = await api.post<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/username', {
          username: username.trim(),
          password,
        })
        if (res?.twoFactorRedirect) {
          setStep('totp')
          return
        }
      } else {
        await api.post(
          useBackup
            ? '/api/auth/two-factor/verify-backup-code'
            : '/api/auth/two-factor/verify-totp',
          {
            code: code.trim(),
            trustDevice,
          },
        )
      }
      await finish()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? step === 'totp'
            ? 'That code is not valid.'
            : 'Wrong username or password.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many attempts. Wait a few seconds and try again.'
            : err instanceof Error
              ? err.message
              : 'Sign in failed',
      )
    } finally {
      setBusy(false)
    }
  }

  if (autoRedirect) {
    return (
      <AuthLayout>
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Redirecting to {oidc?.name}…
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{step === 'totp' ? 'Two-factor authentication' : 'Sign in'}</CardTitle>
          <CardDescription>
            {step === 'totp'
              ? useBackup
                ? 'Enter one of your backup codes.'
                : 'Enter the 6-digit code from your authenticator app.'
              : 'Manage your Docker stacks.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-4">
            {step === 'password' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="otp">{useBackup ? 'Backup code' : 'Code'}</Label>
                  <Input
                    id="otp"
                    autoComplete="one-time-code"
                    inputMode={useBackup ? 'text' : 'numeric'}
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={trustDevice}
                    onCheckedChange={(v) => setTrustDevice(v === true)}
                  />
                  Trust this device for 30 days
                </label>
              </>
            )}
            <FieldError message={error} />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}{' '}
              {step === 'totp' ? 'Verify' : 'Sign in'}
            </Button>
            {step === 'totp' && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground w-full text-center text-xs"
                onClick={() => {
                  setUseBackup((b) => !b)
                  setCode('')
                }}
              >
                {useBackup
                  ? 'Use your authenticator app instead'
                  : 'Lost your device? Use a backup code'}
              </button>
            )}
          </form>
          {oidc && step === 'password' && (
            <>
              <div className="text-muted-foreground flex items-center gap-3 text-xs">
                <span className="bg-border h-px flex-1" /> or{' '}
                <span className="bg-border h-px flex-1" />
              </div>
              <Button variant="outline" className="w-full" onClick={startSso} disabled={busy}>
                <KeyRound /> Sign in with {oidc.name}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  )
}

/** Asks the server where to send the browser to sign in with the OIDC provider. */
async function ssoUrl(providerId: string, callbackURL: string): Promise<string> {
  const res = await api.post<{ url?: string }>('/api/auth/sign-in/oauth2', {
    providerId,
    callbackURL,
    errorCallbackURL: '/login',
  })
  if (!res.url) throw new Error('Single sign-on is not available')
  return res.url
}

/** better-auth puts OAuth failures in `?error=`; make the common ones readable. */
function oidcError(code: string): string {
  const text = code.replace(/_/g, ' ')
  if (/group/i.test(text)) return 'Your account is not allowed to use stacky.'
  return `Single sign-on failed: ${text}`
}

export function SetupPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('The passwords do not match.')
    if (password.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    setError(undefined)
    try {
      await api.post('/api/setup', { username, password })
      await qc.invalidateQueries({ queryKey: ['session'] })
      void navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome to stacky</CardTitle>
          <CardDescription>Create the admin account to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-username">Username</Label>
              <Input
                id="setup-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-confirm">Confirm password</Label>
              <Input
                id="setup-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <FieldError message={error} />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Create account
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
