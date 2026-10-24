import { numbers } from './tags'

/** Labels with a release link template, highest priority first. */
export const LINK_TEMPLATE_LABELS = ['stacky.link.template', 'wud.link.template'] as const

/**
 * The variables a link template can use, as What's Up Docker names them. Like WUD's semver
 * coercion, a missing minor or patch is 0; `transformed` is the tag as-is (no tag transforms).
 */
export function tagVars(tag: string): Record<string, string | undefined> {
  const [major, minor, patch] = numbers(tag).map(String)
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
