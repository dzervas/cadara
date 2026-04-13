import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness } from './helpers/feature-workbench'

test.setTimeout(90_000)

test('bootstraps editor state and restores persisted geometry across reload', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.open()
  await expect(page.getByText('History restore failed')).toHaveCount(0)
  await workbench.createBaseExtrudeFixture()
  await workbench.reloadPreservingStorage()

  await expect(page.getByText('History restore failed')).toHaveCount(0)

  const hoveredFace = await workbench.hoverFirstViewportTargetMatching(/^body_feature_extrude-1\.face_.+$/)
  await workbench.clickViewportAtReal(hoveredFace.point)
  await expect.poll(() => workbench.currentEditorSelection(), { timeout: 10_000 }).toBe(hoveredFace.targetId)
})
