import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { SketchWorkbenchHarness } from './sketch-workbench'
import {
  createBaseExtrudeOperationHistory,
  createRectangleProfileOperationHistory,
  createTwoExtrudeBodiesOperationHistory,
  FEATURE_FIXTURE,
} from './modeling-fixtures'

export { FEATURE_FIXTURE } from './modeling-fixtures'

type FeatureKind =
  | 'extrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'split'
  | 'fillet'
  | 'chamfer'
  | 'thicken'
  | 'deleteSolid'
  | 'mirror'
  | 'transform'
  | 'shell'
  | 'plane'

export class FeatureWorkbenchHarness extends SketchWorkbenchHarness {
  constructor(page: Page) {
    super(page)
  }

  override async open() {
    await super.open()
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
    await this.waitForAnimationFrames(2)
  }

  override async reloadPreservingStorage() {
    await super.reloadPreservingStorage()
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
    await this.waitForAnimationFrames(2)
    await this.waitForStableCanvasFrames()
  }

  async openWithRectangleProfileFixture() {
    await this.openWithOperationHistory(createRectangleProfileOperationHistory())

    return {
      profileTarget: FEATURE_FIXTURE.profile,
    }
  }

  async openWithBaseExtrudeFixture() {
    await this.openWithOperationHistory(createBaseExtrudeOperationHistory())

    return {
      profileTarget: FEATURE_FIXTURE.profile,
      bodyTarget: FEATURE_FIXTURE.body,
    }
  }

  async openWithTwoExtrudeBodiesFixture() {
    await this.openWithOperationHistory(createTwoExtrudeBodiesOperationHistory())

    return {
      firstProfileTarget: FEATURE_FIXTURE.profile,
      secondProfileTarget: 'sketch_2.region_2-outer',
      targetBody: 'body_feature_extrude-1',
      toolBody: 'body_feature_extrude-2',
    }
  }

  async createFeatureChain() {
    const base = await this.openWithBaseExtrudeFixture()
    return new FeatureChainHarness(this, base)
  }

  async activateFeature(kind: FeatureKind) {
    const toolNames: Record<FeatureKind, string> = {
      extrude: 'Create an extruded solid or surface.',
      revolve: 'Create a revolved solid or surface.',
      sweep: 'Create a swept solid or surface.',
      loft: 'Create a lofted solid from ordered profiles.',
      split: 'Split one solid body with another solid tool body.',
      fillet: 'Round selected edges.',
      chamfer: 'Bevel selected edges.',
      thicken: 'Offset selected faces into a solid.',
      deleteSolid: 'Delete one or more solid bodies from the document.',
      mirror: 'Mirror selected bodies across an explicit plane reference.',
      transform: 'Translate selected bodies along an explicit planar reference normal.',
      shell: 'Hollow a solid body.',
      plane: 'Create a construction plane.',
    }
    await this.activateTool(toolNames[kind])
  }

  async selectReference(targetId: string) {
    await this.selectReferenceThroughCurrentUi(targetId)
    await expect.poll(() => this.currentEditorSelection(), { timeout: 10_000 }).toContain(targetId)
  }

  async selectBodyTarget(bodyId: string) {
    await this.selectReference(bodyId)
  }

  async selectSplitToolBody(bodyId: string) {
    await this.selectReference(bodyId)
  }

  async selectMirrorPlane(targetId: string) {
    await this.selectReference(targetId)
  }

  async selectTransformReference(targetId: string) {
    await this.selectReference(targetId)
  }

  async selectFirstReferenceMatching(pattern: RegExp) {
    const ariaLabel = await this.selectFirstReferenceMatchingCurrentUi(pattern)

    if (!ariaLabel) {
      throw new Error(`No selectable reference matched ${pattern}.`)
    }
    return ariaLabel
  }

