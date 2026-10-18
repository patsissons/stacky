import type { UpdateKind } from '@stacky/shared'

/**
 * Tags are compared by "shape": the tag with every number replaced by `#`.
 * `1.27.3-alpine` only competes with other `#.#.#-alpine` tags and
 * `v2.8.3-ls364` with `v#.#.#-ls#`, so variants never cross over.
 */
export function tagShape(tag: string): string {
  return tag.replace(/\d+/g, '#')
}

function numbers(tag: string): number[] {
  return (tag.match(/\d+/g) ?? []).map(Number)
}

/** A tag that names a version (has numbers), as opposed to `latest` or `stable`. */
export function isVersionTag(tag: string): boolean {
  return /\d/.test(tag) && !/^sha256/.test(tag)
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Which position changed: major, minor, patch, or a later build/release number. */
export function updateKind(from: string, to: string): UpdateKind {
  const a = numbers(from)
  const b = numbers(to)
  const i = a.findIndex((n, idx) => n !== b[idx])
  if (i === 0) return 'major'
  if (i === 1) return 'minor'
  if (i === 2) return 'patch'
  return 'prerelease'
}

/** The newest tag with the same shape as `current`, if it is newer. */
export function newestTag(
  current: string,
  tags: string[],
): { tag: string; kind: UpdateKind } | undefined {
  if (!isVersionTag(current)) return undefined
  const shape = tagShape(current)
  const mine = numbers(current)
  let best: { tag: string; nums: number[] } | undefined
  for (const tag of tags) {
    if (tagShape(tag) !== shape) continue
    const nums = numbers(tag)
    if (compare(nums, mine) <= 0) continue
    // a date-like jump in the first number (e.g. 1.x -> 20240101) is a different scheme
    if (mine[0] !== undefined && nums[0]! > mine[0] * 100 + 100) continue
    if (!best || compare(nums, best.nums) > 0) best = { tag, nums }
  }
  return best ? { tag: best.tag, kind: updateKind(current, best.tag) } : undefined
}
