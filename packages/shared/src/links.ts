// Release-notes links from a `stacky.link.template` label, shared so the server (update
// checks) and the web (each container's own label) fill templates the same way.

// a global in Node and browsers alike; this package's ES-only lib doesn't declare it
declare const URL: { canParse(url: string): boolean }

/**
 * The variables a link template can use, as What's Up Docker names them. Like WUD's semver
 * coercion, a missing minor or patch is 0; `transformed` is the tag as-is (no tag transforms).
 */
export function tagVars(tag: string): Record<string, string | undefined> {
  const [major, minor, patch] = (tag.match(/\d+/g) ?? []).map((n) => String(Number(n)))
  return {
    original: tag,
    raw: tag,
    transformed: tag,
    major,
    minor: major && (minor ?? '0'),
    patch: major && (patch ?? '0'),
    prerelease: /^\D*\d+(?:\.\d+)*-(.+)$/.exec(tag)?.[1] ?? '',
  }
}

/**
 * Fills `${name}` placeholders in a link template (it is never evaluated as code). Nothing
 * when the tag lacks a number the template needs; an error for an unknown variable or a
 * result that isn't an http(s) URL.
 */
export function renderLink(
  template: string,
  tag: string,
): { url: string } | { error: string } | undefined {
  const vars = tagVars(tag)
  let unknown: string | undefined
  let missing = false
  const url = template.replace(/\$\{\s*(\w+)\s*\}/g, (_, name: string) => {
    if (!(name in vars)) unknown ??= name
    const value = vars[name]
    if (value === undefined) missing = true
    return value ?? ''
  })
  if (unknown) return { error: `unknown variable \${${unknown}}` }
  if (missing) return undefined
  if (!/^https?:\/\/\S+$/i.test(url) || !URL.canParse(url)) {
    return { error: 'not an http(s) URL' }
  }
  return { url }
}

/** The release links one template gives a tag and its newer tag, or why it gives none. */
export function releaseLinks(
  template: string,
  tag: string,
  newerTag?: string,
): { currentLink?: string; newerLink?: string; linkTemplateError?: string } {
  const current = renderLink(template, tag)
  const newer = newerTag ? renderLink(template, newerTag) : undefined
  const failed = [current, newer].find((r) => r && 'error' in r)
  if (failed && 'error' in failed) return { linkTemplateError: failed.error }
  return {
    ...(current && 'url' in current ? { currentLink: current.url } : {}),
    ...(newer && 'url' in newer ? { newerLink: newer.url } : {}),
  }
}
