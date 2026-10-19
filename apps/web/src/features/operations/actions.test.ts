import { describe, expect, it } from 'vitest'
import { actionLabel, operationTense } from './actions'

describe('actionLabel', () => {
  it('conjugates the action for each tense', () => {
    expect(actionLabel('deploy', 'running')).toBe('Deploying')
    expect(actionLabel('deploy', 'done')).toBe('Deployed')
    expect(actionLabel('deploy', 'verb')).toBe('Deploy')
    expect(actionLabel('deploy-updates', 'verb')).toBe('Deploy updates')
  })

  it('keeps the boolean shorthands', () => {
    expect(actionLabel('restart', true)).toBe('Restarted')
    expect(actionLabel('restart', false)).toBe('Restarting')
  })

  it('passes through unknown actions and a service suffix', () => {
    expect(actionLabel('update web', 'done')).toBe('Updated web')
    expect(actionLabel('frobnicate', 'verb')).toBe('frobnicate')
  })
})

describe('operationTense', () => {
  it('reads "Deploy demo failed" rather than "Deployed demo failed"', () => {
    expect(actionLabel('deploy', operationTense('failed'))).toBe('Deploy')
    expect(actionLabel('deploy', operationTense('cancelled'))).toBe('Deploy')
    expect(actionLabel('deploy', operationTense('succeeded'))).toBe('Deployed')
    expect(actionLabel('deploy', operationTense('running'))).toBe('Deploying')
    expect(actionLabel('deploy', operationTense('queued'))).toBe('Deploying')
  })
})
