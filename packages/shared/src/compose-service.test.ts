import { describe, expect, it } from 'vitest'
import { blockLine, extractService, replaceService } from './compose-service'

const COMPOSE = `# my stack
name: demo
services:
  # the database
  db:
    image: postgres:17 # pinned
    environment: &env
      TZ: UTC
    # ports:
    #   - 5432:5432

  web:
    image: nginx:1.27
    command: |
      echo hi
      exec nginx
    environment: *env
volumes:
  data: {}
`

describe('extractService', () => {
  it('cuts a service block out of the text, with its indented comments', () => {
    const db = extractService(COMPOSE, 'db')!
    expect(db.text).toBe(
      [
        'db:',
        '  image: postgres:17 # pinned',
        '  environment: &env',
        '    TZ: UTC',
        '  # ports:',
        '  #   - 5432:5432',
      ].join('\n'),
    )
    expect(db.indent).toBe(2)
    expect(db.line).toBe(5)
    // the comment above the key stays outside
    expect(COMPOSE.slice(0, db.start)).toContain('# the database')
  })

  it('handles block scalars, aliases and the last service', () => {
    const web = extractService(COMPOSE, 'web')!
    expect(web.text).toBe(
      [
        'web:',
        '  image: nginx:1.27',
        '  command: |',
        '    echo hi',
        '    exec nginx',
        '  environment: *env',
      ].join('\n'),
    )
    expect(COMPOSE.slice(web.end)).toBe('volumes:\n  data: {}\n')
  })

  it('works at the end of a file without a final newline', () => {
    const text = 'services:\n  a:\n    image: x'
    expect(extractService(text, 'a')).toMatchObject({ text: 'a:\n  image: x', end: text.length })
  })

  it('gives up on what it cannot isolate', () => {
    expect(extractService(COMPOSE, 'missing')).toBeUndefined()
    expect(extractService('services: {a: {image: x}}\n', 'a')).toBeUndefined()
    expect(extractService('services:\n  a: [\n', 'a')).toBeUndefined()
    expect(extractService('- a\n', 'a')).toBeUndefined()
  })
})

describe('replaceService', () => {
  it('splices an edit in and keeps everything else byte-identical', () => {
    const db = extractService(COMPOSE, 'db')!
    const edited = db.text.replace('postgres:17', 'postgres:18') + '\n  restart: always\n'
    const next = replaceService(COMPOSE, 'db', edited)
    expect(next.slice(0, db.start)).toBe(COMPOSE.slice(0, db.start))
    expect(next).toContain('    image: postgres:18 # pinned\n')
    expect(next).toContain('    #   - 5432:5432\n    restart: always\n\n  web:\n')
    expect(next.endsWith(COMPOSE.slice(db.end))).toBe(true)
    // round trip: what was extracted goes back unchanged
    expect(replaceService(COMPOSE, 'web', extractService(COMPOSE, 'web')!.text)).toBe(COMPOSE)
  })

  it('keeps CRLF line endings', () => {
    const crlf = COMPOSE.replace(/\n/g, '\r\n')
    const web = extractService(crlf, 'web')!
    expect(web.text).not.toContain('\r')
    const next = replaceService(crlf, 'web', web.text.replace('1.27', '1.28'))
    expect(next).toBe(crlf.replace('nginx:1.27', 'nginx:1.28'))
  })

  it('rejects edits that are not exactly that one service', () => {
    expect(() => replaceService(COMPOSE, 'web', 'other:\n  image: x')).toThrow(/only the service/)
    expect(() => replaceService(COMPOSE, 'web', 'web:\n  image: x\nmore:\n  image: y')).toThrow(
      /only the service/,
    )
    expect(() => replaceService(COMPOSE, 'web', 'web:\n  image: [')).toThrow()
    expect(() => replaceService(COMPOSE, 'nope', 'nope: {}')).toThrow(/cannot be edited/)
  })
})

describe('blockLine', () => {
  it('maps file lines into the block', () => {
    expect(blockLine(5, 6, 5)).toBe(1)
    expect(blockLine(5, 6, 10)).toBe(6)
    expect(blockLine(5, 6, 11)).toBeUndefined()
    expect(blockLine(5, 6, 4)).toBeUndefined()
    expect(blockLine(5, 6, undefined)).toBeUndefined()
  })
})
