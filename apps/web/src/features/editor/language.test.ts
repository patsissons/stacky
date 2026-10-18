import { describe, expect, it } from 'vitest'
import { hasSecrets, languageFor, maskEnv } from './language'

describe('languageFor', () => {
  it('maps common stack files', () => {
    expect(languageFor('compose.yaml')).toBe('yaml')
    expect(languageFor('.env')).toBe('ini')
    expect(languageFor('config/app.env')).toBe('ini')
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('scripts/init.sh')).toBe('shell')
    expect(languageFor('README')).toBe('plaintext')
  })
})

describe('maskEnv', () => {
  it('masks secret-looking values only', () => {
    const text =
      'TZ=UTC\nDB_PASSWORD=hunter2\nexport API_TOKEN = abc123\n# SECRET=commented\nEMPTY_KEY='
    expect(maskEnv(text)).toBe(
      'TZ=UTC\nDB_PASSWORD=••••••••\nexport API_TOKEN = ••••••••\n# SECRET=commented\nEMPTY_KEY=',
    )
    expect(hasSecrets(text)).toBe(true)
    expect(hasSecrets('TZ=UTC')).toBe(false)
  })
})
