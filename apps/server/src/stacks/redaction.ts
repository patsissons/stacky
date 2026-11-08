/**
 * Agent clients often redact secrets in tool output (e.g. `ghp_xe...5BzQ`). When such
 * text is sent back as a file edit, the mask would replace the real value on disk and
 * still validate. These helpers spot masks that were cut from a value the file holds.
 */

export interface RedactedValue {
  /** 1-based line in the incoming text. */
  line: number
  /** The masked text as it appears there. */
  value: string
}

/** `prefix` + `...`, `…` or `***` + `suffix`, not part of a longer word. */
const MASK = /(?<![\w-])([\w-]{1,16})(?:\.\.\.|…|\*{3,})([\w-]{2,8})(?![\w-])/g

/** Splits text into the values a mask may have been cut from. */
const VALUE_SEPARATORS = /[\s'"`=:,;()[\]{}]+/

/**
 * Masked values in `incoming` that are not in `current` and match a longer value of
 * `current` by prefix and suffix, i.e. the value they redact.
 */
export function findRedactedValues(current: string, incoming: string): RedactedValue[] {
  if (!incoming) return []
  let values: string[] | undefined
  const found: RedactedValue[] = []
  incoming.split('\n').forEach((line, index) => {
    for (const m of line.matchAll(MASK)) {
      const [mask, prefix, suffix] = m as unknown as [string, string, string]
      if (current.includes(mask)) continue
      values ??= current.split(VALUE_SEPARATORS)
      const original = values.some(
        (v) =>
          v.length > prefix.length + suffix.length && v.startsWith(prefix) && v.endsWith(suffix),
      )
      if (original) found.push({ line: index + 1, value: mask })
    }
  })
  return found
}
