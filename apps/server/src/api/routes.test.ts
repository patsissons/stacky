import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { loadConfig } from '../config'
import { silentLogger } from '../lib/logger'
import { createRuntime, type Runtime } from '../runtime'

let tmp: string
let runtime: Runtime
let app: ReturnType<typeof createApp>

const ORIGIN = 'http://localhost'

async function boot(env: Record<string, string> = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-api-'))
  const config = loadConfig({
    STACKY_STACKS_DIR: path.join(tmp, 'stacks'),
    STACKY_DATA_DIR: path.join(tmp, 'data'),
    ...env,
  })
  runtime = await createRuntime(config, silentLogger, { authRateLimit: false })
  app = createApp({ config, runtime })
}

function req(method: string, url: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, host: 'localhost' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.cookie) headers.cookie = init.cookie
  return app.request(url, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** Untyped JSON for assertions. */
const json = (res: Response): Promise<any> => res.json()

async function setupAdmin() {
  const res = await req('POST', '/api/setup', {
    body: { username: 'admin', password: 'correct horse' },
  })
  expect(res.status).toBe(200)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

afterEach(() => {
  runtime?.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('auth', () => {
  beforeEach(() => boot())

  it('reports setup state and protects the API', async () => {
    const session = await json(await req('GET', '/api/session'))
    expect(session).toEqual({ authDisabled: false, needsSetup: true, user: null, oidc: null })

    const res = await req('GET', '/api/stacks')
    expect(res.status).toBe(401)
    expect(await json(res)).toMatchObject({ error: { code: 'unauthenticated' } })
  })

  it('creates the admin once, signs them in, and keeps the token out of the body', async () => {
    const res = await req('POST', '/api/setup', {
      body: { username: 'Admin', password: 'correct horse' },
    })
    const body = await json(res)
    expect(body).toEqual({ ok: true, user: { username: 'admin' } })
    expect(JSON.stringify(body)).not.toContain('token')
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')

    expect((await req('GET', '/api/stacks', { cookie })).status).toBe(200)
    const again = await req('POST', '/api/setup', {
      body: { username: 'other', password: 'correct horse' },
    })
    expect(again.status).toBe(409)
  })
})

describe('auth disabled', () => {
  beforeEach(() => boot({ STACKY_AUTH_DISABLED: 'true' }))

  it('serves the API without a session', async () => {
    expect((await req('GET', '/api/stacks')).status).toBe(200)
    expect(await json(await req('GET', '/api/session'))).toMatchObject({ authDisabled: true })
  })
})

describe('stacks', () => {
  let cookie: string
  beforeEach(async () => {
    await boot()
    cookie = await setupAdmin()
  })

  it('creates, reads and saves a stack, preserving the exact text', async () => {
    const compose = '# my app\nservices:\n  web:\n    image: nginx:1.27 # pinned\n'
    const created = await req('POST', '/api/stacks', {
      cookie,
      body: { name: 'web', compose, env: 'A=1\n' },
    })
    expect(created.status).toBe(201)
    expect((await json(created)).stack).toMatchObject({ name: 'web', status: 'inactive' })

    const read = await json(await req('GET', '/api/stacks/web', { cookie }))
    expect(read.files).toMatchObject({ compose, env: 'A=1\n', composeFile: 'compose.yaml' })

    const updated = compose.replace('1.27', '1.28')
    expect(
      (await req('PUT', '/api/stacks/web', { cookie, body: { compose: updated } })).status,
    ).toBe(200)
    expect(fs.readFileSync(path.join(tmp, 'stacks/web/compose.yaml'), 'utf8')).toBe(updated)
  })

  it('rejects an invalid compose file with positioned issues and writes nothing', async () => {
    const res = await req('POST', '/api/stacks', {
      cookie,
      body: { name: 'bad', compose: 'services:\n  web:\n    imagee: x\n' },
    })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error.code).toBe('invalid_compose')
    expect(body.error.details.issues[0]).toMatchObject({ line: 3, severity: 'error' })
    expect(fs.existsSync(path.join(tmp, 'stacks/bad'))).toBe(false)
  })

  it('validates unsaved edits', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    const ok = await (
      await req('POST', '/api/stacks/app/validate', {
        cookie,
        body: { compose: 'services:\n  web:\n    image: nginx:${TAG}\n', env: 'TAG=1\n' },
      })
    ).json()
    expect(ok).toEqual({ ok: true, issues: [] })
  })

  it('reads logs once and long-polls operations', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    const logs = await req('GET', '/api/stacks/app/logs?tail=10', { cookie })
    expect(await json(logs)).toEqual({ lines: [] })
    expect((await req('GET', '/api/stacks/nope/logs', { cookie })).status).toBe(404)
    expect((await req('GET', '/api/stacks/app/logs?service=web', { cookie })).status).toBe(404)

    const op = await json(await req('POST', '/api/stacks/app/actions/down', { cookie }))
    const done = await json(await req('GET', `/api/operations/${op.id}?wait=60`, { cookie }))
    expect(['succeeded', 'failed']).toContain(done.state)
    expect(typeof done.output).toBe('string')
    expect((await req('GET', '/api/operations/op_nope?wait=1', { cookie })).status).toBe(404)
  })

  it('rejects malformed action bodies with a 400', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    const res = await app.request('/api/stacks/app/actions/restart', {
      method: 'POST',
      headers: { origin: ORIGIN, host: 'localhost', cookie, 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    const unknown = await req('POST', '/api/stacks/app/actions/restart', {
      cookie,
      body: { options: { nope: true } },
    })
    expect(unknown.status).toBe(400)
  })

  it('requires a user key for Pushover channels and returns it', async () => {
    const pushover = {
      name: 'Phone',
      type: 'pushover',
      url: 'https://api.pushover.net/1/messages.json',
      token: 'app-token',
      events: ['operation_failed'],
      enabled: true,
    }
    const missing = await req('PUT', '/api/settings/notifications', {
      cookie,
      body: { channels: [pushover] },
    })
    expect(missing.status).toBe(400)
    const saved = await req('PUT', '/api/settings/notifications', {
      cookie,
      body: { channels: [{ ...pushover, recipient: 'user-key' }] },
    })
    expect(saved.status).toBe(200)
    expect(await json(saved)).toMatchObject([{ type: 'pushover', recipient: 'user-key' }])
  })

  it('rejects bad names and paths', async () => {
    const res = await req('POST', '/api/stacks', {
      cookie,
      body: { name: '../evil', compose: 'services: {}\n' },
    })
    expect(res.status).toBe(400)
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    const file = await req('GET', '/api/stacks/app/file?path=../../data/auth-secret', { cookie })
    expect(file.status).toBe(403)
  })

  it('edits other files and global.env', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    await req('PUT', '/api/stacks/app/file', {
      cookie,
      body: { path: 'config/app.ini', content: 'x=1\n' },
    })
    const files = await json(await req('GET', '/api/stacks/app/files', { cookie }))
    expect(files.map((f: { path: string }) => f.path)).toContain('config/app.ini')

    await req('PUT', '/api/global-env', { cookie, body: { content: 'TZ=UTC\n' } })
    expect(await json(await req('GET', '/api/global-env', { cookie }))).toEqual({
      content: 'TZ=UTC\n',
    })
  })

  it('returns structured 404s', async () => {
    const res = await req('GET', '/api/stacks/missing', { cookie })
    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ error: { code: 'not_found' } })
    expect((await req('GET', '/api/nope', { cookie })).status).toBe(404)
  })

  it('browses the stacks and data directories read-only', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    const roots = await json(await req('GET', '/api/files/roots', { cookie }))
    expect(roots.map((r: { id: string }) => r.id)).toEqual(['stacks', 'data'])
    const listing = await json(await req('GET', '/api/files?root=stacks&path=app', { cookie }))
    expect(listing.entries.map((e: { name: string }) => e.name)).toContain('compose.yaml')
    const preview = await json(
      await req('GET', '/api/files/preview?root=stacks&path=app/compose.yaml', { cookie }),
    )
    expect(preview).toMatchObject({ kind: 'text', content: 'services: {}\n' })
    const data = await json(await req('GET', '/api/files?root=data', { cookie }))
    expect(data.entries.map((e: { name: string }) => e.name)).not.toContain('auth-secret')
    expect(
      (await req('GET', '/api/files/preview?root=data&path=auth-secret', { cookie })).status,
    ).toBe(404)
    expect((await req('GET', '/api/files?root=stacks&path=..', { cookie })).status).toBe(403)
    expect(
      (await req('GET', '/api/files/raw?root=stacks&path=app/compose.yaml', { cookie })).status,
    ).toBe(400)
    // there is no way to write through the browser
    expect((await req('PUT', '/api/files?root=stacks&path=app/x', { cookie })).status).toBe(404)
  })

  it('serves icons only from known sets and registered URLs', async () => {
    const unknown = await req('GET', `/api/icons/url/${'0'.repeat(24)}`, { cookie })
    expect(unknown.status).toBe(404)
    expect((await req('GET', '/api/icons/evil/nginx', { cookie })).status).toBe(404)
  })

  it('clears a stack history', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    runtime.stacks.revisions?.record('app', {
      name: 'app',
      composeFile: 'compose.yaml',
      compose: 'services: {}\n',
      env: '',
      hasEnv: false,
    })
    expect(await json(await req('GET', '/api/stacks/app/revisions', { cookie }))).toHaveLength(1)
    const res = await req('DELETE', '/api/stacks/app/history', { cookie })
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ revisions: 1, operations: 0 })
    expect(await json(await req('GET', '/api/stacks/app/revisions', { cookie }))).toEqual([])
    expect((await req('DELETE', '/api/stacks/..%2Fx/history', { cookie })).status).toBe(400)
  })

  it('accepts the update actions and explains when there is nothing to update', async () => {
    await req('POST', '/api/stacks', { cookie, body: { name: 'app', compose: 'services: {}\n' } })
    for (const action of ['pull-updates', 'deploy-updates']) {
      const res = await req('POST', `/api/stacks/app/actions/${action}`, { cookie })
      expect(res.status).toBe(409)
      expect(await json(res)).toMatchObject({ error: { code: 'no_updates' } })
    }
  })
})

