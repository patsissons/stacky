import type { MiddlewareHandler } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import type { Runtime } from '../runtime'

/** `/ws`: same-origin check, session check, then hand the socket to the hub. */
export function websocketRoute(runtime: Runtime, upgradeWebSocket: UpgradeWebSocket) {
  const guard: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header('origin')
    if (origin) {
      const allowed = new Set<string>()
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host')
      if (host) allowed.add(host)
      if (runtime.config.baseUrl) allowed.add(new URL(runtime.config.baseUrl).host)
      if (!allowed.has(new URL(origin).host)) return c.text('forbidden origin', 403)
    }
    if (!runtime.config.authDisabled && runtime.auth) {
      const user = await runtime.auth.session(c.req.raw.headers)
      if (!user) return c.text('unauthenticated', 401)
    }
    return next()
  }

  const handler = upgradeWebSocket(() => {
    let connection: ReturnType<typeof runtime.hub.connect> | undefined
    return {
      onOpen(_evt, ws) {
        connection = runtime.hub.connect({
          send: (message) => {
            if (ws.readyState === 1) ws.send(JSON.stringify(message))
          },
        })
      },
      onMessage(evt) {
        if (typeof evt.data === 'string') connection?.receive(evt.data)
      },
      onClose() {
        connection?.close()
      },
      onError() {
        connection?.close()
      },
    }
  })

  return [guard, handler] as const
}
