import type { Locator, Page } from '@playwright/test'
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
  }

  override async reloadPreservingStorage() {
    await super.reloadPreservingStorage()
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
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
    const button = this.referenceButton(targetId)
    await button.click()
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
    const ariaLabel = await this.getFirstReferenceLabelMatching(pattern)

    if (!ariaLabel) {
      throw new Error(`No selectable reference matched ${pattern}.`)
    }

    await this.page.getByRole('button', { name: ariaLabel }).click()
    return ariaLabel
  }

  async selectSupportedLoftFaceProfile(profileTarget: string) {
    const faceLabels = await this.getReferenceLabelsMatching(/^Select .* body_feature_extrude-1\.face_/)

    for (const faceLabel of faceLabels) {
      await this.selectReference(profileTarget)
      await this.activateFeature('loft')
      await this.page.getByRole('button', { name: faceLabel }).click()

      try {
        await expect.poll(async () => {
          if (await this.hasVisibleFeatureErrorDiagnostics()) {
            return 'error'
          }

          const session = await this.featureSessionLabel()
          return session.includes('create:loft:previewReady') ? 'ready' : session || 'pending'
        }, { timeout: 5_000 }).toBe('ready')

        await expect.poll(() => this.hasVisibleFeatureErrorDiagnostics(), { timeout: 2_000 }).toBe(false)
        return faceLabel
      } catch {
        await this.page.getByRole('button', { name: 'Cancel' }).click()
        await expect.poll(() => this.machineLabel(), { timeout: 10_000 }).toContain('idle')
      }
    }

    throw new Error('No loft face reference produced a preview-ready loft session.')
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
    }, { timeout: 5_000 }).toBeLessThan(maxDelta)
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

  private referenceButton(targetId: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^Select .*${escapeRegExp(targetId)}$`) })
  }

  private async getFirstReferenceLabelMatching(pattern: RegExp) {
    const matches = await this.getReferenceLabelsMatching(pattern)
    return matches[0] ?? null
  }

  private async getReferenceLabelsMatching(pattern: RegExp) {
    return this.page.getByRole('button').evaluateAll((buttons, source) => {
      const regex = new RegExp(source)
      return buttons.flatMap((button) => {
        const label = button.getAttribute('aria-label')
        return label && regex.test(label) ? [label] : []
      })
    }, pattern.source)
  }

  private async listVisibleBodyIds() {
    const labels = await this.page.getByRole('button').evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        if (button.getAttribute('aria-disabled') === 'true') {
          return []
        }

        const label = button.getAttribute('aria-label')
        if (!label?.startsWith('Select ')) {
          return []
        }

        const match = /^Select .* (body_[A-Za-z0-9_-]+)$/.exec(label)
        return match ? [match[1]] : []
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
