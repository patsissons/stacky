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

describe('web UI', () => {
  it('serves index.html for client routes when a web dir is configured', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-web-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<html>stacky-ui</html>')
    const app = createApp({ config: { ...loadConfig({}), webDir } })

    const page = await app.request('/stacks/demo')
    expect(await page.text()).toContain('stacky-ui')

    const api = await app.request('/api/nope')
    expect(api.status).toBe(404)
  })
})
