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
export function resolveStackFile(dir: string, relative: string): Promise<string> {
  return resolveInside(dir, relative, { code: 'path_outside_stack', what: 'the stack directory' })
}

export interface ResolveOptions {
  /** Accept an empty path (or ".") meaning the root itself. */
  allowRoot?: boolean
  /** Error code and description of the root used in the 403. */
  code?: string
  what?: string
}

/**
 * Resolves a path relative to a root directory and guarantees it stays inside it, both
 * lexically and after following symlinks of existing parents.
 */
export async function resolveInside(
  root: string,
  relative: string,
  { allowRoot = false, code = 'path_outside_root', what = 'the directory' }: ResolveOptions = {},
): Promise<string> {
  if (allowRoot && (relative === '' || relative === '.')) return path.resolve(root)
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw badRequest(`invalid file path "${relative}"`)
  }
  const resolved = path.resolve(root, relative)
  if (!isInside(root, resolved) || (resolved === path.resolve(root) && !allowRoot)) {
    throw new AppError(403, code, `"${relative}" is outside ${what}`)
  }

  // Follow symlinks on the deepest existing ancestor to stop link escapes.
  const realRoot = await fs.realpath(root)
  let probe = resolved
  for (;;) {
    try {
      const real = await fs.realpath(probe)
      const rest = path.relative(probe, resolved)
      const finalPath = path.join(real, rest)
      if (!isInside(realRoot, finalPath)) {
        throw new AppError(403, code, `"${relative}" resolves outside ${what}`)
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
