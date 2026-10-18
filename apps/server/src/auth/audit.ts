import { desc, lt } from 'drizzle-orm'
import type { Db } from '../db'
import { auditLog } from '../db/schema'

export interface AuditEntry {
  id: number
  ts: number
  actor: string
  method: string
  path: string
  status: number
}

const KEEP_MS = 90 * 24 * 60 * 60 * 1000

/** Append-only record of mutating API requests, kept for 90 days. */
export class AuditLog {
  private writes = 0

  constructor(private readonly db: Db) {}

  record(entry: Omit<AuditEntry, 'id' | 'ts'>) {
    this.db
      .insert(auditLog)
      .values({ ...entry, ts: Date.now() })
      .run()
    if (++this.writes % 500 === 0) {
      this.db
        .delete(auditLog)
        .where(lt(auditLog.ts, Date.now() - KEEP_MS))
        .run()
    }
  }

  list(limit = 200): AuditEntry[] {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all()
  }
}
