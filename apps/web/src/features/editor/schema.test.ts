import { describe, expect, it } from 'vitest'
import { composeSchema, toDraft7 } from './schema'

describe('toDraft7', () => {
  it('moves $defs to definitions and rewrites refs', () => {
    const out = toDraft7({
      $defs: { a: { type: 'string' } },
      properties: { x: { $ref: '#/$defs/a' } },
    }) as any
    expect(out.definitions.a).toEqual({ type: 'string' })
    expect(out.$defs).toBeUndefined()
    expect(out.properties.x.$ref).toBe('#/definitions/a')
  })

  it('converts the vendored compose schema', () => {
    const s = composeSchema as any
    expect(s.definitions.service).toBeDefined()
    expect(JSON.stringify(s)).not.toContain('#/$defs/')
  })
})
