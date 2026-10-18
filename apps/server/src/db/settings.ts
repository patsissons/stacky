import { eq } from 'drizzle-orm'
import type { Db } from '.'
import { settings } from './schema'

/** Small typed key/value store on the settings table. */
export class SettingsStore {
  constructor(private readonly db: Db) {}

  get<T>(key: string): T | undefined {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get()
    return row?.value as T | undefined
  }

  set<T>(key: string, value: T) {
    this.db
      .insert(settings)
      .values({ key, value, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
      .run()
  }

  delete(key: string) {
    this.db.delete(settings).where(eq(settings.key, key)).run()
  }
}
