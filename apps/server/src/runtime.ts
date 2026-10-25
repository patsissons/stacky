import path from 'node:path'
import type { SystemInfo } from '@stacky/shared'
import { AuthService, loadAuthSecret } from './auth'
import type { Config } from './config'
import { openDatabase } from './db'
import { createDockerClient } from './docker/client'
import { ContainerLister } from './docker/containers'
import { AppError } from './lib/errors'
import { createLogger, type Logger } from './lib/logger'
import { OperationEngine } from './ops/engine'
import { detectSelf, type SelfIdentity } from './self/identity'
import { runPreflight } from './self/preflight'
import { ReleaseChecker } from './self/release'
import { SelfUpdater } from './self/updater'
import { StackRepository } from './stacks/repository'
import { RevisionStore } from './stacks/revisions'
import { StackService } from './stacks/service'
import { StackState } from './stacks/state'
import { SettingsStore } from './db/settings'
import { FileBrowser } from './files/browser'
import { IconCache } from './icons/icons'
import { AuditLog } from './auth/audit'
import { ApiTokenStore } from './auth/tokens'
import { resolveHostName } from './notify/host-name'
import { Notifier } from './notify/notifier'
import { NotifyPolicy } from './notify/policy'
import { GitSync } from './git/sync'
import { UpdateChecker } from './updates/checker'
import { loadDockerCredentials, loadEnvCredentials, RegistryClient } from './updates/registry'
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
  const settings = new SettingsStore(db)
  const icons = new IconCache(path.join(config.dataDir, 'icons'), config.iconCdn)
  const files = new FileBrowser({ stacks: config.stacksDir, data: config.dataDir })
  const tokens = new ApiTokenStore(db)
  const audit = new AuditLog(db)
  const updates = new UpdateChecker(
    state,
    docker,
    // variables win over a mounted docker config.json for the same registry
    new RegistryClient(
      new Map([
        ...loadDockerCredentials(),
        ...loadEnvCredentials(process.env, (message, meta) => logger.warn(message, meta)),
      ]),
    ),
    db,
    settings,
    logger,
    config.updateSchedule,
  )
  stacks.updates = updates
  stacks.revisions = new RevisionStore(db)
  const gitSync = new GitSync(repo, settings, logger, (stack) =>
    stacks.stackAction(stack, 'deploy'),
  )
  repo.onChange = (paths, message) => gitSync.onChange(paths, message)
  gitSync.schedule()
  const notifier = new Notifier(settings, logger, config.baseUrl)
  const notifyPolicy = new NotifyPolicy(settings, state, logger, (ref) =>
    updates.containersUsing(ref),
  )
  notifier.policy = notifyPolicy
  notifier.stacksUsing = (ref) => updates.stacksUsing(ref)
  void resolveHostName(config.displayName, docker).then((name) => (notifier.hostName = name))
  engine.on('update', (op) => notifier.onOperation(op))
  updates.on('change', (summary) => notifier.onUpdates(summary))
  state.on('change', (list) => notifier.onStacks(list))
  setInterval(() => notifier.tick(), 15_000).unref()
  const releases = new ReleaseChecker(config.updateCheck && /^\d/.test(VERSION))
  // keep the release banner and the badge on stacky's own image in sync: finding either update
  // looks for the other right away (the image reaches the registry a little after the release)
  updates.selfRelease = () => !!releases.peek(VERSION)
  releases.on('change', () => {
    if (releases.peek(VERSION)) void updates.checkSelf()
  })
  updates.onSelfChecked = (result) => {
    if (result.status === 'update_available' && !releases.peek(VERSION)) void releases.refresh()
  }
  // known without anyone opening the UI
  const refreshRelease = () => void releases.available(VERSION)
  refreshRelease()
  setInterval(refreshRelease, 60 * 60_000).unref()
  const hub = new Hub(state, engine, docker, logger, updates, releases)

  let auth: AuthService | undefined
  if (!config.authDisabled) {
    auth = await AuthService.create({
      sqlite,
      secret: loadAuthSecret(config.dataDir, process.env.STACKY_AUTH_SECRET),
      baseUrl: config.baseUrl,
      logger,
      rateLimit: authRateLimit,
      trustForwardedFor: config.trustedProxies.length > 0,
      oidc: config.oidc,
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

  const selfUpdater = new SelfUpdater(
    docker,
    engine,
    config,
    self,
    VERSION,
    releases,
    logger,
    dockerBin,
  )
  selfUpdater.onJobFinal = (job) => notifier.onSelfJob(job, VERSION)
  stacks.selfUpdate = (_stack, action, options) => {
    if (action === 'update-to')
      return selfUpdater.run('update', { targetVersion: options.services?.[0] })
    if (action === 'deploy' || action === 'update') return selfUpdater.run(action)
    if (action === 'start' || action === 'restart' || action === 'recreate')
      return selfUpdater.run('restart')
    throw new AppError(
      409,
      'self_stack',
      `"${action}" would stop stacky itself`,
      'Stop or remove stacky from the host with docker compose instead.',
    )
  }
  await selfUpdater
    .reconcile()
    .catch((err) => logger.warn('self-update reconcile failed', { err: String(err) }))
  if (self)
    logger.info('running in container', {
      id: self.containerId.slice(0, 12),
      project: self.project,
    })

  const system = async (): Promise<SystemInfo> => {
    let dockerInfo: SystemInfo['docker']
    let dockerError: string | undefined
    const composeVersion = await stacks.composeVersion()
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
      dockerHost: config.dockerHost,
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
  updates.start()
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
    selfUpdater,
    system,
    settings,
    updates,
    notifier,
    notifyPolicy,
    tokens,
    audit,
    gitSync,
    icons,
    files,
    stop() {
      gitSync.stop()
      updates.stop()
      state.stop()
      sqlite.close()
    },
  }
}
