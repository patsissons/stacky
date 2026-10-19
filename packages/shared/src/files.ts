/** Directories the read-only file browser can show. */
export const fileRoots = ['stacks', 'data'] as const
export type FileRoot = (typeof fileRoots)[number]

export interface FileRootInfo {
  id: FileRoot
  label: string
  /** Absolute path on the server. */
  path: string
}

export interface BrowseEntry {
  name: string
  /** Path relative to the root, with `/` separators. */
  path: string
  type: 'file' | 'dir'
  size?: number
  mtime?: number
}

export interface BrowseListing {
  root: FileRoot
  path: string
  entries: BrowseEntry[]
  /** More entries exist than were returned. */
  truncated: boolean
}

interface PreviewBase {
  root: FileRoot
  path: string
  size: number
  mtime: number
}

export type FilePreview = PreviewBase &
  (
    | { kind: 'text'; content: string }
    | { kind: 'image'; mime: string }
    | { kind: 'binary' }
    | { kind: 'too_large' }
  )
