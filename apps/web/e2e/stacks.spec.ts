import { expect, test, type Page } from '@playwright/test'
import { ADMIN, IMAGE, compose, setEditorText } from './helpers'

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
  await expect(page).toHaveURL(/\/(setup|login)/)
  if (page.url().includes('/login')) {
    // a CI retry replays the whole serial suite against the same server: just sign in
    await page.getByLabel('Username').fill(ADMIN.username)
    await page.getByLabel('Password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Containers' })).toBeVisible()
    return
  }
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

test('adds a Pushover channel with a user key', async () => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Add channel' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Phone')
  await dialog.getByRole('combobox', { name: 'Channel type' }).click()
  await page.getByRole('option', { name: 'Pushover' }).click()
  await expect(dialog.getByLabel('URL')).toHaveCount(0)
  await dialog.getByLabel('Application API token').fill('app-token')
  const save = dialog.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await dialog.getByLabel('User or group key').fill('user-key')
  await save.click()
  const list = page.getByLabel('Notification channels')
  await expect(list).toContainText('Phone')
  await expect(list).toContainText('Pushover')
  await page.getByRole('button', { name: 'Edit Phone' }).click()
  await expect(page.getByRole('dialog').getByLabel('User or group key')).toHaveValue('user-key')
  await page.keyboard.press('Escape')
})

test('sets the image update check schedule', async () => {
  await page.goto('/settings')
  const card = page.getByRole('form', { name: 'Image update checks' })
  const schedule = card.getByRole('combobox', { name: 'Update check schedule' })
  await schedule.click()
  await page.getByRole('option', { name: 'Custom interval or cron…' }).click()
  await card.getByLabel('Interval or cron pattern').fill('every so often')
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card.getByRole('alert')).toContainText('not a schedule')

  await schedule.click()
  await page.getByRole('option', { name: 'Weekly (Sunday, 3 AM)' }).click()
  await card.getByRole('button', { name: 'Save' }).click()
  await expect(card.getByRole('button', { name: 'Use default (6h)' })).toBeVisible()
  await page.reload()
  await expect(schedule).toHaveText('Weekly (Sunday, 3 AM)')
  await card.getByRole('button', { name: 'Use default (6h)' }).click()
  await expect(schedule).toHaveText('Every 6 hours')
})

test('turns image update notifications off by default and back on', async () => {
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: 'New image updates are found' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
})

test('creates an API token that works once and can be revoked', async ({ request }) => {
  await page.goto('/settings')
  await page.getByLabel('Token name').fill('e2e-script')
  await page.getByRole('button', { name: 'Create' }).click()
  const token = (await page.getByTestId('new-token').textContent())!.trim()
  expect(token).toMatch(/^stk_/)
  // the dialog hands over a ready-to-paste MCP command with the new token
  await expect(
    page.getByRole('dialog').getByLabel('Claude Code command', { exact: true }),
  ).toContainText(`/api/mcp --header "Authorization: Bearer ${token}"`)
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('MCP server URL', { exact: true })).toHaveText(
    /^http:\/\/.+\/api\/mcp$/,
  )

  const headers = { authorization: `Bearer ${token}` }
  expect((await request.get('/api/stacks', { headers })).status()).toBe(200)
  const mcp = await request.post('/api/mcp', {
    headers: { ...headers, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  })
  expect(mcp.status()).toBe(200)
  expect(JSON.stringify(await mcp.json())).toContain('list_stacks')
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
  await setEditorText(page, compose('hello-from-e2e', { publish: true }))
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
  // published ports link to STACKY_DOCKER_HOST rather than the host the UI is served from
  await expect(table.getByRole('link', { name: /^\d+$/ }).first()).toHaveAttribute(
    'href',
    /^http:\/\/docker\.e2e\.test:\d+$/,
  )
  await expect(page.getByRole('columnheader', { name: 'Update' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Check for updates|Checking/ })).toBeVisible()
  // grouped by default, with a heading row per stack; the switch turns it off in the URL
  const groupSwitch = page.getByRole('switch', { name: 'Group by stack' })
  await expect(groupSwitch).toBeChecked()
  await expect(table.getByRole('link', { name: 'e2e-app' }).first()).toBeVisible()
  await groupSwitch.click()
  await expect(page).toHaveURL(/group=false/)
  await expect(groupSwitch).not.toBeChecked()
  await page.getByLabel('Search containers').fill('no-such-container')
  await expect(page).toHaveURL(/q=no-such-container/)
  await expect(page.getByText('No containers match the filters.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Search containers')).toHaveValue('no-such-container')
})

