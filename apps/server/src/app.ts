import { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { apiRoutes, errorResponse } from './api/routes'
import type { Config } from './config'
import { createLogger } from './lib/logger'
import type { Runtime } from './runtime'
import { mountWebUi } from './static'
import { VERSION } from './version'
import { websocketRoute } from './ws/route'

export interface AppDeps {
  config: Config
  runtime?: Runtime
  upgradeWebSocket?: UpgradeWebSocket
}

export function createApp({ config, runtime, upgradeWebSocket }: AppDeps) {
  const app = new Hono()
  const logger = runtime?.logger ?? createLogger(config.logLevel)

  app.onError((err, c) => errorResponse(c, err, logger))

  app.get('/healthz', (c) => c.json({ status: 'ok', version: VERSION }))

  if (runtime) {
    app.route('/api', apiRoutes({ ...runtime, stacks: runtime.stacks }))
    if (upgradeWebSocket) app.get('/ws', ...websocketRoute(runtime, upgradeWebSocket))
  }

  if (config.webDir) mountWebUi(app, config.webDir)

  return app
}

export type App = ReturnType<typeof createApp>
