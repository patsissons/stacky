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
