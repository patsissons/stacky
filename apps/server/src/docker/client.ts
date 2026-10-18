import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Docker from 'dockerode'

/** Compose labels stacky relies on (see docker/compose pkg/api/labels.go). */
export const LABELS = {
  project: 'com.docker.compose.project',
  service: 'com.docker.compose.service',
  number: 'com.docker.compose.container-number',
  oneoff: 'com.docker.compose.oneoff',
  workingDir: 'com.docker.compose.project.working_dir',
  configFiles: 'com.docker.compose.project.config_files',
  envFile: 'com.docker.compose.project.environment_file',
  image: 'com.docker.compose.image',
} as const

/**
 * Where to find the engine when DOCKER_HOST is not set: the standard socket,
 * then rootless docker, Docker Desktop and OrbStack locations.
 */
export function socketCandidates(env: NodeJS.ProcessEnv = process.env, home = os.homedir()) {
  return [
    '/var/run/docker.sock',
    env.XDG_RUNTIME_DIR ? path.join(env.XDG_RUNTIME_DIR, 'docker.sock') : undefined,
    path.join(home, '.docker', 'run', 'docker.sock'),
    path.join(home, '.orbstack', 'run', 'docker.sock'),
  ].filter((p): p is string => !!p)
}

/**
 * Uses DOCKER_HOST when set; otherwise the first socket that exists. The
 * chosen socket is exported as DOCKER_HOST so the docker CLI agrees.
 */
export function createDockerClient(env: NodeJS.ProcessEnv = process.env): Docker {
  if (env.DOCKER_HOST) return new Docker()
  const socketPath = socketCandidates(env).find((p) => fs.existsSync(p)) ?? '/var/run/docker.sock'
  if (socketPath !== '/var/run/docker.sock') env.DOCKER_HOST = `unix://${socketPath}`
  return new Docker({ socketPath })
}
