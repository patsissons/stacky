import { Hono, type Context } from 'hono'
import type Docker from 'dockerode'
import { z } from 'zod'
import {
  actionOptionsSchema,
  serviceActions,
  stackActions,
  stackNameSchema,
  channelTypes,
  notifyEvents,
  type ApiErrorBody,
  type ContainerSummary,
  type SystemInfo,
} from '@stacky/shared'
import { OIDC_PROVIDER_ID, type AuthService, type AuthUser } from '../auth'
import type { AuditLog } from '../auth/audit'
import type { ApiTokenStore } from '../auth/tokens'
import type { Config } from '../config'
import { AppError, badRequest, notFound } from '../lib/errors'
import type { Logger } from '../lib/logger'
import type { OperationEngine } from '../ops/engine'
import { assertStackName } from '../stacks/paths'
import { dockerRunToCompose } from '../stacks/convert'
import type { StackRepository } from '../stacks/repository'
import type { StackService } from '../stacks/service'
import type { StackState } from '../stacks/state'
import type { SelfUpdater } from '../self/updater'
import type { SettingsStore } from '../db/settings'
import { WUD_KEY, type UpdateChecker } from '../updates/checker'
import { WudClient, type WudSettings } from '../updates/wud'
import type { Notifier } from '../notify/notifier'
import type { GitSync } from '../git/sync'

export interface ApiContext {
  config: Config
  repo: StackRepository
  state: StackState
  stacks: StackService
  engine: OperationEngine
  docker: Docker
  auth?: AuthService
  logger: Logger
  selfUpdater: SelfUpdater
  updates: UpdateChecker
  settings: SettingsStore
  notifier: Notifier
  tokens: ApiTokenStore
  gitSync: GitSync
  audit: AuditLog
  system: () => Promise<SystemInfo>
}

type Env = { Variables: { user?: AuthUser } }

const MAX_TEXT = 1024 * 1024
const text = z.string().max(MAX_TEXT)

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw badRequest('request body must be JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw badRequest(
      first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'invalid request',
      undefined,
      parsed.error.issues,
    )
  }
  return parsed.data
}

export function errorResponse(c: Context, err: unknown, logger: Logger) {
  if (err instanceof AppError) {
    const payload: ApiErrorBody = {
      error: { code: err.code, message: err.message, hint: err.hint, details: err.details },
    }
    return c.json(payload, err.status)
  }
  logger.error('unhandled API error', {
    path: c.req.path,
    err: String(err),
    stack: (err as Error)?.stack,
  })
  const payload: ApiErrorBody = {
    error: { code: 'internal', message: 'Something went wrong on the server' },
  }
  return c.json(payload, 500)
}

