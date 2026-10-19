import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import {
  actionOptionsSchema,
  serviceActions,
  stackActions,
  stackNameSchema,
  type LogLine,
  type OperationSummary,
  type StackSummary,
} from '@stacky/shared'
import type { ApiContext } from '../api/routes'
import { text } from '../api/schemas'
import { readLogs } from '../docker/logs'
import { AppError, notFound } from '../lib/errors'
import { logTargets } from '../stacks/log-targets'
import { assertStackName } from '../stacks/paths'

/** Output kept in a tool result: enough to see why something failed without flooding the context. */
const OUTPUT_TAIL = 8 * 1024
const MAX_LOG_TEXT = 100 * 1024

type Data = Record<string, unknown>

interface ToolEnv {
  ctx: ApiContext
  /** Who the audit log credits, e.g. `token:claude`. */
  actor: string
}

const result = (data: Data, text = JSON.stringify(data, null, 2)): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: data,
})

function errorResult(err: unknown, env: ToolEnv): CallToolResult {
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message, hint: err.hint, details: err.details }
    const lines = [`${err.code}: ${err.message}`]
    if (err.hint) lines.push(`Hint: ${err.hint}`)
    if (err.details) lines.push(JSON.stringify(err.details, null, 2))
    return { ...result({ error }, lines.join('\n')), isError: true }
  }
  if (err instanceof z.ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return { ...result({ error: { code: 'bad_request', message } }, message), isError: true }
  }
  env.ctx.logger.error('MCP tool failed', { err: String(err), stack: (err as Error)?.stack })
  const error = { code: 'internal', message: 'Something went wrong on the server' }
  return { ...result({ error }, error.message), isError: true }
}

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
const changes = (extra: ToolAnnotations = {}): ToolAnnotations => ({
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  ...extra,
})

const stackName = stackNameSchema.describe('Stack name, as listed by list_stacks')
const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(600)
  .default(60)
  .describe('How long to wait for the operation to finish before returning (seconds)')

/** A compact view of a stack: enough to pick the next action without every port and id. */
function stackOverview(s: StackSummary) {
  return {
    name: s.name,
    status: s.status,
    managed: s.managed,
    isSelf: s.isSelf,
    services: s.services.map((svc) => ({
      name: svc.name,
      image: svc.image,
      state: svc.state,
      containers: svc.containers.map((c) => ({
        name: c.name,
        state: c.state,
        status: c.statusText,
      })),
    })),
    activeOperationId: s.activeOperationId,
    parseError: s.parseError,
  }
}

const formatLogs = (lines: LogLine[]) =>
  lines
    .map(
      (l) =>
        `${new Date(l.ts).toISOString()} ${l.service}${l.stream === 'stderr' ? '!' : ''} | ${l.text}`,
    )
    .join('\n')

async function operationResult(env: ToolEnv, op: OperationSummary, wait: number) {
  const current = (await env.ctx.engine.waitFor(op.id, wait * 1000)) ?? op
  const done = current.state !== 'queued' && current.state !== 'running'
  const output = env.ctx.engine.output(op.id)
  return result({
    operation: current,
    done,
    output: output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output,
    ...(done
      ? {}
      : { next: `Still ${current.state}; call get_operation with id "${op.id}" to keep waiting.` }),
  })
}

/**
 * Registers stacky's tools. Read-only tools cover inspection; the rest change
 * stacks and are recorded in the activity log like REST requests.
 */
