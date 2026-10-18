import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { genericOAuth, twoFactor, username } from 'better-auth/plugins'
import type { OidcConfig } from '../config'
import { AppError, badRequest, conflict } from '../lib/errors'
import type { Logger } from '../lib/logger'

const SESSION_DAYS = 30

export interface AuthOptions {
  sqlite: BetterSqlite3.Database
  secret: string
  baseUrl?: string
  logger?: Logger
  /** Brute-force protection; only disabled in tests. */
  rateLimit?: boolean
  /** Trust X-Forwarded-For for client IPs (only when a reverse proxy is configured). */
  trustForwardedFor?: boolean
  oidc?: OidcConfig
}

export const OIDC_PROVIDER_ID = 'oidc'

/** Rejects OIDC users outside the allowed groups (when STACKY_OIDC_ALLOWED_GROUPS is set). */
export function checkGroups(profile: Record<string, unknown>, allowed: string[]) {
  if (allowed.length === 0) return
  const raw = profile.groups ?? profile.roles
  const groups = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : []
  if (!groups.some((g) => allowed.includes(g))) {
    throw new Error('Your account is not in a group that may use stacky')
  }
}

function options({
  sqlite,
  secret,
  baseUrl,
  logger,
  rateLimit = true,
  trustForwardedFor = false,
  oidc,
}: AuthOptions) {
  return {
    appName: 'stacky',
    database: sqlite,
    secret,
    baseURL: baseUrl,
    basePath: '/api/auth',
    emailAndPassword: {
      enabled: true,
      // Accounts are created through stacky's setup flow, never by public sign-up.
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 256,
    },
    session: {
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: rateLimit, window: 60, max: 30, storage: 'memory' as const },
    advanced: {
      // Without a trusted proxy the client could spoof X-Forwarded-For, so all
      // requests share one rate-limit bucket instead.
      ipAddress: { ipAddressHeaders: trustForwardedFor ? ['x-forwarded-for'] : [] },
    },
    // Same-origin requests are always trusted; STACKY_BASE_URL adds the public origin.
    trustedOrigins: (request?: Request) => {
      const origins = baseUrl ? [new URL(baseUrl).origin] : []
      if (request) {
        const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
        const proto =
          request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')
        if (host) origins.push(`${proto}://${host}`)
      }
      return origins
    },
    plugins: [
      username({ minUsernameLength: 2, maxUsernameLength: 64 }),
      twoFactor({ issuer: 'stacky' }),
      ...(oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: OIDC_PROVIDER_ID,
                  name: oidc.name,
                  discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret,
                  scopes: oidc.scopes,
                  pkce: true,
                  mapProfileToUser: (profile) => {
                    checkGroups(profile as Record<string, unknown>, oidc.allowedGroups)
                    const p = profile as Record<string, unknown>
                    const name = String(p.preferred_username ?? p.name ?? p.email ?? 'user')
                    return { name }
                  },
                },
              ],
            }),
          ]
        : []),
    ],
    telemetry: { enabled: false },
    logger: {
      log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => {
        // Deriving the origin from each request is intended unless STACKY_BASE_URL is set.
        if (message.includes('Base URL is not set')) return
        logger?.[level](`auth: ${message}`)
      },
    },
  }
}

export type Auth = ReturnType<typeof createAuthInstance>

function createAuthInstance(opts: AuthOptions) {
  return betterAuth(options(opts))
}

export interface AuthUser {
  id: string
  username: string
  name: string
  twoFactorEnabled?: boolean
  /** How the request was authenticated. */
  via?: 'session' | 'token'
}

/** Wraps better-auth with stacky's single-admin setup flow. */
export class AuthService {
  readonly auth: Auth

  private constructor(
    auth: Auth,
    private readonly sqlite: BetterSqlite3.Database,
  ) {
    this.auth = auth
  }

  static async create(opts: AuthOptions) {
    const { runMigrations } = await getMigrations(options(opts))
    await runMigrations()
    return new AuthService(createAuthInstance(opts), opts.sqlite)
  }

  /** True until the first account exists. */
  needsSetup(): boolean {
    const row = this.sqlite.prepare('select count(*) as n from user').get() as { n: number }
    return row.n === 0
  }

  async createAdmin(name: string, password: string): Promise<AuthUser> {
    if (!this.needsSetup()) throw conflict('stacky is already set up')
    const usernameValue = name.trim().toLowerCase()
    if (!/^[a-z0-9_.-]{2,64}$/.test(usernameValue)) {
      throw badRequest('usernames use 2-64 letters, digits, ".", "_" or "-"')
    }
    if (password.length < 8) throw badRequest('passwords must be at least 8 characters')

    const ctx = await this.auth.$context
    const hash = await ctx.password.hash(password)
    const user = await ctx.internalAdapter.createUser(
      {
        email: `${usernameValue}@stacky.local`,
        name: usernameValue,
        emailVerified: true,
        username: usernameValue,
        displayUsername: usernameValue,
      },
      { method: 'admin' },
    )
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    })
    return { id: user.id, username: usernameValue, name: usernameValue }
  }

  async session(headers: Headers): Promise<AuthUser | undefined> {
    try {
      const result = await this.auth.api.getSession({ headers })
      if (!result) return undefined
      const u = result.user as {
        id: string
        name: string
        username?: string | null
        twoFactorEnabled?: boolean | null
      }
      return {
        id: u.id,
        name: u.name,
        username: u.username ?? u.name,
        twoFactorEnabled: !!u.twoFactorEnabled,
        via: 'session',
      }
    } catch {
      return undefined
    }
  }

  async requireSession(headers: Headers): Promise<AuthUser> {
    const user = await this.session(headers)
    if (!user) throw new AppError(401, 'unauthenticated', 'Sign in to continue')
    return user
  }
}

/** Reads STACKY_AUTH_SECRET or a secret persisted in the data dir (created on first run). */
export function loadAuthSecret(dataDir: string, fromEnv?: string): string {
  if (fromEnv) return fromEnv
  const file = path.join(dataDir, 'auth-secret')
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    const secret = randomBytes(32).toString('hex')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, secret, { mode: 0o600 })
    return secret
  }
}
