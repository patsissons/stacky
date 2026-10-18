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

test('edits with live validation and reviews a diff before deploying', async () => {
  await page.goto('/stacks/e2e-app?tab=editor')
  await expect(page.locator('.monaco-editor').first()).toBeVisible()

  await setEditorText(page, 'services:\n  app:\n    imagee: nope\n')
  await expect(page.getByLabel('Validation issues')).toContainText("additional properties 'imagee'")

  await setEditorText(page, compose('second-deploy'))
  await expect(page.getByTestId('validation-ok')).toBeVisible()
  await page.getByRole('button', { name: 'Review & deploy' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Review changes to e2e-app')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save & deploy' }).click()
  await expect(page.getByText('Deployed e2e-app').last()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Escape')

  await page.goto('/stacks/e2e-app?tab=history')
  await expect(page.getByRole('button', { name: /Deployed/ })).toHaveCount(2)
})

test('deletes the stack after typed confirmation', async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete stack' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByRole('button', { name: 'Delete stack' })).toBeDisabled()
  await confirm.getByLabel(/Type/).fill('e2e-app')
  await confirm.getByRole('button', { name: 'Delete stack' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Deleted e2e-app').last()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('link', { name: /e2e-app/ })).toHaveCount(0)
})
