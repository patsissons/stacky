import type { ChannelType, NotifyEvent } from '@stacky/shared'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  url: string
  token?: string
  recipient?: string
  events: NotifyEvent[]
  enabled: boolean
}

export interface Message {
  event: NotifyEvent
  title: string
  body: string
  level: 'info' | 'success' | 'warning' | 'error'
  stack?: string
  /** Where the message should link to in stacky (only when `STACKY_BASE_URL` is set). */
  url?: string
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
            ...(msg.url ? { click: msg.url } : {}),
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
          ...(msg.url ? { extras: { 'client::notification': { click: { url: msg.url } } } } : {}),
        }),
      }
    }
    case 'pushover':
      return {
        url: channel.url,
        init: json({
          token: channel.token,
          user: channel.recipient,
          title: msg.title.slice(0, 250),
          message: msg.body.slice(0, 1024),
          // 1 is "high": it bypasses quiet hours; 2 (emergency) needs acknowledging, so skip it
          priority: msg.level === 'error' ? 1 : 0,
          ...(msg.url ? { url: msg.url, url_title: 'Open in stacky' } : {}),
        }),
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
              ...(msg.url ? { url: msg.url } : {}),
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
  if (!res.ok) {
    const reason = errorReason(await res.text().catch(() => ''))
    throw new Error(`${channel.name}: HTTP ${res.status}${reason ? ` (${reason})` : ''}`)
  }
}

/** The human readable part of an error response from Pushover, Gotify, ntfy and friends. */
export function errorReason(text: string): string | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  const reason = Array.isArray(b.errors)
    ? b.errors.filter((e) => typeof e === 'string').join('; ')
    : [b.errorDescription, b.error, b.message].find((v) => typeof v === 'string')
  return typeof reason === 'string' && reason ? reason.slice(0, 200) : undefined
}
