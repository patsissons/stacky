import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StackRepository } from './repository'

let root: string
let repo: StackRepository

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-repo-'))
  repo = new StackRepository(root)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function mkStack(name: string, file = 'compose.yaml', content = 'services: {}\n') {
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, file), content)
}

describe('StackRepository', () => {
  it('lists Dockge-style stack directories with any accepted compose file name', async () => {
    mkStack('alpha')
    mkStack('beta', 'docker-compose.yml')
    fs.mkdirSync(path.join(root, 'no-compose'))
    mkStack('Invalid')
    fs.writeFileSync(path.join(root, 'global.env'), 'TZ=UTC\n')

    const stacks = await repo.list()
    expect(stacks.map((s) => [s.name, s.composeFile])).toEqual([
      ['alpha', 'compose.yaml'],
      ['beta', 'docker-compose.yml'],
    ])
  })

  it('returns an empty list when the stacks dir does not exist', async () => {
    expect(await new StackRepository(path.join(root, 'missing')).list()).toEqual([])
  })

  it('round-trips compose and env text byte for byte', async () => {
    const compose = '# keep me\nservices:\n  web:\n    image: nginx # pinned later\n'
    await repo.create('web', compose, 'A=1\n')
    expect(await repo.read('web')).toEqual({
      name: 'web',
      composeFile: 'compose.yaml',
      compose,
      env: 'A=1\n',
      hasEnv: true,
    })

    await repo.write('web', { compose: 'services: {}\n', env: '' })
    const after = await repo.read('web')
    expect(after.compose).toBe('services: {}\n')
    expect(after.hasEnv).toBe(false)
  })

  it('writes to the existing compose file name', async () => {
    mkStack('legacy', 'docker-compose.yml')
    await repo.write('legacy', { compose: 'services: {x: {image: a}}\n' })
    expect(fs.readFileSync(path.join(root, 'legacy', 'docker-compose.yml'), 'utf8')).toContain('x:')
    expect(fs.existsSync(path.join(root, 'legacy', 'compose.yaml'))).toBe(false)
  })

  it('keeps the inode when writing so bind-mounted files see changes', async () => {
    mkStack('app')
    await repo.writeFile('app', 'config/app.ini', 'a=1\n')
    const before = fs.statSync(path.join(root, 'app/config/app.ini')).ino
    await repo.writeFile('app', 'config/app.ini', 'a=2\n')
    expect(fs.statSync(path.join(root, 'app/config/app.ini')).ino).toBe(before)
  })

  it('refuses to create a duplicate stack', async () => {
    await repo.create('dup', 'services: {}\n')
    await expect(repo.create('dup', 'services: {}\n')).rejects.toThrow(/already exists/)
  })

  it('lists files and blocks paths outside the stack', async () => {
    mkStack('app')
    fs.mkdirSync(path.join(root, 'app/config'))
    fs.writeFileSync(path.join(root, 'app/config/a.conf'), 'x')
    fs.mkdirSync(path.join(root, 'app/.git'))
    const files = await repo.listFiles('app')
    expect(files.map((f) => f.path)).toEqual(['compose.yaml', 'config', 'config/a.conf'])
    await expect(repo.readFile('app', '../global.env')).rejects.toThrow(/outside/)
  })

  it('rejects binary files', async () => {
    mkStack('app')
    fs.writeFileSync(path.join(root, 'app/bin.dat'), Buffer.from([1, 0, 2]))
    await expect(repo.readFile('app', 'bin.dat')).rejects.toThrow(/binary/)
  })

  it('reads and writes global.env', async () => {
    expect(await repo.readGlobalEnv()).toBeUndefined()
    await repo.writeGlobalEnv('TZ=UTC\n')
    expect(await repo.readGlobalEnv()).toBe('TZ=UTC\n')
    await repo.writeGlobalEnv('')
    expect(await repo.readGlobalEnv()).toBeUndefined()
  })
})
