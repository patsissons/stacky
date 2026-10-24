import { describe, expect, it } from 'vitest'
import { registryPage, updateLinks } from './registry-link'

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

describe('updateLinks', () => {
  const hub = { registry: 'docker.io', repository: 'library/nginx' }

  it('offers the tags page when there is no link template', () => {
    expect(updateLinks(hub)).toEqual([
      { label: 'Tags and release notes', href: 'https://hub.docker.com/_/nginx/tags' },
    ])
    expect(updateLinks({ registry: 'registry.example.com', repository: 'a/b' })).toEqual([])
  })

  it('puts the release notes from the link template first', () => {
    expect(
      updateLinks({ ...hub, currentLink: 'https://x.dev/1', newerLink: 'https://x.dev/2' }),
    ).toEqual([
      { label: 'Release notes', href: 'https://x.dev/2' },
      { label: 'Tags', href: 'https://hub.docker.com/_/nginx/tags' },
    ])
    expect(
      updateLinks({
        registry: 'registry.example.com',
        repository: 'a/b',
        currentLink: 'https://x.dev/1',
      }),
    ).toEqual([{ label: 'Release notes', href: 'https://x.dev/1' }])
  })
})
