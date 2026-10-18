import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey(),
    stack: text('stack').notNull(),
    action: text('action').notNull(),
    services: text('services', { mode: 'json' }).$type<string[]>().notNull(),
    state: text('state').notNull(),
    commands: text('commands', { mode: 'json' }).$type<string[]>().notNull(),
    exitCode: integer('exit_code'),
    error: text('error', { mode: 'json' }).$type<{
      code: string
      message: string
      hint?: string
    }>(),
    /** Tail of the combined output (ANSI preserved). */
    output: text('output').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('operations_stack_created_idx').on(t.stack, t.createdAt)],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const imageUpdates = sqliteTable('image_updates', {
  ref: text('ref').primaryKey(),
  data: text('data', { mode: 'json' }).$type<import('@stacky/shared').ImageUpdate>().notNull(),
  checkedAt: integer('checked_at').notNull(),
})

/** The files of a stack as they were at each successful deploy, for diffs and rollback. */
export const stackRevisions = sqliteTable(
  'stack_revisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stack: text('stack').notNull(),
    operationId: text('operation_id'),
    composeFile: text('compose_file').notNull(),
    compose: text('compose').notNull(),
    env: text('env'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('stack_revisions_stack_idx').on(t.stack, t.createdAt)],
)

/** Long-lived bearer tokens for scripts and automation (only a hash is stored). */
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** First characters of the token, shown so users can tell tokens apart. */
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
})

/** Who changed what: every mutating API request. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    actor: text('actor').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
  },
  (t) => [index('audit_log_ts_idx').on(t.ts)],
)
