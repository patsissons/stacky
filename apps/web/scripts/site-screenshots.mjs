// Captures UI screenshots for the docs site from a running stacky.
//
//   STACKY_URL=http://localhost:5005 STACKY_USER=admin STACKY_PASSWORD=… pnpm site:screenshots
//
// Point it at an instance with a few deployed stacks; images land in
// apps/site/src/assets/screenshots.
import path from 'node:path'
import { chromium } from '@playwright/test'

const base = process.env.STACKY_URL ?? 'http://localhost:5005'
const out = path.resolve(import.meta.dirname, '../../site/src/assets/screenshots')
const stack = process.env.STACKY_STACK

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await context.newPage()

await page.goto(`${base}/login`)
if (page.url().includes('/login')) {
  await page.getByLabel('Username').fill(process.env.STACKY_USER ?? 'admin')
  await page.getByLabel('Password').fill(process.env.STACKY_PASSWORD ?? '')
  await page.getByRole('button', { name: 'Sign in' }).click()
}
await page.waitForURL(`${base}/`)

const shoot = async (name, url, wait = 2000) => {
  await page.goto(`${base}${url}`)
  await page.waitForTimeout(wait)
  await page.screenshot({ path: path.join(out, `${name}.png`) })
  console.log(`saved ${name}.png`)
}

// refresh update badges first so the containers page shows them
await page.getByRole('button', { name: 'Check for updates' }).click()
await page.getByRole('button', { name: 'Check for updates' }).waitFor({ timeout: 120_000 })

await shoot('containers', '/')
const first =
  stack ??
  (await page.evaluate(() => fetch('/api/stacks').then((r) => r.json()))).find((s) => s.managed)
    ?.name
if (first) {
  await shoot('stack', `/stacks/${first}`, 3500)
  await shoot('editor', `/stacks/${first}?tab=editor`, 3500)
  await shoot('logs', `/stacks/${first}?tab=logs`, 2500)
}
await browser.close()
