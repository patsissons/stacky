import type { ImageUpdate } from '@stacky/shared'

/** A page listing the image's tags, for release notes and changelogs. */
export function registryPage(u: Pick<ImageUpdate, 'registry' | 'repository'>): string | undefined {
  if (u.registry === 'docker.io') {
    return u.repository.startsWith('library/')
      ? `https://hub.docker.com/_/${u.repository.slice(8)}/tags`
      : `https://hub.docker.com/r/${u.repository}/tags`
  }
  if (u.registry === 'ghcr.io') {
    const [owner, ...rest] = u.repository.split('/')
    return `https://github.com/${owner}/${rest[0] ?? owner}/pkgs/container/${rest.join('%2F') || owner}`
  }
  if (u.registry === 'lscr.io')
    return `https://docs.linuxserver.io/images/docker-${u.repository.split('/').pop()}/`
  if (u.registry === 'quay.io') return `https://quay.io/repository/${u.repository}?tab=tags`
  return undefined
}
