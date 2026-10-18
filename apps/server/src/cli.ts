import path from 'node:path'
import { applyJob } from './self/helper'
import { JobStore } from './self/jobs'

// Helper subcommands; `self-update apply <job>` runs inside the updater container.
const [command, sub, id] = process.argv.slice(2)

if (command === 'self-update' && sub === 'apply' && id) {
  const dataDir = path.resolve(process.env.STACKY_DATA_DIR ?? '/app/data')
  const store = new JobStore(path.join(dataDir, 'self-update'))
  const log = (line: string) => line && console.log(`[stacky-updater] ${line.trimEnd()}`)
  process.exit(
    await applyJob(store, id, { dockerBin: process.env.STACKY_DOCKER_BIN ?? 'docker', log }),
  )
}

console.error(`usage: cli.js self-update apply <job-id>`)
process.exit(2)
