import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnsiText, logLevel } from './ansi'
import { stripAnsi } from './strip-ansi'

describe('AnsiText', () => {
  it('renders coloured segments as text, never HTML', () => {
    const { container } = render(<AnsiText text={'\x1b[31m<b>red</b>\x1b[0m plain'} />)
    expect(container.textContent).toBe('<b>red</b> plain')
    expect(container.querySelector('b')).toBeNull()
    expect((container.firstChild as HTMLElement).style.color).toMatch(/rgb/)
  })

  it('highlights search matches case-insensitively', () => {
    render(<AnsiText text="Connected to Postgres" highlight="postgres" />)
    expect(screen.getByText('Postgres').tagName).toBe('MARK')
  })
})

describe('logLevel / stripAnsi', () => {
  it('detects levels and strips escapes', () => {
    expect(logLevel('level=error msg=boom')).toBe('error')
    expect(logLevel('WARN disk almost full')).toBe('warn')
    expect(logLevel('all good')).toBeUndefined()
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold')
  })
})
