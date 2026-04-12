import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'

test.setTimeout(90_000)

async function viewportSurfaceBox(workbench: FeatureWorkbenchHarness) {
  await expect(workbench.viewportSurface()).toBeVisible({ timeout: 10_000 })
  const box = await workbench.viewportSurface().boundingBox()

  if (!box) {
    throw new Error('Viewport surface is not visible.')
  }

  return box
}

async function discoverViewportTarget(
  workbench: FeatureWorkbenchHarness,
  pattern: RegExp,
) {
  const box = await viewportSurfaceBox(workbench)
  const xSteps = 13
  const ySteps = 9

  for (let row = 1; row <= ySteps; row += 1) {
    for (let column = 1; column <= xSteps; column += 1) {
      const point = {
        x: Math.round((box.width * column) / (xSteps + 1)),
        y: Math.round((box.height * row) / (ySteps + 1)),
      }

      await workbench.hoverViewportAtReal(point)
      await workbench.page.waitForTimeout(30)

      const targetId = (await workbench.currentHoverTarget()).match(pattern)?.[0]

      if (targetId) {
        return { point, targetId }
      }
    }
  }

  throw new Error(`Viewport target matching ${pattern} was not found in the current camera framing.`)
}

async function assertDirectHoverAndClick(
  workbench: FeatureWorkbenchHarness,
  point: { x: number; y: number },
  targetId: string,
) {
  await workbench.clearHoverByLeavingViewport()
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')

  await workbench.hoverViewportAtReal(point)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(targetId)

  await workbench.clearHoverByLeavingViewport()
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')

  await workbench.hoverViewportAtReal(point)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(targetId)

  await workbench.clickViewportAtReal(point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(targetId)
}

test('solid topology targets are discoverable and directly selectable on the live viewport', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()

  const edge = await discoverViewportTarget(
    workbench,
    /^body_feature_extrude-1\.edge_.+$/,
  )
  await assertDirectHoverAndClick(workbench, edge.point, edge.targetId)

  const vertex = await discoverViewportTarget(
    workbench,
    /^body_feature_extrude-1\.vertex_.+$/,
  )
  await assertDirectHoverAndClick(workbench, vertex.point, vertex.targetId)
})

test('solid topology targets remain directly selectable after reload at the same screen points', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()

  const edge = await discoverViewportTarget(
    workbench,
    /^body_feature_extrude-1\.edge_.+$/,
  )
  const vertex = await discoverViewportTarget(
    workbench,
    /^body_feature_extrude-1\.vertex_.+$/,
  )

  await workbench.reloadPreservingStorage()

  await assertDirectHoverAndClick(workbench, edge.point, edge.targetId)
  await assertDirectHoverAndClick(workbench, vertex.point, vertex.targetId)
})
