import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'

test.setTimeout(90_000)

test('viewport hover and selection resolve durable face, edge, and vertex targets on a solid body', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()

  const hoveredFace = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.face_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  await expect.poll(() => workbench.currentMachineSelectionCount(), { timeout: 10_000 }).toBe(1)

  const hoveredEdge = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.edge_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  await workbench.clickViewportAtReal(hoveredEdge.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  await expect.poll(() => workbench.currentMachineSelectionCount(), { timeout: 10_000 }).toBe(1)

  const hoveredVertex = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.vertex_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredVertex.targetId)
  await workbench.clickViewportAtReal(hoveredVertex.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredVertex.targetId)
  await expect.poll(() => workbench.currentMachineSelectionCount(), { timeout: 10_000 }).toBe(1)
})

test('viewport hover and selection still resolve durable targets after reloading a persisted model', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()
  await workbench.reloadPreservingStorage()

  const hoveredFace = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.face_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)

  const hoveredEdge = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.edge_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  await workbench.clickViewportAtReal(hoveredEdge.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)

  const hoveredVertex = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.vertex_.+$/)
  await expect.poll(() => workbench.currentHoverTarget(), { timeout: 10_000 }).toBe(hoveredVertex.targetId)
  await workbench.clickViewportAtReal(hoveredVertex.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredVertex.targetId)
})
