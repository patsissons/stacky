import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('works on a phone: cards instead of a table and a navigation drawer', async ({ page }) => {
  await signIn(page)
  await expect(page.getByTestId('container-cards')).toBeVisible()
  await expect(page.locator('table')).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})
