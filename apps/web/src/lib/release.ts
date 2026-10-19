import { APP_REPO } from '@stacky/shared'

/** The GitHub release page for a version, or undefined for dev and other non-release builds. */
export function releaseUrl(version: string | undefined): string | undefined {
  const v = version?.trim().replace(/^v/, '')
  if (!v || !/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i.test(v)) return undefined
  return `https://github.com/${APP_REPO}/releases/tag/v${v}`
}
