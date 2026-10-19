import { describe, expect, it } from 'vitest'
import { claudeMcpCommand, mcpUrl } from './agents-card'

describe('MCP connection hints', () => {
  it('points at /api/mcp on the given origin', () => {
    expect(mcpUrl('https://stacky.example.com')).toBe('https://stacky.example.com/api/mcp')
  })

  it('builds a claude mcp add command, with the token when auth is on', () => {
    const url = 'https://stacky.example.com/api/mcp'
    expect(claudeMcpCommand('stk_abc', url)).toBe(
      'claude mcp add --transport http stacky https://stacky.example.com/api/mcp --header "Authorization: Bearer stk_abc"',
    )
    expect(claudeMcpCommand(undefined, url)).toBe(
      'claude mcp add --transport http stacky https://stacky.example.com/api/mcp',
    )
  })
})
