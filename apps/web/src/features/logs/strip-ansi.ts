// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
