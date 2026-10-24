import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  channelTypes,
  notifyEvents,
  PUSHOVER_URL,
  type ChannelType,
  type ContainerNotifySettings,
  type NotificationChannel,
  type NotifyEvent,
} from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'

const TYPE_LABELS: Record<
  ChannelType,
  {
    label: string
    url: string
    token?: string
    recipient?: string
    /** The service has one endpoint, so there is no URL to ask for. */
    fixedUrl?: boolean
  }
> = {
  ntfy: { label: 'ntfy', url: 'https://ntfy.sh/my-stacky-topic', token: 'Access token (optional)' },
  gotify: { label: 'Gotify', url: 'https://gotify.example.com', token: 'Application token' },
  pushover: {
    label: 'Pushover',
    url: PUSHOVER_URL,
    token: 'Application API token',
    recipient: 'User or group key',
    fixedUrl: true,
  },
  discord: { label: 'Discord', url: 'https://discord.com/api/webhooks/…' },
  apprise: {
    label: 'Apprise API',
    url: 'http://apprise:8000/notify/apprise',
    token: 'Bearer token (optional)',
  },
  webhook: {
    label: 'Webhook (JSON)',
    url: 'https://example.com/hooks/stacky',
    token: 'Bearer token (optional)',
  },
}

const EVENT_LABELS: Record<NotifyEvent, string> = {
  operation_failed: 'A deploy or other operation fails',
  update_available: 'New image updates are found',
  container_unhealthy: 'A container stays unhealthy or keeps crashing',
  self_update: 'stacky updates itself (or rolls back)',
}

type Draft = Omit<NotificationChannel, 'id' | 'hasToken'> & {
  id?: string
  token?: string | null
  hasToken?: boolean
}

const emptyDraft = (): Draft => ({
  name: '',
  type: 'ntfy',
  url: '',
  events: ['operation_failed', 'container_unhealthy', 'self_update'],
  enabled: true,
})

