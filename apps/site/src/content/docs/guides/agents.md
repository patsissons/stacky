---
title: AI agents & MCP
description: Point Claude Code, Claude Desktop, Cursor and other AI agents at stacky with its built-in MCP server.
sidebar:
  order: 7
---

Stacky has a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. Connect an AI agent to it and the agent can inspect your stacks, read logs, edit compose files, deploy and update, all through the same checks the UI uses. Invalid compose files are rejected before they reach disk, every change runs as a regular [operation](/reference/api/#operations), and every change shows up in the activity log.

## Connect an agent

1. Create an API token under **Settings → API tokens** (see [API tokens](/guides/authentication/#api-tokens)). Name it after the agent, e.g. `claude`, so the activity log shows who did what. When `STACKY_AUTH_DISABLED` is set, skip this step and leave out the header below.
2. Point your agent at **`https://<your-stacky>/api/mcp`** with the header `Authorization: Bearer stk_…`.

**Settings → AI agents and integrations** shows the exact URL for your instance. Right after you create a token, the token dialog shows the Claude Code command with that token filled in.

### Claude Code

```sh
claude mcp add --transport http stacky https://stacky.example.com/api/mcp \
  --header "Authorization: Bearer stk_…"
```

### Claude Desktop, Cursor and other clients

Clients that support remote (Streamable HTTP) servers take a URL and headers:

```json
{
  "mcpServers": {
    "stacky": {
      "type": "http",
      "url": "https://stacky.example.com/api/mcp",
      "headers": { "Authorization": "Bearer stk_…" }
    }
  }
}
```

Clients that only run local (stdio) servers can bridge with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "stacky": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://stacky.example.com/api/mcp",
        "--header",
        "Authorization: Bearer ${STACKY_TOKEN}"
      ],
      "env": { "STACKY_TOKEN": "stk_…" }
    }
  }
}
```

The server is stateless: every request is a self-contained JSON-RPC `POST`, so it works behind any reverse proxy without sticky sessions or long-lived streams.

## Tools

Read-only tools are marked as such, so clients can run them without asking you each time. Tools that change things are marked as changes, and the ones that can remove things are marked as destructive.

| Tool                  | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `list_stacks`         | Every stack with its status, services and containers                                               |
| `get_stack`           | One stack in full, plus its `compose.yaml` and `.env` text                                         |
| `list_containers`     | Containers across all stacks (or one), with state, image and ports                                 |
| `get_logs`            | Recent log lines of a stack or one service                                                         |
| `list_operations`     | Recent operations, newest first                                                                    |
| `get_operation`       | An operation with the tail of its output; can wait for it to finish                                |
| `list_image_updates`  | Images with a newer tag or digest, from the last [update check](/guides/image-updates/)            |
| `get_system_info`     | Stacky, Docker and compose versions, and preflight checks                                          |
| `validate_compose`    | Checks compose text with `docker compose config` without saving it                                 |
| `create_stack`        | Creates a stack from compose text (validated), optionally deploying it                             |
| `update_stack_files`  | Replaces `compose.yaml` and/or `.env` (validated), optionally deploying                            |
| `stack_action`        | `deploy`, `start`, `stop`, `restart`, `down`, `pull`, `update`, `pull-updates` or `deploy-updates` |
| `service_action`      | `start`, `stop`, `restart`, `recreate`, `pull` or `update` one service                             |
| `bump_image`          | Moves one service to another image tag (edits only its `image:` line), then pulls and recreates it |
| `delete_stack`        | Stops a stack and deletes its directory (destructive)                                              |
| `cancel_operation`    | Cancels a queued or running operation                                                              |
| `check_image_updates` | Starts an image update check in the background                                                     |

Action tools wait for their operation (60 seconds by default, `waitSeconds` up to 600) and return the result with the end of its output. A failed operation includes the same error code, message and hint the UI shows, e.g. which container already holds a port. If an operation is still running when the wait ends, the agent can keep waiting with `get_operation`.

Stacky's own settings, git sync, container shells and API tokens are not exposed over MCP.

### Editing files and moving to a new version

- `get_stack` returns `compose.yaml` and `.env` exactly as they are on disk, secrets included. Some agent clients mask secrets in tool output (e.g. `ghp_xe...5BzQ`). If an agent sends that masked text back, `update_stack_files` rejects it with `redacted_secret` and names the lines, so the mask never replaces the real value. Nothing is written in that case.
- `update` (in `stack_action` or `service_action`) pulls the tags the compose file already pins. For a pinned version like `nginx:1.27.3` that changes nothing, so when the [update check](/guides/image-updates/) knows a newer tag, the result carries a `hint` pointing at `bump_image`.
- `bump_image` moves a service to another tag (e.g. `newerTag` from `list_image_updates`) by editing only its `image:` line, then pulls and recreates it. On the stack that runs stacky itself, it runs the [self-update](/guides/self-update/) to that version, with the same rollback if the new version doesn't come up healthy.

## What gets recorded

Each tool call that changes something is written to **Settings → Activity log** as `MCP /api/mcp/<tool>/<stack>`, credited to the token (`token:claude`), with the result status. Read-only calls are not logged.

## Safety

An API token can do everything the admin can (except manage tokens), and that includes deleting stacks. Some tips:

- Use a separate token per agent, and revoke it when you no longer use the agent.
- Let your client ask before running tools marked destructive (`stack_action`, `bump_image`, `delete_stack`).
- Acting on the stack that runs stacky itself restarts stacky, just like in the UI. The connection drops until stacky is back.

## llms.txt

For agents that should learn about stacky itself, the docs are published in the [llms.txt](https://llmstxt.org) format:

- [`/llms.txt`](https://stacky.lgtm.page/llms.txt): an index of the documentation
- [`/llms-full.txt`](https://stacky.lgtm.page/llms-full.txt): the complete docs as one file
- [`/llms-small.txt`](https://stacky.lgtm.page/llms-small.txt): a condensed version for small context windows

The GitHub repository has its own [`llms.txt`](https://github.com/patsissons/stacky/blob/main/llms.txt) describing the source layout.
