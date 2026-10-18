import { describe, expect, it } from 'vitest'
import { registryPage } from './registry-link'

describe('registryPage', () => {
  it('links to the tag pages of well-known registries', () => {
    expect(registryPage({ registry: 'docker.io', repository: 'library/nginx' })).toBe(
      'https://hub.docker.com/_/nginx/tags',
    )
    expect(registryPage({ registry: 'docker.io', repository: 'louislam/dockge' })).toBe(
      'https://hub.docker.com/r/louislam/dockge/tags',
    )
    expect(registryPage({ registry: 'ghcr.io', repository: 'getwud/wud' })).toBe(
      'https://github.com/getwud/wud/pkgs/container/wud',
    )
    expect(registryPage({ registry: 'registry.example.com', repository: 'a/b' })).toBeUndefined()
  })
})
