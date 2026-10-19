import type { StackSummary } from '@stacky/shared'
import { describe, expect, it } from 'vitest'
import { logTargets } from './log-targets'

const container = (id: string) =>
  ({ id, name: `app-${id}-1` }) as StackSummary['services'][number]['containers'][number]

describe('logTargets', () => {
  const stack = {
    services: [
      { name: 'web', containers: [container('web')] },
      { name: 'db', containers: [container('db')] },
    ],
  } as StackSummary

  it('covers every container of the stack', () => {
    expect(logTargets(stack)).toEqual([
      { id: 'web', name: 'app-web-1', service: 'web' },
      { id: 'db', name: 'app-db-1', service: 'db' },
    ])
  })

  it('narrows to one service', () => {
    expect(logTargets(stack, 'db').map((t) => t.id)).toEqual(['db'])
  })
})