test('switches the containers page between a table and cards, remembering the choice', async () => {
  await page.goto('/')
  const cards = page.getByTestId('container-cards')
  await expect(page.locator('table')).toBeVisible()
  await expect(cards).toBeHidden()
  await page.getByRole('radio', { name: 'Card view' }).click()
  await expect(cards.getByText('e2e-app-app-1')).toBeVisible()
  await expect(page.locator('table')).toBeHidden()
  await page.reload()
  await expect(cards.getByText('e2e-app-app-1')).toBeVisible()
  // a link can still ask for the other view
  await page.goto('/?view=table')
  await expect(page.locator('table')).toBeVisible()
  await page.goto('/')
  await expect(cards).toBeVisible()
  await page.getByRole('radio', { name: 'Table view' }).click()
  await expect(page.locator('table')).toBeVisible()
  await expect(cards).toBeHidden()
})

test('switches the stack overview between cards and a table', async () => {
  await page.goto('/stacks/e2e-app')
  await expect(page.getByTestId('service-app')).toBeVisible()
  await page.getByRole('radio', { name: 'Table view' }).click()
  await expect(page.getByTestId('service-row-app')).toBeVisible()
  await expect(page.getByTestId('service-app')).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('service-row-app')).toBeVisible()
  await page.getByRole('radio', { name: 'Card view' }).click()
  await expect(page.getByTestId('service-app')).toBeVisible()
  await expect(page.getByTestId('service-row-app')).toHaveCount(0)
})

test('streams logs for the stack', async () => {
  await page.goto('/stacks/e2e-app?tab=logs')
  await expect(page.getByTestId('log-lines')).toContainText('hello-from-e2e', { timeout: 20_000 })
  await page.getByLabel('Search logs').fill('nothing-matches-this')
  await expect(page.getByText('No matching lines.')).toBeVisible()
})

test('reserves the stats row before the first sample and fills it in', async () => {
  await page.goto('/stacks/e2e-app')
  const stats = page.getByTestId('service-app').getByTestId('service-stats')
  await expect(stats).toBeVisible()
  await expect(stats).toContainText('%', { timeout: 30_000 })
})

test("shows the whole stack's CPU and memory above its services", async () => {
  await page.goto('/stacks/e2e-app')
  const totals = page.getByTestId('stack-stats')
  await expect(totals).toContainText(/\d+ of \d+ containers? running/)
  await expect(totals).toContainText('%', { timeout: 30_000 })
})

test('checks one image for updates from the container menu', async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Actions for e2e-app-app-1' }).click()
  await page.getByRole('menuitem', { name: 'Check for updates' }).click()
  await expect(page.getByText(/^Checking .+…$/)).toBeVisible()
  await expect(
    page.getByText(/is up to date|is available|check (failed|skipped)|no result yet/),
  ).toBeVisible({ timeout: 90_000 })
  // the row says how fresh its update status is
  await expect(page.locator('table').getByText(/^checked (just now|\d+s ago)$/)).toBeVisible()
})

test("checks a stack's images from the Update menu", async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'Update options' }).click()
  await page.getByRole('menuitem', { name: 'Check for updates' }).click()
  await expect(page.getByText('Checking e2e-app…')).toBeVisible()
  await expect(
    page.getByText(/e2e-app( is up to date|: .+ available|: check incomplete|: no result yet)/),
  ).toBeVisible({ timeout: 90_000 })
})

