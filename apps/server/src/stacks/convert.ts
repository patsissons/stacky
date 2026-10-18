// composerize ships without types; it's a single function.
import composerizeModule from 'composerize'
import { badRequest } from '../lib/errors'

type Composerize = (
  command: string,
  existing?: string | null,
  version?: string,
  indent?: number,
) => string
const composerize = ((composerizeModule as unknown as { default?: Composerize }).default ??
  composerizeModule) as unknown as Composerize

/** Converts one or more `docker run` commands into a compose file (Dockge's converter). */
export function dockerRunToCompose(command: string): string {
  const normalized = command
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .join('\n')
  if (!/^\s*docker\s+(container\s+)?(run|create)\b/.test(normalized)) {
    throw badRequest('enter a "docker run" command')
  }
  let out: string
  try {
    out = composerize(normalized, null, 'latest', 2)
  } catch (err) {
    throw badRequest(
      `could not convert the command: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out.replace(/^name: <your project name>\n/m, '').trimStart()
}
