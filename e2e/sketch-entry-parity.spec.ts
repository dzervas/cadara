import { expect, test } from '@playwright/test'
import { SketchWorkbenchHarness } from './helpers/sketch-workbench'

test('feature-tree plane entry opens the same sketch editing mode as viewport entry', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()

  await workbench.expectMachine('editingSketch')
  await workbench.expectSketchPlane('XY')
  await expect.poll(() => page.evaluate(() => window.__cadTestState?.command ?? '')).toBe('sketch')
})
