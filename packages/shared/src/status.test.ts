import { describe, expect, it } from 'vitest'
import { containerState, parseExitCode, serviceState, stackStatus } from './status'

describe('parseExitCode', () => {
  it('extracts the exit code from docker status text', () => {
    expect(parseExitCode('Exited (0) 2 minutes ago')).toBe(0)
    expect(parseExitCode('Exited (137) About an hour ago')).toBe(137)
    expect(parseExitCode('Up 2 hours')).toBeUndefined()
  })
})

describe('containerState', () => {
  it('reads health from the running status text', () => {
    expect(containerState({ state: 'running', status: 'Up 2 hours (healthy)' })).toBe('healthy')
    expect(containerState({ state: 'running', status: 'Up 1 minute (unhealthy)' })).toBe(
      'unhealthy',
    )
    expect(containerState({ state: 'running', status: 'Up 3 seconds (health: starting)' })).toBe(
      'starting',
    )
    expect(containerState({ state: 'running', status: 'Up 2 hours' })).toBe('running')
  })

  it('treats a successful one-shot container as completed', () => {
    expect(
      containerState({ state: 'exited', status: 'Exited (0) 1 hour ago', restartPolicy: 'no' }),
    ).toBe('completed')
    expect(
      containerState({
        state: 'exited',
        status: 'Exited (0) 1 hour ago',
        restartPolicy: 'on-failure',
      }),
    ).toBe('completed')
  })

  it('treats a stopped long-running container as exited, not completed', () => {
    expect(
      containerState({
        state: 'exited',
        status: 'Exited (0) 1 hour ago',
        restartPolicy: 'unless-stopped',
      }),
    ).toBe('exited')
    expect(
      containerState({
        state: 'exited',
        status: 'Exited (137) 1 hour ago',
        restartPolicy: 'always',
      }),
    ).toBe('exited')
  })

  it('treats a crash as an error', () => {
    expect(
      containerState({ state: 'exited', status: 'Exited (1) 1 hour ago', restartPolicy: 'no' }),
    ).toBe('error')
    expect(containerState({ state: 'dead', status: 'Dead' })).toBe('error')
  })
})

describe('serviceState', () => {
  it('is not_created without containers', () => {
    expect(serviceState([])).toBe('not_created')
  })

  it('reports the worst replica', () => {
    expect(serviceState(['healthy', 'unhealthy'])).toBe('unhealthy')
    expect(serviceState(['running', 'running'])).toBe('running')
  })
})

describe('stackStatus', () => {
  it('is inactive when nothing has been created', () => {
    expect(stackStatus([])).toBe('inactive')
    expect(stackStatus(['not_created', 'not_created'])).toBe('inactive')
  })

  it('is running when services are up, healthy or completed one-shots', () => {
    expect(stackStatus(['running', 'healthy', 'completed'])).toBe('running')
  })

  it('does not report a stack with a finished init container as exited (Dockge #177)', () => {
    expect(stackStatus(['completed', 'running'])).toBe('running')
  })

  it('is partial when some services are down', () => {
    expect(stackStatus(['running', 'exited'])).toBe('partial')
    expect(stackStatus(['running', 'not_created'])).toBe('partial')
  })

  it('is unhealthy when an up stack has an unhealthy or crashed service', () => {
    expect(stackStatus(['running', 'unhealthy'])).toBe('unhealthy')
    expect(stackStatus(['running', 'error'])).toBe('unhealthy')
    expect(stackStatus(['restarting'])).toBe('unhealthy')
  })

  it('is starting while a healthcheck is pending', () => {
    expect(stackStatus(['running', 'starting'])).toBe('starting')
  })

  it('is stopped or error when nothing is up', () => {
    expect(stackStatus(['exited', 'completed'])).toBe('stopped')
    expect(stackStatus(['exited', 'error'])).toBe('error')
  })
})
