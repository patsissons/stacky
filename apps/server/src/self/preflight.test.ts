import { describe, expect, it } from 'vitest'
import { containerIdFromCgroup, containerIdFromMountinfo, type SelfIdentity } from './identity'
import { containerChecks } from './preflight'

const ID = 'a'.repeat(64)

function self(mounts: SelfIdentity['mounts'], compose = true): SelfIdentity {
  return {
    containerId: ID,
    name: 'stacky',
    image: 'ghcr.io/patsissons/stacky:latest',
    imageId: 'sha256:1',
    project: compose ? 'stacky' : undefined,
    service: compose ? 'stacky' : undefined,
    workingDir: compose ? '/opt/stacks/stacky' : undefined,
    mounts,
    securityOpt: [],
  }
}

const sock = {
  type: 'bind',
  source: '/var/run/docker.sock',
  destination: '/var/run/docker.sock',
  rw: true,
}

describe('container id detection', () => {
  it('reads the id from mountinfo', () => {
    const line = `612 590 0:59 /docker/containers/${ID}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`
    expect(containerIdFromMountinfo(`other\n${line}\n`)).toBe(ID)
  })

  it('reads the id from a cgroup v1 path', () => {
    expect(containerIdFromCgroup(`12:pids:/docker/${ID}\n`)).toBe(ID)
    expect(containerIdFromCgroup('0::/\n')).toBeUndefined()
  })
})

describe('containerChecks', () => {
  const byId = (checks: ReturnType<typeof containerChecks>, id: string) =>
    checks.find((c) => c.id === id)

  it('passes when the stacks dir is mounted at the same path', () => {
    const checks = containerChecks(
      '/opt/stacks',
      self([sock, { type: 'bind', source: '/opt/stacks', destination: '/opt/stacks', rw: true }]),
    )
    expect(byId(checks, 'stacks-mount')?.ok).toBe(true)
    expect(byId(checks, 'self-update')?.ok).toBe(true)
  })

  it('explains the path rule when host and container paths differ', () => {
    const check = byId(
      containerChecks(
        '/stacks',
        self([sock, { type: 'bind', source: '/srv/stacks', destination: '/stacks', rw: true }]),
      ),
      'stacks-mount',
    )
    expect(check?.ok).toBe(false)
    expect(check?.hint).toContain('/srv/stacks:/srv/stacks')
  })

  it('errors when the stacks dir is not mounted at all', () => {
    expect(byId(containerChecks('/opt/stacks', self([sock])), 'stacks-mount')?.severity).toBe(
      'error',
    )
  })

  it('flags a read-only socket and non-compose deployments', () => {
    const checks = containerChecks(
      '/opt/stacks',
      self(
        [
          { ...sock, rw: false },
          { type: 'bind', source: '/opt/stacks', destination: '/opt/stacks', rw: true },
        ],
        false,
      ),
    )
    expect(byId(checks, 'docker-socket')?.ok).toBe(false)
    expect(byId(checks, 'self-update')?.severity).toBe('warning')
  })
})
