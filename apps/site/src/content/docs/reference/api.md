---
title: REST API
description: Drive stacky from scripts, dashboards and other apps with the token-authenticated REST API.
---

Everything the stacky UI does goes through a JSON API under `/api`. Scripts, Home Assistant automations, CI jobs and other apps can use the same API with an API token. AI agents can use the [MCP server](/guides/agents/) instead.

## Authentication

Create a token under **Settings → API tokens** (see [Sign-in and security](/guides/authentication/#api-tokens)) and send it as a bearer token:

```sh
export STACKY=https://stacky.example.com
export STACKY_TOKEN=stk_…
curl -H "Authorization: Bearer $STACKY_TOKEN" $STACKY/api/stacks
```

A token can do everything the admin can, except create or revoke tokens. Every change is recorded in the activity log as `token:<name>`. When `STACKY_AUTH_DISABLED` is set, no token is needed.

## OpenAPI document

Every instance serves an OpenAPI 3.1 description of the public API at **`/api/openapi.json`**. No token is needed to read it. Load it into Swagger UI, Postman or Insomnia, or use it to generate a client:

```sh
curl $STACKY/api/openapi.json
```

The document covers stacks, operations, logs, containers, image updates and system information. Endpoints used only by the UI (settings, sign-in, git sync and the file browser) are left out and may change between releases.

## Operations

Anything that runs `docker compose` is an **operation**. Action endpoints queue one and return `202 Accepted` with its summary right away:

```json
{
  "id": "op_…",
  "stack": "media",
  "action": "update",
  "state": "queued",
  "commands": ["…"],
  "createdAt": 1760000000000
}
```

An operation moves through `queued → running → succeeded | failed | cancelled`. Operations on the same stack run one at a time, in order. To wait for the result, long-poll the operation with `?wait=<seconds>` (up to 300). The request returns as soon as the operation finishes, together with its output:

```sh
op=$(curl -s -X POST -H "Authorization: Bearer $STACKY_TOKEN" \
  $STACKY/api/stacks/media/actions/update | jq -r .id)
curl -s -H "Authorization: Bearer $STACKY_TOKEN" "$STACKY/api/operations/$op?wait=120" | jq '{state, error}'
```

A failed operation includes an `error` with a `code`, a `message` and usually a `hint`, the same explanation the UI shows (see [Errors](/how-it-works/errors/)).

## Common recipes

| Task                                    | Request                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| List stacks with services and status    | `GET /api/stacks`                                                                     |
| Read a stack's compose file and `.env`  | `GET /api/stacks/{name}`                                                              |
| Create a stack                          | `POST /api/stacks` with `{ "name", "compose", "env"?, "deploy"? }`                    |
| Save edits without deploying            | `PUT /api/stacks/{name}` with `{ "compose"?, "env"? }`                                |
| Validate compose text                   | `POST /api/stacks/{name}/validate` with `{ "compose", "env"? }`                       |
| Preview what a deploy would change      | `POST /api/stacks/{name}/preview` with `{ "compose"?, "env"?, "options"? }`           |
| Deploy, start, stop, restart, update, … | `POST /api/stacks/{name}/actions/{action}`                                            |
| Deploy new compose text in one step     | `POST /api/stacks/{name}/actions/deploy` with `{ "compose" }` (validated, then saved) |
| Restart one service                     | `POST /api/stacks/{name}/services/{service}/restart`                                  |
| Recent logs                             | `GET /api/stacks/{name}/logs?service=web&tail=200`                                    |
| Wait for an operation                   | `GET /api/operations/{id}?wait=60`                                                    |
| Cancel an operation                     | `POST /api/operations/{id}/cancel`                                                    |
| All containers                          | `GET /api/containers`                                                                 |
| Image updates                           | `GET /api/updates`, `POST /api/updates/check`                                         |
| Apply all image updates of a stack      | `POST /api/stacks/{name}/actions/deploy-updates`                                      |

Stack actions are `deploy`, `start`, `stop`, `restart`, `down`, `pull`, `update`, `delete`, `pull-updates` and `deploy-updates`. Service actions are `start`, `stop`, `restart`, `recreate`, `pull` and `update`. Stack actions accept options such as `{ "options": { "pull": "always", "forceRecreate": true } }`; the OpenAPI document lists them all.

Logs are a one-shot read: `tail` lines per container (default 200, at most 5000), optionally only lines after `since` (epoch seconds), merged and sorted by time.

## Errors

Every non-2xx response has the same shape:

```json
{ "error": { "code": "port_in_use", "message": "…", "hint": "…" } }
```

| Status | Meaning                                                                               |
| ------ | ------------------------------------------------------------------------------------- |
| 400    | The request is malformed (bad JSON, unknown action or option, invalid stack name)     |
| 401    | Missing, invalid or revoked token                                                     |
| 404    | Unknown stack, service or operation                                                   |
| 409    | Conflict, e.g. acting on a stack that stacky doesn't manage, or cancelling a done op  |
| 422    | The compose file is invalid; `details.issues` has the line and column of each problem |
