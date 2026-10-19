import { describe, expect, it } from 'vitest'
import { composeSchema, serviceSchema, toDraft7 } from './schema'

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

  it('derives a one-service schema from the compose schema', () => {
    const s = serviceSchema as any
    expect(s.maxProperties).toBe(1)
    expect(Object.values(s.patternProperties)).toEqual([{ $ref: '#/definitions/service' }])
    expect(s.definitions.service).toBeDefined()
  })
})
