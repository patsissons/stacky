import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  site: 'https://stacky.lgtm.page',
  integrations: [
    starlight({
      title: 'stacky',
      description: 'A modern, compose-first Docker stack manager for your home lab.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/patsissons/stacky' }],
      editLink: { baseUrl: 'https://github.com/patsissons/stacky/edit/main/apps/site/' },
      lastUpdated: true,
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'How it works', items: [{ autogenerate: { directory: 'how-it-works' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
})
