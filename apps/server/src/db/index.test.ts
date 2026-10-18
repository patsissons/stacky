import { describe, expect, it } from 'vitest'
import { openDatabase } from './index'
import { settings } from './schema'

describe('openDatabase', () => {
  it('applies migrations to a fresh database', () => {
    const { db, sqlite } = openDatabase(':memory:')
    db.insert(settings)
      .values({ key: 'k', value: { a: 1 }, updatedAt: 1 })
      .run()
    expect(db.select().from(settings).all()).toEqual([{ key: 'k', value: { a: 1 }, updatedAt: 1 }])
    sqlite.close()
  })
})
