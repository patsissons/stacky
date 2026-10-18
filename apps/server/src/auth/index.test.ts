import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { AuthService } from '.'

async function setup() {
  const { sqlite } = openDatabase(':memory:')
  const auth = await AuthService.create({
    sqlite,
    secret: 'test-secret-test-secret-test-secret',
    baseUrl: 'http://localhost:5005',
  })
  return { auth, sqlite }
}

async function signIn(auth: AuthService, username: string, password: string) {
  return auth.auth.handler(
    new Request('http://localhost:5005/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5005' },
      body: JSON.stringify({ username, password }),
    }),
  )
}

describe('AuthService', () => {
  it('needs setup until the admin exists, then refuses a second admin', async () => {
    const { auth, sqlite } = await setup()
    expect(auth.needsSetup()).toBe(true)
    await auth.createAdmin('Admin', 'correct horse')
    expect(auth.needsSetup()).toBe(false)
    await expect(auth.createAdmin('other', 'correct horse')).rejects.toThrow(/already set up/)
    sqlite.close()
  })

  it('validates usernames and password length', async () => {
    const { auth, sqlite } = await setup()
    await expect(auth.createAdmin('a', 'correct horse')).rejects.toThrow(/usernames/)
    await expect(auth.createAdmin('admin', 'short')).rejects.toThrow(/8 characters/)
    sqlite.close()
  })

  it('signs in with username and password and resolves the session cookie', async () => {
    const { auth, sqlite } = await setup()
    await auth.createAdmin('admin', 'correct horse')

    const bad = await signIn(auth, 'admin', 'wrong password')
    expect(bad.status).toBe(401)

    const res = await signIn(auth, 'admin', 'correct horse')
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain('session_token')

    const user = await auth.session(new Headers({ cookie: cookie!.split(';')[0]! }))
    expect(user).toMatchObject({ username: 'admin' })
    expect(await auth.session(new Headers())).toBeUndefined()
    sqlite.close()
  })

  it('rejects public sign-up', async () => {
    const { auth, sqlite } = await setup()
    const res = await auth.auth.handler(
      new Request('http://localhost:5005/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5005' },
        body: JSON.stringify({ email: 'x@y.z', password: 'correct horse', name: 'x' }),
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(auth.needsSetup()).toBe(true)
    sqlite.close()
  })
})