/** Notification channels: where stacky reports failures, updates and self-updates. */
export function NotificationsCard() {
  const qc = useQueryClient()
  const { data: channels = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationChannel[]>('/api/settings/notifications'),
  })
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState<string>()
  const ready =
    !!draft?.url &&
    (!TYPE_LABELS[draft.type].recipient || !!draft.recipient?.trim()) &&
    (draft.type !== 'pushover' || !!draft.token || !!draft.hasToken)

  const changeType = (type: ChannelType) => {
    if (!draft) return
    const wasFixed = TYPE_LABELS[draft.type].fixedUrl
    const url = TYPE_LABELS[type].fixedUrl ? TYPE_LABELS[type].url : wasFixed ? '' : draft.url
    setDraft({ ...draft, type, url })
  }

  const persist = async (next: Draft[]) => {
    await api.put('/api/settings/notifications', {
      channels: next.map(({ hasToken: _h, ...c }) => c),
    })
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const saveDraft = async () => {
    if (!draft) return
    setBusy('save')
    try {
      const others = channels
        .filter((c) => c.id !== draft.id)
        .map((c) => ({ ...c, token: undefined }))
      await persist([...others, draft])
      setDraft(undefined)
      toast.success('Saved notification channel')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (id: string) => {
    setBusy(id)
    try {
      await persist(channels.filter((c) => c.id !== id).map((c) => ({ ...c, token: undefined })))
    } finally {
      setBusy(undefined)
    }
  }

  const test = async (channel: Draft) => {
    setBusy(`test-${channel.id ?? 'draft'}`)
    try {
      const { hasToken: _h, ...payload } = channel
      await api.post('/api/settings/notifications/test', { channel: payload })
      toast.success(`Sent a test message to ${channel.name || 'the channel'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Get told when something fails, needs updating or stays unhealthy.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
          <Plus /> Add channel
        </Button>
      </CardHeader>
      <CardContent>
        {channels.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Bell className="size-4" /> No channels yet. Add ntfy, Gotify, Pushover, Discord,
            Apprise or a webhook.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Notification channels">
            {channels.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground text-xs">{TYPE_LABELS[c.type].label}</span>
                {!c.enabled && <span className="text-muted-foreground text-xs">(off)</span>}
                <span className="text-muted-foreground hidden truncate text-xs md:inline">
                  {c.events.length} events
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Test ${c.name}`}
                    onClick={() => void test(c)}
                    disabled={!!busy}
                  >
                    {busy === `test-${c.id}` ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setDraft({ ...c })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => void remove(c.id)}
                    disabled={!!busy}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ContainerNotifications />
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(undefined)}>
        {draft && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {draft.id ? `Edit ${draft.name}` : 'Add a notification channel'}
              </DialogTitle>
              <DialogDescription>
                Messages are short: a title and one or two lines of detail.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-name">Name</Label>
                  <Input
                    id="ch-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Phone"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={draft.type} onValueChange={(v) => changeType(v as ChannelType)}>
                    <SelectTrigger aria-label="Channel type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABELS[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!TYPE_LABELS[draft.type].fixedUrl && (
                <div className="space-y-1.5">
                  <Label htmlFor="ch-url">URL</Label>
                  <Input
                    id="ch-url"
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    placeholder={TYPE_LABELS[draft.type].url}
                  />
                </div>
              )}
              {TYPE_LABELS[draft.type].recipient && (
                <div className="space-y-1.5">
                  <Label htmlFor="ch-recipient">{TYPE_LABELS[draft.type].recipient}</Label>
                  <Input
                    id="ch-recipient"
                    autoComplete="off"
                    value={draft.recipient ?? ''}
                    onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
                  />
                </div>
              )}
              {TYPE_LABELS[draft.type].token && (
                <div className="space-y-1.5">
                  <Label htmlFor="ch-token">{TYPE_LABELS[draft.type].token}</Label>
                  <Input
                    id="ch-token"
                    type="password"
                    autoComplete="off"
                    value={draft.token ?? ''}
                    placeholder={draft.hasToken ? '•••••••• (saved)' : ''}
                    onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                  />
                </div>
              )}
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Send when</legend>
                {notifyEvents.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.events.includes(ev)}
                      onCheckedChange={(v) =>
                        setDraft({
                          ...draft,
                          events: v ? [...draft.events, ev] : draft.events.filter((x) => x !== ev),
                        })
                      }
                    />
                    {EVENT_LABELS[ev]}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />{' '}
                Enabled
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => void test(draft)}
                disabled={!ready || !!busy}
              >
                {busy === `test-${draft.id ?? 'draft'}` ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Send />
                )}{' '}
                Send test
              </Button>
              <Button onClick={() => void saveDraft()} disabled={!draft.name || !ready || !!busy}>
                {busy === 'save' && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}

/** The default for container notifications, and the stack overrides set on stacky itself. */
function ContainerNotifications() {
  const qc = useQueryClient()
  const key = ['notifications', 'containers']
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.get<ContainerNotifySettings>('/api/settings/notifications/containers'),
  })
  const [saving, setSaving] = useState(false)
  if (!data) return null

  const toggle = async (enabled: boolean) => {
    setSaving(true)
    try {
      qc.setQueryData(
        key,
        await api.put<ContainerNotifySettings>('/api/settings/notifications/containers', {
          enabled,
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t pt-4 text-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="notify-containers">Notify about containers by default</Label>
          <p className="text-muted-foreground text-xs">
            Unhealthy containers and image updates. A{' '}
            <code className="font-mono text-xs">stacky.notify</code> label on a service, or a{' '}
            <code className="font-mono text-xs">stacky.notify.stack.&lt;stack&gt;</code> label on
            stacky itself, overrides this.
          </p>
        </div>
        <Switch
          id="notify-containers"
          checked={data.enabled}
          onCheckedChange={(enabled) => void toggle(enabled)}
          disabled={saving}
        />
      </div>
      {data.stacks.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Stack overrides on stacky:{' '}
          {data.stacks.map((s, i) => (
            <span key={s.stack}>
              {i > 0 && ', '}
              <span className="font-mono">{s.stack}</span> {s.enabled ? 'on' : 'off'}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
