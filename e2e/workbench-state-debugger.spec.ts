import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness, FEATURE_FIXTURE } from './helpers/feature-workbench'
import { createBaseExtrudeOperationHistory } from './helpers/modeling-fixtures'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('state debugger owns workbench debug readouts and collapses locally', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('State Debugger')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand state debugger' })).toBeVisible()
  await expect(page.getByText('Active mode')).toHaveCount(0)
  await expect(page.getByText('Selection filter')).toHaveCount(0)

  const partsHeader = page.locator('aside header').filter({ hasText: 'Parts & Objects' }).first()
  await expect(partsHeader).toBeVisible()
  await expect(partsHeader).not.toContainText('Active mode')
  await expect(partsHeader).not.toContainText('Filter:')
  await expect(page.getByText('Editor Session')).toHaveCount(0)

  await page.getByRole('button', { name: 'Expand state debugger' }).click()
  await expect(page.getByText('Active mode')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collapse state debugger' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse state debugger' }).click()
  await expect(page.getByText('Active mode')).toHaveCount(0)
})

test('feature inspector omits debugger-only contract and revision readouts', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithRectangleProfileFixture()
  await workbench.activateFeature('extrude')
  await workbench.selectReference(FEATURE_FIXTURE.profile)

  const inspector = page.locator('main').getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'Commit' }),
  })
  await expect(inspector).toBeVisible()
  await expect(inspector).not.toContainText('Contract:')
  await expect(inspector).not.toContainText('Revision state:')
  await expect(inspector.getByRole('button', { name: 'Commit' })).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Cancel' })).toBeVisible()
})

test('diagnostics and debugger stay in-frame without page scrollbars', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)
  const viewportHeight = page.viewportSize()?.height ?? 960

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory())

  const stateDebugger = page.getByText('State Debugger', { exact: true })

  await expect(page.getByText('Snapshot References', { exact: true })).toHaveCount(0)
  await expect(stateDebugger).toBeVisible()

  for (const locator of [stateDebugger]) {
    const box = await locator.boundingBox()

    if (!box) {
      throw new Error('Expected debug chip to be measurable.')
    }

    expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight)
  }

  await expect.poll(() => page.evaluate(() => ({
    hasHorizontalScrollbar:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hasVerticalScrollbar:
      document.documentElement.scrollHeight > document.documentElement.clientHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  })), { timeout: 10_000 }).toEqual({
    hasHorizontalScrollbar: false,
    hasVerticalScrollbar: false,
    scrollX: 0,
    scrollY: 0,
  })
})
