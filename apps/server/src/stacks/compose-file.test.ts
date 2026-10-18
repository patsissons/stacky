import { describe, expect, it } from 'vitest'
import { parseCompose } from './compose-file'

describe('parseCompose', () => {
  it('lists services, images, urls and project name', () => {
    const parsed = parseCompose(`
name: custom
x-dockge:
  urls:
    - https://a.example
x-stacky:
  urls: [https://b.example, https://a.example]
services:
  web:
    image: nginx:1.27 # comment
  worker:
    build: .
`)
    expect(parsed.error).toBeUndefined()
    expect(parsed.services).toEqual([
      { name: 'web', image: 'nginx:1.27' },
      { name: 'worker', image: undefined },
    ])
    expect(parsed.urls).toEqual(['https://b.example', 'https://a.example'])
    expect(parsed.projectName).toBe('custom')
  })

  it('accepts compose merge tags and anchors', () => {
    const parsed = parseCompose(`
x-base: &base
  restart: unless-stopped
services:
  app:
    <<: *base
    image: alpine
    ports: !reset []
    environment: !override
      A: "1"
`)
    expect(parsed.error).toBeUndefined()
    expect(parsed.services.map((s) => s.name)).toEqual(['app'])
  })

  it('reports syntax errors with a position', () => {
    const parsed = parseCompose('services:\n  web:\n    image: [unclosed\n')
    expect(parsed.error).toBeDefined()
    expect(parsed.error?.line).toBeGreaterThan(0)
  })

  it('tolerates empty and non-object documents', () => {
    expect(parseCompose('').services).toEqual([])
    expect(parseCompose('just a string').services).toEqual([])
  })
})
