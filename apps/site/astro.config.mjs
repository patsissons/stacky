import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'

const site = 'https://stacky.lgtm.page'
const ogImage = (property, content) => ({ tag: 'meta', attrs: { property, content } })

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'stacky',
      description: 'A modern, compose-first Docker stack manager for your home lab.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      // regenerate with `pnpm site:og-image`
      head: [
        ogImage('og:image', `${site}/og.png`),
        ogImage('og:image:width', '1200'),
        ogImage('og:image:height', '630'),
        ogImage('og:image:alt', 'stacky, a compose-first Docker stack manager'),
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/patsissons/stacky' }],
      editLink: { baseUrl: 'https://github.com/patsissons/stacky/edit/main/apps/site/' },
      lastUpdated: true,
      plugins: [
        starlightLinksValidator(),
        // /llms.txt, /llms-full.txt and /llms-small.txt, generated from these docs
        starlightLlmsTxt({
          projectName: 'stacky',
          description:
            'stacky is a self-hosted, compose-first Docker stack manager for home labs: a web UI over plain `compose.yaml` directories (Dockge-compatible), with image update checks, self-update, a REST API and a built-in MCP server for AI agents.',
          details: [
            '- Each stack is a directory `<stacks dir>/<name>/` with `compose.yaml` and an optional `.env`; the files on disk are the source of truth.',
            '- Automate it with the REST API (`/api`, OpenAPI document at `/api/openapi.json`) or connect an AI agent to the MCP server at `/api/mcp`; both use API tokens (`Authorization: Bearer stk_…`).',
            '- Source code: https://github.com/patsissons/stacky',
          ].join('\n'),
          promote: ['index', 'getting-started/**', 'guides/using-stacky'],
          optionalLinks: [
            {
              label: 'Source code and changelog',
              url: 'https://github.com/patsissons/stacky',
              description: 'The pnpm monorepo: server, web UI, docs and Docker image',
            },
          ],
        }),
      ],
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'How it works', items: [{ autogenerate: { directory: 'how-it-works' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
})
