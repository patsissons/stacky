import fs from 'node:fs/promises'
import path from 'node:path'
import type { PreflightCheck } from '@stacky/shared'
import type { SelfIdentity } from './identity'

export interface PreflightInput {
  stacksDir: string
  self?: SelfIdentity
  dockerReachable: boolean
  dockerError?: string
  composeVersion?: string
}

/** Configuration checks shown prominently in the UI when something is wrong. */
export async function runPreflight(input: PreflightInput): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = []

  checks.push(
    input.dockerReachable
      ? { id: 'docker', ok: true, severity: 'info', message: 'Connected to the Docker engine' }
      : {
          id: 'docker',
          ok: false,
          severity: 'error',
          message: 'Cannot reach the Docker engine',
          hint: `Mount /var/run/docker.sock into the stacky container.${input.dockerError ? ` (${input.dockerError})` : ''}`,
        },
  )

  checks.push(
    input.composeVersion
      ? {
          id: 'compose',
          ok: true,
          severity: 'info',
          message: `Docker Compose ${input.composeVersion}`,
        }
      : {
          id: 'compose',
          ok: false,
          severity: 'error',
          message: 'The docker compose plugin is not available',
          hint: 'Use the official stacky image, which bundles docker compose.',
        },
  )

  try {
    await fs.access(input.stacksDir, fs.constants.R_OK | fs.constants.W_OK)
    checks.push({
      id: 'stacks-dir',
      ok: true,
      severity: 'info',
      message: `Stacks directory ${input.stacksDir} is writable`,
    })
  } catch {
    checks.push({
      id: 'stacks-dir',
      ok: false,
      severity: 'error',
      message: `Stacks directory ${input.stacksDir} is missing or not writable`,
      hint: `Mount it into the container, e.g. "${input.stacksDir}:${input.stacksDir}".`,
    })
  }

  if (input.self) checks.push(...containerChecks(input.stacksDir, input.self))
  return checks
}

/** Checks that only apply when stacky runs inside a container. */
export function containerChecks(stacksDir: string, self: SelfIdentity): PreflightCheck[] {
  const checks: PreflightCheck[] = []
  const stacksMount = self.mounts
    .filter((m) => isWithin(m.destination, stacksDir))
    .sort((a, b) => b.destination.length - a.destination.length)[0]

  if (!stacksMount) {
    checks.push({
      id: 'stacks-mount',
      ok: false,
      severity: 'error',
      message: `${stacksDir} is not mounted from the host`,
      hint: `Stacks would be lost when the container is recreated. Add the volume "${stacksDir}:${stacksDir}".`,
    })
  } else if (stacksMount.type === 'bind' && stacksMount.source !== stacksMount.destination) {
    checks.push({
      id: 'stacks-mount',
      ok: false,
      severity: 'error',
      message: `The stacks directory is mounted from ${stacksMount.source} but appears at ${stacksMount.destination} inside the container`,
      hint: `docker compose resolves relative paths inside stacky but the engine uses them on the host, so bind mounts in your stacks would point to the wrong place. Mount it at the same path on both sides: "${stacksMount.source}:${stacksMount.source}" and set STACKY_STACKS_DIR=${stacksMount.source}.`,
    })
  } else {
    checks.push({
      id: 'stacks-mount',
      ok: true,
      severity: 'info',
      message: 'Stacks directory has the same path on the host and in the container',
    })
  }

  const socket = self.mounts.find((m) => m.destination === '/var/run/docker.sock')
  if (socket && !socket.rw) {
    checks.push({
      id: 'docker-socket',
      ok: false,
      severity: 'error',
      message: 'The Docker socket is mounted read-only',
      hint: 'Stacky needs write access to deploy stacks; remove ":ro" from the socket mount.',
    })
  }

  checks.push(
    self.project && self.workingDir
      ? {
          id: 'self-update',
          ok: true,
          severity: 'info',
          message: `Stacky runs from compose project "${self.project}" and can update itself`,
        }
      : {
          id: 'self-update',
          ok: false,
          severity: 'warning',
          message: 'Stacky was not started with docker compose, so it cannot update itself',
          hint: 'Run stacky from a compose file in your stacks directory to enable self-update.',
        },
  )
  return checks
}

function isWithin(parent: string, child: string) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
