import Anser from 'anser'

/** Renders ANSI-coloured text as styled spans (no HTML injection). */
export function AnsiText({ text, highlight }: { text: string; highlight?: string }) {
  const parts = Anser.ansiToJson(text, { remove_empty: true, use_classes: false })
  return (
    <>
      {parts.map((p, i) => {
        const style: React.CSSProperties = {}
        if (p.fg) style.color = `rgb(${p.fg})`
        if (p.bg) style.backgroundColor = `rgb(${p.bg})`
        if (p.decorations?.includes('bold')) style.fontWeight = 600
        if (p.decorations?.includes('italic')) style.fontStyle = 'italic'
        if (p.decorations?.includes('underline')) style.textDecoration = 'underline'
        return (
          <span key={i} style={style}>
            {highlight ? <Highlight text={p.content} term={highlight} /> : p.content}
          </span>
        )
      })}
    </>
  )
}

function Highlight({ text, term }: { text: string; term: string }) {
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  const out: React.ReactNode[] = []
  let i = 0
  for (;;) {
    const j = lower.indexOf(needle, i)
    if (j < 0) break
    if (j > i) out.push(text.slice(i, j))
    out.push(
      <mark key={j} className="bg-status-warning/40 text-foreground rounded-sm">
        {text.slice(j, j + needle.length)}
      </mark>,
    )
    i = j + needle.length
  }
  out.push(text.slice(i))
  return <>{out}</>
}

export function logLevel(text: string): 'error' | 'warn' | undefined {
  if (/\b(error|err|fatal|panic|exception|crit(ical)?)\b/i.test(text)) return 'error'
  if (/\b(warn|warning)\b/i.test(text)) return 'warn'
  return undefined
}
