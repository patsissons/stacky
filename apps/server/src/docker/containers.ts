import type Docker from 'dockerode'
import { containerState, type ContainerSummary, type PortMapping } from '@stacky/shared'
import { iconName } from '../icons/icons'
import { LINK_TEMPLATE_LABELS } from '../updates/links'
import { SCHEDULE_LABEL } from '../updates/schedule'
import { TAG_EXCLUDE_LABELS, TAG_INCLUDE_LABELS } from '../updates/tags'
import { LABELS } from './client'
import { firstLabel } from './labels'

export interface ComposeContainer extends ContainerSummary {
  workingDir?: string
  configFiles?: string
  labels: Record<string, string>
}

/**
 * Lists containers created by docker compose (excluding one-off `compose run`
 * containers), normalised into stacky's model. Restart policies are not part
 * of the list response, so they are inspected once per container and cached.
 */
export class ContainerLister {
  private restartPolicies = new Map<string, string>()

  constructor(private readonly docker: Docker) {}

  async list(): Promise<ComposeContainer[]> {
    const raw = await this.docker.listContainers({
      all: true,
      filters: { label: [LABELS.project] },
    })
    const live = new Set(raw.map((c) => c.Id))
    for (const id of this.restartPolicies.keys()) if (!live.has(id)) this.restartPolicies.delete(id)

    const containers = await Promise.all(
      raw
        .filter((c) => (c.Labels?.[LABELS.oneoff] ?? 'False') !== 'True')
        .map(async (c): Promise<ComposeContainer> => {
          const labels = c.Labels ?? {}
          const restartPolicy = await this.restartPolicy(c.Id, c.State)
          return {
            id: c.Id,
            name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
            project: labels[LABELS.project] ?? '',
            service: labels[LABELS.service] ?? '',
            number: Number(labels[LABELS.number] ?? 1),
            image: c.Image,
            imageId: c.ImageID,
            state: containerState({ state: c.State, status: c.Status, restartPolicy }),
            statusText: c.Status,
            exitCode: c.State === 'exited' ? parseExit(c.Status) : undefined,
            createdAt: c.Created * 1000,
            ports: ports(c.Ports ?? []),
            icon: iconName(c.Image, labels),
            updateSchedule: labels[SCHEDULE_LABEL],
            tagInclude: firstLabel(labels, TAG_INCLUDE_LABELS),
            tagExclude: firstLabel(labels, TAG_EXCLUDE_LABELS),
            linkTemplate: firstLabel(labels, LINK_TEMPLATE_LABELS),
            workingDir: labels[LABELS.workingDir],
            configFiles: labels[LABELS.configFiles],
            labels,
          }
        }),
    )
    return containers.sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        a.service.localeCompare(b.service) ||
        a.number - b.number,
    )
  }

  private async restartPolicy(id: string, state: string): Promise<string | undefined> {
    // Only exited containers need the policy to tell "completed" from "stopped".
    if (state !== 'exited') return undefined
    const cached = this.restartPolicies.get(id)
    if (cached !== undefined) return cached
    try {
      const info = await this.docker.getContainer(id).inspect()
      const policy = info.HostConfig?.RestartPolicy?.Name ?? ''
      this.restartPolicies.set(id, policy)
      return policy
    } catch {
      return undefined
    }
  }
}

function parseExit(status: string): number | undefined {
  const m = /^Exited \((-?\d+)\)/.exec(status)
  return m ? Number(m[1]) : undefined
}

function ports(list: Docker.Port[]): PortMapping[] {
  const seen = new Set<string>()
  const out: PortMapping[] = []
  for (const p of list) {
    // Docker reports IPv4 and IPv6 bindings separately; show each port once.
    const key = `${p.PublicPort ?? ''}:${p.PrivatePort}/${p.Type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      hostIp: p.IP,
      hostPort: p.PublicPort,
      containerPort: p.PrivatePort,
      protocol: (p.Type as PortMapping['protocol']) ?? 'tcp',
    })
  }
  return out.sort(
    (a, b) => (a.hostPort ?? 0) - (b.hostPort ?? 0) || a.containerPort - b.containerPort,
  )
}
