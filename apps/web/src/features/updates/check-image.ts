import { toast } from 'sonner'
import type { ImageUpdate, UpdatesSummary } from '@stacky/shared'
import { checkForUpdates } from '@/hooks/use-updates'
import { api } from '@/lib/api'

const POLL_MS = 1000
const TIMEOUT_MS = 60_000

/**
 * Checks one image reference now and resolves with its result once the checker has written it
 * (the check endpoint answers before the registry does). `undefined` when nothing arrived in
 * time, which happens when a full check is already running and swallowed the request.
 */
export async function checkImage(
  ref: string,
  since = 0,
  { poll = POLL_MS, timeout = TIMEOUT_MS } = {},
): Promise<ImageUpdate | undefined> {
  await checkForUpdates([ref])
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, poll))
    const summary = await api.get<UpdatesSummary>('/api/updates')
    const result = summary.updates.find((u) => u.ref === ref)
    if (result && result.checkedAt > since) return result
  }
  return undefined
}

/** What a finished check means, in words for a toast. */
export function describeCheck(ref: string, result: ImageUpdate | undefined) {
  if (!result) {
    return {
      tone: 'warning' as const,
      title: `${ref}: no result yet`,
      description: 'Another check is still running; try again when it finishes.',
    }
  }
  if (result.status === 'update_available') {
    return {
      tone: 'success' as const,
      title: result.newerTag
        ? `${ref}: ${result.newerTag} is available`
        : `${ref}: a new image for this tag is available`,
    }
  }
  if (result.status === 'up_to_date')
    return { tone: 'success' as const, title: `${ref} is up to date` }
  return {
    tone: 'error' as const,
    title: `${ref}: check ${result.status === 'skipped' ? 'skipped' : 'failed'}`,
    description: result.message,
  }
}

/** Runs {@link checkImage} behind a loading toast that turns into the result. */
export async function checkImageNow(ref: string, since?: number) {
  const id = toast.loading(`Checking ${ref}…`)
  try {
    const { tone, title, description } = describeCheck(ref, await checkImage(ref, since))
    toast[tone](title, { id, description })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err), { id })
  }
}

/**
 * Checks several image references now and resolves once the check that covers them finished,
 * with each ref's result (`undefined` when that ref got none). The baseline is the server's own
 * `lastCheckAt` from the check request, so only results written after it count: ours, or those of
 * a check that was already running and swallowed the request. Waiting for the run rather than for
 * every ref keeps refs the checker skips (such as `${TAG}`) from holding it up.
 */
export async function checkImages(
  refs: string[],
  { poll = POLL_MS, timeout = TIMEOUT_MS } = {},
): Promise<Map<string, ImageUpdate | undefined>> {
  const { lastCheckAt: since = 0 } = await checkForUpdates(refs)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, poll))
    const summary = await api.get<UpdatesSummary>('/api/updates')
    if (summary.checking || (summary.lastCheckAt ?? 0) <= since) continue
    const fresh = new Map(
      summary.updates.filter((u) => u.checkedAt > since).map((u) => [u.ref, u] as const),
    )
    return new Map(refs.map((ref) => [ref, fresh.get(ref)]))
  }
  return new Map()
}

/** What a finished stack check means, in words for a toast. */
export function describeStackCheck(stack: string, results: Map<string, ImageUpdate | undefined>) {
  const all = [...results.values()]
  if (!all.some(Boolean)) {
    return {
      tone: 'warning' as const,
      title: `${stack}: no result yet`,
      description: 'Another check is still running; try again when it finishes.',
    }
  }
  const refs = (match: (u: ImageUpdate | undefined) => boolean) =>
    [...results].filter(([, u]) => match(u)).map(([ref]) => ref)
  const available = refs((u) => u?.status === 'update_available')
  const failed = refs((u) => !u || (u.status !== 'update_available' && u.status !== 'up_to_date'))
  const problems = failed.length
    ? `${failed.length} could not be checked: ${failed.join(', ')}`
    : undefined
  if (available.length) {
    const count = available.length === 1 ? '1 update' : `${available.length} updates`
    return {
      tone: 'success' as const,
      title: `${stack}: ${count} available`,
      description: [available.join(', '), problems].filter(Boolean).join('. '),
    }
  }
  if (failed.length)
    return { tone: 'warning' as const, title: `${stack}: check incomplete`, description: problems }
  return { tone: 'success' as const, title: `${stack} is up to date` }
}

/** Checks every image of a stack behind a loading toast that turns into the result. */
export async function checkStackNow(stack: string, refs: string[]) {
  if (!refs.length) {
    toast.info(`${stack} has no images to check`)
    return
  }
  const id = toast.loading(`Checking ${stack}…`)
  try {
    const { tone, title, description } = describeStackCheck(stack, await checkImages(refs))
    toast[tone](title, { id, description })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err), { id })
  }
}
