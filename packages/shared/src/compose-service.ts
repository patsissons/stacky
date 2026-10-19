import { isMap, isScalar, parseDocument, type Node } from 'yaml'

/** One service's block, cut from a compose file's own text (never re-serialized). */
export interface ServiceBlock {
  /** The block dedented to column 0, `name:` line first, LF line endings, no final newline. */
  text: string
  /** Offsets of the block's lines in the original text: [start, end). */
  start: number
  end: number
  /** Indentation of the service key. */
  indent: number
  /** 1-based line of the service key in the original text. */
  line: number
}

const parse = (text: string) =>
  parseDocument(text, { uniqueKeys: false, prettyErrors: false, strict: false })

/**
 * Finds a service in a compose file and returns its text block. Undefined when the file does
 * not parse or the service cannot be isolated (missing, or `services:` written in flow style).
 */
export function extractService(compose: string, name: string): ServiceBlock | undefined {
  const doc = parse(compose)
  if (doc.errors.length > 0 || !isMap(doc.contents)) return undefined
  const services = doc.contents.get('services', true)
  if (!isMap(services) || services.flow) return undefined
  const pair = services.items.find((p) => isScalar(p.key) && String(p.key.value) === name)
  if (!pair || !isScalar(pair.key) || !pair.key.range) return undefined

  const keyStart = pair.key.range[0]
  const start = compose.lastIndexOf('\n', keyStart - 1) + 1
  const indent = keyStart - start
  // anything but spaces before the key (e.g. an explicit `? key`) is too unusual to splice
  if (!/^ *$/.test(compose.slice(start, keyStart))) return undefined

  const value = pair.value as Node | null
  const valueEnd = Math.max(value?.range?.[1] ?? pair.key.range[1], keyStart + 1)
  const nl = compose.indexOf('\n', valueEnd - 1)
  let end = nl < 0 ? compose.length : nl + 1

  // comment lines indented under the service (e.g. a commented-out option) belong to it
  let probe = end
  while (probe < compose.length) {
    const lineEnd = compose.indexOf('\n', probe)
    const next = lineEnd < 0 ? compose.length : lineEnd + 1
    const line = compose.slice(probe, next).replace(/\r?\n$/, '')
    if (line.trim() === '') {
      probe = next
      continue
    }
    const lead = /^ */.exec(line)![0].length
    if (line.trimStart().startsWith('#') && lead > indent) {
      end = next
      probe = next
      continue
    }
    break
  }

  const text = compose
    .slice(start, end)
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (l.slice(0, indent).trim() === '' ? l.slice(indent) : l.trimStart()))
    .join('\n')
  const line = compose.slice(0, start).split('\n').length
  return { text, start, end, indent, line }
}

/**
 * Replaces a service's block with edited text (as returned by `extractService`, changed).
 * Everything outside the block stays byte-for-byte as it was. Throws when the edit does not
 * parse or is not exactly that one service.
 */
export function replaceService(compose: string, name: string, edited: string): string {
  const block = extractService(compose, name)
  if (!block) throw new Error(`service "${name}" cannot be edited on its own`)

  const doc = parse(edited)
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]!.message.split('\n')[0] ?? 'invalid YAML')
  }
  const map = doc.contents
  const key = isMap(map) && map.items.length === 1 ? map.items[0]!.key : undefined
  if (!isScalar(key) || String(key.value) !== name) {
    throw new Error(`the text must define only the service "${name}"`)
  }

  const eol = compose.includes('\r\n') ? '\r\n' : '\n'
  const pad = ' '.repeat(block.indent)
  const body = edited
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join(eol)
  const trailing = /\r?\n$/.exec(compose.slice(block.start, block.end))?.[0] ?? ''
  return compose.slice(0, block.start) + body + trailing + compose.slice(block.end)
}

/**
 * Maps a line of the whole file to the block's own numbering, if it falls inside a block of
 * `lines` lines that starts at line `start` (as `ServiceBlock.line`).
 */
export function blockLine(start: number, lines: number, line: number | undefined) {
  if (line === undefined) return undefined
  const local = line - start + 1
  return local >= 1 && local <= lines ? local : undefined
}
