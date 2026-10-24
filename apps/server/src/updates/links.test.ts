import { describe, expect, it } from 'vitest'
import { renderLink, tagVars } from './links'

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
