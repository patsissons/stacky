import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterReference, REFERENCE } from './reference'

const documented = REFERENCE.flatMap((s) => s.entries)
  .flatMap((e) => [e.name, ...(e.aliases ?? [])])
  .join(' ')

describe('REFERENCE', () => {
  it('documents every STACKY_ variable the server config reads', () => {
    const config = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../../server/src/config.ts'),
      'utf8',
    )
    const vars = [...new Set(config.match(/\bSTACKY_[A-Z_]+[A-Z]\b/g))]
    expect(vars.length).toBeGreaterThan(20)
    for (const name of vars) expect(documented, name).toContain(name)
  })

  it('has no duplicate entries', () => {
    const names = REFERENCE.flatMap((s) => s.entries.map((e) => e.name))
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('filterReference', () => {
  it('returns everything for an empty query', () => {
    expect(filterReference('  ')).toBe(REFERENCE)
  })

  it('matches names, aliases and text case-insensitively, dropping empty sections', () => {
    const byAlias = filterReference('WUD.TAG.INCLUDE')
    expect(byAlias.flatMap((s) => s.entries.map((e) => e.name))).toEqual(['stacky.tag.include'])
    expect(byAlias.map((s) => s.title)).toEqual(['Labels on a service'])
    expect(filterReference('reverse proxy').flatMap((s) => s.entries.map((e) => e.name))).toContain(
      'STACKY_AUTH_DISABLED',
    )
  })
})
