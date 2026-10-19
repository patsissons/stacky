import { expect, test, type Page } from '@playwright/test'
import { compose, signIn } from './helpers'

/** The page must never scroll sideways on a phone. */
async function expectNoSidewaysScroll(page: Page) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
  expect(width.main).toBeLessThanOrEqual(width.client)
}

test('works on a phone: cards instead of a table and a navigation drawer', async ({ page }) => {
  await signIn(page)
  await expect(page.getByTestId('container-cards')).toBeVisible()
  await expect(page.locator('table')).toBeHidden()
  await expectNoSidewaysScroll(page)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Activity log', { exact: true })).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test('reaches a stack from its card and keeps the stack page within the screen', async ({
  page,
}) => {
  await signIn(page)
  const created = await page.request.post('/api/stacks', {
    data: { name: 'mobile-app', compose: compose('hello-from-mobile'), deploy: true },
  })
  expect(created.status()).toBe(201)
  try {
    await page.goto('/')
    // grouping (on by default) applies to the cards too, with a heading per stack
    const group = page.getByTestId('container-group').filter({ hasText: 'mobile-app' })
    await expect(group).toBeVisible({ timeout: 120_000 })
    await expect(group.getByText(/1 container/)).toBeVisible()
    await expectNoSidewaysScroll(page)
    // ungrouped, the card's own stack link is the way to the stack page
    await page.goto('/?group=false')
    const card = page.getByTestId('container-cards').getByRole('link', { name: 'mobile-app' })
    await expect(card).toBeVisible()
    await card.click()
    await expect(page).toHaveURL(/\/stacks\/mobile-app$/)
    await expect(page.getByTestId('service-app')).toBeVisible()
    // the long compose path truncates instead of widening the page
    await expectNoSidewaysScroll(page)
    await page.getByRole('tab', { name: 'Logs' }).click()
    await expect(page.getByTestId('log-lines')).toContainText('hello-from-mobile', {
      timeout: 20_000,
    })
    await expectNoSidewaysScroll(page)
  } finally {
    // wait for the delete to finish so no container outlives the test server
    const op = await (await page.request.post('/api/stacks/mobile-app/actions/delete')).json()
    await expect
      .poll(async () => (await (await page.request.get(`/api/operations/${op.id}`)).json()).state, {
        timeout: 60_000,
      })
      .toMatch(/succeeded|failed|cancelled/)
  }
})

test('browses files on a phone, one pane at a time', async ({ page }) => {
  await signIn(page)
  await page.goto('/files?root=data')
  const tree = page.getByRole('complementary', { name: 'Files' })
  await tree.getByRole('button', { name: 'stacky.db', exact: true }).click()
  await expect(page.getByText(/^Binary data \(/)).toBeVisible()
  await expect(tree).toBeHidden()
  await expectNoSidewaysScroll(page)
  await page.getByRole('button', { name: 'Back to files' }).click()
  await expect(tree).toBeVisible()
  await expectNoSidewaysScroll(page)
})
