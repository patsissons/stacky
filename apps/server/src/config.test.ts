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

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ STACKY_PORT: 'nope' })).toThrow(ConfigError)
  })
})
