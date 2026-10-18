import type { OperationError } from '@stacky/shared'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

interface Rule {
  code: string
  test: RegExp
  message: (m: RegExpMatchArray) => string
  hint?: (m: RegExpMatchArray) => string
}

/**
 * Patterns for the docker / compose failures people actually hit, turned into
 * a readable message and a concrete next step. Order matters: the first match
 * wins, so more specific rules come first.
 */
const RULES: Rule[] = [
  {
    code: 'port_in_use',
    test: /Bind for (?:\S+?):(\d+) failed: port is already allocated|listen tcp[46]? (?:\S*?):(\d+): bind: address already in use|ports are not available: .*?:(\d+)/i,
    message: (m) => `Port ${m[1] ?? m[2] ?? m[3]} is already in use`,
    hint: () =>
      'Another container or process on the host is using this port. Change the host side of the port mapping in the compose file, or stop whatever is using it.',
  },
  {
    code: 'registry_rate_limited',
    test: /toomanyrequests|You have reached your (?:unauthenticated )?pull rate limit/i,
    message: () => 'The registry rate limit was reached',
    hint: () =>
      'Docker Hub limits anonymous pulls. Wait a while, or log in on the host (`docker login`) to get a higher limit.',
  },
  {
    code: 'image_access_denied',
    test: /pull access denied for ([^\s,]+)|denied: requested access to the resource is denied|unauthorized: authentication required/i,
    message: (m) =>
      m[1] ? `Access to image "${m[1]}" was denied` : 'Access to the image was denied',
    hint: () =>
      'Check the image name for typos. If the image is private, run `docker login <registry>` on the host so stacky can use the credentials.',
  },
  {
    code: 'image_not_found',
    test: /manifest for (\S+) not found|manifest unknown|(?:\S+): not found(?=\s*$)|no matching manifest for ([^\s]+)/im,
    message: (m) =>
      m[2]
        ? `The image has no build for this platform (${m[2]})`
        : m[1]
          ? `Image "${m[1]}" was not found`
          : 'The image or tag was not found',
    hint: () => 'Check that the image name and tag exist in the registry.',
  },
  {
    code: 'env_missing_variable',
    test: /required variable (\S+) is missing a value(?::\s*(.*))?/i,
    message: (m) => `Required variable ${m[1]} has no value`,
    hint: (m) =>
      `${m[2] ? m[2].trim() + '. ' : ''}Set ${m[1]} in the stack's .env file or in global.env.`,
  },
  {
    code: 'env_interpolation',
    test: /invalid interpolation format for (\S+)/i,
    message: (m) => `Invalid variable substitution in ${m[1]}`,
    hint: () => 'Use ${VAR}, ${VAR:-default} or escape a literal dollar sign as $$.',
  },
  {
    code: 'env_file_missing',
    test: /env file (\S+) not found|Couldn't find env file:? (\S+)/i,
    message: (m) => `Env file ${m[1] ?? m[2]} does not exist`,
    hint: () => 'Create the file or remove it from env_file in the compose file.',
  },
  {
    code: 'compose_yaml',
    test: /(?:^|[\s(])yaml: (?:line (\d+): )?(.+)/im,
    message: (m) => `The compose file is not valid YAML${m[1] ? ` (line ${m[1]})` : ''}: ${m[2]}`,
    hint: () => 'Fix the syntax error in the editor; the line is highlighted.',
  },
  {
    code: 'compose_invalid',
    test: /validating (?:\S+): (.+)/i,
    message: (m) => `The compose file is invalid: ${m[1]}`,
    hint: () => 'Check the highlighted key against the Compose specification.',
  },
  {
    code: 'network_not_found',
    test: /network (\S+) declared as external, but could not be found/i,
    message: (m) => `External network ${m[1]} does not exist`,
    hint: (m) =>
      `Create it with \`docker network create ${m[1]}\`, or deploy the stack that owns it first.`,
  },
  {
    code: 'volume_not_found',
    test: /external volume "?([^"\s]+)"? not found/i,
    message: (m) => `External volume ${m[1]} does not exist`,
    hint: (m) => `Create it with \`docker volume create ${m[1]}\`.`,
  },
  {
    code: 'container_name_conflict',
    test: /The container name "\/?([^"]+)" is already in use/i,
    message: (m) => `A container named "${m[1]}" already exists`,
    hint: () =>
      'Another stack or a manually created container uses this container_name. Remove or rename one of them.',
  },
  {
    code: 'dependency_failed',
    test: /dependency failed to start: container (\S+) (is unhealthy|exited \(\d+\))/i,
    message: (m) => `Dependency ${m[1]} ${m[2]}`,
    hint: () => 'Open the logs of that service to see why it is not healthy.',
  },
  {
    code: 'unknown_service',
    test: /no such service: (\S+)/i,
    message: (m) => `Service ${m[1]} is not defined in the compose file`,
  },
  {
    code: 'build_failed',
    test: /failed to solve:? (.+)|failed to build/i,
    message: (m) => (m[1] ? `Image build failed: ${m[1]}` : 'Image build failed'),
    hint: () => 'Scroll up in the output to find the failing build step.',
  },
  {
    code: 'disk_full',
    test: /no space left on device/i,
    message: () => 'The host is out of disk space',
    hint: () => 'Free up space, e.g. with `docker system prune`.',
  },
  {
    code: 'docker_api_version',
    test: /client version (\S+) is too new|client version (\S+) is too old|API version .* is too old/i,
    message: () => 'The Docker CLI in stacky and the Docker engine do not agree on an API version',
    hint: () => 'Upgrade the Docker engine on the host, or set DOCKER_API_VERSION.',
  },
  {
    code: 'docker_unavailable',
    test: /Cannot connect to the Docker daemon|permission denied while trying to connect to the docker API|dial unix \S+docker\.sock/i,
    message: () => 'Stacky cannot reach the Docker engine',
    hint: () =>
      'Mount /var/run/docker.sock into the stacky container and make sure Docker is running.',
  },
]

/** Classifies failed command output into a user-facing error. */
export function classifyFailure(output: string, exitCode?: number): OperationError {
  const text = stripAnsi(output)
  for (const rule of RULES) {
    const m = text.match(rule.test)
    if (m) return { code: rule.code, message: rule.message(m), hint: rule.hint?.(m) }
  }
  const lastLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  return {
    code: 'command_failed',
    message: lastLine
      ? lastLine.replace(/^Error(?: response from daemon)?:\s*/i, '')
      : `Command failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`,
  }
}
