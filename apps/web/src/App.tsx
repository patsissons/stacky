import { useEffect, useState } from 'react'

export interface AppProps {
  /** Overridable for tests. */
  fetchHealth?: () => Promise<{ version: string }>
}

const defaultFetchHealth = async () => {
  const res = await fetch('/healthz')
  return (await res.json()) as { version: string }
}

export function App({ fetchHealth = defaultFetchHealth }: AppProps) {
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    fetchHealth()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion('unavailable'))
  }, [fetchHealth])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">stacky</h1>
      <p className="text-muted-foreground text-sm">
        server version: <span data-testid="server-version">{version ?? '…'}</span>
      </p>
    </main>
  )
}
