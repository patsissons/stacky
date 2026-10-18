import type { Duplex } from 'node:stream'
import type Docker from 'dockerode'

export interface ExecSession {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

/** Prefers bash, falls back to sh, so the user gets the best shell the image has. */
export const AUTO_SHELL = [
  '/bin/sh',
  '-c',
  'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi',
]

export function shellCommand(shell: string | undefined): string[] {
  if (!shell || shell === 'auto') return AUTO_SHELL
  if (!/^[\w/.-]+$/.test(shell)) throw new Error(`invalid shell "${shell}"`)
  return [shell]
}

/** Opens an interactive TTY exec session in a running container. */
export async function openExec(
  docker: Docker,
  containerId: string,
  shell: string | undefined,
  size: { cols: number; rows: number },
  onData: (data: string) => void,
  onExit: (code: number | undefined) => void,
): Promise<ExecSession> {
  const container = docker.getContainer(containerId)
  const exec = await container.exec({
    Cmd: shellCommand(shell),
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color', `COLUMNS=${size.cols}`, `LINES=${size.rows}`],
  })
  const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as Duplex
  stream.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')))
  stream.on('end', async () => {
    try {
      const info = await exec.inspect()
      onExit(info.ExitCode ?? undefined)
    } catch {
      onExit(undefined)
    }
  })
  await exec.resize({ h: size.rows, w: size.cols }).catch(() => {})
  return {
    write: (data) => stream.write(data),
    resize: (cols, rows) => void exec.resize({ h: rows, w: cols }).catch(() => {}),
    close: () => stream.destroy(),
  }
}
