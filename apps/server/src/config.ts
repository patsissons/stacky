import path from 'node:path'
import { z } from 'zod'

const booleanish = z
  .string()
  .optional()
  .transform((value) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase()))

const envSchema = z.object({
  STACKY_PORT: z.coerce.number().int().min(1).max(65535).default(5005),
  STACKY_HOSTNAME: z.string().optional(),
  STACKY_STACKS_DIR: z.string().default('/opt/stacks'),
  STACKY_DATA_DIR: z.string().default('/app/data'),
  STACKY_WEB_DIR: z.string().optional(),
  STACKY_BASE_URL: z.string().url().optional(),
  STACKY_AUTH_DISABLED: booleanish,
  STACKY_TRUSTED_PROXIES: z.string().optional(),
  STACKY_ADMIN_USER: z.string().optional(),
  STACKY_ADMIN_PASSWORD: z.string().optional(),
  STACKY_CONTAINER_ID: z.string().optional(),
  STACKY_UPDATE_CHECK: z.string().optional(),
  STACKY_UPDATE_INTERVAL: z.coerce.number().min(0).default(6),
  STACKY_OIDC_ISSUER: z.string().url().optional(),
  STACKY_OIDC_CLIENT_ID: z.string().optional(),
  STACKY_OIDC_CLIENT_SECRET: z.string().optional(),
  STACKY_OIDC_NAME: z.string().default('SSO'),
  STACKY_OIDC_SCOPES: z.string().default('openid profile email'),
  STACKY_OIDC_ALLOWED_GROUPS: z.string().optional(),
  STACKY_OIDC_AUTO_REDIRECT: booleanish,
  STACKY_ICON_CDN: z.string().default('https://cdn.jsdelivr.net/gh/selfhst/icons'),
  STACKY_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export interface Config {
  port: number
  hostname: string | undefined
  /** Absolute path of the directory holding one sub-directory per stack. */
  stacksDir: string
  /** Absolute path of stacky's own persistent data (database, history, icons). */
  dataDir: string
  /** Directory of the built web UI; undefined in dev where Vite serves it. */
  webDir: string | undefined
  baseUrl: string | undefined
  authDisabled: boolean
  /** CIDRs/addresses whose X-Forwarded-* headers are trusted. */
  trustedProxies: string[]
  admin: { username: string; password: string } | undefined
  containerId: string | undefined
  /** Check GitHub for newer stacky releases. */
  updateCheck: boolean
  /** Hours between image update checks; 0 disables scheduled checks. */
  updateIntervalHours: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  oidc: OidcConfig | undefined
  /** Base URL of the selfh.st icon set; empty disables fetching icons. */
  iconCdn: string | undefined
}

export interface OidcConfig {
  /** Issuer URL; the discovery document is read from `<issuer>/.well-known/openid-configuration`. */
  issuer: string
  clientId: string
  clientSecret: string
  /** Label on the sign-in button. */
  name: string
  scopes: string[]
  /** When set, only users with one of these groups (from the `groups` claim) may sign in. */
  allowedGroups: string[]
  autoRedirect: boolean
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new ConfigError(`invalid configuration: ${issues}`)
  }
  const e = parsed.data

  const oidcParts = [e.STACKY_OIDC_ISSUER, e.STACKY_OIDC_CLIENT_ID, e.STACKY_OIDC_CLIENT_SECRET]
  if (oidcParts.some(Boolean) && !oidcParts.every(Boolean)) {
    throw new ConfigError(
      'STACKY_OIDC_ISSUER, STACKY_OIDC_CLIENT_ID and STACKY_OIDC_CLIENT_SECRET must be set together',
    )
  }

  if (Boolean(e.STACKY_ADMIN_USER) !== Boolean(e.STACKY_ADMIN_PASSWORD)) {
    throw new ConfigError('STACKY_ADMIN_USER and STACKY_ADMIN_PASSWORD must be set together')
  }

  return {
    port: e.STACKY_PORT,
    hostname: e.STACKY_HOSTNAME,
    stacksDir: path.resolve(e.STACKY_STACKS_DIR),
    dataDir: path.resolve(e.STACKY_DATA_DIR),
    webDir: e.STACKY_WEB_DIR ? path.resolve(e.STACKY_WEB_DIR) : undefined,
    baseUrl: e.STACKY_BASE_URL,
    authDisabled: e.STACKY_AUTH_DISABLED,
    trustedProxies: (e.STACKY_TRUSTED_PROXIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    admin:
      e.STACKY_ADMIN_USER && e.STACKY_ADMIN_PASSWORD
        ? { username: e.STACKY_ADMIN_USER, password: e.STACKY_ADMIN_PASSWORD }
        : undefined,
    containerId: e.STACKY_CONTAINER_ID,
    updateCheck: !['0', 'false', 'no', 'off'].includes((e.STACKY_UPDATE_CHECK ?? '').toLowerCase()),
    updateIntervalHours: e.STACKY_UPDATE_INTERVAL,
    logLevel: e.STACKY_LOG_LEVEL,
    iconCdn: e.STACKY_ICON_CDN || undefined,
    oidc: e.STACKY_OIDC_ISSUER
      ? {
          issuer: e.STACKY_OIDC_ISSUER.replace(/\/+$/, ''),
          clientId: e.STACKY_OIDC_CLIENT_ID!,
          clientSecret: e.STACKY_OIDC_CLIENT_SECRET!,
          name: e.STACKY_OIDC_NAME,
          scopes: e.STACKY_OIDC_SCOPES.split(/[\s,]+/).filter(Boolean),
          allowedGroups: (e.STACKY_OIDC_ALLOWED_GROUPS ?? '')
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          autoRedirect: e.STACKY_OIDC_AUTO_REDIRECT,
        }
      : undefined,
  }
}
