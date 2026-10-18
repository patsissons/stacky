import { expect, test } from '@playwright/test'

test('loads the UI and reaches the server', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'stacky' })).toBeVisible()
  await expect(page.getByTestId('server-version')).toHaveText('dev')
})
