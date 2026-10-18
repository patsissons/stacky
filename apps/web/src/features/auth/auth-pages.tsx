import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const search = useSearch({ strict: false }) as { redirect?: string }
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.post('/api/auth/sign-in/username', { username: username.trim(), password })
      await qc.invalidateQueries({ queryKey: ['session'] })
      const target = search.redirect?.startsWith('/') ? search.redirect : '/'
      void navigate({ to: target })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong username or password.'
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

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Manage your Docker stacks.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
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
            <FieldError message={error} />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
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
