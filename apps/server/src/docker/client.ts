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

/** Uses DOCKER_HOST when set, otherwise the default local socket. */
export function createDockerClient(): Docker {
  return new Docker()
}