export function apiRoutes(ctx: ApiContext) {
  const api = new Hono<Env>()
  // handle errors here (not only at the root) so middleware like the audit log sees the status
  api.onError((err, c) => errorResponse(c, err, ctx.logger))
  const { auth, config } = ctx

  // ---- public: session state, first-run setup and better-auth endpoints ----
  const oidc = config.oidc
    ? {
        providerId: OIDC_PROVIDER_ID,
        name: config.oidc.name,
        autoRedirect: config.oidc.autoRedirect,
      }
    : null

  api.get('/session', async (c) => {
    if (config.authDisabled || !auth) {
      return c.json({ authDisabled: true, needsSetup: false, user: null, oidc: null })
    }
    const user = await auth.session(c.req.raw.headers)
    return c.json({ authDisabled: false, needsSetup: auth.needsSetup(), user: user ?? null, oidc })
  })

  api.post('/setup', async (c) => {
    if (config.authDisabled || !auth) throw badRequest('authentication is disabled')
    const input = await body(c, z.object({ username: z.string(), password: z.string().max(256) }))
    await auth.createAdmin(input.username, input.password)
    // Sign the new admin in straight away by forwarding better-auth's response.
    const url = new URL('/api/auth/sign-in/username', c.req.url)
    const res = await auth.auth.handler(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: c.req.header('origin') ?? url.origin,
          host: c.req.header('host') ?? url.host,
        },
        body: JSON.stringify({
          username: input.username.trim().toLowerCase(),
          password: input.password,
        }),
      }),
    )
    if (!res.ok) return res
    // Forward only the session cookie; the token stays out of JS-readable JSON.
    const out = c.json({ ok: true, user: { username: input.username.trim().toLowerCase() } })
    for (const cookie of res.headers.getSetCookie()) out.headers.append('set-cookie', cookie)
    return out
  })

  // push webhooks from GitHub/Gitea/GitLab: the secret in the URL is the credential
  api.post('/git/webhook/:secret', async (c) => {
    if (!ctx.gitSync.verifyWebhook(c.req.param('secret'))) throw notFound('webhook')
    void ctx.gitSync.pull()
    return c.json({ ok: true }, 202)
  })

  api.on(['GET', 'POST'], '/auth/*', (c) => {
    if (!auth) throw notFound('auth')
    return auth.auth.handler(c.req.raw)
  })

  // ---- everything below requires a session (unless auth is disabled) ----
  api.use('*', async (c, next) => {
    if (config.authDisabled || !auth) return next()
    const bearer = /^Bearer (.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
    const token = bearer ? ctx.tokens.verify(bearer) : undefined
    if (bearer && !token)
      throw new AppError(401, 'invalid_token', 'The API token is invalid or was revoked')
    c.set(
      'user',
      token
        ? {
            id: `token:${token.id}`,
            username: `token:${token.name}`,
            name: token.name,
            via: 'token',
          }
        : await auth.requireSession(c.req.raw.headers),
    )
    return next()
  })

  // every change is recorded: who, what, and whether it worked
  api.use('*', async (c, next) => {
    await next()
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return
    ctx.audit.record({
      actor: c.get('user')?.username ?? (config.authDisabled ? 'auth disabled' : 'anonymous'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
    })
  })

  api.get('/audit', (c) =>
    c.json(ctx.audit.list(Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000))),
  )

  // ---- API tokens (managed from a signed-in session only) ----
  const requireSessionUser = (c: Context<Env>) => {
    if (c.get('user')?.via === 'token') {
      throw new AppError(403, 'forbidden', 'API tokens cannot manage API tokens')
    }
  }
  api.get('/tokens', (c) => c.json(ctx.tokens.list()))
  api.post('/tokens', async (c) => {
    requireSessionUser(c)
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(64) }))
    return c.json(ctx.tokens.create(input.name), 201)
  })
  api.delete('/tokens/:id', (c) => {
    requireSessionUser(c)
    if (!ctx.tokens.revoke(c.req.param('id'))) throw notFound('token')
    return c.json({ ok: true })
  })

  api.get('/system', async (c) => c.json(await ctx.system()))

  // ---- image updates ----
  api.get('/updates', (c) => c.json(ctx.updates.summary()))

  api.post('/updates/check', async (c) => {
    const raw = await c.req.text()
    const input = z
      .object({ refs: z.array(z.string()).optional() })
      .parse(raw ? JSON.parse(raw) : {})
    void ctx.updates.checkAll(input.refs)
    return c.json({ ...ctx.updates.summary(), checking: true }, 202)
  })

  api.post('/updates/ignore', async (c) => {
    const input = await body(c, z.object({ ref: z.string().min(1), value: z.string().optional() }))
    ctx.updates.ignore(input.ref, input.value)
    return c.json(ctx.updates.summary())
  })

  api.post('/stacks/:name/services/:service/image', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const input = await body(c, z.object({ tag: z.string().min(1).max(128) }))
    return c.json(await ctx.stacks.bumpImage(name, c.req.param('service'), input.tag), 202)
  })

  // ---- integrations ----
  const wudInput = z.object({
    enabled: z.boolean(),
    url: z.string().url().or(z.literal('')),
    token: z.string().max(512).optional(),
  })

  api.get('/settings/wud', (c) => {
    const s = ctx.settings.get<WudSettings & { enabled?: boolean }>(WUD_KEY)
    return c.json({ enabled: !!s?.enabled, url: s?.url ?? '', hasToken: !!s?.token })
  })

  api.put('/settings/wud', async (c) => {
    const input = await body(c, wudInput)
    const current = ctx.settings.get<WudSettings & { enabled?: boolean }>(WUD_KEY)
    // an omitted token keeps the stored one (the UI never receives it back)
    const token = input.token === undefined ? current?.token : input.token || undefined
    ctx.settings.set(WUD_KEY, { enabled: input.enabled, url: input.url, token })
    return c.json({ enabled: input.enabled, url: input.url, hasToken: !!token })
  })

  api.post('/settings/wud/test', async (c) => {
    const input = await body(c, wudInput)
    const stored = ctx.settings.get<WudSettings>(WUD_KEY)
    const client = new WudClient({ url: input.url, token: input.token ?? stored?.token })
    try {
      const containers = await client.containers()
      return c.json({ ok: true, containers: containers.length })
    } catch (err) {
      throw new AppError(502, 'wud_unreachable', err instanceof Error ? err.message : String(err))
    }
  })

  // ---- git ----
  const gitView = async () => {
    const { remote, ...rest } = ctx.gitSync.config()
    return {
      settings: {
        ...rest,
        remote: remote
          ? {
              url: remote.url,
              branch: remote.branch,
              username: remote.username,
              hasToken: !!remote.token,
            }
          : undefined,
      },
      status: await ctx.gitSync.status(),
    }
  }
  api.get('/git', async (c) => c.json(await gitView()))
  api.put('/git', async (c) => {
    const input = await body(
      c,
      z.object({
        enabled: z.boolean(),
        includeEnv: z.boolean(),
        push: z.boolean(),
        pull: z.object({
          enabled: z.boolean(),
          intervalMinutes: z.number().int().min(1).max(1440),
          autoDeploy: z.boolean(),
        }),
        remote: z
          .object({
            url: z.string().min(1).max(512),
            branch: z
              .string()
              .regex(/^[\w./-]{1,100}$/)
              .default('main'),
            username: z.string().max(128).optional(),
            token: z.string().max(1024).optional(),
          })
          .optional(),
        regenerateSecret: z.boolean().optional(),
      }),
    )
    try {
      await ctx.gitSync.configure(input)
    } catch (err) {
      throw new AppError(422, 'git_failed', err instanceof Error ? err.message : String(err))
    }
    return c.json(await gitView())
  })
  api.post('/git/push', async (c) => c.json(await ctx.gitSync.push()))
  api.post('/git/pull', async (c) => c.json(await ctx.gitSync.pull()))
  api.get('/stacks/:name/git-log', async (c) => {
    const name = assertStackName(c.req.param('name'))
    return c.json(await ctx.gitSync.history(name))
  })

  // ---- notifications ----
  const channelInput = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(64),
    type: z.enum(channelTypes),
    url: z.string().url(),
    token: z.string().max(1024).nullable().optional(),
    events: z.array(z.enum(notifyEvents)),
    enabled: z.boolean(),
  })

  api.get('/settings/notifications', (c) => c.json(ctx.notifier.list()))

  api.put('/settings/notifications', async (c) => {
    const input = await body(c, z.object({ channels: z.array(channelInput).max(20) }))
    return c.json(ctx.notifier.save(input.channels))
  })

  api.post('/settings/notifications/test', async (c) => {
    const input = await body(c, z.object({ channel: channelInput }))
    try {
      await ctx.notifier.test(input.channel)
    } catch (err) {
      throw new AppError(
        502,
        'notification_failed',
        err instanceof Error ? err.message : String(err),
      )
    }
    return c.json({ ok: true })
  })

  // ---- stacky itself ----
  api.get('/self', async (c) => c.json(await ctx.selfUpdater.info()))

  api.post('/self/:action', async (c) => {
    const action = z.enum(['update', 'deploy', 'restart']).safeParse(c.req.param('action'))
    if (!action.success) throw badRequest(`unknown action "${c.req.param('action')}"`)
    const raw = await c.req.text()
    const input = z
      .object({ targetVersion: z.string().max(128).optional() })
      .parse(raw ? JSON.parse(raw) : {})
    return c.json(await ctx.selfUpdater.run(action.data, input), 202)
  })

  // ---- stacks ----
  api.get('/stacks', (c) => c.json(ctx.state.list()))

  api.post('/stacks', async (c) => {
    const input = await body(
      c,
      z.object({
        name: stackNameSchema,
        compose: text,
        env: text.optional(),
        deploy: z.boolean().optional(),
      }),
    )
    const validation = await ctx.stacks.validate(input.name, input.compose, input.env)
    if (!validation.ok) {
      throw new AppError(
        422,
        'invalid_compose',
        'The compose file is invalid',
        undefined,
        validation,
      )
    }
    await ctx.stacks.create(input.name, input.compose, input.env)
    const operation = input.deploy ? await ctx.stacks.stackAction(input.name, 'deploy') : undefined
    return c.json({ stack: ctx.state.get(input.name), operation }, 201)
  })

  api.get('/stacks/:name', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const summary = ctx.state.get(name)
    if (!summary) throw notFound(`stack "${name}"`)
    const files = summary.managed ? await ctx.repo.read(name) : undefined
    return c.json({ summary, files })
  })

  api.put('/stacks/:name', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const input = await body(c, z.object({ compose: text.optional(), env: text.optional() }))
    await ctx.stacks.save(name, input)
    return c.json({ stack: ctx.state.get(name) })
  })

  api.post('/stacks/:name/validate', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const input = await body(c, z.object({ compose: text, env: text.optional() }))
    return c.json(await ctx.stacks.validate(name, input.compose, input.env))
  })

  api.post('/stacks/:name/actions/:action', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const action = z.enum(stackActions).safeParse(c.req.param('action'))
    if (!action.success) throw badRequest(`unknown action "${c.req.param('action')}"`)
    const raw = await c.req.text()
    const input = z
      .object({
        options: actionOptionsSchema.optional(),
        compose: text.optional(),
        env: text.optional(),
      })
      .parse(raw ? JSON.parse(raw) : {})

    // Deploying unsaved edits: validate first so an invalid file never lands on disk.
    if (input.compose !== undefined || input.env !== undefined) {
      if (action.data !== 'deploy') throw badRequest('only deploy accepts file contents')
      const current = await ctx.repo.read(name)
      const validation = await ctx.stacks.validate(
        name,
        input.compose ?? current.compose,
        input.env ?? (current.hasEnv ? current.env : undefined),
      )
      if (!validation.ok) {
        throw new AppError(
          422,
          'invalid_compose',
          'The compose file is invalid',
          undefined,
          validation,
        )
      }
      await ctx.stacks.save(name, { compose: input.compose, env: input.env })
    }
    const operation = await ctx.stacks.stackAction(name, action.data, input.options ?? {})
    return c.json(operation, 202)
  })

  api.post('/stacks/:name/services/:service/:action', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const action = z.enum(serviceActions).safeParse(c.req.param('action'))
    if (!action.success) throw badRequest(`unknown action "${c.req.param('action')}"`)
    const operation = await ctx.stacks.serviceAction(name, c.req.param('service'), action.data)
    return c.json(operation, 202)
  })

  // ---- deployed revisions ----
  api.get('/stacks/:name/revisions', (c) => {
    const name = assertStackName(c.req.param('name'))
    return c.json(ctx.stacks.revisions?.list(name) ?? [])
  })

  api.post('/stacks/:name/revisions/:id/restore', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) throw badRequest('invalid revision id')
    return c.json(await ctx.stacks.restoreRevision(name, id), 202)
  })

  // ---- arbitrary files inside a stack directory ----
  api.get('/stacks/:name/files', async (c) => {
    const name = assertStackName(c.req.param('name'))
    return c.json(await ctx.repo.listFiles(name))
  })

  api.get('/stacks/:name/file', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const path = c.req.query('path') ?? ''
    return c.json({ path, content: await ctx.repo.readFile(name, path) })
  })

  api.put('/stacks/:name/file', async (c) => {
    const name = assertStackName(c.req.param('name'))
    const input = await body(c, z.object({ path: z.string().min(1), content: text }))
    await ctx.repo.writeFile(name, input.path, input.content)
    ctx.state.schedule(0)
    return c.json({ ok: true })
  })

  api.delete('/stacks/:name/file', async (c) => {
    const name = assertStackName(c.req.param('name'))
    await ctx.repo.deleteFile(name, c.req.query('path') ?? '')
    ctx.state.schedule(0)
    return c.json({ ok: true })
  })

  api.post('/convert/docker-run', async (c) => {
    const input = await body(c, z.object({ command: z.string().min(1).max(20_000) }))
    return c.json({ compose: dockerRunToCompose(input.command) })
  })

  // ---- global.env ----
  api.get('/global-env', async (c) => c.json({ content: (await ctx.repo.readGlobalEnv()) ?? '' }))
  api.put('/global-env', async (c) => {
    const input = await body(c, z.object({ content: text }))
    await ctx.repo.writeGlobalEnv(input.content)
    return c.json({ ok: true })
  })

  // ---- operations ----
  api.get('/operations', (c) => {
    const stack = c.req.query('stack')
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200)
    return c.json(ctx.engine.list({ stack, limit }))
  })

  api.get('/operations/:id', (c) => {
    const op = ctx.engine.get(c.req.param('id'))
    if (!op) throw notFound('operation')
    return c.json({ ...op, output: ctx.engine.output(op.id) })
  })

  api.post('/operations/:id/cancel', (c) => {
    if (!ctx.engine.cancel(c.req.param('id'))) {
      throw new AppError(409, 'not_running', 'The operation is not running')
    }
    return c.json({ ok: true })
  })

  // ---- containers & engine resources ----
  api.get('/containers', (c) => {
    const rows: (ContainerSummary & { stack: string; managed: boolean })[] = []
    for (const s of ctx.state.list()) {
      for (const svc of s.services) {
        for (const ct of svc.containers) rows.push({ ...ct, stack: s.name, managed: s.managed })
      }
    }
    return c.json(rows)
  })

  api.get('/networks', async (c) => {
    const networks = await ctx.docker.listNetworks()
    return c.json(networks.map((n) => ({ name: n.Name, driver: n.Driver, scope: n.Scope })))
  })

  api.notFound((c) =>
    errorResponse(c, notFound(`API route ${c.req.method} ${c.req.path}`), ctx.logger),
  )
  return api
}
