import path from 'node:path'
import { serviceState, stackStatus, type ServiceSummary, type StackSummary } from '@stacky/shared'
import type { ComposeContainer } from '../docker/containers'
import { iconLabel, STACKY_ICON } from '../icons/icons'
import type { ParsedCompose } from './compose-file'

export interface ManagedStack {
  name: string
  dir: string
  composeFile: string
  parsed: ParsedCompose
}

export interface SummaryOptions {
  selfContainerId?: string
  activeOperations?: ReadonlyMap<string, string>
}

/**
 * Joins stacks on disk with compose containers from the engine.
 *
 * A container belongs to a managed stack when its compose working dir is the
 * stack directory, or (for containers created elsewhere) when its project
 * name matches the stack's project name. Projects that match nothing on disk
 * become read-only `external` stacks.
 */
export function buildStackSummaries(
  managed: ManagedStack[],
  engineContainers: ComposeContainer[],
  { selfContainerId, activeOperations }: SummaryOptions = {},
): StackSummary[] {
  const isSelfContainer = (c: ComposeContainer) =>
    !!selfContainerId && c.id.startsWith(selfContainerId)
  // stacky shows its own logo, whatever its image is called, unless a label picks another icon
  const containers = engineContainers.map((c) =>
    isSelfContainer(c) && !iconLabel(c.labels) ? { ...c, icon: STACKY_ICON } : c,
  )
  const byDir = new Map(managed.map((s) => [path.resolve(s.dir), s]))
  const byProject = new Map(managed.map((s) => [s.parsed.projectName ?? s.name, s]))
  const owned = new Map<string, ComposeContainer[]>()
  const external = new Map<string, ComposeContainer[]>()

  for (const c of containers) {
    const stack =
      (c.workingDir ? byDir.get(path.resolve(c.workingDir)) : undefined) ?? byProject.get(c.project)
    if (stack) push(owned, stack.name, c)
    else push(external, c.project, c)
  }

  const isSelf = (list: ComposeContainer[]) => list.some(isSelfContainer)

  const summaries: StackSummary[] = managed.map((s) => {
    const list = owned.get(s.name) ?? []
    const declared = s.parsed.services
    const services = mergeServices(
      declared.map((d) => d.name),
      list,
      new Map(declared.map((d) => [d.name, d.image])),
    )
    return {
      name: s.name,
      managed: true,
      status: stackStatus(services.map((x) => x.state)),
      path: s.dir,
      composeFile: s.composeFile,
      services,
      isSelf: isSelf(list),
      urls: s.parsed.urls,
      parseError: s.parsed.error?.message,
      activeOperationId: activeOperations?.get(s.name),
    }
  })

  for (const [project, list] of external) {
    const services = mergeServices([], list, new Map())
    summaries.push({
      name: project,
      managed: false,
      status: stackStatus(services.map((x) => x.state)),
      path: list.find((c) => c.workingDir)?.workingDir,
      services,
      isSelf: isSelf(list),
      urls: [],
    })
  }

  return summaries.sort(
    (a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name),
  )
}

function mergeServices(
  declared: string[],
  containers: ComposeContainer[],
  images: Map<string, string | undefined>,
): ServiceSummary[] {
  const names = [...new Set([...declared, ...containers.map((c) => c.service)])]
  return names.map((name) => {
    const own = containers.filter((c) => c.service === name)
    return {
      name,
      image: images.get(name) ?? own[0]?.image,
      state: serviceState(own.map((c) => c.state)),
      containers: own.map(stripInternal),
    }
  })
}

function stripInternal(c: ComposeContainer) {
  const { workingDir: _w, configFiles: _c, labels: _l, ...rest } = c
  return rest
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
