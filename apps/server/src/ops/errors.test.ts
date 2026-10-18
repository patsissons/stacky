import { describe, expect, it } from 'vitest'
import { classifyFailure, stripAnsi } from './errors'

// Real-world compose / docker stderr samples.
const samples: [string, string, RegExp][] = [
  [
    'Error response from daemon: driver failed programming external connectivity on endpoint app-web-1 (abc): Bind for 0.0.0.0:8080 failed: port is already allocated',
    'port_in_use',
    /Port 8080/,
  ],
  [
    'Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:5432 -> 0.0.0.0:0: listen tcp 0.0.0.0:5432: bind: address already in use',
    'port_in_use',
    /5432/,
  ],
  [
    "Error response from daemon: pull access denied for myorg/private, repository does not exist or may require 'docker login'",
    'image_access_denied',
    /myorg\/private/,
  ],
  [
    'Error response from daemon: manifest for nginx:9.99 not found: manifest unknown: manifest unknown',
    'image_not_found',
    /nginx:9\.99/,
  ],
  [
    'Error response from daemon: toomanyrequests: You have reached your unauthenticated pull rate limit.',
    'registry_rate_limited',
    /rate limit/,
  ],
  [
    'required variable DB_PASSWORD is missing a value: set it in .env',
    'env_missing_variable',
    /DB_PASSWORD/,
  ],
  [
    'invalid interpolation format for services.web.environment.A.\nYou may need to escape any $ with another $.',
    'env_interpolation',
    /services\.web/,
  ],
  [
    "validating /opt/stacks/app/compose.yaml: services.web additional properties 'imagee' not allowed",
    'compose_invalid',
    /imagee/,
  ],
  ['yaml: line 4: mapping values are not allowed in this context', 'compose_yaml', /line 4/],
  ['network proxy declared as external, but could not be found', 'network_not_found', /proxy/],
  [
    'Error response from daemon: Conflict. The container name "/postgres" is already in use by container "abc".',
    'container_name_conflict',
    /postgres/,
  ],
  ['dependency failed to start: container app-db-1 is unhealthy', 'dependency_failed', /app-db-1/],
  [
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'docker_unavailable',
    /Docker engine/,
  ],
  [
    'Error response from daemon: client version 1.53 is too new. Maximum supported API version is 1.43',
    'docker_api_version',
    /API version/,
  ],
  ['write /var/lib/docker/tmp/x: no space left on device', 'disk_full', /disk space/],
]

describe('classifyFailure', () => {
  it.each(samples)('classifies %s', (output, code, message) => {
    const err = classifyFailure(output, 1)
    expect(err.code).toBe(code)
    expect(err.message).toMatch(message)
  })

  it('ignores ANSI colour codes', () => {
    const err = classifyFailure(
      '\x1b[31mBind for 0.0.0.0:80 failed: port is already allocated\x1b[0m',
    )
    expect(err.code).toBe('port_in_use')
  })

  it('falls back to the last output line', () => {
    const err = classifyFailure('step 1\nError response from daemon: something odd happened\n', 1)
    expect(err).toEqual({ code: 'command_failed', message: 'something odd happened' })
  })

  it('falls back to the exit code with no output', () => {
    expect(classifyFailure('', 3).message).toBe('Command failed with exit code 3')
  })
})

describe('stripAnsi', () => {
  it('removes colour and cursor sequences', () => {
    expect(stripAnsi('\x1b[1;32mok\x1b[0m \x1b[2K')).toBe('ok ')
  })
})
