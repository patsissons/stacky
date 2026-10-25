import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

describe('loadConfig', () => {
  it('applies Dockge-compatible defaults', () => {
    const config = loadConfig({})
    expect(config.port).toBe(5005)
    expect(config.stacksDir).toBe('/opt/stacks')
    expect(config.dataDir).toBe('/app/data')
    expect(config.authDisabled).toBe(false)
    expect(config.admin).toBeUndefined()
  })

  it('parses booleans and lists', () => {
    const config = loadConfig({
      STACKY_AUTH_DISABLED: 'TRUE',
      STACKY_TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.1',
    })
    expect(config.authDisabled).toBe(true)
    expect(config.trustedProxies).toEqual(['10.0.0.0/8', '192.168.1.1'])
  })

  it('requires admin user and password together', () => {
    expect(() => loadConfig({ STACKY_ADMIN_USER: 'admin' })).toThrow(ConfigError)
  })

  it('reads the display name for notifications, separate from the bind address', () => {
    const config = loadConfig({ STACKY_DISPLAY_NAME: ' nas ', STACKY_HOSTNAME: '0.0.0.0' })
    expect(config.displayName).toBe('nas')
    expect(config.hostname).toBe('0.0.0.0')
    expect(loadConfig({ STACKY_DISPLAY_NAME: '  ' }).displayName).toBeUndefined()
    expect(loadConfig({}).displayName).toBeUndefined()
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ STACKY_PORT: 'nope' })).toThrow(ConfigError)
  })
})

describe('update schedule', () => {
  it('prefers STACKY_UPDATE_SCHEDULE over the legacy interval', () => {
    expect(loadConfig({}).updateSchedule).toBe('6h')
    expect(loadConfig({ STACKY_UPDATE_INTERVAL: '12' }).updateSchedule).toBe('12h')
    expect(loadConfig({ STACKY_UPDATE_INTERVAL: '0' }).updateSchedule).toBe('never')
    expect(
      loadConfig({ STACKY_UPDATE_SCHEDULE: 'nightly', STACKY_UPDATE_INTERVAL: '12' })
        .updateSchedule,
    ).toBe('nightly')
  })

  it('rejects an invalid schedule', () => {
    expect(() => loadConfig({ STACKY_UPDATE_SCHEDULE: 'sometimes' })).toThrow(ConfigError)
  })
})

describe('STACKY_DOCKER_HOST', () => {
  it('defaults to the host stacky is served from', () => {
    expect(loadConfig({}).dockerHost).toBeUndefined()
    expect(loadConfig({ STACKY_DOCKER_HOST: '  ' }).dockerHost).toBeUndefined()
  })

  it('accepts a hostname or IP address', () => {
    expect(loadConfig({ STACKY_DOCKER_HOST: ' op.teambison.io ' }).dockerHost).toBe(
      'op.teambison.io',
    )
    expect(loadConfig({ STACKY_DOCKER_HOST: '192.168.1.10' }).dockerHost).toBe('192.168.1.10')
  })

  it('brackets IPv6 addresses for use in URLs', () => {
    expect(loadConfig({ STACKY_DOCKER_HOST: 'fd00::10' }).dockerHost).toBe('[fd00::10]')
    expect(loadConfig({ STACKY_DOCKER_HOST: '[fd00::10]' }).dockerHost).toBe('[fd00::10]')
  })

  it('rejects URLs and socket addresses', () => {
    expect(() => loadConfig({ STACKY_DOCKER_HOST: 'tcp://docker:2375' })).toThrow(ConfigError)
    expect(() => loadConfig({ STACKY_DOCKER_HOST: 'https://op.teambison.io/' })).toThrow(
      ConfigError,
    )
  })
})

describe('OIDC config', () => {
  it('parses provider settings', () => {
    const config = loadConfig({
      STACKY_OIDC_ISSUER: 'https://auth.example.com/application/o/stacky/',
      STACKY_OIDC_CLIENT_ID: 'id',
      STACKY_OIDC_CLIENT_SECRET: 'secret',
      STACKY_OIDC_ALLOWED_GROUPS: 'admins, homelab',
      STACKY_OIDC_AUTO_REDIRECT: 'true',
    })
    expect(config.oidc).toEqual({
      issuer: 'https://auth.example.com/application/o/stacky',
      clientId: 'id',
      clientSecret: 'secret',
      name: 'SSO',
      scopes: ['openid', 'profile', 'email'],
      allowedGroups: ['admins', 'homelab'],
      autoRedirect: true,
    })
    expect(loadConfig({}).oidc).toBeUndefined()
  })

  it('requires the issuer, client id and secret together', () => {
    expect(() => loadConfig({ STACKY_OIDC_ISSUER: 'https://auth.example.com' })).toThrow(
      ConfigError,
    )
  })
})
