// Bundles the server into dist/ with esbuild. Native and optional-native
// dependencies stay external and are installed in the image via `pnpm deploy`.
import fs from 'node:fs'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external: ['better-sqlite3', 'dockerode', 'ssh2', 'cpu-features'],
  banner: {
    // esbuild ESM output needs a require() shim for bundled CJS dependencies.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})

// Drizzle reads SQL migrations from disk at startup.
fs.rmSync('dist/migrations', { recursive: true, force: true })
fs.cpSync('src/db/migrations', 'dist/migrations', { recursive: true })
