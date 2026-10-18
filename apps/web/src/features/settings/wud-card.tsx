import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'

interface WudSettings {
  enabled: boolean
  url: string
  hasToken: boolean
}

/** Optional What's Up Docker connection, used where stacky's own checks can't answer. */
export function WudCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['wud'],
    queryFn: () => api.get<WudSettings>('/api/settings/wud'),
  })
  const [draft, setDraft] = useState<{ enabled?: boolean; url?: string; token?: string }>({})
  const [busy, setBusy] = useState<'save' | 'test'>()
  const enabled = draft.enabled ?? data?.enabled ?? false
  const url = draft.url ?? data?.url ?? ''
  const payload = { enabled, url, token: draft.token }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    try {
      await api.put('/api/settings/wud', payload)
      setDraft({})
      await qc.invalidateQueries({ queryKey: ['wud'] })
      toast.success('Saved WUD settings')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      const r = await api.post<{ containers: number }>('/api/settings/wud/test', payload)
      toast.success(`Connected to WUD (${r.containers} containers)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What&apos;s Up Docker</CardTitle>
        <CardDescription>
          Stacky checks registries itself. If you also run{' '}
          <a
            href="https://getwud.app"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            WUD
          </a>
          , stacky uses it for images it can&apos;t check (private registries, rate limits). Create
          a personal API token in WUD under My Profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid max-w-lg gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="wud-enabled"
              checked={enabled}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
            />
            <Label htmlFor="wud-enabled" className="font-normal">
              Use WUD
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wud-url">URL</Label>
            <Input
              id="wud-url"
              placeholder="http://wud:3000"
              value={url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wud-token">API token</Label>
            <Input
              id="wud-token"
              type="password"
              autoComplete="off"
              placeholder={data?.hasToken ? '•••••••• (saved)' : 'wud_…'}
              value={draft.token ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void test()}
              disabled={!url || !!busy}
            >
              {busy === 'test' && <Loader2 className="animate-spin" />} Test connection
            </Button>
            <Button type="submit" disabled={!!busy}>
              {busy === 'save' && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
