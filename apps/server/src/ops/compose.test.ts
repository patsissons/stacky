import { describe, expect, it } from 'vitest'
import {
  composeArgs,
  displayCommand,
  planServiceAction,
  planStackAction,
  planUpdateAction,
  type Step,
} from './compose'

const target = { dir: '/opt/stacks/app', composeFile: 'compose.yaml', hasEnv: true }
const tail = (s: Step) => (s.kind === 'docker' ? s.args.slice(composeArgs(target).length) : [])

describe('composeArgs', () => {
  it('relies on compose reading .env by default when there is no global.env', () => {
    expect(composeArgs(target)).toEqual([
      'compose',
      '--ansi',
      'always',
      '--progress',
      'tty',
      '--project-directory',
      '/opt/stacks/app',
      '-f',
      '/opt/stacks/app/compose.yaml',
    ])
  })

  it('layers global.env before the stack .env', () => {
    const args = composeArgs({ ...target, globalEnv: '/opt/stacks/global.env' })
    expect(args.slice(-4)).toEqual([
      '--env-file',
      '/opt/stacks/global.env',
      '--env-file',
      '/opt/stacks/app/.env',
    ])
  })

  it('passes only global.env when the stack has no .env', () => {
    const args = composeArgs({ ...target, hasEnv: false, globalEnv: '/opt/stacks/global.env' })
    expect(args.slice(-2)).toEqual(['--env-file', '/opt/stacks/global.env'])
  })
})

describe('planStackAction', () => {
  it('validates before deploying', () => {
    const steps = planStackAction(target, 'deploy', {}, { running: false })
    expect(steps.map(tail)).toEqual([
      ['config', '--quiet'],
      ['up', '-d', '--remove-orphans'],
    ])
  })

  it('maps deploy options to up flags', () => {
    const steps = planStackAction(
      target,
      'deploy',
      { build: true, pull: 'always', forceRecreate: true },
      { running: true },
    )
    expect(tail(steps[1]!)).toEqual([
      'up',
      '-d',
      '--remove-orphans',
      '--build',
      '--pull',
      'always',
      '--force-recreate',
    ])
  })

  it('only restarts containers after an update when the stack was running', () => {
    expect(planStackAction(target, 'update', {}, { running: false }).map(tail)).toEqual([['pull']])
    expect(planStackAction(target, 'update', {}, { running: true }).map(tail)).toEqual([
      ['pull'],
      ['up', '-d', '--remove-orphans'],
    ])
  })

  it('can prune dangling images after an update', () => {
    const steps = planStackAction(target, 'update', { prune: true }, { running: true })
    expect(steps.at(-1)).toEqual({ kind: 'docker', args: ['image', 'prune', '--force'] })
  })

  it('removes volumes on down only when asked', () => {
    expect(tail(planStackAction(target, 'down', {}, { running: true })[0]!)).toEqual([
      'down',
      '--remove-orphans',
    ])
    expect(
      tail(planStackAction(target, 'down', { removeVolumes: true }, { running: true })[0]!),
    ).toEqual(['down', '--remove-orphans', '--volumes'])
  })
})

describe('planUpdateAction', () => {
  const plan = {
    bumps: [
      { service: 'web', from: 'nginx:1.27.3', to: 'nginx:1.28.0' },
      { service: 'worker', from: 'nginx:1.28.0', to: 'nginx:1.28.0' },
    ],
    rebuilt: ['db'],
    skipped: [{ service: 'cache', reason: 'image set from a variable' }],
  }
  const output = async (step: Step) => {
    const lines: string[] = []
    if (step.kind === 'task') await step.run({ write: (t) => lines.push(t) })
    return lines
  }

  it('prefetches newer tags by reference and re-pulls rebuilt services', async () => {
    const steps = planUpdateAction(target, 'pull', plan, {})
    expect(steps[0]?.kind).toBe('task')
    expect(await output(steps[0]!)).toEqual([
      'web: nginx:1.27.3 → nginx:1.28.0',
      'cache: skipped (image set from a variable)',
    ])
    expect(steps.slice(1).map((s) => (s.kind === 'docker' ? s.args : []))).toEqual([
      ['pull', 'nginx:1.28.0'],
      [...composeArgs(target), 'pull', 'db'],
    ])
  })

  it('has no compose pull when nothing was rebuilt', () => {
    const steps = planUpdateAction(
      target,
      'pull',
      { bumps: [plan.bumps[0]!], rebuilt: [], skipped: [] },
      {},
    )
    expect(steps.map((s) => (s.kind === 'docker' ? s.args : s.label))).toEqual([
      'newer images',
      ['pull', 'nginx:1.28.0'],
    ])
  })

  it('validates, pulls and recreates only the updated services', () => {
    const steps = planUpdateAction(target, 'deploy', plan, {})
    expect(steps[0]?.kind).toBe('task')
    expect(steps.slice(1).map(tail)).toEqual([
      ['config', '--quiet'],
      ['pull', 'web', 'worker', 'db'],
      ['up', '-d', '--remove-orphans', 'web', 'worker', 'db'],
    ])
  })

  it('prunes after deploying when asked', () => {
    const steps = planUpdateAction(target, 'deploy', plan, { prune: true })
    expect(steps.at(-1)).toEqual({ kind: 'docker', args: ['image', 'prune', '--force'] })
  })
})

describe('planServiceAction', () => {
  it('recreates a single service without touching dependencies', () => {
    expect(planServiceAction(target, 'recreate', ['web']).map(tail)).toEqual([
      ['up', '-d', '--no-deps', '--force-recreate', 'web'],
    ])
  })
})

describe('displayCommand', () => {
  it('hides global flags', () => {
    const [step] = planStackAction(
      { ...target, globalEnv: '/g.env' },
      'stop',
      { services: ['web'] },
      { running: true },
    )
    expect(displayCommand(step!)).toBe('docker compose stop web')
  })
})