  async selectSupportedLoftFaceProfile() {
    await this.activateFeature('loft')
    await this.clickViewportAtReal(VIEWPORT_TARGET_POINTS.face1)
    await expect.poll(() => this.currentEditorSelection(), { timeout: 10_000 }).toContain('body_feature_extrude-1.face_body_feature_extrude-1_t0001_1')
    await this.clickViewportAtReal(VIEWPORT_TARGET_POINTS.face6)

    await expect.poll(async () => {
      if (await this.hasVisibleFeatureErrorDiagnostics()) {
        return 'error'
      }

      const session = await this.featureSessionLabel()
      return session.includes('create:loft:previewReady') ? 'ready' : session || 'pending'
    }, { timeout: 10_000 }).toBe('ready')

    await expect.poll(() => this.hasVisibleFeatureErrorDiagnostics(), { timeout: 2_000 }).toBe(false)
    return 'Select viewport target body_feature_extrude-1.face_body_feature_extrude-1_t0001_6'
  }

  async setNumericField(label: string, value: number) {
    await this.page.getByLabel(label).fill(String(value))
  }

  async setOperation(operation: 'newBody' | 'join' | 'cut' | 'intersect') {
    await this.page.getByRole('button', { name: operation }).click()
  }

  async expectFeaturePreviewReady(kind: FeatureKind) {
    await expect.poll(() => this.featureSessionLabel(), { timeout: 30_000 }).toContain(`create:${kind}:previewReady`)
    await expect.poll(() => this.currentPreviewDiagnosticsText(), { timeout: 10_000 }).not.toMatch(/\berror\b/i)
  }

  async commitFeature(expectedFeatureId?: string) {
    await this.page.getByRole('button', { name: 'Commit' }).click()
    await expect.poll(() => this.machineLabel(), { timeout: 75_000 }).toContain('idle')

    if (expectedFeatureId) {
      await expect(this.page.getByText(expectedFeatureId).first()).toBeVisible({ timeout: 30_000 })
    }
  }

  async canvasBytes() {
    return this.viewport().screenshot()
  }

  async waitForStableCanvasFrames(maxDelta = 2) {
    await expect.poll(async () => {
      const firstFrame = await this.canvasBytes()
      await this.waitForAnimationFrames(2)
      const secondFrame = await this.canvasBytes()
      return meanPixelDelta(firstFrame, secondFrame)
    }, { timeout: 15_000 }).toBeLessThan(maxDelta)
  }

  async expectBodyPresent(bodyId: string) {
    await expect.poll(() => this.listVisibleBodyIds(), { timeout: 30_000 }).toContain(bodyId)
  }

  async expectBodyAbsent(bodyId: string) {
    await expect.poll(() => this.listVisibleBodyIds(), { timeout: 30_000 }).not.toContain(bodyId)
  }

  async expectBodyCountAtLeast(count: number) {
    await expect.poll(async () => (await this.listVisibleBodyIds()).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(count)
  }

  private async selectReferenceThroughCurrentUi(targetId: string) {
    const viewportPoint = VIEWPORT_TARGET_POINTS_BY_ID[targetId]
    if (viewportPoint) {
      await this.clickViewportAtReal(viewportPoint)
      return
    }

    const sidebarLabel = SIDEBAR_TARGET_LABELS[targetId]
    if (sidebarLabel) {
      await this.page.locator('aside').getByRole('button', { name: sidebarLabel }).first().click()
      return
    }

    throw new Error(`No current UI selector is configured for ${targetId}.`)
  }

  private async selectFirstReferenceMatchingCurrentUi(pattern: RegExp) {
    const targetId = resolveViewportTargetForPattern(pattern)

    if (!targetId) {
      return null
    }

    await this.selectReferenceThroughCurrentUi(targetId)
    return `Select viewport target ${targetId}`
  }

  private async listVisibleBodyIds() {
    const labels = await this.page.locator('aside').getByRole('button').evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        if (button.getAttribute('aria-disabled') === 'true') {
          return []
        }

        const label = button.getAttribute('aria-label')
        if (label?.startsWith('Select ')) {
          const match = /^Select .* (body_[A-Za-z0-9_-]+)$/.exec(label)
          return match ? [match[1]] : []
        }

        const text = button.textContent?.trim() ?? ''
        const bodyLabel = /^feature_[A-Za-z0-9_-]+$/.exec(text)?.[0]
        return bodyLabel ? [`body_${bodyLabel}`] : []
      }),
    )

    return Array.from(new Set(labels))
  }

  private async revisionLabel() {
    const bodyText = await this.page.locator('body').textContent()
    return bodyText?.match(/Revision:\s*([^\s]+)/)?.[1] ?? 'loading'
  }

  private async machineLabel() {
    const bodyText = await this.page.locator('body').textContent()
    return bodyText?.match(/Machine:\s*([^\s]+)/)?.[1] ?? ''
  }

  private async featureSessionLabel() {
    const bodyText = await this.page.locator('body').textContent()
    return bodyText?.match(/Feature session:\s*([^\s]+)/)?.[1] ?? ''
  }

  private async currentPreviewDiagnosticsText() {
    const bodyText = await this.page.locator('body').textContent()
    return bodyText?.match(/Diagnostics(.*?)CancelCommit/s)?.[1] ?? ''
  }

  private async hasVisibleFeatureErrorDiagnostics() {
    return this.page.locator('aside').getByText(/^error$/i).isVisible().catch(() => false)
  }
}

