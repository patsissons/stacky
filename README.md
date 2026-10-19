# stacky

A modern, compose-first Docker stack manager for your home lab: a better-looking, easier-to-use, more robust take on [Dockge](https://github.com/louislam/dockge).

- **Compose files are the source of truth.** Each stack is a plain directory (`/opt/stacks/<name>/compose.yaml` plus an optional `.env`). Stacky reads Dockge's layout as-is, so migrating means pointing it at the same directory.
- **Modern UI.** Covers stacks, a cross-stack containers table, logs, container shells and a real editor with schema completion and a diff before every deploy. Click any container to inspect or edit just its service.
- **Clear errors.** Failed operations explain what went wrong and how to fix it.
- **Image updates.** Native registry digest checks, plus an optional [What's Up Docker](https://github.com/getwud/wud) integration. Apply updates per service, per stack (including pinned versions), or all at once.
- **File browser.** A read-only view of the stacks directory and stacky's data directory, with a text viewer and an image viewer.
- **App icons.** Matched by image name from the selfh.st set, or picked with a `stacky.display.icon` label: any of What's Up Docker's icon sets, or an image URL.
- **Self-update.** Stacky can update its own stack from inside the UI, with automatic rollback.

Docs: **https://stacky.lgtm.page**

## Install

```sh
curl -fsSL https://stacky.lgtm.page/install.sh | sh
```

Or do it by hand: create `/opt/stacks/stacky/compose.yaml` (see [`docker/compose.example.yaml`](docker/compose.example.yaml)):

```yaml
services:
  stacky:
    image: ghcr.io/patsissons/stacky:latest # or docker.io/patsissons/stacky
    restart: unless-stopped
    ports:
      - 5005:5005
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      - /opt/stacks:/opt/stacks # host path MUST equal container path
```

```sh
cd /opt/stacks/stacky && docker compose up -d
```

Open `http://<host>:5005` and create the admin account. From then on, stacky appears as a stack inside itself and can update itself.

### Configuration

| Variable                                      | Default       | Description                                                            |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `STACKY_PORT`                                 | `5005`        | HTTP port                                                              |
| `STACKY_STACKS_DIR`                           | `/opt/stacks` | Directory containing one sub-directory per stack                       |
| `STACKY_DATA_DIR`                             | `/app/data`   | Stacky's database and state                                            |
| `STACKY_AUTH_DISABLED`                        | `false`       | Disable built-in auth (only behind an authenticating reverse proxy)    |
| `STACKY_TRUSTED_PROXIES`                      | (none)        | Comma-separated proxy addresses/CIDRs whose `X-Forwarded-*` is trusted |
| `STACKY_ADMIN_USER` / `STACKY_ADMIN_PASSWORD` | (none)        | Seed the admin account instead of using the setup page                 |
| `STACKY_UPDATE_CHECK`                         | `true`        | Check GitHub for newer stacky releases                                 |
| `STACKY_UPDATE_INTERVAL`                      | `6`           | Hours between image update checks (`0` = only on demand)               |
| `STACKY_BASE_URL`                             | (none)        | Public URL, used for links and OIDC callbacks                          |

## Integrations

- **REST API.** Scripts and other apps can drive stacky with an API token (**Settings → API tokens**): `curl -H "Authorization: Bearer stk_…" http://<host>:5005/api/stacks`. Each instance serves an OpenAPI 3.1 document at `/api/openapi.json`. See the [REST API reference](https://stacky.lgtm.page/reference/api/).
- **AI agents (MCP).** A built-in [MCP](https://modelcontextprotocol.io) server at `/api/mcp` lets Claude Code, Claude Desktop, Cursor and other agents inspect, edit, deploy and update stacks: `claude mcp add --transport http stacky http://<host>:5005/api/mcp --header "Authorization: Bearer stk_…"`. See [AI agents & MCP](https://stacky.lgtm.page/guides/agents/).

## Development

Requirements: Node 24+, pnpm (version pinned in `package.json`), and Docker (OrbStack, Docker Desktop or a local engine).

```sh
pnpm install
pnpm dev        # server on :5005 (tsx watch) + web on :5173 (Vite, proxies /api and /ws)
```

In development the server uses `STACKY_STACKS_DIR` and `STACKY_DATA_DIR` from your environment. Point them at a scratch directory, e.g. `STACKY_STACKS_DIR=$PWD/.dev/stacks STACKY_DATA_DIR=$PWD/.dev/data pnpm dev`.

### Scripts

| Script                       | What it does                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                   | Run server and web UI in watch mode                                       |
| `pnpm build`                 | Build shared, web and server packages                                     |
| `pnpm test`                  | Unit tests (Vitest) across all packages                                   |
| `pnpm test:e2e`              | Playwright e2e tests against a production build                           |
| `pnpm validate:quick`        | Format check + typecheck + lint + unit tests                              |
| `pnpm validate`              | `validate:quick` + e2e tests (used by CI)                                 |
| `pnpm format-and-validate`   | Format with Prettier, then `validate`; run this before every commit       |
| `scripts/self-update-e2e.sh` | End-to-end test of stacky updating and rolling back itself (needs Docker) |
| `pnpm site:dev`              | Run the docs site locally                                                 |

### Repository layout

```
apps/server     Hono API + WebSocket server
apps/web        React UI
apps/site       Docs site (Astro Starlight), deployed to stacky.lgtm.page
packages/shared Shared zod schemas and types
docker/         Dockerfile and example compose file
```

## Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Every push to `main` runs CI and publishes `ghcr.io/patsissons/stacky:edge` (plus Docker Hub when credentials are configured). [release-please](https://github.com/googleapis/release-please) maintains a release PR; merging it tags a release and publishes `X.Y.Z`, `X.Y`, `X` (from 1.0 on) and `latest` for `linux/amd64` and `linux/arm64`.

## License

MIT
