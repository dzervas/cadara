import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'
import { createBaseExtrudeOperationHistory } from './helpers/modeling-fixtures'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

const FACE_POINT = { x: 230, y: 130 }
const EDGE_POINT = { x: 199, y: 110 }
const VERTEX_POINT = { x: 109, y: 207 }
const BLANK_POINT = { x: 1000, y: 200 }

const FACE_TARGET = 'body_feature_extrude-1.face_body_feature_extrude-1_t0001_6'
const EDGE_TARGET = 'body_feature_extrude-1.edge_body_feature_extrude-1_t0001_12'
const VERTEX_TARGET = 'body_feature_extrude-1.vertex_body_feature_extrude-1_t0001_2'

function countBufferDiff(left: Buffer, right: Buffer) {
  const limit = Math.min(left.length, right.length)
  let diff = 0

  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      diff += 1
    }
  }

  return diff + Math.abs(left.length - right.length)
}

test('front-most solid face hover and click change the rendered crop deterministically', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory())

  await workbench.clearHoverByLeavingViewport()
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')
  const baseCrop = await workbench.viewportCrop(FACE_POINT)

  await workbench.hoverViewportAtReal(FACE_POINT)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(FACE_TARGET)
  const hoveredCrop = await workbench.viewportCrop(FACE_POINT)
  expect(countBufferDiff(baseCrop, hoveredCrop)).toBeGreaterThan(1_000)

  await workbench.clickViewportAtReal(FACE_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(FACE_TARGET)
  const selectedCrop = await workbench.viewportCrop(FACE_POINT)
  expect(countBufferDiff(hoveredCrop, selectedCrop)).toBeGreaterThan(1_000)

  await workbench.hoverViewportAtReal(BLANK_POINT)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(FACE_TARGET)
})

test('edge priority and enlarged vertex hitboxes resolve at fixed viewport points', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory())

  await workbench.hoverViewportAtReal(EDGE_POINT)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(EDGE_TARGET)
  await workbench.clickViewportAtReal(EDGE_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(EDGE_TARGET)

  await workbench.hoverViewportAtReal(VERTEX_POINT)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(VERTEX_TARGET)
  await workbench.clickViewportAtReal(VERTEX_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(VERTEX_TARGET)
})

test('reload preserves the same topology targets and blank-space behavior', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithOperationHistory(createBaseExtrudeOperationHistory())
  await workbench.reloadPreservingStorage()

  await expect(page.getByText('History restore failed')).toHaveCount(0)

  await workbench.clickViewportAtReal(FACE_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(FACE_TARGET)

  await workbench.clickViewportAtReal(EDGE_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(EDGE_TARGET)

  await workbench.clickViewportAtReal(VERTEX_POINT)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(VERTEX_TARGET)

  await workbench.hoverViewportAtReal(BLANK_POINT)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe('none')
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(VERTEX_TARGET)
})
