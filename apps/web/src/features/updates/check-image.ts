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
