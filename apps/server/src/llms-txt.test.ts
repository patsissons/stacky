import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8')
const links = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(([, url]) => new URL(url!))

describe('repository llms.txt', () => {
  it('follows the llms.txt layout', () => {
    expect(llms).toMatch(/^# stacky\n\n> /)
    expect(llms).toContain('\n## Optional\n')
  })

  it('links only to docs pages that exist', () => {
    const docs = links.filter((u) => u.host === 'stacky.lgtm.page' && !u.pathname.endsWith('.txt'))
    expect(docs.length).toBeGreaterThan(5)
    for (const url of docs) {
      const base = path.join(root, 'apps/site/src/content/docs', url.pathname.replace(/\/$/, ''))
      expect(
        ['.md', '.mdx'].some((ext) => fs.existsSync(base + ext)),
        url.href,
      ).toBe(true)
    }
  })

  it('links only to repository paths that exist', () => {
    const repo = links.filter((u) => u.pathname.startsWith('/patsissons/stacky/'))
    expect(repo.length).toBeGreaterThan(3)
    for (const url of repo) {
      const rel = url.pathname.replace(/^\/patsissons\/stacky\/(blob|tree)\/main\/?/, '')
      expect(fs.existsSync(path.join(root, rel)), url.href).toBe(true)
    }
  })
})
