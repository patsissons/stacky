import { expect, type Page } from '@playwright/test'

export const ADMIN = { username: 'admin', password: 'correct horse battery' }

/** Image used by e2e stacks; override locally if Docker Hub rate limits you. */
export const IMAGE = process.env.STACKY_E2E_IMAGE ?? 'alpine:3'

export async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Containers' })).toBeVisible()
}

/**
 * Replaces the content of the visible Monaco editor. Pastes from the clipboard,
 * like a user would, so Monaco's auto-indent doesn't rewrite the YAML.
 */
export async function setEditorText(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  const lines = editor.locator('.view-lines')
  await expect(lines).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  // Monaco picks its keybindings from the user agent; native paste follows the host OS.
  const isMacUa = await page.evaluate(() => /Mac/.test(navigator.userAgent))
  await expect(async () => {
    await lines.click()
    await expect(editor.locator('textarea')).toBeFocused({ timeout: 1000 })
    await page.keyboard.press(isMacUa ? 'Meta+a' : 'Control+a')
    await page.keyboard.press('ControlOrMeta+v')
    const lineCount = await editor.locator('.view-line').count()
    expect(lineCount).toBe(
      text.replace(/\n$/, '').split('\n').length + (text.endsWith('\n') ? 1 : 0),
    )
  }).toPass({ timeout: 15_000 })
}

/** A one-service stack; `publish` maps container port 80 to a random loopback port. */
export function compose(message: string, { publish = false } = {}) {
  return `services:
  app:
    image: ${IMAGE}
    command: ["sh", "-c", "echo ${message}; exec sleep 3600"]
    init: true
${publish ? '    ports: ["127.0.0.1::80"]\n' : ''}`
}
