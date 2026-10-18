import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ValidationIssue, ValidationResult } from '@stacky/shared'
import { runCapture } from '../lib/run'
import { stripAnsi } from '../ops/errors'
import { parseCompose } from './compose-file'

export interface ValidateInput {
  /** Stack directory: relative paths in the compose file resolve against it. */
  dir: string
  compose: string
  env?: string
  globalEnv?: string
  dockerBin?: string
}

/**
 * Validates unsaved compose text the same way a deploy would: a YAML parse for
 * instant positions, then `docker compose config` (fed on stdin) for the
 * authoritative answer, including variable interpolation.
 */
export async function validateCompose(input: ValidateInput): Promise<ValidationResult> {
  const parsed = parseCompose(input.compose)
  if (parsed.error) {
    return {
      ok: false,
      issues: [
        {
          message: parsed.error.message,
          line: parsed.error.line,
          column: parsed.error.column,
          severity: 'error',
          source: 'yaml',
        },
      ],
    }
  }

  let tmpDir: string | undefined
  try {
    const args = ['compose', '--ansi', 'never', '--project-directory', input.dir, '-f', '-']
    const envFiles: string[] = []
    if (input.globalEnv) envFiles.push(input.globalEnv)
    if (input.env !== undefined) {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacky-validate-'))
      const envPath = path.join(tmpDir, '.env')
      await fs.writeFile(envPath, input.env)
      envFiles.push(envPath)
    } else if (input.globalEnv) {
      const stackEnv = path.join(input.dir, '.env')
      if (await exists(stackEnv)) envFiles.push(stackEnv)
    }
    for (const f of envFiles) args.push('--env-file', f)
    args.push('config', '--quiet')

    const result = await runCapture(input.dockerBin ?? 'docker', args, {
      cwd: (await exists(input.dir)) ? input.dir : undefined,
      stdin: input.compose,
      timeoutMs: 20_000,
    })
    if (result.code === 0) {
      const warnings = parseWarnings(result.stderr)
      return { ok: true, issues: warnings }
    }
    return { ok: false, issues: [composeIssue(result.stderr || result.stdout, input.compose)] }
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function parseWarnings(stderr: string): ValidationIssue[] {
  return stripAnsi(stderr)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(time=.*level=warning|WARN)/i.test(l))
    .map((l) => ({
      message: l
        .replace(/^time="[^"]*" level=warning msg=/, '')
        .replace(/^"|"$/g, '')
        .replace(/\\"/g, '"'),
      severity: 'warning' as const,
      source: 'compose' as const,
    }))
}

/** Turns compose's error text into an issue, locating the offending key when possible. */
export function composeIssue(stderr: string, compose: string): ValidationIssue {
  const text = stripAnsi(stderr).trim()
  const message =
    text
      .split('\n')
      .filter((l) => !/level=warning/.test(l))
      .join('\n')
      .replace(/^validating \S+: /, '')
      .trim() || 'docker compose rejected the file'
  const yamlLine = /yaml: line (\d+)/.exec(text)
  if (yamlLine) {
    return { message, line: Number(yamlLine[1]), severity: 'error', source: 'compose' }
  }
  return { message, line: locateKey(message, compose), severity: 'error', source: 'compose' }
}

/** Best effort: map "services.web.imagee" style paths in an error to a line number. */
export function locateKey(message: string, compose: string): number | undefined {
  const pathMatch = /\b(services|networks|volumes|configs|secrets)\.([\w.-]+)/.exec(message)
  const extra = /'([^']+)'/.exec(message)?.[1]
  if (!pathMatch) return undefined
  const keys = [pathMatch[1]!, ...pathMatch[2]!.split('.')]
  if (extra && !keys.includes(extra)) keys.push(extra)
  const lines = compose.split('\n')
  let line = 0
  let indent = -1
  for (const key of keys) {
    const re = new RegExp(`^(\\s*)${escapeRe(key)}\\s*:`)
    let found = false
    for (let i = line; i < lines.length; i++) {
      const m = re.exec(lines[i]!)
      if (m && m[1]!.length > indent) {
        line = i
        indent = m[1]!.length
        found = true
        break
      }
    }
    if (!found) break
  }
  return indent >= 0 ? line + 1 : undefined
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
