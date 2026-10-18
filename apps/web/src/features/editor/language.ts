/** Monaco language id for a file in a stack directory. */
export function languageFor(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (name === '.env' || name.endsWith('.env') || name.startsWith('.env.')) return 'ini'
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'dockerfile'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  const map: Record<string, string> = {
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    toml: 'ini',
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',
    sh: 'shell',
    bash: 'shell',
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    md: 'markdown',
    xml: 'xml',
    html: 'html',
    css: 'css',
    sql: 'sql',
    lua: 'lua',
    caddyfile: 'plaintext',
  }
  return map[ext] ?? 'plaintext'
}

const SECRET_KEY = /(pass(word)?|secret|token|key|credential|auth|private)/i

/** Masks values of secret-looking keys in .env text for display. */
export function maskEnv(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/.exec(line)
      if (!m || !SECRET_KEY.test(m[2]!) || !m[4]) return line
      // fixed width so the mask doesn't reveal the value's length
      return `${m[1]}${m[2]}${m[3]}••••••••`
    })
    .join('\n')
}

export function hasSecrets(text: string): boolean {
  return maskEnv(text) !== text
}
