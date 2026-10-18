import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the product name', () => {
    render(<App fetchHealth={() => new Promise(() => {})} />)
    expect(screen.getByRole('heading', { name: 'stacky' })).toBeInTheDocument()
  })

  it('shows the server version once loaded', async () => {
    render(<App fetchHealth={async () => ({ version: '1.2.3' })} />)
    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    // a single heading proves the previous test's render was cleaned up
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })
})
