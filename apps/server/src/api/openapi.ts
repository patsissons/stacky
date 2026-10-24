import { z } from 'zod'
import {
  actionOptionsSchema,
  containerStates,
  serviceActions,
  stackActions,
  stackStatuses,
} from '@stacky/shared'
import { VERSION } from '../version'
import {
  bumpImageBody,
  checkUpdatesBody,
  createStackBody,
  ignoreUpdateBody,
  previewBody,
  saveStackBody,
  stackActionBody,
  stackFileBody,
  validateBody,
} from './schemas'

// The public, token-authenticated part of the REST API. Settings, auth, git and
// the file browser are UI plumbing and stay out of the document.

type Schema = Record<string, unknown>

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })
const arrayOf = (items: Schema): Schema => ({ type: 'array', items })
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
})
const str: Schema = { type: 'string' }
const int: Schema = { type: 'integer' }
const bool: Schema = { type: 'boolean' }
/** epoch milliseconds */
const time: Schema = { type: 'integer', description: 'epoch milliseconds' }

function jsonSchema(schema: z.ZodType): Schema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Schema
  return rest
}

const components: Record<string, Schema> = {
  Error: obj(
    {
      error: obj(
        {
          code: { ...str, description: 'Stable machine-readable code, e.g. `port_in_use`' },
          message: str,
          hint: { ...str, description: 'What to do about it, when stacky knows' },
          details: {},
          operationId: str,
        },
        ['code', 'message'],
      ),
    },
    ['error'],
  ),
  Port: obj(
    {
      hostIp: str,
      hostPort: int,
      containerPort: int,
      protocol: { type: 'string', enum: ['tcp', 'udp', 'sctp'] },
    },
    ['containerPort', 'protocol'],
  ),
  Container: obj(
    {
      id: str,
      name: str,
      project: str,
      service: str,
      number: int,
      image: str,
      imageId: str,
      state: { type: 'string', enum: [...containerStates] },
      statusText: str,
      exitCode: int,
      createdAt: time,
      ports: arrayOf(ref('Port')),
      icon: str,
      updateSchedule: {
        ...str,
        description: 'The `stacky.update.schedule` label: how often the image is checked',
      },
      tagInclude: {
        ...str,
        description: 'The `stacky.tag.include` (or `wud.tag.include`) regex newer tags must match',
      },
      tagExclude: {
        ...str,
        description: 'The `stacky.tag.exclude` (or `wud.tag.exclude`) regex that rules tags out',
      },
      linkTemplate: {
        ...str,
        description: 'The `stacky.link.template` (or `wud.link.template`) release link template',
      },
    },
    ['id', 'name', 'service', 'image', 'state', 'statusText', 'ports'],
  ),
  Service: obj(
    {
      name: str,
      image: str,
      state: str,
      containers: arrayOf(ref('Container')),
    },
    ['name', 'state', 'containers'],
  ),
  StackSummary: obj(
    {
      name: str,
      managed: { ...bool, description: 'false for compose projects outside the stacks directory' },
      status: { type: 'string', enum: [...stackStatuses] },
      path: str,
      composeFile: str,
      services: arrayOf(ref('Service')),
      isSelf: { ...bool, description: 'The stack that runs stacky itself' },
      urls: arrayOf(str),
      parseError: str,
      activeOperationId: str,
    },
    ['name', 'managed', 'status', 'services', 'isSelf', 'urls'],
  ),
  StackFiles: obj({ name: str, composeFile: str, compose: str, env: str, hasEnv: bool }, [
    'name',
    'composeFile',
    'compose',
    'env',
    'hasEnv',
  ]),
  Operation: obj(
    {
      id: str,
      stack: str,
      action: str,
      services: arrayOf(str),
      state: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
      commands: arrayOf(str),
      exitCode: int,
      error: obj({ code: str, message: str, hint: str }, ['code', 'message']),
      createdAt: time,
      startedAt: time,
      finishedAt: time,
    },
    ['id', 'stack', 'action', 'services', 'state', 'commands', 'createdAt'],
  ),
  ValidationResult: obj(
    {
      ok: bool,
      issues: arrayOf(
        obj(
          {
            message: str,
            line: int,
            column: int,
            severity: { type: 'string', enum: ['error', 'warning'] },
            source: { type: 'string', enum: ['yaml', 'compose'] },
          },
          ['message', 'severity', 'source'],
        ),
      ),
    },
    ['ok', 'issues'],
  ),
  DeployPreview: obj(
    {
      ok: bool,
      containers: arrayOf(
        obj(
          {
            name: str,
            action: {
              type: 'string',
              enum: ['create', 'recreate', 'start', 'remove', 'unchanged'],
            },
          },
          ['name', 'action'],
        ),
      ),
      message: str,
      composeMismatch: obj({ deployedWith: arrayOf(str), current: str }, [
        'deployedWith',
        'current',
      ]),
    },
    ['ok', 'containers'],
  ),
  LogLine: obj(
    {
      container: str,
      service: str,
      stream: { type: 'string', enum: ['stdout', 'stderr'] },
      ts: time,
      text: str,
    },
    ['container', 'service', 'stream', 'ts', 'text'],
  ),
  ImageUpdate: obj(
    {
      ref: { ...str, description: 'Image reference, e.g. `nginx:1.27`' },
      status: { type: 'string', enum: ['up_to_date', 'update_available', 'error', 'skipped'] },
      newerTag: str,
      kind: { type: 'string', enum: ['major', 'minor', 'patch', 'prerelease', 'digest'] },
      digestChanged: bool,
      ignored: bool,
      message: str,
      checkedAt: time,
      scheduleLabel: {
        ...str,
        description: 'The `stacky.update.schedule` label that sets how often this image is checked',
      },
      scheduleError: { ...str, description: 'Why that label was ignored' },
      tagInclude: { ...str, description: 'The `stacky.tag.include` regex this check applied' },
      tagExclude: { ...str, description: 'The `stacky.tag.exclude` regex this check applied' },
      tagFilterError: { ...str, description: 'Why a tag include/exclude label was ignored' },
      linkTemplate: {
        ...str,
        description: 'The `stacky.link.template` label links are built from',
      },
      linkTemplateError: { ...str, description: 'Why the link template gave no links' },
      currentLink: { ...str, description: 'Release link for the tag in use' },
      newerLink: { ...str, description: 'Release link for `newerTag`' },
    },
    ['ref', 'status', 'checkedAt'],
  ),
  UpdatesSummary: obj(
    {
      updates: arrayOf(ref('ImageUpdate')),
      checking: bool,
      lastCheckAt: time,
      nextCheckAt: time,
    },
    ['updates', 'checking'],
  ),
  Revision: obj(
    {
      id: int,
      stack: str,
      operationId: str,
      composeFile: str,
      compose: str,
      env: str,
      createdAt: time,
    },
    ['id', 'stack', 'composeFile', 'compose', 'createdAt'],
  ),
  ActionOptions: jsonSchema(actionOptionsSchema),
}

