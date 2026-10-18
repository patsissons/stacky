import type { Terminal } from '@xterm/xterm'
import { Plug, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StackSummary } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { liveSocket } from '@/lib/ws'
import { Xterm } from './xterm'

const UP = new Set(['running', 'healthy', 'unhealthy', 'starting', 'paused'])
const SHELLS = ['auto', '/bin/bash', '/bin/sh', '/bin/ash', '/bin/zsh']

function rememberedShell(service: string) {
  try {
    return localStorage.getItem(`stacky:shell:${service}`) ?? 'auto'
  } catch {
    return 'auto'
  }
}

function rememberShell(service: string, shell: string) {
  try {
    localStorage.setItem(`stacky:shell:${service}`, shell)
  } catch {
    // storage unavailable
  }
}

/** Interactive shell into one of the stack's running containers (docker exec). */
export function ShellTab({
  stack,
  containerId,
  onContainerChange,
}: {
  stack: StackSummary
  containerId?: string
  onContainerChange: (id: string) => void
}) {
  const containers = stack.services.flatMap((s) =>
    s.containers.filter((c) => UP.has(c.state)).map((c) => ({ ...c, service: s.name })),
  )
  const selected = containers.find((c) => c.id === containerId) ?? containers[0]
  const [shell, setShell] = useState(() => (selected ? rememberedShell(selected.service) : 'auto'))
  const [session, setSession] = useState(0)

  if (containers.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        No running containers to open a shell in.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected?.id} onValueChange={(id) => onContainerChange(id)}>
          <SelectTrigger className="h-8 w-56" aria-label="Container">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {containers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={shell}
          onValueChange={(v) => {
            setShell(v)
            if (selected) rememberShell(selected.service, v)
            setSession((n) => n + 1)
          }}
        >
          <SelectTrigger className="h-8 w-36" aria-label="Shell">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHELLS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'auto' ? 'bash or sh' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setSession((n) => n + 1)}>
          <RotateCcw /> Reconnect
        </Button>
      </div>
      {selected && (
        <ExecTerminal
          key={`${selected.id}:${shell}:${session}`}
          containerId={selected.id}
          shell={shell}
        />
      )}
    </div>
  )
}

function ExecTerminal({ containerId, shell }: { containerId: string; shell: string }) {
  const topic = `exec:${containerId}`
  const termRef = useRef<Terminal | null>(null)
  const [exited, setExited] = useState<string>()
  const [size, setSize] = useState<{ cols: number; rows: number }>()

  useEffect(() => {
    if (!size) return
    const off = liveSocket.subscribe(
      topic,
      (msg) => {
        if (msg.type === 'output') termRef.current?.write(msg.data)
        else if (msg.type === 'exit') {
          const why = msg.reason ?? `shell exited${msg.code !== undefined ? ` (${msg.code})` : ''}`
          setExited(why)
          termRef.current?.write(`\r\n\x1b[2m[${why}]\x1b[0m\r\n`)
        }
      },
      { cols: size.cols, rows: size.rows, shell },
    )
    return off
    // the session is opened once with the initial size; later resizes are messages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, shell, !!size])

  return (
    <div className="relative flex min-h-80 flex-1 flex-col">
      <Xterm
        className="flex-1"
        options={{ cursorBlink: true }}
        onReady={(term) => {
          termRef.current = term
          term.focus()
          setSize({ cols: term.cols, rows: term.rows })
          const d = term.onData((data) => liveSocket.send({ type: 'input', topic, data }))
          return () => {
            d.dispose()
            termRef.current = null
          }
        }}
        onResize={(cols, rows) => liveSocket.send({ type: 'resize', topic, cols, rows })}
      />
      {exited && (
        <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
          <Plug className="size-3.5" /> {exited}
        </div>
      )}
    </div>
  )
}
