import { test } from '@playwright/test'
import { expect } from '@playwright/test'
import { SketchWorkbenchHarness } from './helpers/sketch-workbench'

test.use({ viewport: { width: 1440, height: 960 } })

test('starts a sketch from the primary top plane button', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()

  await workbench.expectMachine('editingSketch')
  await workbench.expectSketchSessionActive()
  await workbench.expectSketchPlane('XY')
})

test('hovering and clicking a seeded datum plane works on a cold load', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.hoverViewportAtReal({ x: 340, y: 200 })

  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('construction_plane-xz')

  await workbench.clickViewportAtReal({ x: 340, y: 200 })
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toContain('construction_plane-xz')
})
