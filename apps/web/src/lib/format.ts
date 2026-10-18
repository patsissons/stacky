export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatRelative(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/** Splits an image reference into registry, repository and tag for display. */
export function parseImageRef(ref: string): { registry: string; repository: string; tag: string } {
  let rest = ref
  let tag = 'latest'
  const at = rest.indexOf('@')
  if (at >= 0) {
    tag = rest.slice(at + 1, at + 20)
    rest = rest.slice(0, at)
  } else {
    const colon = rest.lastIndexOf(':')
    if (colon > rest.lastIndexOf('/')) {
      tag = rest.slice(colon + 1)
      rest = rest.slice(0, colon)
    }
  }
  const first = rest.split('/')[0] ?? ''
  const hasRegistry =
    rest.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')
  const registry = hasRegistry ? first : 'docker.io'
  let repository = hasRegistry ? rest.slice(first.length + 1) : rest
  if (registry === 'docker.io' && !repository.includes('/')) repository = `library/${repository}`
  return { registry, repository, tag }
}
