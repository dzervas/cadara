import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'
import { captureActionableErrorRecords } from './helpers/error-reporting'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('invalid variable edit reports a UI error notification and actionable console error', async ({ page }) => {
  const consoleErrors = captureActionableErrorRecords(page)
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await page.getByRole('button', { name: 'Add variable' }).click()
  const valueInput = page.getByLabel(/^Variable value /)
  await expect(valueInput).toBeVisible({ timeout: 30_000 })
  await valueInput.fill('missing + 1')
  await valueInput.press('Enter')

  await expect(page.getByRole('alert').filter({ hasText: /missing/i })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => consoleErrors.length, { timeout: 30_000 }).toBeGreaterThan(0)
})
