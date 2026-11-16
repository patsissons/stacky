import { describe, expect, it } from 'vitest'
import { containerLinks, releaseLink } from './release-link'

const NPM = 'https://github.com/NginxProxyManager/nginx-proxy-manager/releases/tag/'

describe('containerLinks', () => {
  // two containers of one image with different labels: the image-wide check gives no links
  const conflicted = {
    tag: '2.17.0',
    newerTag: '2.18.0',
    linkTemplateError: 'containers using this image have different stacky.link.template labels',
  }

  it("uses the container's own template when another container's label disagrees", () => {
    expect(containerLinks(conflicted, `${NPM}v\${original}`)).toEqual({
      currentLink: `${NPM}v2.17.0`,
      newerLink: `${NPM}v2.18.0`,
    })
  })

  it("reports the container's own template error", () => {
    expect(containerLinks(conflicted, 'see ${original}')).toEqual({
      linkTemplateError: 'not an http(s) URL',
    })
  })

  it('falls back to the image-wide links without a label', () => {
    const update = { tag: '1', currentLink: 'https://x.dev/1', newerLink: 'https://x.dev/2' }
    expect(containerLinks(update, undefined)).toEqual({
      currentLink: 'https://x.dev/1',
      newerLink: 'https://x.dev/2',
      linkTemplateError: undefined,
    })
    expect(containerLinks(conflicted, '  ').linkTemplateError).toBe(conflicted.linkTemplateError)
  })
})

describe('releaseLink', () => {
  const ref = 'jc21/nginx-proxy-manager:2.17.0'

  it("fills the container's own template with the tag it runs", () => {
    expect(releaseLink(ref, `${NPM}v\${original}`, undefined)).toBe(`${NPM}v2.17.0`)
  })

  it("prefers the container's own template over the image-wide link", () => {
    expect(releaseLink(ref, `${NPM}v\${original}`, { currentLink: `${NPM}2.17.0` })).toBe(
      `${NPM}v2.17.0`,
    )
  })

  it('gives no link when its own template gives none', () => {
    expect(releaseLink(ref, 'see ${original}', { currentLink: 'https://x.dev/1' })).toBeUndefined()
  })

  it('uses the image-wide link without a label, or for an id or digest ref', () => {
    const update = { currentLink: 'https://x.dev/1' }
    expect(releaseLink(ref, undefined, update)).toBe('https://x.dev/1')
    expect(releaseLink('sha256:abc', `${NPM}\${original}`, update)).toBe('https://x.dev/1')
    expect(releaseLink('nginx:1@sha256:abc', `${NPM}\${original}`, update)).toBe('https://x.dev/1')
    expect(releaseLink(undefined, `${NPM}\${original}`, undefined)).toBeUndefined()
  })
})
