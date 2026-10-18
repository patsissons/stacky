import { describe, expect, it } from 'vitest'
import { buildRequest, type Channel, type Message } from './channels'

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
    expect(init.body).toBe('Port 80 is already in use')
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
      body: 'Port 80 is already in use',
      type: 'failure',
    })
  })

  it('sends the full event to generic webhooks', () => {
    const body = JSON.parse(buildRequest(channel({}), msg).init.body as string)
    expect(body).toMatchObject({ event: 'operation_failed', stack: 'app', source: 'stacky' })
  })
})
