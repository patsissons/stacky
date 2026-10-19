/** Icon sets drawn as single-color glyphs, which need inverting on a dark background. */
const MONO_SETS = new Set(['mdi', 'fas', 'far', 'fab', 'si'])

/**
 * The URL stacky serves an icon id from (`<set>:<name>`, `url:<hash>` or a bare selfh.st
 * name). `stacky` itself has none: the UI draws its logo.
 */
export function iconSrc(icon: string): string | undefined {
  if (icon === 'stacky') return undefined
  const i = icon.indexOf(':')
  if (i < 0) return `/api/icons/${encodeURIComponent(icon)}`
  return `/api/icons/${encodeURIComponent(icon.slice(0, i))}/${encodeURIComponent(icon.slice(i + 1))}`
}

export function isMonoIcon(icon: string): boolean {
  return MONO_SETS.has(icon.split(':')[0]!)
}
