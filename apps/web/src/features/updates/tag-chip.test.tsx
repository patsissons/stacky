import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReleaseNotesLink, TagChip } from './tag-chip'

const href = 'https://github.com/nginx/nginx/releases/tag/release-1.26.3'

describe('TagChip', () => {
  it('links the tag to its release notes in a new tab', () => {
    render(<TagChip tag="1.26.3" href={href} className="font-mono" />)
    const link = screen.getByRole('link', { name: '1.26.3' })
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveAttribute('title', 'Release notes for 1.26.3')
  })

  it('shows the plain tag without a link', () => {
    render(<TagChip tag="latest" className="font-mono" />)
    expect(screen.getByText('latest')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('ReleaseNotesLink', () => {
  it('links the version in use to its release notes', () => {
    render(<ReleaseNotesLink tag="1.26.3" href={href} />)
    const link = screen.getByRole('link', { name: 'Release notes for 1.26.3' })
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders nothing without a link', () => {
    const { container } = render(<ReleaseNotesLink tag="1.26.3" />)
    expect(container).toBeEmptyDOMElement()
  })
})
