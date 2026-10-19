import type { ImageUpdate, StackSummary } from '@stacky/shared'
import { parseDocument } from 'yaml'
import { splitRef, withTag } from '../self/image-ref'
import { composeTags } from './compose-file'

/** Docker's tag grammar; registry-reported tags are checked before they reach a command line. */
export const TAG_PATTERN = /^[\w][\w.-]{0,127}$/

/** A service moving from one image reference to another (equal when already edited). */
export interface ImageBump {
  service: string
  from: string
  to: string
}

/** What "pull updates" / "deploy updates" will do for one stack. */
export interface StackUpdatePlan {
  /** Services with a newer version tag. */
  bumps: ImageBump[]
  /** Services whose tag has a new build behind it. */
  rebuilt: string[]
  skipped: { service: string; reason: string }[]
}

export interface PlanUpdatesOptions {
  /**
   * The stack's compose file. When given, bumps are expressed against its `image:` lines
   * (the deploy case); otherwise against the image the containers run (the prefetch case).
   */
  compose?: string
  /** Restrict to these services. */
  only?: string[]
}

/** Collects the actionable updates of a stack's services from the update checker's results. */
export function planStackUpdates(
  stack: StackSummary,
  updates: ImageUpdate[],
  { compose, only }: PlanUpdatesOptions = {},
): StackUpdatePlan {
  const plan: StackUpdatePlan = { bumps: [], rebuilt: [], skipped: [] }
  const byRef = new Map(updates.map((u) => [u.ref, u]))
  const doc =
    compose === undefined ? undefined : parseDocument(compose, { customTags: composeTags })

  for (const service of stack.services) {
    if (only && !only.includes(service.name)) continue
    const container = service.containers[0]
    if (!container) continue
    // same rule as the checker: the engine may report a bare image id
    const ref = container.image.startsWith('sha256:') ? service.image : container.image
    const update = ref ? byRef.get(ref) : undefined
    if (!update || update.status !== 'update_available' || update.ignored) continue
    const skip = (reason: string) => plan.skipped.push({ service: service.name, reason })

    if (!update.newerTag) {
      if (update.digestChanged) plan.rebuilt.push(service.name)
      continue
    }
    if (!TAG_PATTERN.test(update.newerTag)) {
      skip(`invalid tag "${update.newerTag}"`)
      continue
    }
    if (!doc) {
      plan.bumps.push({ service: service.name, from: ref!, to: withTag(ref!, update.newerTag) })
      continue
    }
    const current = doc.getIn(['services', service.name, 'image'])
    if (typeof current !== 'string') skip('no image in the compose file')
    else if (current.includes('$')) skip('image set from a variable')
    else {
      const tag = splitRef(current).tag ?? 'latest'
      if (tag === update.tag || tag === update.newerTag) {
        plan.bumps.push({
          service: service.name,
          from: current,
          to: withTag(current, update.newerTag),
        })
      } else skip('compose file changed since the check')
    }
  }
  return plan
}

/** Every service the plan touches. */
export function planServices(plan: StackUpdatePlan): string[] {
  return [...plan.bumps.map((b) => b.service), ...plan.rebuilt]
}
