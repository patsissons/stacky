import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownToLine, Download, Eraser, Pause, Play, Search, WrapText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogLine } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { liveSocket } from '@/lib/ws'
import { cn } from '@/lib/utils'
import { AnsiText, logLevel } from './ansi'
import { stripAnsi } from './strip-ansi'

const MAX_LINES = 20_000
const SERVICE_COLORS = [
  'text-sky-500',
  'text-emerald-500',
  'text-amber-500',
  'text-fuchsia-500',
  'text-rose-500',
  'text-indigo-400',
  'text-teal-500',
]

export interface LogViewerProps {
  stack: string
  services: string[]
  service?: string
  onServiceChange?: (service: string | undefined) => void
  /** Changes whenever containers are recreated so the stream reconnects. */
  generation?: string
}

/** Live, searchable, virtualised logs for a stack or one service. */
export function LogViewer({
  stack,
  services,
  service,
  onServiceChange,
  generation,
}: LogViewerProps) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [ended, setEnded] = useState<string>()
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(true)
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [timestamps, setTimestamps] = useState(false)
  const [tail, setTail] = useState(500)
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    setEnded(undefined)
    const topic = service ? `logs:${stack}:${service}` : `logs:${stack}`
    return liveSocket.subscribe(
      topic,
      (msg) => {
        if (msg.type === 'log') {
          setLines((prev) => {
            const next = prev.concat(msg.lines)
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
          })
        } else if (msg.type === 'exit') setEnded(msg.reason ?? 'stream ended')
        else if (msg.type === 'error') setEnded(msg.message)
      },
      { tail },
    )
  }, [stack, service, tail, generation])

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      q && onlyMatches ? lines.filter((l) => stripAnsi(l.text).toLowerCase().includes(q)) : lines,
    [lines, q, onlyMatches],
  )

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 30,
  })

  useEffect(() => {
    if (follow && visible.length > 0)
      virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
  }, [visible.length, follow, virtualizer])

  const colorFor = (svc: string) =>
    SERVICE_COLORS[Math.max(0, services.indexOf(svc)) % SERVICE_COLORS.length]

  const download = () => {
    const text = lines
      .map((l) => `${new Date(l.ts).toISOString()} ${l.container} ${stripAnsi(l.text)}`)
      .join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${stack}${service ? `-${service}` : ''}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* phones: the two selects share the first row, search and the icons the second */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={service ?? '__all'}
          onValueChange={(v) => onServiceChange?.(v === '__all' ? undefined : v)}
        >
          <SelectTrigger
            className="h-8 min-w-0 flex-1 basis-32 sm:w-40 sm:flex-none sm:basis-auto"
            aria-label="Service"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All services</SelectItem>
            {services.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative order-1 min-w-40 flex-1 sm:order-none sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs"
            aria-label="Search logs"
            className="h-8 pl-8 text-sm"
          />
        </div>
        {q && (
          <Toggle
            size="sm"
            pressed={onlyMatches}
            onPressedChange={setOnlyMatches}
            className="order-1 h-8 text-xs sm:order-none"
          >
            Only matches
          </Toggle>
        )}
        <Select value={String(tail)} onValueChange={(v) => setTail(Number(v))}>
          <SelectTrigger
            className="h-8 min-w-0 flex-1 basis-32 sm:w-40 sm:flex-none sm:basis-auto"
            aria-label="History"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[100, 500, 2000, 10000].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Last {n} lines
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="order-2 ml-auto flex items-center gap-1 sm:order-none">
          <IconToggle
            label={follow ? 'Pause auto-scroll' : 'Follow new lines'}
            pressed={follow}
            onChange={setFollow}
          >
            {follow ? <Pause /> : <Play />}
          </IconToggle>
          <IconToggle label="Wrap long lines" pressed={wrap} onChange={setWrap}>
            <WrapText />
          </IconToggle>
          <IconToggle label="Show timestamps" pressed={timestamps} onChange={setTimestamps}>
            <span className="font-mono text-[10px] font-semibold">TS</span>
          </IconToggle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setLines([])}
                aria-label="Clear"
              >
                <Eraser />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={download}
                aria-label="Download"
              >
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={parentRef}
        className="bg-muted/30 relative min-h-64 flex-1 overflow-auto rounded-lg border font-mono text-[12px] leading-5"
        onWheel={(e) => e.deltaY < 0 && follow && setFollow(false)}
        data-testid="log-lines"
      >
        {visible.length === 0 && (
          <p className="text-muted-foreground p-4 font-sans text-sm">
            {ended
              ? `No logs (${ended}).`
              : q && onlyMatches
                ? 'No matching lines.'
                : 'Waiting for logs…'}
          </p>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = visible[item.index]!
            const level = logLevel(line.text)
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'absolute left-0 flex w-full gap-2 px-3',
                  wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
                  level === 'error' && 'bg-status-error/8',
                  level === 'warn' && 'bg-status-warning/8',
                  line.stream === 'stderr' && 'border-status-error/40 border-l-2',
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {timestamps && (
                  <span className="text-muted-foreground shrink-0">
                    {new Date(line.ts).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                )}
                {!service && (
                  <span className={cn('shrink-0 font-semibold', colorFor(line.service))}>
                    {line.service}
                  </span>
                )}
                <span className="min-w-0">
                  <AnsiText text={line.text} highlight={q || undefined} />
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {!follow && (
        <Button
          size="sm"
          variant="secondary"
          className="self-center"
          onClick={() => setFollow(true)}
        >
          <ArrowDownToLine /> Jump to latest
        </Button>
      )}
    </div>
  )
}

function IconToggle({
  label,
  pressed,
  onChange,
  children,
}: {
  label: string
  pressed: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={pressed}
          onPressedChange={onChange}
          aria-label={label}
          className="size-8"
        >
          {children}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
