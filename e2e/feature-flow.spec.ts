import { expect, test } from '@playwright/test'

import { FeatureWorkbenchHarness, FEATURE_FIXTURE, meanPixelDelta } from './helpers/feature-workbench'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('extrude previews and commits from the shared feature harness', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithRectangleProfileFixture()
  await workbench.activateFeature('extrude')
  await workbench.selectReference(FEATURE_FIXTURE.profile)

  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.commitFeature('feature_extrude-1')
})

test('revolve previews and commits with a planar profile and durable edge axis', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('revolve')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.edge_/)

  await workbench.expectFeaturePreviewReady('revolve')
  await workbench.commitFeature('feature_revolve-1')
})

test('sweep previews and commits with a planar profile and durable edge path', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()

  await workbench.activateFeature('sweep')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.edge_/)

  await workbench.expectFeaturePreviewReady('sweep')
  await workbench.commitFeature('feature_sweep-1')
})

test('loft previews and commits with ordered profile selection', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.selectSupportedLoftFaceProfile()

  await workbench.expectFeaturePreviewReady('loft')
  await workbench.commitFeature('feature_loft-1')
})

test('fillet previews and commits from a durable body edge', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('fillet')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.edge_/)
  await workbench.setNumericField('Radius', 0.5)

  await workbench.expectFeaturePreviewReady('fillet')
  await workbench.commitFeature('feature_fillet-1')
})

test('chamfer previews and commits from a durable body edge', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('chamfer')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.edge_/)
  await workbench.setNumericField('Distance', 0.4)

  await workbench.expectFeaturePreviewReady('chamfer')
  await workbench.commitFeature('feature_chamfer-1')
})

test('thicken previews and commits from a durable planar face', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('thicken')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)
  await workbench.setNumericField('Thickness', 0.6)

  await workbench.expectFeaturePreviewReady('thicken')
  await workbench.commitFeature('feature_thicken-1')
})

test('split previews and commits from explicit target and tool bodies', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const fixture = await workbench.openWithTwoExtrudeBodiesFixture()
  await workbench.selectBodyTarget(fixture.targetBody)
  await workbench.activateFeature('split')
  await workbench.selectSplitToolBody(fixture.toolBody)

  await workbench.expectFeaturePreviewReady('split')
  await workbench.commitFeature('feature_split-1')
  await workbench.expectBodyAbsent(fixture.targetBody)
  await workbench.expectBodyPresent(fixture.toolBody)
  await workbench.expectBodyCountAtLeast(3)
})

test('combine subtract previews, commits, and persists consumed tool output', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const fixture = await workbench.openWithTwoExtrudeBodiesFixture()
  await workbench.selectBodyTarget(fixture.targetBody)
  await workbench.activateFeature('combine')
  await workbench.setCombineOperation('subtract')
  await workbench.selectBodyTarget(fixture.toolBody)

  await workbench.expectFeaturePreviewReady('combine')
  await workbench.commitFeature('feature_combine-1')
  await workbench.expectBodyPresent(fixture.targetBody)
  await workbench.expectBodyAbsent(fixture.toolBody)

  await workbench.reloadPreservingStorage()
  await workbench.expectBodyPresent(fixture.targetBody)
  await workbench.expectBodyAbsent(fixture.toolBody)
})

test('delete-solid previews and commits from an explicit body target', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const fixture = await workbench.openWithTwoExtrudeBodiesFixture()
  await workbench.activateFeature('deleteSolid')
  await workbench.selectBodyTarget(fixture.targetBody)

  await workbench.expectFeaturePreviewReady('deleteSolid')
  await workbench.commitFeature('feature_deleteSolid-1')
  await workbench.expectBodyAbsent(fixture.targetBody)
  await workbench.expectBodyPresent(fixture.toolBody)
})

test('mirror previews and commits from explicit body and plane references', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const fixture = await workbench.openWithBaseExtrudeFixture()
  await workbench.selectBodyTarget(fixture.bodyTarget)
  await workbench.activateFeature('mirror')
  await workbench.selectMirrorPlane('construction_plane-yz')

  await workbench.expectFeaturePreviewReady('mirror')
  await workbench.commitFeature('feature_mirror-1')
  await workbench.expectBodyPresent(fixture.bodyTarget)
  await workbench.expectBodyCountAtLeast(2)
})

test('transform previews and commits from explicit body and reference selections', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const fixture = await workbench.openWithBaseExtrudeFixture()
  await workbench.selectBodyTarget(fixture.bodyTarget)
  await workbench.activateFeature('transform')
  await workbench.selectTransformReference('construction_plane-xy')
  await workbench.setNumericField('Distance', 2)

  await workbench.expectFeaturePreviewReady('transform')
  await workbench.commitFeature('feature_transform-1')
  await workbench.expectBodyPresent(fixture.bodyTarget)
})

test('shell previews, commits, and keeps consecutive canvas frames stable', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('shell')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1$/)
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)

  await workbench.expectFeaturePreviewReady('shell')
  await workbench.commitFeature()

  const firstFrame = await workbench.canvasBytes()
  await workbench.waitForAnimationFrames(2)
  const secondFrame = await workbench.canvasBytes()
  expect(meanPixelDelta(firstFrame, secondFrame)).toBeLessThan(2)
})

test('plane previews and commits from a planar face reference', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('plane')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)

  await workbench.expectFeaturePreviewReady('plane')
  await workbench.commitFeature('feature_plane-1')
})

test('extrude boolean scope previews and commits with an explicit target body', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('extrude')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)
  await workbench.setOperation('join')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1$/)

  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.commitFeature('feature_extrude-2')
})

test('extrude preselects join and target body for a coplanar face preview', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('extrude')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)

  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)
})

test('extrude preserves manual operation and target after later preselection changes', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithBaseExtrudeFixture()
  await workbench.activateFeature('extrude')
  await workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.face_/)
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)

  await workbench.setOperation('join')
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)

  await workbench.flipDepthDirection()
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)

  await workbench.setOperation('newBody')
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('newBody')
  await workbench.expectNoBooleanTargetSelected()

  await workbench.setOperation('join')
  await workbench.selectBodyTarget(FEATURE_FIXTURE.body)
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)

  await workbench.flipDepthDirection()
  await workbench.expectFeaturePreviewReady('extrude')
  await workbench.expectOperationSelected('join')
  await workbench.expectBooleanTargetSelected(FEATURE_FIXTURE.body)
})

test('feature chain carries durable context across feature steps', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  const chain = await workbench.createFeatureChain()

  await chain.addFilletFromFirstEdge()
  await chain.addPlaneFromTopPlane()
})
