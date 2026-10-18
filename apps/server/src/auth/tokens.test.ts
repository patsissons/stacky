import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { AuditLog } from './audit'
import { checkGroups } from '.'
import { ApiTokenStore } from './tokens'

describe('ApiTokenStore', () => {
  it('creates, verifies, lists and revokes tokens without storing them', () => {
    const { db, sqlite } = openDatabase(':memory:')
    const store = new ApiTokenStore(db)
    const { token, info } = store.create('ci')
    expect(token).toMatch(/^stk_/)
    expect(store.verify(token)?.id).toBe(info.id)
    expect(store.verify(token + 'x')).toBeUndefined()
    expect(store.verify('not-a-token')).toBeUndefined()
    expect(JSON.stringify(sqlite.prepare('select * from api_tokens').all())).not.toContain(token)
    expect(store.list()[0]).toMatchObject({ name: 'ci', prefix: token.slice(0, 10) })
    expect(store.revoke(info.id)).toBe(true)
    expect(store.verify(token)).toBeUndefined()
    sqlite.close()
  })
})

describe('AuditLog', () => {
  it('lists newest first', () => {
    const { db, sqlite } = openDatabase(':memory:')
    const log = new AuditLog(db)
    log.record({ actor: 'admin', method: 'POST', path: '/api/stacks', status: 201 })
    log.record({ actor: 'token:ci', method: 'DELETE', path: '/api/x', status: 200 })
    expect(log.list().map((e) => e.actor)).toEqual(['token:ci', 'admin'])
    sqlite.close()
  })
})

describe('checkGroups', () => {
  it('allows anyone when no groups are configured, else requires one', () => {
    expect(() => checkGroups({}, [])).not.toThrow()
    expect(() => checkGroups({ groups: ['users', 'admins'] }, ['admins'])).not.toThrow()
    expect(() => checkGroups({ groups: 'admins homelab' }, ['homelab'])).not.toThrow()
    expect(() => checkGroups({ groups: ['users'] }, ['admins'])).toThrow(/not in a group/)
    expect(() => checkGroups({}, ['admins'])).toThrow()
  })
})
