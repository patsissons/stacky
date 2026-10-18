import fs from 'node:fs/promises'
import os from 'node:os'
import type Docker from 'dockerode'
import { LABELS } from '../docker/client'

export interface SelfIdentity {
  containerId: string
  name: string
  image: string
  imageId: string
  project?: string
  service?: string
  workingDir?: string
  configFiles?: string[]
  envFiles?: string[]
  mounts: { type: string; source: string; destination: string; rw: boolean; name?: string }[]
  securityOpt: string[]
}

const ID_RE = /([0-9a-f]{64})/

/** Extracts this container's id from /proc/self/mountinfo (cgroup v1 and v2 hosts). */
export function containerIdFromMountinfo(mountinfo: string): string | undefined {
  for (const line of mountinfo.split('\n')) {
    // The hostname / hosts / resolv.conf bind mounts live under the container's own dir.
    const m = /\/(?:docker|containers)\/containers\/([0-9a-f]{64})\//.exec(line)
    if (m) return m[1]
  }
  return undefined
}

export function containerIdFromCgroup(cgroup: string): string | undefined {
  for (const line of cgroup.split('\n')) {
    if (!/docker|containerd|kubepods/.test(line)) continue
    const m = ID_RE.exec(line)
    if (m) return m[1]
  }
  return undefined
}

async function readOptional(file: string) {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Finds the container stacky runs in, if any. Order: explicit override,
 * mountinfo, cgroup, then the hostname (docker's default is the short id).
 */
export async function detectSelf(
  docker: Docker,
  override?: string,
): Promise<SelfIdentity | undefined> {
  const candidates = [
    override,
    containerIdFromMountinfo(await readOptional('/proc/self/mountinfo')),
    containerIdFromCgroup(await readOptional('/proc/self/cgroup')),
    os.hostname(),
  ].filter((c): c is string => !!c)

  for (const id of candidates) {
    try {
      const info = await docker.getContainer(id).inspect()
      const labels = info.Config?.Labels ?? {}
      return {
        containerId: info.Id,
        name: info.Name.replace(/^\//, ''),
        image: info.Config?.Image ?? '',
        imageId: info.Image,
        project: labels[LABELS.project],
        service: labels[LABELS.service],
        workingDir: labels[LABELS.workingDir],
        configFiles: labels[LABELS.configFiles]?.split(','),
        envFiles: labels[LABELS.envFile]?.split(','),
        mounts: (info.Mounts ?? []).map((m) => ({
          type: m.Type,
          source: m.Source,
          destination: m.Destination,
          rw: m.RW,
          name: (m as { Name?: string }).Name,
        })),
        securityOpt: info.HostConfig?.SecurityOpt ?? [],
      }
    } catch {
      // not a container we can see (e.g. running on the host in dev)
    }
  }
  return undefined
}
