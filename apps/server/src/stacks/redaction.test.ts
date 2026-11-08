import { describe, expect, it } from 'vitest'
import { findRedactedValues } from './redaction'

const TOKEN = 'ghp_xeAbCdEfGhIjKlMnOpQrStUvWxYz0123455BzQ'

const compose = (token: string, image = 'ghcr.io/patsissons/stacky:0.17.1') =>
  [
    'services:',
    '  stacky:',
    `    image: ${image}`,
    '    environment:',
    `      STACKY_REGISTRY_LSCR_PRIVATE_TOKEN: ${token}`,
    '',
  ].join('\n')

describe('findRedactedValues', () => {
  it('finds a prefix...suffix mask of an existing value', () => {
    expect(TOKEN).toHaveLength(42)
    const incoming = compose('ghp_xe...5BzQ', 'ghcr.io/patsissons/stacky:0.17.2')
    expect(findRedactedValues(compose(TOKEN), incoming)).toEqual([
      { line: 5, value: 'ghp_xe...5BzQ' },
    ])
  })

  it('finds masks written with an ellipsis or asterisks', () => {
    expect(findRedactedValues(compose(TOKEN), compose('ghp_xe…5BzQ'))).toHaveLength(1)
    expect(findRedactedValues(compose(TOKEN), compose('ghp_***5BzQ'))).toHaveLength(1)
  })

  it('finds masks in .env text and quoted values', () => {
    const current = `A=1\nAPI_KEY="${TOKEN}"\n`
    expect(findRedactedValues(current, 'A=1\nAPI_KEY="ghp_xe...5BzQ"\n')).toEqual([
      { line: 2, value: 'ghp_xe...5BzQ' },
    ])
    expect(findRedactedValues(`API_KEY=${TOKEN}`, 'API_KEY=ghp_xe...5BzQ')).toHaveLength(1)
  })

  it('keeps CRLF line numbers', () => {
    const current = compose(TOKEN).replace(/\n/g, '\r\n')
    const incoming = compose('ghp_xe...5BzQ').replace(/\n/g, '\r\n')
    expect(findRedactedValues(current, incoming)).toEqual([{ line: 5, value: 'ghp_xe...5BzQ' }])
  })

  it('ignores text the file already holds', () => {
    const current = `${compose(TOKEN)}# see foo...barz\n`
    expect(findRedactedValues(current, `${compose(TOKEN)}# see foo...barz\n`)).toEqual([])
  })

  it('ignores masks that match no existing value', () => {
    expect(findRedactedValues(compose(TOKEN), compose('abc...wxyz'))).toEqual([])
    expect(findRedactedValues('', compose('ghp_xe...5BzQ'))).toEqual([])
  })

  it('ignores ordinary edits', () => {
    const incoming = compose(TOKEN, 'ghcr.io/patsissons/stacky:0.17.2')
    expect(findRedactedValues(compose(TOKEN), incoming)).toEqual([])
    expect(findRedactedValues(compose(TOKEN), 'command: echo "wait..."\n')).toEqual([])
  })
})
