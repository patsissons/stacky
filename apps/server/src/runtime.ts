import path from 'node:path'
import type { SystemInfo } from '@stacky/shared'
import { AuthService, loadAuthSecret } from './auth'
import type { Config } from './config'
import { openDatabase } from './db'
import { createDockerClient } from './docker/client'
import { ContainerLister } from './docker/containers'
import { createLogger, type Logger } from './lib/logger'
import { runCapture } from './lib/run'
import { OperationEngine } from './ops/engine'
import { detectSelf, type SelfIdentity } from './self/identity'
import { runPreflight } from './self/preflight'
import { StackRepository } from './stacks/repository'
import { StackService } from './stacks/service'
import { StackState } from './stacks/state'
import { VERSION } from './version'
import { Hub } from './ws/hub'

export type Runtime = Awaited<ReturnType<typeof createRuntime>>

/** Builds and starts every long-lived service. */
export interface RuntimeOptions {
  /** Auth brute-force protection (disabled only in tests). */
  authRateLimit?: boolean
}

export async function createRuntime(
  config: Config,
  logger: Logger = createLogger(config.logLevel),
  { authRateLimit = true }: RuntimeOptions = {},
) {
  const dockerBin = process.env.STACKY_DOCKER_BIN ?? 'docker'
  const docker = createDockerClient()
  const { db, sqlite } = openDatabase(path.join(config.dataDir, 'stacky.db'))
  const repo = new StackRepository(config.stacksDir)
  await repo
    .ensureStacksDir()
    .catch((err) =>
      logger.warn('cannot create stacks dir', { dir: config.stacksDir, err: String(err) }),
    )
  const engine = new OperationEngine(db, logger, dockerBin)
  const state = new StackState(repo, docker, new ContainerLister(docker), logger)
  const stacks = new StackService(repo, state, engine, dockerBin)
  const hub = new Hub(state, engine, docker, logger)

  let auth: AuthService | undefined
  if (!config.authDisabled) {
    auth = await AuthService.create({
      sqlite,
      secret: loadAuthSecret(config.dataDir, process.env.STACKY_AUTH_SECRET),
      baseUrl: config.baseUrl,
      logger,
      rateLimit: authRateLimit,
      trustForwardedFor: config.trustedProxies.length > 0,
    })
    if (config.admin && auth.needsSetup()) {
      await auth.createAdmin(config.admin.username, config.admin.password)
      logger.info('created admin account from STACKY_ADMIN_USER')
    }
  } else {
    logger.warn('authentication is DISABLED (STACKY_AUTH_DISABLED=true)')
  }

  let self: SelfIdentity | undefined
  try {
    self = await detectSelf(docker, config.containerId)
  } catch {
    self = undefined
  }
  state.selfContainerId = self?.containerId
  if (self)
    logger.info('running in container', {
      id: self.containerId.slice(0, 12),
      project: self.project,
    })

  let composeVersion: string | undefined
  const system = async (): Promise<SystemInfo> => {
    let dockerInfo: SystemInfo['docker']
    let dockerError: string | undefined
    if (!composeVersion) {
      const r = await runCapture(dockerBin, ['compose', 'version', '--short'], {
        timeoutMs: 10_000,
      })
      if (r.code === 0) composeVersion = r.stdout.trim()
    }
    try {
      const v = await docker.version()
      dockerInfo = {
        version: v.Version,
        apiVersion: v.ApiVersion,
        os: v.Os,
        arch: v.Arch,
        composeVersion,
      }
    } catch (err) {
      dockerError = err instanceof Error ? err.message : String(err)
    }
    return {
      version: VERSION,
      stacksDir: config.stacksDir,
      authDisabled: config.authDisabled,
      docker: dockerInfo,
      self: self
        ? {
            containerId: self.containerId,
            project: self.project,
            service: self.service,
            image: self.image,
          }
        : undefined,
      preflight: await runPreflight({
        stacksDir: config.stacksDir,
        self,
        dockerReachable: !!dockerInfo,
        dockerError,
        composeVersion,
      }),
    }
  }

  await state.start()
  const info = await system()
  for (const check of info.preflight.filter((c) => !c.ok)) {
    logger.warn(`preflight: ${check.message}`, { hint: check.hint })
  }

  return {
    config,
    logger,
    docker,
    db,
    repo,
    engine,
    state,
    stacks,
    hub,
    auth,
    self,
    system,
    stop() {
      state.stop()
      sqlite.close()
    },
  }
}
