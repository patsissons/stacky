import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../lib/errors'
import { assertStackName, findComposeFile, resolveStackFile, stackDir } from './paths'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-paths-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('stack names', () => {
  it('accepts Dockge-compatible names', () => {
    for (const name of ['app', 'my-app', 'my_app', '0day', 'a1-b2_c3']) {
      expect(assertStackName(name)).toBe(name)
    }
  })

  it('rejects traversal and invalid names before building a path (Dockge #994)', () => {
    for (const name of ['../etc', '..', '.', 'a/b', 'App', '-x', '', 'a b', 'x'.repeat(64)]) {
      expect(() => stackDir(root, name)).toThrow(AppError)
    }
  })
})

describe('resolveStackFile', () => {
  it('resolves files inside the stack', async () => {
    const dir = path.join(root, 'app')
    fs.mkdirSync(dir)
    expect(await resolveStackFile(dir, 'compose.yaml')).toBe(path.join(dir, 'compose.yaml'))
    expect(await resolveStackFile(dir, 'config/app.ini')).toBe(path.join(dir, 'config/app.ini'))
  })

  it('rejects traversal and absolute paths', async () => {
    const dir = path.join(root, 'app')
    fs.mkdirSync(dir)
    await expect(resolveStackFile(dir, '../other/compose.yaml')).rejects.toThrow(AppError)
    await expect(resolveStackFile(dir, '/etc/passwd')).rejects.toThrow(AppError)
    await expect(resolveStackFile(dir, '.')).rejects.toThrow(AppError)
  })

  it('rejects symlinks that escape the stack', async () => {
    const dir = path.join(root, 'app')
    fs.mkdirSync(dir)
    fs.mkdirSync(path.join(root, 'secret'))
    fs.symlinkSync(path.join(root, 'secret'), path.join(dir, 'link'))
    await expect(resolveStackFile(dir, 'link/file.txt')).rejects.toThrow(/outside/)
  })
})

describe('findComposeFile', () => {
  it('follows compose priority order', async () => {
    const dir = path.join(root, 'app')
    fs.mkdirSync(dir)
    expect(await findComposeFile(dir)).toBeUndefined()
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), '')
    expect(await findComposeFile(dir)).toBe('docker-compose.yml')
    fs.writeFileSync(path.join(dir, 'compose.yaml'), '')
    expect(await findComposeFile(dir)).toBe('compose.yaml')
  })
})
