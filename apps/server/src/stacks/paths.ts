import fs from 'node:fs/promises'
import path from 'node:path'
import { COMPOSE_FILE_NAMES, STACK_NAME_RE } from '@stacky/shared'
import { AppError, badRequest } from '../lib/errors'

export function isValidStackName(name: string): boolean {
  return STACK_NAME_RE.test(name)
}

export function assertStackName(name: string): string {
  if (!isValidStackName(name)) {
    throw badRequest(
      `invalid stack name "${name}"`,
      'Use lowercase letters, digits, "-" and "_", starting with a letter or digit.',
    )
  }
  return name
}

/** Absolute directory for a stack. Validates the name *before* building any path. */
export function stackDir(stacksDir: string, name: string): string {
  assertStackName(name)
  return path.join(stacksDir, name)
}

/**
 * Resolves a file path relative to a stack directory and guarantees it stays
 * inside it, both lexically and after following symlinks of existing parents.
 */
export async function resolveStackFile(dir: string, relative: string): Promise<string> {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw badRequest(`invalid file path "${relative}"`)
  }
  const resolved = path.resolve(dir, relative)
  if (!isInside(dir, resolved) || resolved === dir) {
    throw new AppError(403, 'path_outside_stack', `"${relative}" is outside the stack directory`)
  }

  // Follow symlinks on the deepest existing ancestor to stop link escapes.
  const realDir = await fs.realpath(dir)
  let probe = resolved
  for (;;) {
    try {
      const real = await fs.realpath(probe)
      const rest = path.relative(probe, resolved)
      const finalPath = path.join(real, rest)
      if (!isInside(realDir, finalPath)) {
        throw new AppError(
          403,
          'path_outside_stack',
          `"${relative}" resolves outside the stack directory`,
        )
      }
      return resolved
    } catch (err) {
      if (err instanceof AppError) throw err
      const parent = path.dirname(probe)
      if (parent === probe) return resolved
      probe = parent
    }
  }
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Finds the stack's compose file following compose's own priority order. */
export async function findComposeFile(dir: string): Promise<string | undefined> {
  for (const name of COMPOSE_FILE_NAMES) {
    try {
      const stat = await fs.stat(path.join(dir, name))
      if (stat.isFile()) return name
    } catch {
      // try the next name
    }
  }
  return undefined
}
