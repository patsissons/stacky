# Agent working rules

Stacky is a pnpm monorepo:

- `apps/server` — Hono API + WebSocket server (Node, TypeScript, bundled with esbuild)
- `apps/web` — React UI (Vite, Tailwind, shadcn/ui, TanStack Router/Query/Table)
- `apps/site` — docs/landing site (Astro Starlight) deployed to https://stacky.lgtm.page
- `packages/shared` — zod schemas and types shared by server and web
- `docker/` — the production image and an example compose file

## Before every commit

After making changes from a prompt and BEFORE committing:

1. **Author new tests** covering the changes being made (Vitest unit tests next to the code;
   Playwright e2e in `apps/web/e2e` for UI flows).
2. **Update documentation** affected by the changes: `README.md`, and the matching page(s) under
   `apps/site/src/content/docs/` (every user-visible feature or config change needs a docs update).
3. Run `pnpm format-and-validate` and repair any regressions in-line. This includes the Playwright
   e2e suite — never skip it.

## Conventions

- Vitest runs with globals off: import `describe`/`it`/`expect` from `vitest` explicitly.
- Compose files are the source of truth. Never re-serialize a whole compose file from a parsed
  model; save the user's raw text, and use the `yaml` Document API only for targeted edits.
- Every filesystem path derived from user input (stack names, file names) must pass
  `stacks/paths.ts` validation and containment checks before use.
- Commits use Conventional Commits (`feat:`, `fix:`, `chore:` …) — release-please derives
  versions and the changelog from them.
