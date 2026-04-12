import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'

test.setTimeout(90_000)

function vertexProbeCandidates(point: { x: number; y: number }) {
  return [
    point,
    { x: point.x - 96, y: point.y },
    { x: point.x + 96, y: point.y },
    { x: point.x, y: point.y - 96 },
    { x: point.x, y: point.y + 96 },
    { x: point.x - 96, y: point.y - 96 },
    { x: point.x + 96, y: point.y - 96 },
    { x: point.x - 96, y: point.y + 96 },
    { x: point.x + 96, y: point.y + 96 },
  ]
}

test('viewport hover and selection resolve durable face, edge, and vertex targets on a solid body', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await workbench.createBaseExtrudeFixture()

  const hoveredFace = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.face_.+$/)
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
  await expect.poll(() => workbench.currentMachineSelectionCount(), { timeout: 10_000 }).toBe(1)

  const hoveredEdge = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.edge_.+$/)
  await workbench.clickViewportAtReal(hoveredEdge.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)
  await expect.poll(() => workbench.currentMachineSelectionCount(), { timeout: 10_000 }).toBe(1)

  const hoveredVertex = await workbench.hoverViewportTargetNear(
    /^body_feature_extrude-1\.vertex_.+$/,
    vertexProbeCandidates(hoveredEdge.point),
  )
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
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)

  const hoveredEdge = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.edge_.+$/)
  await workbench.clickViewportAtReal(hoveredEdge.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredEdge.targetId)

  const hoveredVertex = await workbench.hoverViewportTargetNear(
    /^body_feature_extrude-1\.vertex_.+$/,
    vertexProbeCandidates(hoveredEdge.point),
  )
  await workbench.clickViewportAtReal(hoveredVertex.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredVertex.targetId)
})
