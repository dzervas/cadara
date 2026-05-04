import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'
import { createBaseExtrudeOperationHistory } from './helpers/modeling-fixtures'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

const FACE_POINT = { x: 230, y: 178 }

test('section handle drags forward and back along the active section normal', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory())
  await workbench.activateTool('Create a temporary section view.')
  await workbench.clickViewportAtReal(FACE_POINT)

  await expect.poll(() => page.evaluate(() => window.__cadaraDebug?.getState()?.machineState ?? ''), { timeout: 10_000 })
    .toBe('inspectingSection')
  await expect.poll(() => page.evaluate(() => window.__cadProjectSectionHandleToScreen?.()), { timeout: 10_000 })
    .not.toBeNull()

  const initialSection = await page.evaluate(() => ({
    offset: window.__cadaraDebug?.getState()?.sectionOffset ?? null,
    projection: window.__cadProjectSectionHandleToScreen?.() ?? null,
  }))

  expect(initialSection.offset).toBe(0)
  expect(initialSection.projection).not.toBeNull()

  const projection = initialSection.projection
  if (!projection) {
    throw new Error('Section handle projection is unavailable.')
  }

  const axisVector = projection.normal
    ? {
        x: projection.normal.x - projection.handle.x,
        y: projection.normal.y - projection.handle.y,
      }
    : { x: 0, y: -1 }
  const axisLength = Math.hypot(axisVector.x, axisVector.y) || 1
  const step = {
    x: (axisVector.x / axisLength) * 96,
    y: (axisVector.y / axisLength) * 96,
  }
  const viewportBox = await workbench.viewportSurface().boundingBox()

  if (!viewportBox) {
    throw new Error('Viewport surface is not visible.')
  }

  await page.mouse.move(viewportBox.x + projection.handle.x, viewportBox.y + projection.handle.y)
  await page.mouse.down()

  for (let index = 1; index <= 8; index += 1) {
    await page.mouse.move(
      viewportBox.x + projection.handle.x + (step.x * index) / 8,
      viewportBox.y + projection.handle.y + (step.y * index) / 8,
    )
  }

  await expect.poll(() => page.evaluate(() => window.__cadaraDebug?.getState()?.sectionOffset ?? null), { timeout: 10_000 })
    .not.toBe(initialSection.offset)

  const movedOffset = await page.evaluate(() => window.__cadaraDebug?.getState()?.sectionOffset ?? null)

  expect(typeof movedOffset).toBe('number')
  expect(Math.abs((movedOffset as number) - (initialSection.offset as number))).toBeGreaterThan(0.25)

  for (let index = 7; index >= 0; index -= 1) {
    await page.mouse.move(
      viewportBox.x + projection.handle.x + (step.x * index) / 8,
      viewportBox.y + projection.handle.y + (step.y * index) / 8,
    )
  }

  await page.mouse.up()

  await expect.poll(
    async () => Math.abs((await page.evaluate(() => window.__cadaraDebug?.getState()?.sectionOffset ?? 999)) as number),
    { timeout: 10_000 },
  ).toBeLessThan(0.25)
})
