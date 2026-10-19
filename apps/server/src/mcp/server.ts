import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { ApiContext } from '../api/routes'
import { VERSION } from '../version'
import { registerTools } from './tools'

const INSTRUCTIONS = `stacky manages Docker Compose stacks on one Docker host. Each stack is a directory holding compose.yaml (plus an optional .env); the files on disk are the source of truth.

- Start with list_stacks. Stacks with managed=false are compose projects outside the stacks directory: you can inspect them but not change them.
- Changes run as operations, one at a time per stack. Action tools wait up to waitSeconds and return the operation with the tail of its output; when done is false, call get_operation with its id to keep waiting.
- A failed operation has an error with a code, message and hint (e.g. port_in_use names the container holding the port). Use get_logs to look at the containers.
- To change a stack, read it with get_stack, edit the compose text, then update_stack_files with deploy=true. Invalid files are rejected with line numbers and nothing is written.
- The stack with isSelf=true runs stacky itself; deploying, restarting or updating it restarts this server.
- delete_stack and stack_action down (with removeVolumes) remove things for good; confirm with the user first.`

/** A fresh MCP server bound to the caller; stateless, so one per request. */
export function createMcpServer(ctx: ApiContext, actor: string) {
  const server = new McpServer(
    { name: 'stacky', title: 'stacky', version: VERSION },
    { instructions: INSTRUCTIONS },
  )
  registerTools(server, { ctx, actor })
  return server
}

/**
 * Streamable HTTP endpoint in stateless JSON mode: every POST carries complete
 * JSON-RPC messages and gets a JSON response, so no session or stream is kept.
 */
export async function handleMcpRequest(
  ctx: ApiContext,
  actor: string,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed: this server is stateless, POST only' },
        id: null,
      },
      { status: 405, headers: { allow: 'POST' } },
    )
  }
  const server = createMcpServer(ctx, actor)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    void server.close()
  }
}
