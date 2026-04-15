import { test } from '@playwright/test'
import { SketchWorkbenchHarness } from './helpers/sketch-workbench'

test('starts a sketch from the primary top plane button', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()

  await workbench.expectMachine('editingSketch')
  await workbench.expectSketchSessionActive()
  await workbench.expectSketchPlane('XY')
})
