import { describe, expect, it } from 'vitest'
import { releaseLinks, renderLink, tagVars } from './links'

describe('tagVars', () => {
  it('splits a tag into WUD template variables', () => {
    expect(tagVars('v2.8.3-ls364')).toEqual({
      original: 'v2.8.3-ls364',
      raw: 'v2.8.3-ls364',
      transformed: 'v2.8.3-ls364',
      major: '2',
      minor: '8',
      patch: '3',
      prerelease: 'ls364',
    })
    expect(tagVars('1.27')).toMatchObject({ major: '1', minor: '27', patch: '0', prerelease: '' })
    expect(tagVars('latest')).toMatchObject({ major: undefined, patch: undefined })
  })
})

describe('renderLink', () => {
  it('fills in every variable', () => {
    expect(
      renderLink(
        'https://x.dev/${major}/${minor}/${patch}/${prerelease}/${ original }',
        '1.2.3-rc1',
      ),
    ).toEqual({ url: 'https://x.dev/1/2/3/rc1/1.2.3-rc1' })
    expect(renderLink('https://x.dev/${raw}?t=${transformed}', '7.1')).toEqual({
      url: 'https://x.dev/7.1?t=7.1',
    })
  })

  it('gives no link when the tag lacks a number the template uses', () => {
    expect(renderLink('https://x.dev/v${major}', 'latest')).toBeUndefined()
    expect(renderLink('https://x.dev/${original}', 'latest')).toEqual({
      url: 'https://x.dev/latest',
    })
  })

  it('reports unknown variables and non-http results', () => {
    expect(renderLink('https://x.dev/${version}', '1.2.3')).toEqual({
      error: 'unknown variable ${version}',
    })
    expect(renderLink('javascript:alert(${major})', '1.2.3')).toEqual({
      error: 'not an http(s) URL',
    })
    expect(renderLink('${original}', '1.2.3')).toEqual({ error: 'not an http(s) URL' })
  })
})

describe('releaseLinks', () => {
  const template = 'https://example.com/releases/v${original}'

  it('links a tag and its newer tag', () => {
    expect(releaseLinks(template, '2.17.0', '2.18.0')).toEqual({
      currentLink: 'https://example.com/releases/v2.17.0',
      newerLink: 'https://example.com/releases/v2.18.0',
    })
    expect(releaseLinks(template, '2.17.0')).toEqual({
      currentLink: 'https://example.com/releases/v2.17.0',
    })
  })

  it('gives no link for a tag without the numbers the template needs', () => {
    expect(releaseLinks('https://example.com/v${major}', 'latest')).toEqual({})
  })

  it('says why a broken template gives no links', () => {
    expect(releaseLinks('see ${original}', '1.0')).toEqual({
      linkTemplateError: 'not an http(s) URL',
    })
    expect(releaseLinks('https://example.com/${nope}', '1.0')).toEqual({
      linkTemplateError: 'unknown variable ${nope}',
    })
  })
})
