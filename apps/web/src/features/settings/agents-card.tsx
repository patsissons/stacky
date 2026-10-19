import { Bot, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSession } from '@/hooks/use-session'

export const mcpUrl = (origin = window.location.origin) => `${origin}/api/mcp`

/** `claude mcp add` for this instance; without a token when auth is disabled. */
export function claudeMcpCommand(token?: string, url = mcpUrl()) {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : ''
  return `claude mcp add --transport http stacky ${url}${header}`
}

/** A line of code with a copy button. */
export function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="bg-muted flex items-start gap-2 rounded-md p-2 pl-3">
      <code className="min-w-0 flex-1 py-1 font-mono text-xs break-all" aria-label={label}>
        {value}
      </code>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

/** How to point an AI agent (MCP) or another app (REST + OpenAPI) at this instance. */
export function AgentsCard() {
  const { data: session } = useSession()
  const needsToken = !session?.authDisabled
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5" /> AI agents and integrations
        </CardTitle>
        <CardDescription>
          Agents such as Claude Code, Claude Desktop or Cursor can manage stacks through
          stacky&apos;s MCP server.
          {needsToken && ' Create an API token above and send it as a bearer token.'}{' '}
          <a
            className="underline underline-offset-2"
            href="https://stacky.lgtm.page/guides/agents/"
            target="_blank"
            rel="noreferrer"
          >
            Setup guide
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs">MCP server (Streamable HTTP)</div>
          <CopyLine value={mcpUrl()} label="MCP server URL" />
        </div>
        <div className="space-y-1">
          <div className="text-muted-foreground text-xs">Claude Code</div>
          <CopyLine
            value={claudeMcpCommand(needsToken ? 'stk_…' : undefined)}
            label="Claude Code command"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Other apps can use the REST API, described by the{' '}
          <a
            className="underline underline-offset-2"
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI document
          </a>
          .
        </p>
      </CardContent>
    </Card>
  )
}