export function registerTools(server: McpServer, env: ToolEnv) {
  const { ctx } = env

  function tool<Shape extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; annotations: ToolAnnotations; input: Shape },
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
  ) {
    const audited = config.annotations.readOnlyHint !== true
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        annotations: { title: config.title, ...config.annotations },
      },
      // The SDK validates input against the shape before calling us; its callback type
      // can't follow the generic shape, hence the cast.
      (async (input: z.infer<z.ZodObject<Shape>>) => {
        let out: CallToolResult
        let status = 200
        try {
          out = await run(input)
        } catch (err) {
          status = err instanceof AppError ? err.status : err instanceof z.ZodError ? 400 : 500
          out = errorResult(err, env)
        }
        if (audited) {
          const stack = (input as { name?: unknown }).name
          ctx.audit.record({
            actor: env.actor,
            method: 'MCP',
            path: `/api/mcp/${name}${typeof stack === 'string' ? `/${stack}` : ''}`,
            status,
          })
        }
        return out
      }) as Parameters<McpServer['registerTool']>[2],
    )
  }

  // ---- inspection ----
  tool(
    'list_stacks',
    {
      title: 'List stacks',
      description:
        'Lists every Docker Compose stack with its status, services and containers. Start here.',
      annotations: readOnly,
      input: {},
    },
    async () => result({ stacks: ctx.state.list().map(stackOverview) }),
  )

  tool(
    'get_stack',
    {
      title: 'Get stack',
      description:
        'Returns one stack in full (services, containers, ports) plus its compose.yaml and .env text when stacky manages it.',
      annotations: readOnly,
      input: { name: stackName },
    },
    async ({ name }) => {
      const summary = ctx.state.get(assertStackName(name))
      if (!summary) throw notFound(`stack "${name}"`)
      const files = summary.managed ? await ctx.repo.read(name) : undefined
      return result({ summary, files })
    },
  )

  tool(
    'list_containers',
    {
      title: 'List containers',
      description: 'Lists containers across all stacks (or one stack) with state, image and ports.',
      annotations: readOnly,
      input: { stack: stackName.optional().describe('Only containers of this stack') },
    },
    async ({ stack }) =>
      result({
        containers: ctx.state
          .list()
          .filter((s) => !stack || s.name === stack)
          .flatMap((s) =>
            s.services.flatMap((svc) =>
              svc.containers.map((c) => ({
                stack: s.name,
                service: svc.name,
                name: c.name,
                image: c.image,
                state: c.state,
                status: c.statusText,
                ports: c.ports,
              })),
            ),
          ),
      }),
  )

  tool(
    'get_logs',
    {
      title: 'Get logs',
      description:
        'Returns recent log lines of a stack (or one service), oldest first. Each line reads `<time> <service>[!] | text`; `!` marks stderr.',
      annotations: readOnly,
      input: {
        name: stackName,
        service: z.string().optional().describe('Only this service'),
        tail: z.number().int().min(1).max(2000).default(200).describe('Lines per container'),
        since: z.number().int().optional().describe('Only lines after this time (epoch seconds)'),
      },
    },
    async ({ name, service, tail, since }) => {
      const stack = ctx.state.get(assertStackName(name))
      if (!stack) throw notFound(`stack "${name}"`)
      if (service && !stack.services.some((s) => s.name === service)) {
        throw notFound(`service "${service}" in stack "${name}"`)
      }
      const lines = await readLogs(ctx.docker, logTargets(stack, service), { tail, since })
      let text = formatLogs(lines) || '(no log lines)'
      if (text.length > MAX_LOG_TEXT) text = `…${text.slice(-MAX_LOG_TEXT)}`
      return { content: [{ type: 'text', text }] }
    },
  )

  tool(
    'list_operations',
    {
      title: 'List operations',
      description: 'Lists recent operations (deploys, restarts, updates…), newest first.',
      annotations: readOnly,
      input: {
        stack: stackName.optional().describe('Only operations of this stack'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ stack, limit }) => result({ operations: ctx.engine.list({ stack, limit }) }),
  )

  tool(
    'get_operation',
    {
      title: 'Get operation',
      description:
        'Returns an operation with the tail of its output, optionally waiting for it to finish. Failed operations include an error code, message and hint.',
      annotations: readOnly,
      input: {
        id: z.string().min(1).describe('Operation id (op_…)'),
        waitSeconds: waitSeconds.default(0),
      },
    },
    async ({ id, waitSeconds: wait }) => {
      const op = ctx.engine.get(id)
      if (!op) throw notFound('operation')
      return operationResult(env, op, wait)
    },
  )

  tool(
    'list_image_updates',
    {
      title: 'List image updates',
      description:
        'Returns the latest image update check: which image references have newer tags or digests.',
      annotations: readOnly,
      input: {
        onlyAvailable: z.boolean().default(true).describe('Only images with an update available'),
      },
    },
    async ({ onlyAvailable }) => {
      const summary = ctx.updates.summary()
      return result({
        ...summary,
        updates: summary.updates.filter(
          (u) => !onlyAvailable || (u.status === 'update_available' && !u.ignored),
        ),
      })
    },
  )

  tool(
    'get_system_info',
    {
      title: 'Get system info',
      description:
        "stacky's version, the Docker engine and compose versions, and preflight checks.",
      annotations: readOnly,
      input: {},
    },
    async () => result({ ...(await ctx.system()) }),
  )

  tool(
    'validate_compose',
    {
      title: 'Validate compose',
      description:
        'Checks compose.yaml (and .env) text with `docker compose config` without saving it. Returns issues with line numbers.',
      annotations: readOnly,
      input: {
        name: stackName.describe('Stack the files belong to (relative paths resolve there)'),
        compose: text,
        env: text.optional(),
      },
    },
    async ({ name, compose, env: envText }) =>
      result({ ...(await ctx.stacks.validate(assertStackName(name), compose, envText)) }),
  )

  // ---- changes ----
  tool(
    'create_stack',
    {
      title: 'Create stack',
      description:
        'Creates a new stack directory from compose.yaml (and .env) text, validating it first. Optionally deploys it.',
      annotations: changes(),
      input: {
        name: stackName,
        compose: text.describe('compose.yaml contents, saved exactly as given'),
        env: text.optional().describe('.env contents'),
        deploy: z.boolean().default(false).describe('Deploy right after creating'),
        waitSeconds,
      },
    },
    async ({ name, compose, env: envText, deploy, waitSeconds: wait }) => {
      await ctx.stacks.assertValid(name, compose, envText)
      await ctx.stacks.create(name, compose, envText)
      if (!deploy) return result({ stack: ctx.state.get(name) })
      return operationResult(env, await ctx.stacks.stackAction(name, 'deploy'), wait)
    },
  )

  tool(
    'update_stack_files',
    {
      title: 'Update stack files',
      description:
        "Replaces a stack's compose.yaml and/or .env. The result is validated first and nothing is written if it is invalid. Changes take effect on deploy.",
      annotations: changes(),
      input: {
        name: stackName,
        compose: text.optional().describe('New compose.yaml contents'),
        env: text.optional().describe('New .env contents; an empty string removes .env'),
        deploy: z.boolean().default(false).describe('Deploy the saved files'),
        waitSeconds,
      },
    },
    async ({ name, compose, env: envText, deploy, waitSeconds: wait }) => {
      assertStackName(name)
      if (compose === undefined && envText === undefined) {
        throw new AppError(400, 'bad_request', 'Pass compose and/or env')
      }
      await ctx.stacks.saveValidated(name, { compose, env: envText })
      if (!deploy) return result({ stack: ctx.state.get(name) })
      return operationResult(env, await ctx.stacks.stackAction(name, 'deploy'), wait)
    },
  )

  tool(
    'stack_action',
    {
      title: 'Run stack action',
      description: [
        'Runs a docker compose action on a stack and waits for the result:',
        'deploy (up -d), start, stop, restart, down (remove containers), pull, update (pull + up),',
        'pull-updates (prefetch newer images found by the update check),',
        'deploy-updates (write newer tags to compose.yaml and redeploy).',
        'Acting on the stack with isSelf=true restarts stacky itself.',
      ].join(' '),
      annotations: changes({ destructiveHint: true }),
      input: {
        name: stackName,
        action: z.enum(stackActions.filter((a) => a !== 'delete') as [string, ...string[]]),
        options: actionOptionsSchema.optional(),
        waitSeconds,
      },
    },
    async ({ name, action, options, waitSeconds: wait }) =>
      operationResult(
        env,
        await ctx.stacks.stackAction(
          assertStackName(name),
          action as (typeof stackActions)[number],
          options ?? {},
        ),
        wait,
      ),
  )

  tool(
    'service_action',
    {
      title: 'Run service action',
      description:
        'Runs an action on one service of a stack and waits for the result: start, stop, restart, recreate, pull or update.',
      annotations: changes(),
      input: {
        name: stackName,
        service: z.string().min(1),
        action: z.enum(serviceActions),
        waitSeconds,
      },
    },
    async ({ name, service, action, waitSeconds: wait }) =>
      operationResult(
        env,
        await ctx.stacks.serviceAction(assertStackName(name), service, action),
        wait,
      ),
  )

  tool(
    'delete_stack',
    {
      title: 'Delete stack',
      description:
        "Stops a stack (docker compose down) and deletes its directory, including compose.yaml and .env. This can't be undone.",
      annotations: changes({ destructiveHint: true }),
      input: {
        name: stackName,
        removeVolumes: z.boolean().default(false).describe('Also remove named volumes (data loss)'),
        waitSeconds,
      },
    },
    async ({ name, removeVolumes, waitSeconds: wait }) =>
      operationResult(
        env,
        await ctx.stacks.stackAction(assertStackName(name), 'delete', { removeVolumes }),
        wait,
      ),
  )

  tool(
    'cancel_operation',
    {
      title: 'Cancel operation',
      description: 'Cancels a queued or running operation.',
      annotations: changes({ idempotentHint: true }),
      input: { id: z.string().min(1).describe('Operation id (op_…)') },
    },
    async ({ id }) => {
      if (!ctx.engine.cancel(id)) {
        throw new AppError(409, 'not_running', 'The operation is not running')
      }
      return result({ ok: true })
    },
  )

  tool(
    'check_image_updates',
    {
      title: 'Check image updates',
      description:
        'Starts an image update check in the background. Call list_image_updates afterwards for the results.',
      annotations: changes({ idempotentHint: true, openWorldHint: true }),
      input: {
        refs: z
          .array(z.string())
          .optional()
          .describe('Image references to check; all when omitted'),
      },
    },
    async ({ refs }) => {
      void ctx.updates.checkAll(refs)
      return result({ checking: true })
    },
  )
}
