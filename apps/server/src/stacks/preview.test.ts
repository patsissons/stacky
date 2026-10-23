import { describe, expect, it } from 'vitest'
import { composeMismatch, parseDryRun } from './preview'

// captured from `docker compose --ansi never --progress plain --dry-run up -d --remove-orphans`
const UNCHANGED = ` Container app-a-1 Running \n Container app-b-1 Running \n`

const REMOVED = ` Container app-a-1 Running
 Container app-b-1 Stopping
 Container app-b-1 Stopped
 Container app-b-1 Removing
 Container app-b-1 Removed
`

const RECREATED = ` Container app-b-1 Running
 Container app-a-1 Recreate
 Container app-a-1 Recreated
 Container d329a9f3a800_app-a-1 Starting
 Container d329a9f3a800_app-a-1 Started
`

const ADDED = ` Container app-a-1 Running
 Container app-c-1 Creating
 Container app-c-1 Created
 Container app-c-1 Starting
 Container app-c-1 Started
`

describe('parseDryRun', () => {
  it('reports untouched containers as unchanged', () => {
    expect(parseDryRun(UNCHANGED)).toEqual([
      { name: 'app-a-1', action: 'unchanged' },
      { name: 'app-b-1', action: 'unchanged' },
    ])
  })

  it('reports a removed service once, whatever states it went through', () => {
    expect(parseDryRun(REMOVED)).toEqual([
      { name: 'app-a-1', action: 'unchanged' },
      { name: 'app-b-1', action: 'remove' },
    ])
  })

  it('folds the temporary <id>_<name> container into the recreated one', () => {
    expect(parseDryRun(RECREATED)).toEqual([
      { name: 'app-b-1', action: 'unchanged' },
      { name: 'app-a-1', action: 'recreate' },
    ])
  })

  it('reports new containers as created and stopped ones as started', () => {
    expect(parseDryRun(ADDED)).toContainEqual({ name: 'app-c-1', action: 'create' })
    expect(parseDryRun(' Container app-b-1 Starting \n Container app-b-1 Started \n')).toEqual([
      { name: 'app-b-1', action: 'start' },
    ])
  })

  it('ignores networks, ANSI codes, CRLF and the dry-run prefix', () => {
    const out =
      '\x1b[32m Network app_default Creating\x1b[0m\r\n DRY-RUN MODE -  Container app-a-1 Recreated\r\n'
    expect(parseDryRun(out)).toEqual([{ name: 'app-a-1', action: 'recreate' }])
  })
})

describe('composeMismatch', () => {
  it('lists the other versions that created containers', () => {
    expect(composeMismatch(['2.29.1', '2.29.1', '5.6.0', undefined], '5.6.0')).toEqual({
      deployedWith: ['2.29.1'],
      current: '5.6.0',
    })
  })

  it('is unset when every container matches, or the current version is unknown', () => {
    expect(composeMismatch(['5.6.0', 'v5.6.0', undefined], '5.6.0')).toBeUndefined()
    expect(composeMismatch(['2.29.1'], undefined)).toBeUndefined()
    expect(composeMismatch([], '5.6.0')).toBeUndefined()
  })
})
