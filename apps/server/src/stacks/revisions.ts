import { and, desc, eq, lt } from 'drizzle-orm'
import type { StackFiles } from '@stacky/shared'
import type { Db } from '../db'
import { stackRevisions } from '../db/schema'

export interface Revision {
  id: number
  stack: string
  operationId?: string
  composeFile: string
  compose: string
  env?: string
  createdAt: number
}

const KEEP = 50

/** Deployed versions of each stack's files (newest first), deduplicated and capped. */
export class RevisionStore {
  constructor(private readonly db: Db) {}

  list(stack: string, limit = KEEP): Revision[] {
    return this.db
      .select()
      .from(stackRevisions)
      .where(eq(stackRevisions.stack, stack))
      .orderBy(desc(stackRevisions.createdAt), desc(stackRevisions.id))
      .limit(limit)
      .all()
      .map(toRevision)
  }

  get(stack: string, id: number): Revision | undefined {
    const row = this.db
      .select()
      .from(stackRevisions)
      .where(and(eq(stackRevisions.stack, stack), eq(stackRevisions.id, id)))
      .get()
    return row ? toRevision(row) : undefined
  }

  /** Records the files unless they are identical to the latest revision. */
  record(stack: string, files: StackFiles, operationId?: string): Revision | undefined {
    const latest = this.list(stack, 1)[0]
    const env = files.hasEnv ? files.env : undefined
    if (latest && latest.compose === files.compose && (latest.env ?? undefined) === env)
      return undefined
    const row = this.db
      .insert(stackRevisions)
      .values({
        stack,
        operationId: operationId ?? null,
        composeFile: files.composeFile,
        compose: files.compose,
        env: env ?? null,
        createdAt: Date.now(),
      })
      .returning()
      .get()
    // keep the newest KEEP revisions per stack
    const cutoff = this.list(stack, KEEP + 1)[KEEP]
    if (cutoff) {
      this.db
        .delete(stackRevisions)
        .where(and(eq(stackRevisions.stack, stack), lt(stackRevisions.id, cutoff.id + 1)))
        .run()
    }
    return toRevision(row)
  }
}

function toRevision(r: typeof stackRevisions.$inferSelect): Revision {
  return {
    id: r.id,
    stack: r.stack,
    operationId: r.operationId ?? undefined,
    composeFile: r.composeFile,
    compose: r.compose,
    env: r.env ?? undefined,
    createdAt: r.createdAt,
  }
}
