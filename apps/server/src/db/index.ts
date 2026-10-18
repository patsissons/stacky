import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = ReturnType<typeof drizzle<typeof schema>>

/** In the bundle, migrations sit next to index.js; in dev and tests, next to this file. */
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [path.join(here, 'migrations'), path.join(here, 'db', 'migrations')]) {
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate
  }
  throw new Error('database migrations folder not found')
}

/** Opens (creating if needed) stacky's SQLite database and applies migrations. */
export function openDatabase(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  return { db, sqlite }
}
