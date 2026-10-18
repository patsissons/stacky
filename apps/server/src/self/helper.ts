import fs from 'node:fs/promises'
import { runCapture } from '../lib/run'
import type { JobStore, SelfUpdateJob } from './jobs'

/** `docker compose` arguments that address stacky's own project exactly as it was started. */
export async function projectArgs(job: SelfUpdateJob): Promise<string[]> {
  const args = [
    'compose',
    '--ansi',
    'never',
    '-p',
    job.project,
    '--project-directory',
    job.workingDir,
  ]
  for (const f of job.configFiles) args.push('-f', f)
  for (const f of job.envFiles) {
    // compose records env files it used; skip any that have since disappeared
    if (await exists(f)) args.push('--env-file', f)
  }
  return args
}

/** Recreates only stacky's service and waits until it is running (and healthy). */
export async function upArgs(job: SelfUpdateJob): Promise<string[]> {
  return [
    ...(await projectArgs(job)),
    'up',
    '--detach',
    '--no-deps',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '180',
    job.service,
  ]
}

const tail = (text: string, n = 4000) => text.slice(-n)

/**
 * Runs inside the short-lived updater container (`stacky self-update apply <id>`).
 * The updater keeps running while stacky's own container is replaced, so the
 * swap is never interrupted. If the new version doesn't come up healthy, the
 * previous compose file and image are restored and started again.
 */
export async function applyJob(
  store: JobStore,
  id: string,
  {
    dockerBin = 'docker',
    log = console.log,
  }: { dockerBin?: string; log?: (line: string) => void } = {},
): Promise<number> {
  const job = await store.read(id)
  if (!job) {
    log(`job ${id} not found`)
    return 2
  }
  if (job.state !== 'pending') {
    log(`job ${id} is already ${job.state}`)
    return 0
  }

  log(`updating ${job.project}/${job.service}: ${job.from.ref} -> ${job.to.ref}`)
  const up = await runCapture(dockerBin, await upArgs(job), { timeoutMs: 10 * 60_000 })
  log(up.stdout + up.stderr)
  if (up.code === 0) {
    await store.write({
      ...job,
      state: 'applied',
      finishedAt: Date.now(),
      log: tail(up.stdout + up.stderr),
    })
    log('new version is up')
    return 0
  }

  log('new version failed to start; rolling back')
  for (const backup of job.composeBackups ?? []) {
    await fs.writeFile(backup.file, backup.content)
  }
  // a moving tag may now point at the new image; point it back at the old one
  await runCapture(dockerBin, ['tag', job.from.imageId, job.from.ref])
  const back = await runCapture(dockerBin, await upArgs(job), { timeoutMs: 10 * 60_000 })
  log(back.stdout + back.stderr)
  await store.write({
    ...job,
    state: back.code === 0 ? 'rolled_back' : 'failed',
    finishedAt: Date.now(),
    error: tail(up.stderr || up.stdout, 1500).trim() || `exit code ${up.code}`,
    log: tail(`${up.stdout}${up.stderr}\n--- rollback ---\n${back.stdout}${back.stderr}`),
  })
  return back.code === 0 ? 1 : 3
}

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
