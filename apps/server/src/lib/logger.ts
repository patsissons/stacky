type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

/** Minimal structured logger: one line per entry, JSON fields appended. */
export function createLogger(level: Level = 'info', write = (line: string) => console.log(line)) {
  const log = (l: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[l] < ORDER[level]) return
    const extra = fields && Object.keys(fields).length > 0 ? ' ' + JSON.stringify(fields) : ''
    write(`${new Date().toISOString()} ${l.toUpperCase().padEnd(5)} ${msg}${extra}`)
  }
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  } satisfies Logger
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
