import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { createApp } from './app'
import { loadConfig } from './config'
import { createRuntime } from './runtime'
import { VERSION } from './version'

const config = loadConfig()
const runtime = await createRuntime(config)

// node-ws needs the root app to register its upgrade handler.
const root = new Hono()
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app: root })
root.route('/', createApp({ config, runtime, upgradeWebSocket }))

const server = serve(
  { fetch: root.fetch, port: config.port, hostname: config.hostname },
  (info) => {
    runtime.logger.info(`stacky ${VERSION} listening on http://${info.address}:${info.port}`, {
      stacksDir: config.stacksDir,
      dataDir: config.dataDir,
    })
  },
)
injectWebSocket(server)

function shutdown(signal: string) {
  runtime.logger.info(`received ${signal}, shutting down`)
  runtime.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
