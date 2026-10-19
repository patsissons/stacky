import { expect, test, type Page } from '@playwright/test'
import { ADMIN, compose, setEditorText } from './helpers'

// One server, one admin: these run in order, build on each other and share one
// signed-in page (sign-in is rate limited, as it should be).
test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})

test.afterAll(async () => {
  await page.close()
})

test('first visit walks through admin setup', async () => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
  await page.getByLabel('Confirm password').fill('mismatch')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.')
  await page.getByLabel('Confirm password').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Containers' })).toBeVisible()
})

test('rejects a wrong password and protects pages', async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto('/stacks/anything')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Username').fill(ADMIN.username)
  await page.getByLabel('Password').fill('wrong password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password.')
  await page.close()
})

test('adds a notification channel', async () => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Add channel' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Ops hook')
  await dialog.getByLabel('URL').fill('http://127.0.0.1:9/nothing-listens-here')
  await dialog.getByRole('button', { name: 'Send test' }).click()
  await expect(page.getByText(/fetch failed|HTTP|ECONNREFUSED/i).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByLabel('Notification channels')).toContainText('Ops hook')
})

test('creates an API token that works once and can be revoked', async ({ request }) => {
  await page.goto('/settings')
  await page.getByLabel('Token name').fill('e2e-script')
  await page.getByRole('button', { name: 'Create' }).click()
  const token = (await page.getByTestId('new-token').textContent())!.trim()
  expect(token).toMatch(/^stk_/)
  await page.keyboard.press('Escape')

  const headers = { authorization: `Bearer ${token}` }
  expect((await request.get('/api/stacks', { headers })).status()).toBe(200)
  await page.getByRole('button', { name: 'Revoke e2e-script' }).click()
  await expect(page.getByLabel('API tokens')).toHaveCount(0)
  expect((await request.get('/api/stacks', { headers })).status()).toBe(401)
})

test('creates and deploys a stack, then shows it live', async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'New stack' }).first().click()
  await page.getByLabel('Name').fill('Bad Name')
  await expect(page.getByText('Use lowercase letters')).toBeVisible()
  await page.getByLabel('Name').fill('e2e-app')
  await setEditorText(page, compose('hello-from-e2e'))
  await expect(page.getByText('Valid', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create & deploy' }).click()

  // the operation drawer streams the compose output, then the toast reports success
  await expect(page.getByText(/Deploy(ing|ed) e2e-app/).first()).toBeVisible()
  await expect(page.getByText('Deployed e2e-app').last()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Escape')

  await expect(page).toHaveURL(/\/stacks\/e2e-app/)
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('service-app')).toBeVisible()
})

test('lists the container in the containers table with URL-backed filters', async () => {
  await page.goto('/')
  const table = page.locator('table')
  await expect(table.getByText('e2e-app-app-1')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Update' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Check for updates|Checking/ })).toBeVisible()
  await page.getByRole('switch', { name: 'Group by stack' }).click()
  await expect(page).toHaveURL(/group=true/)
  await expect(table.getByRole('link', { name: 'e2e-app' }).first()).toBeVisible()
  await page.getByLabel('Search containers').fill('no-such-container')
  await expect(page).toHaveURL(/q=no-such-container/)
  await expect(page.getByText('No containers match the filters.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Search containers')).toHaveValue('no-such-container')
})

test('streams logs for the stack', async () => {
  await page.goto('/stacks/e2e-app?tab=logs')
  await expect(page.getByTestId('log-lines')).toContainText('hello-from-e2e', { timeout: 20_000 })
  await page.getByLabel('Search logs').fill('nothing-matches-this')
  await expect(page.getByText('No matching lines.')).toBeVisible()
})

test('offers the newer-version updates, disabled while there are none', async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'Update options' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('(none found)')).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Apply updates' })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: 'Pull updates only' })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: 'Re-pull current tags' })).toBeEnabled()
  await page.keyboard.press('Escape')
})

test('explains every operation in the help modal', async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'What these actions do' }).click()
  const dialog = page.getByRole('dialog', { name: 'What the operations do' })
  await expect(dialog.getByText('More → Down')).toBeVisible()
  await expect(dialog.getByText('Update → Pull updates only', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Update → Re-pull current tags')).toBeVisible()
  await expect(dialog.getByText('Pull & recreate (one service)')).toBeVisible()
  await expect(dialog.getByText('Update all → Pull all updates')).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Full documentation' })).toHaveAttribute(
    'href',
    'https://stacky.lgtm.page',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
})

