import type { ChannelType, NotifyEvent } from '@stacky/shared'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  url: string
  token?: string
  events: NotifyEvent[]
  enabled: boolean
}

export interface Message {
  event: NotifyEvent
  title: string
  body: string
  level: 'info' | 'success' | 'warning' | 'error'
  stack?: string
}

const DISCORD_COLORS = { info: 0x6366f1, success: 0x22c55e, warning: 0xf59e0b, error: 0xef4444 }
const APPRISE_TYPES = { info: 'info', success: 'success', warning: 'warning', error: 'failure' }

/** Builds the HTTP request each channel type expects. */
export function buildRequest(channel: Channel, msg: Message): { url: string; init: RequestInit } {
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const bearer: Record<string, string> = channel.token
    ? { authorization: `Bearer ${channel.token}` }
    : {}

  switch (channel.type) {
    case 'ntfy':
      return {
        url: channel.url,
        init: {
          method: 'POST',
          headers: {
            // ntfy headers are latin-1; keep titles ASCII-safe
            title: msg.title.replace(/[^\x20-\x7e]/g, ''),
            priority: msg.level === 'error' ? 'high' : 'default',
            tags:
              msg.level === 'error'
                ? 'rotating_light'
                : msg.level === 'success'
                  ? 'white_check_mark'
                  : 'whale',
            ...bearer,
          },
          body: msg.body,
        },
      }
    case 'gotify': {
      const url = new URL('message', channel.url.endsWith('/') ? channel.url : `${channel.url}/`)
      if (channel.token) url.searchParams.set('token', channel.token)
      return {
        url: url.toString(),
        init: json({
          title: msg.title,
          message: msg.body,
          priority: msg.level === 'error' ? 8 : 4,
        }),
      }
    }
    case 'discord':
      return {
        url: channel.url,
        init: json({
          username: 'stacky',
          embeds: [
            {
              title: msg.title,
              description: msg.body.slice(0, 4000),
              color: DISCORD_COLORS[msg.level],
            },
          ],
        }),
      }
    case 'apprise':
      return {
        url: channel.url,
        init: json({ title: msg.title, body: msg.body, type: APPRISE_TYPES[msg.level] }, bearer),
      }
    case 'webhook':
      return {
        url: channel.url,
        init: json({ ...msg, source: 'stacky', timestamp: new Date().toISOString() }, bearer),
      }
  }
}

export async function send(channel: Channel, msg: Message, fetchImpl: typeof fetch = fetch) {
  const { url, init } = buildRequest(channel, msg)
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${channel.name}: HTTP ${res.status}`)
}
