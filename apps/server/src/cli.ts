// Entry point for helper subcommands (e.g. `self-update apply`), filled in by later phases.
const [command] = process.argv.slice(2)

console.error(`unknown command: ${command ?? '(none)'}`)
process.exit(2)