interface Route {
  method: 'get' | 'post' | 'put' | 'delete'
  path: string
  summary: string
  tag: string
  description?: string
  /** Path parameter schemas other than a plain string. */
  params?: Record<string, Schema>
  query?: Record<string, Schema & { description?: string }>
  body?: z.ZodType
  bodyRequired?: boolean
  status?: number
  response: Schema
}

const ok = obj({ ok: bool }, ['ok'])

/** Every documented operation; `openapi.test.ts` checks each one exists in the router. */
export const routes: Route[] = [
  {
    method: 'get',
    path: '/system',
    tag: 'system',
    summary: 'Version, Docker engine and preflight checks',
    response: obj({ version: str, stacksDir: str, authDisabled: bool, dockerHost: str }),
  },
  {
    method: 'get',
    path: '/stacks',
    tag: 'stacks',
    summary: 'List stacks with their services and containers',
    response: arrayOf(ref('StackSummary')),
  },
  {
    method: 'post',
    path: '/stacks',
    tag: 'stacks',
    summary: 'Create a stack (optionally deploying it)',
    description:
      'The compose file is validated first; an invalid file returns 422 `invalid_compose`.',
    body: createStackBody,
    status: 201,
    response: obj({ stack: ref('StackSummary'), operation: ref('Operation') }),
  },
  {
    method: 'get',
    path: '/stacks/{name}',
    tag: 'stacks',
    summary: 'Get a stack and, for managed stacks, its compose and .env text',
    response: obj({ summary: ref('StackSummary'), files: ref('StackFiles') }, ['summary']),
  },
  {
    method: 'put',
    path: '/stacks/{name}',
    tag: 'stacks',
    summary: 'Save compose.yaml and/or .env (without deploying)',
    body: saveStackBody,
    response: obj({ stack: ref('StackSummary') }),
  },
  {
    method: 'post',
    path: '/stacks/{name}/validate',
    tag: 'stacks',
    summary: 'Validate compose text with `docker compose config`',
    body: validateBody,
    response: ref('ValidationResult'),
  },
  {
    method: 'post',
    path: '/stacks/{name}/preview',
    tag: 'stacks',
    summary: 'Preview a deploy with `docker compose up --dry-run`',
    description:
      'Lists what deploying the given (or saved) files would do to each container. `composeMismatch` is set when the containers were created by another Docker Compose version, which makes compose recreate them.',
    body: previewBody,
    bodyRequired: false,
    response: ref('DeployPreview'),
  },
  {
    method: 'post',
    path: '/stacks/{name}/actions/{action}',
    tag: 'stacks',
    summary: 'Run a stack action',
    description:
      'Returns the queued operation; poll `GET /operations/{id}?wait=60` for the result.',
    params: { action: { type: 'string', enum: [...stackActions] } },
    body: stackActionBody,
    bodyRequired: false,
    status: 202,
    response: ref('Operation'),
  },
  {
    method: 'post',
    path: '/stacks/{name}/services/{service}/{action}',
    tag: 'stacks',
    summary: 'Run a service action',
    params: { action: { type: 'string', enum: [...serviceActions] } },
    status: 202,
    response: ref('Operation'),
  },
  {
    method: 'post',
    path: '/stacks/{name}/services/{service}/image',
    tag: 'updates',
    summary: "Change a service's image tag in compose.yaml and redeploy it",
    body: bumpImageBody,
    status: 202,
    response: ref('Operation'),
  },
  {
    method: 'get',
    path: '/stacks/{name}/logs',
    tag: 'stacks',
    summary: 'Recent log lines of a stack, oldest first',
    query: {
      service: { ...str, description: 'Only this service' },
      tail: { ...int, description: 'Lines per container (default 200, max 5000)' },
      since: { ...int, description: 'Only lines after this time (epoch seconds)' },
    },
    response: obj({ lines: arrayOf(ref('LogLine')) }, ['lines']),
  },
  {
    method: 'get',
    path: '/stacks/{name}/files',
    tag: 'stacks',
    summary: 'List the files in a stack directory',
    response: arrayOf(
      obj({ path: str, type: { type: 'string', enum: ['file', 'dir'] }, size: int }, ['path']),
    ),
  },
  {
    method: 'get',
    path: '/stacks/{name}/file',
    tag: 'stacks',
    summary: 'Read a file inside the stack directory',
    query: { path: { ...str, description: 'Path relative to the stack directory' } },
    response: obj({ path: str, content: str }, ['path', 'content']),
  },
  {
    method: 'put',
    path: '/stacks/{name}/file',
    tag: 'stacks',
    summary: 'Write a file inside the stack directory',
    body: stackFileBody,
    response: ok,
  },
  {
    method: 'get',
    path: '/stacks/{name}/revisions',
    tag: 'stacks',
    summary: 'Previously deployed versions of the stack files',
    response: arrayOf(ref('Revision')),
  },
  {
    method: 'post',
    path: '/stacks/{name}/revisions/{id}/restore',
    tag: 'stacks',
    summary: 'Restore a deployed version and redeploy it',
    status: 202,
    response: ref('Operation'),
  },
  {
    method: 'get',
    path: '/operations',
    tag: 'operations',
    summary: 'Recent operations, newest first',
    query: {
      stack: { ...str, description: 'Only this stack' },
      limit: { ...int, description: 'Default 50, max 200' },
    },
    response: arrayOf(ref('Operation')),
  },
  {
    method: 'get',
    path: '/operations/{id}',
    tag: 'operations',
    summary: 'An operation and its output',
    query: {
      wait: {
        ...int,
        description:
          'Long-poll: wait up to this many seconds (max 300) for the operation to finish',
      },
    },
    response: { allOf: [ref('Operation'), obj({ output: str })] },
  },
  {
    method: 'post',
    path: '/operations/{id}/cancel',
    tag: 'operations',
    summary: 'Cancel a queued or running operation',
    response: ok,
  },
  {
    method: 'get',
    path: '/containers',
    tag: 'stacks',
    summary: 'Every container, with the stack it belongs to',
    response: arrayOf({ allOf: [ref('Container'), obj({ stack: str, managed: bool })] }),
  },
  {
    method: 'get',
    path: '/updates',
    tag: 'updates',
    summary: 'Image update check results',
    response: ref('UpdatesSummary'),
  },
  {
    method: 'post',
    path: '/updates/check',
    tag: 'updates',
    summary: 'Start an image update check (runs in the background)',
    body: checkUpdatesBody,
    bodyRequired: false,
    status: 202,
    response: ref('UpdatesSummary'),
  },
  {
    method: 'post',
    path: '/updates/ignore',
    tag: 'updates',
    summary: 'Ignore (or stop ignoring) an available update',
    body: ignoreUpdateBody,
    response: ref('UpdatesSummary'),
  },
]

