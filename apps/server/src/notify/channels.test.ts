import { describe, expect, it } from 'vitest'
import { PUSHOVER_URL } from '@stacky/shared'
import {
  buildRequest,
  context,
  errorReason,
  send,
  withContext,
  type Channel,
  type Message,
} from './channels'

const msg: Message = {
  event: 'operation_failed',
  title: 'Deploy app failed',
  body: 'Port 80 is already in use',
  level: 'error',
  stack: 'app',
}
const channel = (over: Partial<Channel>): Channel => ({
  id: '1',
  name: 'test',
  type: 'webhook',
  url: 'https://example.test/hook',
  events: ['operation_failed'],
  enabled: true,
  ...over,
})

describe('buildRequest', () => {
  it('posts plain text with headers to ntfy', () => {
    const { url, init } = buildRequest(
      channel({ type: 'ntfy', url: 'https://ntfy.sh/stacky', token: 'tk' }),
      msg,
    )
    expect(url).toBe('https://ntfy.sh/stacky')
    expect(init.body).toBe('Port 80 is already in use\n\nStack: app')
    expect(init.headers).toMatchObject({
      title: 'Deploy app failed',
      priority: 'high',
      authorization: 'Bearer tk',
    })
  })

  it('puts the gotify token in the query string', () => {
    const { url, init } = buildRequest(
      channel({ type: 'gotify', url: 'https://gotify.lan', token: 'abc' }),
      msg,
    )
    expect(url).toBe('https://gotify.lan/message?token=abc')
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: 'Deploy app failed',
      priority: 8,
    })
  })

  it('sends Discord embeds and Apprise types', () => {
    const discord = JSON.parse(buildRequest(channel({ type: 'discord' }), msg).init.body as string)
    expect(discord.embeds[0]).toMatchObject({ title: 'Deploy app failed', color: 0xef4444 })
    const apprise = JSON.parse(buildRequest(channel({ type: 'apprise' }), msg).init.body as string)
    expect(apprise).toEqual({
      title: 'Deploy app failed',
      body: 'Port 80 is already in use\n\nStack: app',
      type: 'failure',
    })
  })

  it('sends the full event to generic webhooks', () => {
    const body = JSON.parse(buildRequest(channel({}), { ...msg, host: 'nas' }).init.body as string)
    expect(body).toMatchObject({
      event: 'operation_failed',
      stack: 'app',
      host: 'nas',
      body: 'Port 80 is already in use',
      source: 'stacky',
    })
  })

  it('names the host and stack under the message', () => {
    const hosted = { ...msg, host: 'nas' }
    expect(buildRequest(channel({ type: 'ntfy' }), hosted).init.body).toBe(
      'Port 80 is already in use\n\nHost: nas · Stack: app',
    )
    const gotify = JSON.parse(buildRequest(channel({ type: 'gotify' }), hosted).init.body as string)
    expect(gotify.message).toBe('Port 80 is already in use\n\nHost: nas · Stack: app')
    const discord = JSON.parse(
      buildRequest(channel({ type: 'discord' }), hosted).init.body as string,
    )
    expect(discord.embeds[0]).toMatchObject({
      description: 'Port 80 is already in use',
      footer: { text: 'Host: nas · Stack: app' },
    })
    const bare = { ...msg, stack: undefined }
    expect(buildRequest(channel({ type: 'ntfy' }), bare).init.body).toBe(
      'Port 80 is already in use',
    )
    const plain = JSON.parse(buildRequest(channel({ type: 'discord' }), bare).init.body as string)
    expect(plain.embeds[0]).not.toHaveProperty('footer')
  })

  it('posts Pushover messages with the app token, user key and a link', () => {
    const { url, init } = buildRequest(
      channel({ type: 'pushover', url: PUSHOVER_URL, token: 'app', recipient: 'user' }),
      { ...msg, body: 'x'.repeat(2000), url: 'https://stacky.lan/stacks/app' },
    )
    expect(url).toBe(PUSHOVER_URL)
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      token: 'app',
      user: 'user',
      title: 'Deploy app failed',
      priority: 1,
      url: 'https://stacky.lan/stacks/app',
      url_title: 'Open in stacky',
    })
    expect(body.message).toHaveLength(1024)
    expect(body.message).toMatch(/x…\n\nStack: app$/)
    const info = JSON.parse(
      buildRequest(channel({ type: 'pushover', recipient: 'user' }), { ...msg, level: 'info' }).init
        .body as string,
    )
    expect(info.priority).toBe(0)
    expect(info).not.toHaveProperty('url')
  })

  it('links back to stacky from ntfy, Discord and Gotify when a URL is known', () => {
    const linked = { ...msg, url: 'https://stacky.lan/' }
    expect(buildRequest(channel({ type: 'ntfy' }), linked).init.headers).toMatchObject({
      click: 'https://stacky.lan/',
    })
    expect(buildRequest(channel({ type: 'ntfy' }), msg).init.headers).not.toHaveProperty('click')
    const discord = JSON.parse(
      buildRequest(channel({ type: 'discord' }), linked).init.body as string,
    )
    expect(discord.embeds[0].url).toBe('https://stacky.lan/')
    const gotify = JSON.parse(buildRequest(channel({ type: 'gotify' }), linked).init.body as string)
    expect(gotify.extras['client::notification'].click.url).toBe('https://stacky.lan/')
  })
})

describe('withContext', () => {
  it('joins the parts the message has', () => {
    expect(context({ host: 'nas', stack: 'web' })).toBe('Host: nas · Stack: web')
    expect(context({ host: 'nas' })).toBe('Host: nas')
    expect(context({})).toBe('')
  })

  it('keeps the context line when the body has to be cut', () => {
    const long = { ...msg, host: 'nas', body: 'y'.repeat(50) }
    const text = withContext(long, 40)
    expect(text).toHaveLength(40)
    expect(text.endsWith('\n\nHost: nas · Stack: app')).toBe(true)
    expect(withContext({ ...msg, stack: undefined }, 4)).toBe('Port')
  })
})

describe('send', () => {
  it('explains rejected requests with the service error', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ user: 'invalid', errors: ['user identifier is invalid'], status: 0 }),
        { status: 400 },
      )) as unknown as typeof fetch
    await expect(
      send(channel({ type: 'pushover', name: 'Phone' }), msg, fetchImpl),
    ).rejects.toThrow('Phone: HTTP 400 (user identifier is invalid)')
  })

  it('reads the error fields of common services', () => {
    expect(errorReason('{"error":"unauthorized","http":401}')).toBe('unauthorized')
    expect(errorReason('{"error":"Unauthorized","errorDescription":"bad token"}')).toBe('bad token')
    expect(errorReason('<html>nope</html>')).toBeUndefined()
    expect(errorReason('{}')).toBeUndefined()
  })
})
