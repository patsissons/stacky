import type { UpdateChecker } from '../updates/checker'
import { compareVersions } from './image-ref'
import type { ReleaseChecker } from './release'

const RELEASE_TICK_MS = 60 * 60_000

/**
 * Keeps the release banner and the badge on stacky's own image in sync: finding either update
 * looks for the other right away (the image reaches the registry a little after the release).
 * Returns a function that stops the hourly release check.
 */
export function syncSelfRelease(
  releases: ReleaseChecker,
  updates: Pick<UpdateChecker, 'selfRelease' | 'onSelfChecked' | 'checkSelf'>,
  version: string,
): () => void {
  updates.selfRelease = () => releases.peek(version)?.version
  releases.on('change', () => {
    if (releases.peek(version)) void updates.checkSelf()
  })
  updates.onSelfChecked = (result) => {
    if (result.status !== 'update_available') return
    const known = releases.peek(version)?.version
    // the registry has a newer image than the newest release known: that release is out now
    if (!known || (result.newerTag && compareVersions(result.newerTag, known) > 0))
      void releases.refresh()
  }
  // known without anyone opening the UI; refresh (not the cache) so it really looks every hour
  const refreshRelease = () => void releases.refresh()
  refreshRelease()
  const timer = setInterval(refreshRelease, RELEASE_TICK_MS).unref()
  return () => clearInterval(timer)
}