export class FeatureChainHarness {
  constructor(
    private readonly workbench: FeatureWorkbenchHarness,
    readonly context: {
      profileTarget: string
      bodyTarget: string
    },
  ) {}

  async addFilletFromFirstEdge() {
    await this.workbench.activateFeature('fillet')
    await this.workbench.selectFirstReferenceMatching(/^Select .* body_feature_extrude-1\.edge_/)
    await this.workbench.setNumericField('Radius', 0.5)
    await this.workbench.expectFeaturePreviewReady('fillet')
    await this.workbench.commitFeature('feature_fillet-1')
    return this
  }

  async addPlaneFromTopPlane() {
    await this.workbench.activateFeature('plane')
    await this.workbench.page.getByRole('button', { name: /Top Plane/ }).first().click()
    await expect.poll(() => this.workbench.currentEditorSelection(), { timeout: 10_000 }).toContain('construction_plane-xy')
    await this.workbench.expectFeaturePreviewReady('plane')
    await this.workbench.commitFeature('feature_plane-1')
    return this
  }
}

export function meanPixelDelta(left: Buffer, right: Buffer) {
  const length = Math.min(left.length, right.length)
  let total = 0

  for (let index = 0; index < length; index += 1) {
    total += Math.abs(left[index]! - right[index]!)
  }

  return total / Math.max(length, 1)
}

const VIEWPORT_TARGET_POINTS = {
  profile: { x: 380, y: 280 },
  face: { x: 254, y: 65 },
  face1: { x: 95, y: 200 },
  face6: { x: 290, y: 35 },
  edge: { x: 190, y: 65 },
  vertex: { x: 63, y: 148 },
} as const

const VIEWPORT_TARGET_POINTS_BY_ID: Record<string, { x: number, y: number }> = {
  'sketch_primary.region_primary-outer': VIEWPORT_TARGET_POINTS.profile,
  'body_feature_extrude-1.face_body_feature_extrude-1_t0001_6': VIEWPORT_TARGET_POINTS.face,
  'body_feature_extrude-1.edge_body_feature_extrude-1_t0001_12': VIEWPORT_TARGET_POINTS.edge,
  'body_feature_extrude-1.vertex_body_feature_extrude-1_t0001_2': VIEWPORT_TARGET_POINTS.vertex,
}

const SIDEBAR_TARGET_LABELS: Record<string, string | RegExp> = {
  'body_feature_extrude-1': 'feature_extrude-1',
  'body_feature_extrude-2': 'feature_extrude-2',
  'construction_plane-xy': 'Top Plane',
  'construction_plane-yz': 'Right Plane',
  'construction_plane-xz': 'Front Plane',
}

function resolveViewportTargetForPattern(pattern: RegExp) {
  const source = pattern.source

  if (source.includes('body_feature_extrude-1') && source.includes('face_')) {
    return 'body_feature_extrude-1.face_body_feature_extrude-1_t0001_6'
  }

  if (source.includes('body_feature_extrude-1') && source.includes('edge_')) {
    return 'body_feature_extrude-1.edge_body_feature_extrude-1_t0001_12'
  }

  if (source.includes('body_feature_extrude-1$')) {
    return 'body_feature_extrude-1'
  }

  return null
}
