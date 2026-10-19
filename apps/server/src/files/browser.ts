import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  fileRoots,
  type BrowseEntry,
  type BrowseListing,
  type FilePreview,
  type FileRoot,
  type FileRootInfo,
} from '@stacky/shared'
import { badRequest, notFound } from '../lib/errors'
import { resolveInside } from '../stacks/paths'

const MAX_ENTRIES = 2000
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const SNIFF_BYTES = 8192

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
}

const LABELS: Record<FileRoot, string> = { stacks: 'Stacks directory', data: 'Data directory' }

/**
 * A read-only view of the stacks directory and stacky's data directory. Every path is
 * contained to its root (symlinks included); secrets stacky keeps for itself and git
 * internals are never listed or read.
 */
export class FileBrowser {
  /** The session signing secret, hidden wherever it shows up (the data dir may sit in a stack). */
  private readonly secret: string

  constructor(private readonly roots: Record<FileRoot, string>) {
    this.secret = path.resolve(roots.data, 'auth-secret')
  }

  rootInfo(): FileRootInfo[] {
    return fileRoots.map((id) => ({ id, label: LABELS[id], path: this.roots[id] }))
  }

  async list(rootId: string, dir = ''): Promise<BrowseListing> {
    const root = this.root(rootId)
    const rel = normalize(dir)
    this.assertVisible(root, rel)
    const abs = await this.resolve(root, rel, true)
    const stat = await fs.stat(abs).catch(() => undefined)
    if (!stat?.isDirectory()) throw notFound(`directory "${rel || '/'}"`)

    const dirents = await fs.readdir(abs, { withFileTypes: true })
    const entries: BrowseEntry[] = []
    for (const d of dirents) {
      const childRel = rel ? `${rel}/${d.name}` : d.name
      if (this.hidden(root, childRel)) continue
      let type: BrowseEntry['type'] | undefined
      let st: Stats | undefined
      try {
        // follows symlinks, but only those that stay inside the root
        st = await fs.stat(await this.resolve(root, childRel, false))
        type = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : undefined
      } catch {
        type = undefined
      }
      if (!type || !st) continue
      entries.push({
        name: d.name,
        path: childRel,
        type,
        size: type === 'file' ? st.size : undefined,
        mtime: st.mtimeMs,
      })
    }
    entries.sort(
      (a, b) =>
        Number(b.type === 'dir') - Number(a.type === 'dir') ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    )
    return {
      root: rootId as FileRoot,
      path: rel,
      entries: entries.slice(0, MAX_ENTRIES),
      truncated: entries.length > MAX_ENTRIES,
    }
  }

  async preview(rootId: string, file: string): Promise<FilePreview> {
    const root = this.root(rootId)
    const { abs, rel, stat } = await this.file(root, file)
    const base = { root: rootId as FileRoot, path: rel, size: stat.size, mtime: stat.mtimeMs }
    const mime = imageType(rel)
    if (mime) return { ...base, kind: 'image', mime }
    if (stat.size > MAX_TEXT_BYTES) {
      return (await looksBinary(abs)) ? { ...base, kind: 'binary' } : { ...base, kind: 'too_large' }
    }
    const buf = await fs.readFile(abs)
    if (isBinary(buf)) return { ...base, kind: 'binary' }
    return { ...base, kind: 'text', content: buf.toString('utf8') }
  }

  /** The bytes of an image file, for the viewer. Other files are never served raw. */
  async image(rootId: string, file: string): Promise<{ data: Buffer; type: string }> {
    const root = this.root(rootId)
    const { abs, rel, stat } = await this.file(root, file)
    const type = imageType(rel)
    if (!type) throw badRequest(`"${rel}" is not an image`)
    if (stat.size > MAX_IMAGE_BYTES) throw badRequest(`"${rel}" is too large to show (over 20 MB)`)
    return { data: await fs.readFile(abs), type }
  }

  private root(id: string): string {
    if (!(fileRoots as readonly string[]).includes(id)) throw badRequest(`unknown root "${id}"`)
    return this.roots[id as FileRoot]
  }

  private async file(root: string, file: string) {
    const rel = normalize(file)
    if (!rel) throw badRequest('a file path is required')
    this.assertVisible(root, rel)
    const abs = await this.resolve(root, rel, false)
    const stat = await fs.stat(abs).catch(() => undefined)
    if (!stat?.isFile()) throw notFound(`file "${rel}"`)
    // a symlink to the secret is as secret as the file itself
    const [real, secret] = await Promise.all([
      fs.realpath(abs),
      fs.realpath(this.secret).catch(() => this.secret),
    ])
    if (real === secret) throw notFound(`"${rel}"`)
    return { abs, rel, stat }
  }

  private resolve(root: string, rel: string, allowRoot: boolean) {
    return resolveInside(root, rel, { allowRoot, what: 'the browsable directories' })
  }

  /** Paths that are never shown: git internals and the session signing secret. */
  private hidden(root: string, rel: string): boolean {
    if (rel.split('/').includes('.git')) return true
    return path.resolve(root, rel) === this.secret
  }

  private assertVisible(root: string, rel: string) {
    if (rel && this.hidden(root, rel)) throw notFound(`"${rel}"`)
  }
}

/** Accepts `a/b`, `/a/b/` and `./a` alike; traversal is left for the containment check. */
function normalize(p: string): string {
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join('/')
}

function imageType(file: string): string | undefined {
  return IMAGE_TYPES[path.extname(file).toLowerCase()]
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, SNIFF_BYTES).includes(0)
}

async function looksBinary(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0)
    return isBinary(buf.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
