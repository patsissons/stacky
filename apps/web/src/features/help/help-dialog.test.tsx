import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { HelpDialog, helpStore } from './help-dialog'

afterEach(() => act(() => helpStore.close()))

describe('HelpDialog', () => {
  it('opens on the operations tab by default', () => {
    render(<HelpDialog />)
    act(() => helpStore.open())
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Operations' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('More → Down')).toBeInTheDocument()
  })

  it('opens straight on the labels and environment tab', () => {
    render(<HelpDialog />)
    act(() => helpStore.open('reference'))
    expect(screen.getByRole('tab', { name: 'Labels & environment' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('stacky.update.schedule')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Configuration/ })).toHaveAttribute(
      'href',
      'https://stacky.lgtm.page/reference/configuration/',
    )
  })

  it('switches tabs and filters the reference', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)
    act(() => helpStore.open())
    await user.click(screen.getByRole('tab', { name: 'Labels & environment' }))
    expect(screen.getByText('STACKY_PORT')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter labels and variables'), 'notify')
    expect(screen.getByText('stacky.notify')).toBeInTheDocument()
    expect(screen.queryByText('STACKY_PORT')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Filter labels and variables'))
    await user.type(screen.getByLabelText('Filter labels and variables'), 'zzz-nothing')
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument()
  })
})
