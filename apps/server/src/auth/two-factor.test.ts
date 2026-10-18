import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { AuthService } from '.'

const ORIGIN = 'http://localhost:5005'

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) as authenticator apps compute it. */
function totp(secretBase32: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  const n = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString()
  return n.padStart(6, '0')
}

function cookieJar() {
  let cookies: Record<string, string> = {}
  return {
    header: () =>
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    store(res: Response) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const [k, v] = pair!.split('=')
        if (v === '' || /max-age=0/i.test(c)) {
          const { [k!]: _, ...rest } = cookies
          cookies = rest
        } else cookies[k!] = v!
      }
    },
  }
}

describe('two-factor authentication', () => {
  it('requires a TOTP code after the password once enabled', async () => {
    const { sqlite } = openDatabase(':memory:')
    const auth = await AuthService.create({
      sqlite,
      secret: 'x'.repeat(40),
      baseUrl: ORIGIN,
      rateLimit: false,
    })
    await auth.createAdmin('admin', 'correct horse')
    const jar = cookieJar()
    const call = async (path: string, body: unknown) => {
      const res = await auth.auth.handler(
        new Request(`${ORIGIN}/api/auth${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: jar.header() },
          body: JSON.stringify(body),
        }),
      )
      jar.store(res)
      return {
        status: res.status,
        body: (await res.json().catch(() => ({}))) as Record<string, any>,
      }
    }

    expect(
      (await call('/sign-in/username', { username: 'admin', password: 'correct horse' })).status,
    ).toBe(200)
    const enable = await call('/two-factor/enable', { password: 'correct horse' })
    expect(enable.status).toBe(200)
    const secret = new URL(enable.body.totpURI).searchParams.get('secret')!
    expect(enable.body.backupCodes.length).toBeGreaterThan(0)
    expect((await call('/two-factor/verify-totp', { code: totp(secret) })).status).toBe(200)
    expect((await auth.session(new Headers({ cookie: jar.header() })))?.twoFactorEnabled).toBe(true)

    await call('/sign-out', {})
    const signIn = await call('/sign-in/username', { username: 'admin', password: 'correct horse' })
    expect(signIn.body.twoFactorRedirect).toBe(true)
    // password alone is not a session
    expect(await auth.session(new Headers({ cookie: jar.header() }))).toBeUndefined()

    expect((await call('/two-factor/verify-totp', { code: '000000' })).status).toBe(401)
    expect((await call('/two-factor/verify-totp', { code: totp(secret) })).status).toBe(200)
    expect(await auth.session(new Headers({ cookie: jar.header() }))).toMatchObject({
      username: 'admin',
    })
    sqlite.close()
  })
})
