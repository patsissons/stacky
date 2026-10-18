import { Hono } from 'hono'
import type { Config } from './config'
import { mountWebUi } from './static'
import { VERSION } from './version'

export interface AppDeps {
  config: Config
}

export function createApp({ config }: AppDeps) {
  const app = new Hono()

  app.get('/healthz', (c) => c.json({ status: 'ok', version: VERSION }))

  if (config.webDir) mountWebUi(app, config.webDir)

  return app
}

export type App = ReturnType<typeof createApp>
