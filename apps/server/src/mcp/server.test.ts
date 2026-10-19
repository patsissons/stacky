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
let token: string

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-mcp-'))
  const config = loadConfig({
    STACKY_STACKS_DIR: path.join(tmp, 'stacks'),
    STACKY_DATA_DIR: path.join(tmp, 'data'),
  })
  runtime = await createRuntime(config, silentLogger, { authRateLimit: false })
  app = createApp({ config, runtime })
  token = runtime.tokens.create('agent').token
})

afterEach(() => {
  runtime?.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

let nextId = 1
/** Sends one JSON-RPC request to the MCP endpoint. */
async function rpc(method: string, params: unknown = {}, auth: string | null = token) {
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
  return { status: res.status, body: (await res.json()) as any }
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc('tools/call', { name, arguments: args })).body.result

describe('MCP endpoint', () => {
  it('requires a token', async () => {
    expect((await rpc('tools/list', {}, null)).status).toBe(401)
    expect((await rpc('tools/list', {}, 'stk_nope')).status).toBe(401)
  })

  it('initializes as the stacky server with usage instructions', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(status).toBe(200)
    expect(body.result.serverInfo.name).toBe('stacky')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.instructions).toContain('list_stacks')
  })

  it('rejects GET: the server is stateless', async () => {
    const res = await app.request('/api/mcp', {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    })
    expect(res.status).toBe(405)
  })

  it('lists tools with safety annotations', async () => {
    const { body } = await rpc('tools/list')
    const tools = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t]))
    expect(Object.keys(tools).sort()).toEqual(
      [
        'cancel_operation',
        'check_image_updates',
        'create_stack',
        'delete_stack',
        'get_logs',
        'get_operation',
        'get_stack',
        'get_system_info',
        'list_containers',
        'list_image_updates',
        'list_operations',
        'list_stacks',
        'service_action',
        'stack_action',
        'update_stack_files',
        'validate_compose',
      ].sort(),
    )
    expect(tools.list_stacks.annotations.readOnlyHint).toBe(true)
    expect(tools.delete_stack.annotations.destructiveHint).toBe(true)
    expect(tools.stack_action.inputSchema.properties.action.enum).not.toContain('delete')
  })

  it('creates, reads and edits a stack, auditing the changes', async () => {
    const compose = 'services:\n  web:\n    image: nginx:1.27\n'
    const created = await call('create_stack', { name: 'web', compose })
    expect(created.isError).toBeFalsy()
    expect(created.structuredContent.stack).toMatchObject({ name: 'web', status: 'inactive' })

    const listed = await call('list_stacks')
    expect(listed.structuredContent.stacks).toEqual([
      expect.objectContaining({ name: 'web', managed: true }),
    ])
    const read = await call('get_stack', { name: 'web' })
    expect(read.structuredContent.files.compose).toBe(compose)

    const invalid = await call('update_stack_files', {
      name: 'web',
      compose: 'services:\n  web:\n    imagee: x\n',
    })
    expect(invalid.isError).toBe(true)
    expect(invalid.content[0].text).toContain('invalid_compose')
    expect(fs.readFileSync(path.join(tmp, 'stacks/web/compose.yaml'), 'utf8')).toBe(compose)

    const audit = runtime.audit.list(10).map((e) => [e.actor, e.method, e.path, e.status])
    expect(audit).toEqual([
      ['token:agent', 'MCP', '/api/mcp/update_stack_files/web', 422],
      ['token:agent', 'MCP', '/api/mcp/create_stack/web', 200],
    ])
  })

  it('reports unknown stacks and bad input as tool errors', async () => {
    const missing = await call('get_stack', { name: 'nope' })
    expect(missing.isError).toBe(true)
    expect(missing.structuredContent.error.code).toBe('not_found')
    const bad = await call('get_stack', { name: '../etc' })
    expect(bad.isError).toBe(true)
  })

  it('runs a stack action and waits for the operation', async () => {
    await call('create_stack', { name: 'app', compose: 'services: {}\n' })
    const res = await call('stack_action', { name: 'app', action: 'down', waitSeconds: 60 })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent.done).toBe(true)
    expect(res.structuredContent.operation).toMatchObject({ stack: 'app', action: 'down' })
    const op = await call('get_operation', { id: res.structuredContent.operation.id })
    expect(op.structuredContent.operation.state).toBe(res.structuredContent.operation.state)
    const logs = await call('get_logs', { name: 'app' })
    expect(logs.content[0].text).toBe('(no log lines)')
  })
})
