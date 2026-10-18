import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = createApp({ config })

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.hostname }, (info) => {
  console.log(`stacky listening on http://${info.address}:${info.port}`)
})

function shutdown(signal: string) {
  console.log(`received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