test('keeps the shell layout steady', async () => {
  // the stack tab bar keeps its height and never scrolls vertically, even when a short
  // window makes the page content overflow
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: viewport.width, height: 360 })
  await page.goto('/stacks/e2e-app')
  const tabs = page.getByRole('tablist')
  await expect(tabs).toBeVisible()
  await expect(page.getByTestId('service-app')).toBeVisible()
  const tabBox = await tabs.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    height: el.getBoundingClientRect().height,
  }))
  expect(tabBox).toEqual({ overflowY: 'hidden', height: 36 })
  await page.setViewportSize(viewport)

  // only <main> scrolls on a long page; the document itself never does
  await page.goto('/settings')
  await expect(page.getByText('Activity log', { exact: true })).toBeVisible()
  const doc = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    client: document.documentElement.clientHeight,
  }))
  expect(doc.scroll).toBeLessThanOrEqual(doc.client)

  // the logo goes home
  await page.getByRole('link', { name: 'stacky home' }).click()
  await expect(page).toHaveURL(/\/$/)

  // the header buttons on the containers page line up
  const newStack = await page.getByRole('link', { name: 'New stack' }).last().boundingBox()
  const check = await page.getByRole('button', { name: /Check for updates|Checking/ }).boundingBox()
  expect(newStack?.height).toBe(check?.height)
})

test('edits with live validation and reviews a diff before deploying', async () => {
  await page.goto('/stacks/e2e-app?tab=editor')
  await expect(page.locator('.monaco-editor').first()).toBeVisible()

  await setEditorText(page, 'services:\n  app:\n    imagee: nope\n')
  await expect(page.getByLabel('Validation issues')).toContainText("additional properties 'imagee'")

  await setEditorText(page, compose('second-deploy'))
  await expect(page.getByTestId('validation-ok')).toBeVisible()
  // the stack action bar's Deploy also goes through the review while edits are unsaved
  const review = page.getByRole('button', { name: 'Review & deploy' })
  await expect(review).toHaveCount(2)
  await review.first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Review changes to e2e-app')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save & deploy' }).click()
  await expect(page.getByText('Deployed e2e-app').last()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Escape')

  await page.goto('/stacks/e2e-app?tab=history')
  await expect(page.getByLabel('Activity').getByRole('button', { name: /Deployed/ })).toHaveCount(2)
})

test('restores an earlier deployed version', async () => {
  await page.goto('/stacks/e2e-app?tab=history')
  const versions = page.getByLabel('Deployed versions').getByRole('listitem')
  await expect(versions).toHaveCount(2)
  await expect(versions.first()).toContainText('current')
  await versions.last().getByRole('button', { name: 'Restore' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore & deploy' }).click()
  await expect(page.getByText('Deployed e2e-app').last()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Escape')
  await page.goto('/stacks/e2e-app?tab=logs')
  await expect(page.getByTestId('log-lines')).toContainText('hello-from-e2e', { timeout: 20_000 })
})

test('keeps the .env editor open while a secret is typed', async () => {
  await page.goto('/stacks/e2e-app?tab=editor')
  await page.getByRole('tab', { name: '.env' }).click()
  const editor = page.locator('.monaco-editor').first()
  await editor.locator('.view-lines').click()
  await expect(editor.locator('textarea')).toBeFocused()
  // the editor used to be swapped for the masked preview as soon as a secret appeared,
  // silently dropping every keystroke after it
  await page.keyboard.type('DB_PASSWORD=hunter2\nPORT=8080', { delay: 10 })
  await expect(editor).toContainText('PORT=8080')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const res = await page.request.get('/api/stacks/e2e-app')
  // LF even though this browser profile reports Windows, where Monaco would default to CRLF
  expect((await res.json()).files.env).toBe('DB_PASSWORD=hunter2\nPORT=8080')

  await page.getByRole('button', { name: 'Mask' }).click()
  await expect(page.getByLabel('.env (masked)')).toContainText('DB_PASSWORD=••••••••')
  await expect(editor).toBeHidden()
})

test('creates, saves and deletes an extra file', async () => {
  await page.goto('/stacks/e2e-app?tab=editor')
  await page.getByRole('button', { name: 'New file' }).click()
  await page.getByPlaceholder('config/app.conf').fill('config/app.conf')
  await page.keyboard.press('Enter')
  const editor = page.locator('.monaco-editor').first()
  await editor.locator('.view-lines').click()
  await expect(editor.locator('textarea')).toBeFocused()
  await page.keyboard.type('[app]', { delay: 10 })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved config/app.conf')).toBeVisible()
  // the tree picks the new file (and its directory) up without a reload
  const files = page.getByRole('complementary', { name: 'Files' })
  await expect(files.getByText('config', { exact: true })).toBeVisible()
  const file = files.getByRole('button', { name: /app\.conf/ }).first()
  await expect(file).toBeVisible()
  await file.hover()
  await files.getByRole('button', { name: 'Delete config/app.conf' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete file' }).click()
  await expect(page.getByText('Deleted config/app.conf')).toBeVisible()
  await expect(files.getByRole('button', { name: /app\.conf/ })).toHaveCount(0)
})

test('deletes the stack after typed confirmation', async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete stack' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByRole('button', { name: 'Delete stack' })).toBeDisabled()
  // the name field is focused, and Enter confirms once the name matches
  await expect(confirm.getByLabel(/Type/)).toBeFocused()
  await page.keyboard.type('e2e-app')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Deleted e2e-app').last()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('link', { name: /e2e-app/ })).toHaveCount(0)
})
