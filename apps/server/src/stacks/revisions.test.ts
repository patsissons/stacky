import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { RevisionStore } from './revisions'

const files = (compose: string, env = '') => ({
  name: 'app',
  composeFile: 'compose.yaml',
  compose,
  env,
  hasEnv: env !== '',
})

describe('RevisionStore', () => {
  it('records deployed files newest first and skips duplicates', () => {
    const { db, sqlite } = openDatabase(':memory:')
    const store = new RevisionStore(db)
    expect(store.record('app', files('a'), 'op1')).toBeDefined()
    expect(store.record('app', files('a'), 'op2')).toBeUndefined()
    store.record('app', files('a', 'X=1'), 'op3')
    store.record('app', files('b'), 'op4')
    expect(store.list('app').map((r) => [r.compose, r.env ?? ''])).toEqual([
      ['b', ''],
      ['a', 'X=1'],
      ['a', ''],
    ])
    const first = store.list('app').at(-1)!
    expect(store.get('app', first.id)?.operationId).toBe('op1')
    expect(store.get('other', first.id)).toBeUndefined()
    sqlite.close()
  })

  it('keeps at most 50 revisions per stack', () => {
    const { db, sqlite } = openDatabase(':memory:')
    const store = new RevisionStore(db)
    for (let i = 0; i < 60; i++) store.record('app', files(`v${i}`))
    const list = store.list('app', 100)
    expect(list).toHaveLength(50)
    expect(list[0]?.compose).toBe('v59')
    expect(list.at(-1)?.compose).toBe('v10')
    sqlite.close()
  })

  it('clears one stack without touching the others', () => {
    const { db, sqlite } = openDatabase(':memory:')
    const store = new RevisionStore(db)
    store.record('app', files('a'))
    store.record('app', files('b'))
    store.record('other', files('c'))
    expect(store.clear('app')).toBe(2)
    expect(store.list('app')).toEqual([])
    expect(store.list('other')).toHaveLength(1)
    expect(store.clear('app')).toBe(0)
    sqlite.close()
  })
})