const pathParams = (route: Route) =>
  [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: route.params?.[name!] ?? str,
  }))

const errorResponses = {
  '400': {
    description: 'Invalid request',
    content: { 'application/json': { schema: ref('Error') } },
  },
  '401': {
    description: 'Missing or invalid token',
    content: { 'application/json': { schema: ref('Error') } },
  },
  '404': { description: 'Not found', content: { 'application/json': { schema: ref('Error') } } },
  '409': { description: 'Conflict', content: { 'application/json': { schema: ref('Error') } } },
  '422': {
    description: 'Invalid compose file',
    content: { 'application/json': { schema: ref('Error') } },
  },
}

export function openApiDocument(serverUrl?: string) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of routes) {
    const parameters = [
      ...pathParams(route),
      ...Object.entries(route.query ?? {}).map(([name, { description, ...schema }]) => ({
        name,
        in: 'query',
        description,
        schema,
      })),
    ]
    paths[route.path] ??= {}
    paths[route.path]![route.method] = {
      tags: [route.tag],
      summary: route.summary,
      description: route.description,
      operationId: `${route.method}${route.path.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ?? '').toUpperCase())}`,
      parameters: parameters.length ? parameters : undefined,
      requestBody: route.body
        ? {
            required: route.bodyRequired ?? true,
            content: { 'application/json': { schema: jsonSchema(route.body) } },
          }
        : undefined,
      responses: {
        [String(route.status ?? 200)]: {
          description: 'OK',
          content: { 'application/json': { schema: route.response } },
        },
        ...errorResponses,
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'stacky API',
      version: VERSION,
      description:
        'Manage Docker Compose stacks. Authenticate with an API token from Settings → API tokens: `Authorization: Bearer stk_…`. Changes run as operations: action endpoints return 202 with an operation you can wait on.',
    },
    servers: [{ url: `${serverUrl ?? ''}/api` }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: 'stacks' }, { name: 'operations' }, { name: 'updates' }, { name: 'system' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'stacky API token (`stk_…`)' },
      },
      schemas: components,
    },
  }
}
