import { describe, expect, it } from 'vitest'
import {
  composeArgs,
  displayCommand,
  planServiceAction,
  planStackAction,
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
