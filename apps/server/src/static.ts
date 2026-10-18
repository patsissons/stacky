import fs from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

/**
 * Serves the built web UI from `webDir`, falling back to index.html for
 * client-side routes. API and websocket paths are never shadowed.
 */
export function mountWebUi(app: Hono, webDir: string) {
  const indexPath = path.join(webDir, 'index.html')
  const assets = serveStatic({ root: webDir })

  app.use('/*', async (c, next) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/ws') || p === '/healthz') {
      return next()
    }
    return assets(c, next)
  })

  app.get('*', (c, next) => {
    const p = c.req.path
    if (p.startsWith('/api/') || p.startsWith('/ws') || !fs.existsSync(indexPath)) {
      return next()
    }
    return c.html(fs.readFileSync(indexPath, 'utf8'))
  })
}
