// Builds the app and starts the production server against throwaway
// stacks/data directories for Playwright.
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../..')
const tmp = process.env.STACKY_E2E_TMP
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(path.join(tmp, 'stacks'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })

execSync('pnpm build', { cwd: root, stdio: 'inherit' })

const child = spawn(process.execPath, [path.join(root, 'apps/server/dist/index.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    STACKY_WEB_DIR: path.join(root, 'apps/web/dist'),
    STACKY_STACKS_DIR: path.join(tmp, 'stacks'),
    STACKY_DATA_DIR: path.join(tmp, 'data'),
  },
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
