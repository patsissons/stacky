import fs from 'node:fs/promises'
import path from 'node:path'
import type { StackFiles } from '@stacky/shared'
import { AppError, conflict, notFound } from '../lib/errors'
import { findComposeFile, isValidStackName, resolveStackFile, stackDir } from './paths'

export const GLOBAL_ENV_FILE = 'global.env'
const MAX_EDITABLE_BYTES = 1024 * 1024
const MAX_TREE_ENTRIES = 1000
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

export interface StackDirEntry {
  name: string
  dir: string
  composeFile: string
}

export interface FileEntry {
  path: string
  type: 'file' | 'dir'
  size?: number
  /** false for large or binary files */
  editable?: boolean
}

/** Reads and writes stack files on disk. The directory layout is Dockge-compatible. */
export class StackRepository {
  /** Called after every change made through stacky (paths relative to the stacks dir). */
  onChange: ((paths: string[], message: string) => void) | undefined

  constructor(readonly stacksDir: string) {}

  private changed(paths: string[], message: string) {
    this.onChange?.(paths, message)
  }

  dir(name: string) {
    return stackDir(this.stacksDir, name)
  }

  async ensureStacksDir() {
    await fs.mkdir(this.stacksDir, { recursive: true })
  }

  async list(): Promise<StackDirEntry[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(this.stacksDir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const stacks = await Promise.all(
      entries
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isValidStackName(e.name))
        .map(async (e) => {
          const dir = path.join(this.stacksDir, e.name)
          const composeFile = await findComposeFile(dir)
          return composeFile ? { name: e.name, dir, composeFile } : undefined
        }),
    )
    return stacks
      .filter((s): s is StackDirEntry => !!s)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async exists(name: string) {
    return (await findComposeFile(this.dir(name))) !== undefined
  }

  async read(name: string): Promise<StackFiles> {
    const dir = this.dir(name)
    const composeFile = await findComposeFile(dir)
    if (!composeFile) throw notFound(`stack "${name}"`)
    const compose = await fs.readFile(path.join(dir, composeFile), 'utf8')
    const env = await readOptional(path.join(dir, '.env'))
    return { name, composeFile, compose, env: env ?? '', hasEnv: env !== undefined }
  }

  /**
   * Writes the compose file and/or .env exactly as given. An empty `env`
   * removes an existing `.env`.
   */
  async write(name: string, files: { compose?: string; env?: string }) {
    const dir = this.dir(name)
    const composeFile = await findComposeFile(dir)
    if (!composeFile) throw notFound(`stack "${name}"`)
    if (files.compose !== undefined) {
      await writeInPlace(path.join(dir, composeFile), files.compose, dir)
    }
    if (files.env !== undefined) {
      const envPath = path.join(dir, '.env')
      if (files.env === '') await fs.rm(envPath, { force: true })
      else await writeInPlace(envPath, files.env, dir)
    }
    const paths = [
      ...(files.compose !== undefined ? [`${name}/${composeFile}`] : []),
      ...(files.env !== undefined ? [`${name}/.env`] : []),
    ]
    this.changed(paths, `update ${name}`)
  }

  async create(name: string, compose: string, env = '') {
    const dir = this.dir(name)
    if (await this.exists(name)) throw conflict(`stack "${name}" already exists`)
    await fs.mkdir(dir, { recursive: true })
    await matchOwner(dir, this.stacksDir)
    await writeInPlace(path.join(dir, 'compose.yaml'), compose, dir)
    if (env) await writeInPlace(path.join(dir, '.env'), env, dir)
    this.changed([`${name}/compose.yaml`, ...(env ? [`${name}/.env`] : [])], `create ${name}`)
  }

  async remove(name: string) {
    const dir = this.dir(name)
    await fs.rm(dir, { recursive: true, force: true })
    this.changed([name], `delete ${name}`)
  }

  async readGlobalEnv(): Promise<string | undefined> {
    return readOptional(path.join(this.stacksDir, GLOBAL_ENV_FILE))
  }

  async writeGlobalEnv(text: string) {
    const file = path.join(this.stacksDir, GLOBAL_ENV_FILE)
    if (text === '') await fs.rm(file, { force: true })
    else await writeInPlace(file, text, this.stacksDir)
    this.changed([GLOBAL_ENV_FILE], 'update global.env')
  }

  async listFiles(name: string): Promise<FileEntry[]> {
    const root = this.dir(name)
    const out: FileEntry[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 4 || out.length >= MAX_TREE_ENTRIES) return
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const e of entries) {
        if (out.length >= MAX_TREE_ENTRIES) return
        const abs = path.join(dir, e.name)
        const rel = path.relative(root, abs)
        if (e.isDirectory()) {
          if (SKIPPED_DIRS.has(e.name)) continue
          out.push({ path: rel, type: 'dir' })
          await walk(abs, depth + 1)
        } else if (e.isFile()) {
          const stat = await fs.stat(abs).catch(() => undefined)
          const size = stat?.size ?? 0
          out.push({ path: rel, type: 'file', size, editable: size <= MAX_EDITABLE_BYTES })
        }
      }
    }
    await walk(root, 0)
    return out
  }

  async readFile(name: string, relative: string): Promise<string> {
    const file = await resolveStackFile(this.dir(name), relative)
    const stat = await fs.stat(file).catch(() => undefined)
    if (!stat?.isFile()) throw notFound(`file "${relative}"`)
    if (stat.size > MAX_EDITABLE_BYTES) {
      throw new AppError(422, 'file_too_large', `"${relative}" is too large to edit (over 1 MB)`)
    }
    const buf = await fs.readFile(file)
    if (buf.includes(0)) {
      throw new AppError(422, 'binary_file', `"${relative}" looks like a binary file`)
    }
    return buf.toString('utf8')
  }

  async writeFile(name: string, relative: string, content: string) {
    const dir = this.dir(name)
    const file = await resolveStackFile(dir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeInPlace(file, content, dir)
    this.changed(
      [`${name}/${path.relative(dir, file)}`],
      `update ${name}/${path.relative(dir, file)}`,
    )
  }

  async deleteFile(name: string, relative: string) {
    const dir = this.dir(name)
    const file = await resolveStackFile(dir, relative)
    await fs.rm(file, { force: true })
    this.changed(
      [`${name}/${path.relative(dir, file)}`],
      `delete ${name}/${path.relative(dir, file)}`,
    )
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }
}

/**
 * Writes in place (truncate + write) rather than write-and-rename, so files
 * bind-mounted into containers keep their inode and see the change. New files
 * take the owner of `ownerFrom` so stacky running as root doesn't leave
 * root-owned files in the user's stacks (Dockge #89).
 */
async function writeInPlace(file: string, content: string, ownerFrom: string) {
  const existed = await fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
  await fs.writeFile(file, content, 'utf8')
  if (!existed) await matchOwner(file, ownerFrom)
}

async function matchOwner(target: string, reference: string) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return
  try {
    const ref = await fs.stat(reference)
    await fs.chown(target, ref.uid, ref.gid)
  } catch {
    // best effort
  }
}
