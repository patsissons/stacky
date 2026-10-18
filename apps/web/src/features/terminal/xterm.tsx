import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from 'next-themes'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const DARK = {
  background: '#0f1117',
  foreground: '#d7dae0',
  cursor: '#a5b4fc',
  selectionBackground: '#4f46e566',
  black: '#1e2030',
  brightBlack: '#545c7e',
}
const LIGHT = {
  background: '#fbfbfd',
  foreground: '#24292f',
  cursor: '#4f46e5',
  selectionBackground: '#c7d2fe',
  black: '#24292f',
  brightBlack: '#6e7781',
  yellow: '#9a6700',
  brightYellow: '#7d4e00',
  white: '#6e7781',
  brightWhite: '#8c959f',
}

export interface XtermProps {
  className?: string
  options?: ITerminalOptions
  /** Called once with the terminal; return a cleanup function if needed. */
  onReady: (term: Terminal) => void | (() => void)
  onResize?: (cols: number, rows: number) => void
}

/** A themed, auto-fitting xterm.js terminal. */
export function Xterm({ className, options, onReady, onResize }: XtermProps) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const { resolvedTheme } = useTheme()
  const onReadyRef = useRef(onReady)
  const onResizeRef = useRef(onResize)
  useLayoutEffect(() => {
    onReadyRef.current = onReady
    onResizeRef.current = onResize
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      convertEol: true,
      scrollback: 10_000,
      allowProposedApi: true,
      ...options,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(el)
    termRef.current = term
    const doFit = () => {
      try {
        fit.fit()
      } catch {
        // element hidden
      }
    }
    doFit()
    const sub = term.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows))
    const observer = new ResizeObserver(() => doFit())
    observer.observe(el)
    const cleanup = onReadyRef.current(term)
    return () => {
      cleanup?.()
      observer.disconnect()
      sub.dispose()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = resolvedTheme === 'light' ? LIGHT : DARK
  }, [resolvedTheme])

  return (
    <div
      className={cn(
        'h-full min-h-0 w-full overflow-hidden rounded-md border p-2',
        resolvedTheme === 'light' ? 'bg-[#fbfbfd]' : 'bg-[#0f1117]',
        className,
      )}
    >
      <div ref={ref} className="h-full w-full" />
    </div>
  )
}