describe('API tokens and audit log', () => {
  let cookie: string
  beforeEach(async () => {
    await boot()
    cookie = await setupAdmin()
  })

  it('authenticates scripts with a bearer token that can be revoked', async () => {
    const created = await json(await req('POST', '/api/tokens', { cookie, body: { name: 'ci' } }))
    expect(created.token).toMatch(/^stk_/)
    const withToken = (method: string, url: string, body?: unknown) =>
      app.request(url, {
        method,
        headers: {
          authorization: `Bearer ${created.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })

    expect((await withToken('GET', '/api/stacks')).status).toBe(200)
    // tokens cannot mint more tokens
    expect((await withToken('POST', '/api/tokens', { name: 'x' })).status).toBe(403)

    await req('DELETE', `/api/tokens/${created.info.id}`, { cookie })
    const revoked = await withToken('GET', '/api/stacks')
    expect(revoked.status).toBe(401)
    expect(await json(revoked)).toMatchObject({ error: { code: 'invalid_token' } })
  })

  it('records who changed what, including failures', async () => {
    await req('PUT', '/api/global-env', { cookie, body: { content: 'TZ=UTC\n' } })
    await req('POST', '/api/stacks', { cookie, body: { name: '../bad', compose: '' } })
    const log = await json(await req('GET', '/api/audit', { cookie }))
    expect(log.slice(0, 2).map((e: any) => [e.actor, e.method, e.path, e.status])).toEqual([
      ['admin', 'POST', '/api/stacks', 400],
      ['admin', 'PUT', '/api/global-env', 200],
    ])
  })

  it('reports OIDC as not configured by default', async () => {
    expect((await json(await req('GET', '/api/session', { cookie }))).oidc).toBeNull()
  })
})
