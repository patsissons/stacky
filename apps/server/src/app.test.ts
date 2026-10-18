import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { loadConfig } from './config'

describe('createApp', () => {
  it('responds to /healthz', async () => {
    const app = createApp({ config: loadConfig({}) })
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })
})
