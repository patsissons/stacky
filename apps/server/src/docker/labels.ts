/** The first of `keys` a container sets to a non-blank value, trimmed. */
export function firstLabel(
  labels: Record<string, string> = {},
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = labels[key]?.trim()
    if (value) return value
  }
  return undefined
}
