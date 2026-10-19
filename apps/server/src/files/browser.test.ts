import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../lib/errors'
import { FileBrowser } from './browser'

let tmp: string
let stacks: string
let data: string
let browser: FileBrowser

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-browse-'))
  stacks = path.join(tmp, 'stacks')
  data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(stacks, 'app/config'), { recursive: true })
  fs.mkdirSync(path.join(stacks, '.git'))
  fs.mkdirSync(path.join(data, 'icons'), { recursive: true })
  fs.writeFileSync(path.join(stacks, 'app/compose.yaml'), 'services: {}\n')
  fs.writeFileSync(path.join(stacks, 'app/config/b.conf'), 'b')
  fs.writeFileSync(path.join(stacks, 'app/a.txt'), 'a')
  fs.writeFileSync(path.join(stacks, '.git/config'), '[core]')
  fs.writeFileSync(path.join(data, 'auth-secret'), 'shh')
  fs.writeFileSync(path.join(data, 'stacky.db'), Buffer.from([1, 0, 2, 0]))
  fs.writeFileSync(path.join(data, 'icons/nginx.png'), PNG)
  fs.mkdirSync(path.join(tmp, 'outside'))
  fs.writeFileSync(path.join(tmp, 'outside/secret.txt'), 'nope')
  browser = new FileBrowser({ stacks, data })
})

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const code = (p: Promise<unknown>) => p.then(() => 'ok').catch((e: AppError) => e.code)

describe('FileBrowser', () => {
  it('lists one directory, folders first, without git internals', async () => {
    const root = await browser.list('stacks')
    expect(root.entries.map((e) => [e.name, e.type])).toEqual([['app', 'dir']])
    const app = await browser.list('stacks', '/app/')
    expect(app.path).toBe('app')
    expect(app.entries.map((e) => e.path)).toEqual(['app/config', 'app/a.txt', 'app/compose.yaml'])
    expect(app.entries[1]).toMatchObject({ type: 'file', size: 1 })
    expect(app.truncated).toBe(false)
    expect(await code(browser.list('stacks', '.git'))).toBe('not_found')
    expect(await code(browser.list('stacks', 'app/a.txt'))).toBe('not_found')
  })

  it('never shows the auth secret, even through a stack or a symlink', async () => {
    const listing = await browser.list('data')
    expect(listing.entries.map((e) => e.name)).toEqual(['icons', 'stacky.db'])
    expect(await code(browser.preview('data', 'auth-secret'))).toBe('not_found')
    fs.symlinkSync(path.join(data, 'auth-secret'), path.join(data, 'icons/link'))
    expect(await code(browser.preview('data', 'icons/link'))).toBe('not_found')
    // a data dir inside the stacks dir is a common layout
    const nested = new FileBrowser({ stacks: tmp, data })
    expect((await nested.list('stacks', 'data')).entries.map((e) => e.name)).not.toContain(
      'auth-secret',
    )
    expect(await code(nested.preview('stacks', 'data/auth-secret'))).toBe('not_found')
  })

  it('stays inside its roots', async () => {
    expect(await code(browser.list('stacks', '..'))).toBe('path_outside_root')
    expect(await code(browser.preview('stacks', '../outside/secret.txt'))).toBe('path_outside_root')
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(stacks, 'app/escape'))
    expect(await code(browser.preview('stacks', 'app/escape/secret.txt'))).toBe('path_outside_root')
    // an escaping link is left out of the listing too
    const app = await browser.list('stacks', 'app')
    expect(app.entries.map((e) => e.name)).not.toContain('escape')
    expect(await code(browser.list('nope'))).toBe('bad_request')
  })

  it('previews text, images, binary and large files', async () => {
    expect(await browser.preview('stacks', 'app/compose.yaml')).toMatchObject({
      kind: 'text',
      content: 'services: {}\n',
      size: 13,
    })
    expect(await browser.preview('data', 'icons/nginx.png')).toMatchObject({
      kind: 'image',
      mime: 'image/png',
    })
    expect(await browser.preview('data', 'stacky.db')).toMatchObject({ kind: 'binary', size: 4 })
    fs.writeFileSync(path.join(data, 'big.log'), 'x'.repeat(1024 * 1024 + 1))
    expect(await browser.preview('data', 'big.log')).toMatchObject({ kind: 'too_large' })
    expect(await code(browser.preview('stacks', 'app/missing'))).toBe('not_found')
  })

  it('serves only images raw', async () => {
    expect((await browser.image('data', 'icons/nginx.png')).type).toBe('image/png')
    expect(await code(browser.image('stacks', 'app/compose.yaml'))).toBe('bad_request')
  })
})