test('offers the newer-version updates, disabled while there are none', async () => {
  await page.goto('/stacks/e2e-app')
  // nothing to apply: the Update button is off, but its menu still re-pulls the current tags
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeDisabled()
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
  // a compose dry run shows what the deploy will do: the new command recreates the container
  await expect(dialog.getByTestId('deploy-preview')).toContainText('Recreate e2e-app-app-1', {
    timeout: 30_000,
  })

  // containers made by another compose version come with an explanation
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await page.route('**/api/stacks/e2e-app/preview', (route) =>
    route.fulfill({
      json: {
        ok: true,
        containers: [{ name: 'e2e-app-app-1', action: 'recreate' }],
        composeMismatch: { deployedWith: ['2.29.1'], current: '5.6.0' },
      },
    }),
  )
  await review.first().click()
  await expect(dialog.getByTestId('deploy-preview')).toContainText(
    'created by Docker Compose 2.29.1',
  )
  await page.unroute('**/api/stacks/e2e-app/preview')

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

test('inspects, edits and deploys one service from its container', async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'e2e-app-app-1', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Service app in')).toBeVisible()
  await expect(sheet.locator('.monaco-editor')).toContainText('command:')
  // read-only until Edit is on
  await expect(sheet.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await sheet.getByRole('switch', { name: 'Edit' }).click()

  const snippet = `app:
  image: ${IMAGE}
  command: ["sh", "-c", "echo hello-from-sheet; exec sleep 3600"]
  init: true
`
  await setEditorText(page, snippet)
  await expect(sheet.getByTestId('validation-ok')).toBeVisible()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved app')).toBeVisible()
  const files = (await (await page.request.get('/api/stacks/e2e-app')).json()).files
  expect(files.compose).toBe(`services:\n  ${snippet.trimEnd().replace(/\n/g, '\n  ')}\n`)

  // the next edit goes through a review of the service before it deploys
  await setEditorText(page, snippet.replace('hello-from-sheet', 'hello-again-from-sheet'))
  await sheet.getByRole('button', { name: 'Review & deploy' }).click()
  await expect(sheet.getByText('Your changes to')).toBeVisible()
  await sheet.getByRole('button', { name: 'Save & deploy' }).click()
  await expect(page.getByText('Deployed e2e-app').last()).toBeVisible({ timeout: 120_000 })
  await page.keyboard.press('Escape')
  await page.goto('/stacks/e2e-app?tab=logs')
  await expect(page.getByTestId('log-lines')).toContainText('hello-again-from-sheet', {
    timeout: 20_000,
  })
})

test("opens a container's logs from its service sheet", async () => {
  await page.goto('/')
  await page.getByRole('button', { name: 'e2e-app-app-1', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Service app in')).toBeVisible()
  await sheet.getByRole('link', { name: 'Logs' }).click()
  await expect(page).toHaveURL(/\/stacks\/e2e-app\?.*tab=logs/)
  await expect(page).toHaveURL(/service=app/)
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('log-lines')).toContainText('hello-again-from-sheet', {
    timeout: 20_000,
  })
})

test('browses the stacks and data directories read-only', async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Files' }).click()
  await expect(page).toHaveURL(/\/files/)
  const tree = page.getByRole('complementary', { name: 'Files' })
  await tree.getByRole('button', { name: 'e2e-app' }).click()
  await tree.getByRole('button', { name: 'compose.yaml' }).click()
  await expect(page).toHaveURL(/path=e2e-app%2Fcompose\.yaml|path=e2e-app\/compose\.yaml/)
  const viewer = page.getByRole('region', { name: 'File contents' })
  await expect(viewer.locator('.monaco-editor')).toContainText('hello-again-from-sheet')
  // a viewer, not an editor
  await expect(page.getByRole('button', { name: /^(Save|Deploy)/ })).toHaveCount(0)

  await page.getByRole('tab', { name: 'Data directory' }).click()
  await expect(tree.getByRole('button', { name: 'auth-secret' })).toHaveCount(0)
  await tree.getByRole('button', { name: 'stacky.db', exact: true }).click()
  await expect(viewer.getByText(/^Binary data \(/)).toBeVisible()
})

test('clears the stack history after confirming', async () => {
  await page.goto('/stacks/e2e-app?tab=history')
  await expect(page.getByLabel('Deployed versions')).toBeVisible()
  await expect(page.getByLabel('Activity')).toBeVisible()
  await page.getByRole('button', { name: 'Clear history' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('cannot be undone')
  await confirm.getByRole('button', { name: 'Clear history' }).click()
  await expect(page.getByText('Cleared the history of e2e-app')).toBeVisible()
  await expect(page.getByText('Every successful deploy saves the files')).toBeVisible()
  await expect(page.getByText('Nothing has been run on this stack yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear history' })).toBeDisabled()
})

test('deletes the stack after typed confirmation', async () => {
  await page.goto('/stacks/e2e-app')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete stack' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByRole('button', { name: 'Delete stack' })).toBeDisabled()
  // the name field is focused, and Enter confirms once the name matches
  const typed = confirm.getByLabel(/Type/)
  await expect(typed).toBeFocused()
  // fill() rather than typing: a keystroke landing mid-render could drop a character
  await typed.fill('e2e-app')
  await expect(confirm.getByRole('button', { name: 'Delete stack' })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Deleted e2e-app').last()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('link', { name: /e2e-app/ })).toHaveCount(0)
})
