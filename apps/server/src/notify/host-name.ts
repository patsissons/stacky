import os from 'node:os'
import type Docker from 'dockerode'

/**
 * The name notifications use for this stacky: `STACKY_DISPLAY_NAME`, else the Docker host's
 * name (inside a container `os.hostname()` is only the container id), else `os.hostname()`.
 */
export async function resolveHostName(
  displayName: string | undefined,
  docker: Pick<Docker, 'info'>,
  timeoutMs = 5_000,
): Promise<string> {
  if (displayName) return displayName
  try {
    const info = (await Promise.race([
      docker.info(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref()),
    ])) as { Name?: unknown }
    if (typeof info.Name === 'string' && info.Name.trim()) return info.Name.trim()
  } catch {
    // the engine is unreachable: fall through to this machine's name
  }
  return os.hostname()
}
