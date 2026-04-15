import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness, FEATURE_FIXTURE } from './helpers/feature-workbench'

test.setTimeout(90_000)

test('state debugger owns workbench debug readouts and collapses locally', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await expect(page.getByText('State Debugger')).toBeVisible()
  await expect(page.getByText('Active mode')).toBeVisible()
  await expect(page.getByText('Selection filter')).toBeVisible()

  const partsHeader = page.locator('aside header').filter({ hasText: 'Parts & Objects' }).first()
  await expect(partsHeader).toBeVisible()
  await expect(partsHeader).not.toContainText('Active mode')
  await expect(partsHeader).not.toContainText('Filter:')
  await expect(page.getByText('Editor Session')).toHaveCount(0)

  await page.getByRole('button', { name: 'Collapse state debugger' }).click()
  await expect(page.getByRole('button', { name: 'Expand state debugger' })).toBeVisible()
  await expect(page.getByText('Active mode')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand state debugger' }).click()
  await expect(page.getByText('Active mode')).toBeVisible()
})

test('feature inspector omits debugger-only contract and revision readouts', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithRectangleProfileFixture()
  await workbench.selectReference(FEATURE_FIXTURE.profile)
  await workbench.activateFeature('extrude')

  const inspector = page.locator('aside').filter({ hasText: 'Feature Session' })
  await expect(inspector).toBeVisible()
  await expect(inspector).not.toContainText('Contract:')
  await expect(inspector).not.toContainText('Revision state:')
  await expect(inspector.getByRole('button', { name: 'Commit' })).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Cancel' })).toBeVisible()
})
