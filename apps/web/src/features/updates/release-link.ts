import { releaseLinks, type ImageUpdate } from '@stacky/shared'
import { parseImageRef } from '@/lib/format'

type Links = Pick<ImageUpdate, 'currentLink' | 'newerLink' | 'linkTemplateError'>

/**
 * An update's release links for one container. Its own `stacky.link.template` label decides,
 * so one container with a wrong template can't take the links away from the others running
 * the same image. A container without one uses the links its image's update check gave.
 */
export function containerLinks(
  update: Pick<ImageUpdate, 'tag' | 'newerTag'> & Links,
  template: string | undefined,
): Links {
  const own = template?.trim()
  if (!own) {
    const { currentLink, newerLink, linkTemplateError } = update
    return { currentLink, newerLink, linkTemplateError }
  }
  return releaseLinks(own, update.tag, update.newerTag)
}

/** The release notes link for the version a container runs (see `containerLinks`). */
export function releaseLink(
  ref: string | undefined,
  template: string | undefined,
  update: Pick<ImageUpdate, 'currentLink'> | undefined,
): string | undefined {
  // a bare image id or a digest pin names no version to fill in
  if (ref && template?.trim() && !ref.startsWith('sha256:') && !ref.includes('@')) {
    return releaseLinks(template.trim(), parseImageRef(ref).tag).currentLink
  }
  return update?.currentLink
}
