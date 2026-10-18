import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { apiTokens } from '../db/schema'

export const TOKEN_PREFIX = 'stk_'

export interface ApiTokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: number
  lastUsedAt?: number
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** API tokens for automation. The token is shown once; only its SHA-256 is kept. */
export class ApiTokenStore {
  constructor(private readonly db: Db) {}

  create(name: string): { token: string; info: ApiTokenInfo } {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const info = { id: randomUUID(), name, prefix: token.slice(0, 10), createdAt: Date.now() }
    this.db
      .insert(apiTokens)
      .values({ ...info, hash: hash(token) })
      .run()
    return { token, info }
  }

  verify(token: string): ApiTokenInfo | undefined {
    if (!token.startsWith(TOKEN_PREFIX)) return undefined
    const row = this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.hash, hash(token)))
      .get()
    if (!row) return undefined
    // record usage at most once a minute
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt > 60_000) {
      this.db
        .update(apiTokens)
        .set({ lastUsedAt: Date.now() })
        .where(eq(apiTokens.id, row.id))
        .run()
    }
    return toInfo(row)
  }

  list(): ApiTokenInfo[] {
    return this.db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt)).all().map(toInfo)
  }

  revoke(id: string): boolean {
    return this.db.delete(apiTokens).where(eq(apiTokens.id, id)).run().changes > 0
  }
}

function toInfo(r: typeof apiTokens.$inferSelect): ApiTokenInfo {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt ?? undefined,
  }
}
