/** Splits `repo[:tag][@digest]` into its repository and tag (digest dropped). */
export function splitRef(ref: string): { repository: string; tag?: string } {
  const noDigest = ref.split('@')[0]!
  const slash = noDigest.lastIndexOf('/')
  const colon = noDigest.lastIndexOf(':')
  if (colon > slash) return { repository: noDigest.slice(0, colon), tag: noDigest.slice(colon + 1) }
  return { repository: noDigest }
}

export function withTag(ref: string, tag: string): string {
  return `${splitRef(ref).repository}:${tag}`
}

/** Tags like `latest`, `edge`, `1` or `0.4` move to newer images; full versions don't. */
export function isMovingTag(tag: string | undefined): boolean {
  if (!tag) return true
  return !/^v?\d+\.\d+\.\d+([-+].*)?$/.test(tag)
}

/** Compares dotted versions (ignoring a leading v and pre-release suffixes). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[-+]/)[0]!
      .split('.')
      .map((n) => Number(n) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}
