import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { UpdateScheduleSettings } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'

const PRESETS = [
  { value: 'hourly', label: 'Hourly' },
  { value: '6h', label: 'Every 6 hours' },
  { value: 'nightly', label: 'Nightly (3 AM)' },
  { value: 'weekly', label: 'Weekly (Sunday, 3 AM)' },
  { value: 'monthly', label: 'Monthly (the 1st, 3 AM)' },
  { value: 'never', label: 'Never (only when asked)' },
]
const CUSTOM = 'custom'

/** How often stacky checks images for updates; containers can override it with a label. */
export function UpdatesCard() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['update-schedule'],
    queryFn: () => api.get<UpdateScheduleSettings>('/api/settings/updates'),
  })
  const [draft, setDraft] = useState<string>()
  const [custom, setCustom] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const value = draft ?? data?.schedule ?? ''
  const preset = PRESETS.find((p) => p.value === value.trim().toLowerCase())
  const showCustom = custom || (!!value && !preset)

  const save = async (schedule: string | null) => {
    setBusy(true)
    setError(undefined)
    try {
      await api.put('/api/settings/updates', { schedule })
      setDraft(undefined)
      setCustom(false)
      await qc.invalidateQueries({ queryKey: ['update-schedule'] })
      await qc.invalidateQueries({ queryKey: ['updates'] })
      toast.success('Saved the update check schedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save(value)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image update checks</CardTitle>
        <CardDescription>
          How often stacky checks registries for newer images. To check a container on its own
          schedule, give it a <code className="font-mono text-xs">stacky.update.schedule</code>{' '}
          label with one of these values.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-lg gap-3" aria-label="Image update checks">
          <div className="space-y-1.5">
            <Label>Check</Label>
            <Select
              value={showCustom ? CUSTOM : (preset?.value ?? '')}
              onValueChange={(v) => {
                setError(undefined)
                if (v === CUSTOM) {
                  setCustom(true)
                  return
                }
                setCustom(false)
                setDraft(v)
              }}
            >
              <SelectTrigger aria-label="Update check schedule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom interval or cron…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showCustom && (
            <div className="space-y-1.5">
              <Label htmlFor="update-schedule">Interval or cron pattern</Label>
              <Input
                id="update-schedule"
                className="font-mono"
                placeholder="12h, 30m, 0 4 * * *"
                value={value}
                aria-invalid={!!error}
                onChange={(e) => {
                  setError(undefined)
                  setDraft(e.target.value)
                }}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            {data?.nextCheckAt
              ? `Next check: ${new Date(data.nextCheckAt).toLocaleString()}`
              : 'No scheduled checks.'}
            {data && !data.saved && ` Using the default (${data.default}).`}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !value.trim() || draft === undefined}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
            {data?.saved && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void save(null)}
                disabled={busy}
              >
                Use default ({data.default})
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
