import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UpdatePlan } from '@/features/containers/rows'
import { UpdateAllDialog } from './update-all-dialog'

const noop = () => {}

describe('UpdateAllDialog', () => {
  it('leaves the stack name out of the rows when focused on one stack', () => {
    const plan: UpdatePlan = {
      steps: [{ stack: 'ollama', service: 'server', kind: 'bump', tag: '1.0', newerTag: '1.1' }],
      skipped: [{ stack: 'ollama', service: 'webui', reason: 'image comes from a variable' }],
    }
    render(<UpdateAllDialog plan={plan} mode="deploy" stack="ollama" onClose={noop} />)

    expect(screen.getByRole('dialog', { name: 'Update ollama' })).toBeInTheDocument()
    const row = within(screen.getByRole('list', { name: 'Updates to apply' })).getByRole('listitem')
    expect(row).toHaveTextContent('server')
    expect(row).not.toHaveTextContent('ollama')
    expect(screen.getByText('webui: image comes from a variable')).toBeInTheDocument()
  })

  it('names the stack in the rows when the plan covers every stack', () => {
    const plan: UpdatePlan = {
      steps: [
        { stack: 'ollama', service: 'server', kind: 'bump', tag: '1.0', newerTag: '1.1' },
        { stack: 'media', service: 'plex', kind: 'pull', tag: 'latest' },
      ],
      skipped: [{ stack: 'ollama', service: 'webui', reason: 'image comes from a variable' }],
    }
    render(<UpdateAllDialog plan={plan} mode="deploy" onClose={noop} />)

    expect(screen.getByRole('dialog', { name: 'Update all containers' })).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Updates to apply' })).getAllByRole(
      'listitem',
    )
    expect(rows[0]).toHaveTextContent('ollama / server')
    expect(rows[1]).toHaveTextContent('media / plex')
    expect(screen.getByText('ollama / webui: image comes from a variable')).toBeInTheDocument()
  })
})
