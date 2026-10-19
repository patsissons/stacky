import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { loadConfig } from '../config'
import { silentLogger } from '../lib/logger'
import { createRuntime, type Runtime } from '../runtime'
import { openApiDocument, routes } from './openapi'

let tmp: string
let runtime: Runtime
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-openapi-'))
  const config = loadConfig({
    STACKY_STACKS_DIR: path.join(tmp, 'stacks'),
    STACKY_DATA_DIR: path.join(tmp, 'data'),
  })
  runtime = await createRuntime(config, silentLogger, { authRateLimit: false })
  app = createApp({ config, runtime })
})

afterEach(() => {
  runtime?.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('OpenAPI document', () => {
  it('is served without authentication', async () => {
    const res = await app.request('http://stacky.test/api/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as ReturnType<typeof openApiDocument>
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.servers).toEqual([{ url: 'http://stacky.test/api' }])
    expect(doc.paths['/stacks/{name}/actions/{action}']).toHaveProperty('post')
  })

  it('documents only routes the server actually has', () => {
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`))
    for (const route of routes) {
      const honoPath = `/api${route.path.replace(/\{(\w+)\}/g, ':$1')}`
      expect(registered, `${route.method} ${route.path}`).toContain(
        `${route.method.toUpperCase()} ${honoPath}`,
      )
    }
  })

  it('generates request bodies from the validation schemas', () => {
    const doc = openApiDocument()
    const create = doc.paths['/stacks']?.post as {
      requestBody: { content: { 'application/json': { schema: { required: string[] } } } }
    }
    expect(create.requestBody.content['application/json'].schema.required).toEqual([
      'name',
      'compose',
    ])
    const ids = Object.values(doc.paths).flatMap((ops) =>
      Object.values(ops).map((op) => (op as { operationId: string }).operationId),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
