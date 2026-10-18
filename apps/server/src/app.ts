import { Hono } from 'hono'
import type { Config } from './config'
import { VERSION } from './version'

export interface AppDeps {
  config: Config
}

export function createApp({ config: _config }: AppDeps) {
  const app = new Hono()

  app.get('/healthz', (c) => c.json({ status: 'ok', version: VERSION }))

  return app
}

export type App = ReturnType<typeof createApp>
