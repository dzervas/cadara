import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { SketchWorkbenchHarness } from './sketch-workbench'
import {
  createBaseExtrudeOperationHistory,
  createRectangleProfileOperationHistory,
  createTwoExtrudeBodiesOperationHistory,
  FEATURE_FIXTURE,
  SECONDARY_EXTRUDE_FIXTURE,
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
  | 'combine'
  | 'deleteSolid'
  | 'mirror'
  | 'transform'
  | 'shell'
  | 'plane'

export class FeatureWorkbenchHarness extends SketchWorkbenchHarness {
  constructor(page: Page) {
    super(page)
  }

  override async open(path = '/') {
    await super.open(path)
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
    await this.waitForRenderIdle()
  }

  override async reloadPreservingStorage(path = '/') {
    await super.reloadPreservingStorage(path)
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
    await this.waitForRenderIdle()
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
      secondProfileTarget: SECONDARY_EXTRUDE_FIXTURE.profile,
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
      combine: 'Boolean explicit target bodies with explicit tool bodies.',
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
    await expect.poll(() => this.featureSessionLabel(), { timeout: 10_000 }).toContain('create:loft:')
    await this.selectReferenceThroughCurrentUi('body_feature_extrude-1.face_body_feature_extrude-1_t0001_1')
    await expect.poll(() => this.currentEditorSelection(), { timeout: 10_000 }).toContain('body_feature_extrude-1.face_body_feature_extrude-1_t0001_1')
    await this.selectReferenceThroughCurrentUi('body_feature_extrude-1.face_body_feature_extrude-1_t0001_6')

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
    await this.page.getByRole('spinbutton', { name: label }).fill(String(value))
  }

  async setOperation(operation: 'newBody' | 'join' | 'cut' | 'intersect') {
    await this.selectOperation(operation)
  }

  async setCombineOperation(operation: 'add' | 'subtract' | 'intersect') {
    await this.selectOperation(operation)
  }

  async expectFeaturePreviewReady(kind: FeatureKind) {
    await expect.poll(() => this.featureSessionLabel(), { timeout: 30_000 }).toContain(`create:${kind}:previewReady`)
    await expect.poll(() => this.currentPreviewDiagnosticsText(), { timeout: 10_000 }).not.toMatch(/\berror\b/i)
  }

  async commitFeature(expectedFeatureId?: string) {
    await this.page.getByRole('button', { name: 'Commit' }).click()
    await expect.poll(() => this.machineLabel(), { timeout: 75_000 }).toContain('idle')
    await this.waitForRenderIdle(30_000)

    if (expectedFeatureId) {
      await expect.poll(
        () => this.page.evaluate(
          (featureId) => window.__cadTestState?.featureIds.includes(featureId) ?? false,
          expectedFeatureId,
        ),
        { timeout: 30_000 },
      ).toBe(true, { message: `${expectedFeatureId} should be present in the committed document.` })
    }
  }

  async canvasBytes() {
    return this.viewport().screenshot()
  }

  async waitForRenderIdle(timeout = 15_000) {
    await this.page.waitForSelector('[data-render-idle="true"]', { timeout })
  }

  async selectReferenceByViewportPicking(targetId: string) {
    const viewportPoint = await this.projectTargetToScreen(targetId)

    if (!viewportPoint) {
      throw new Error(`No projected viewport point is available for ${targetId}.`)
    }

    await this.clickViewportAtReal(viewportPoint)
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
    const selected = await this.page.evaluate((id) => window.__cadSelectTarget?.(id) ?? false, targetId)

    if (selected) {
      return
    }

    const viewportPoint = await this.projectTargetToScreen(targetId)
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

  private async selectOperation(operation: string) {
    const operationLabels: Record<string, string> = {
      newBody: 'New body',
      join: 'Join',
      cut: 'Cut',
      intersect: 'Intersect',
      create: 'Create',
      add: 'Add',
      subtract: 'Subtract',
    }
    const optionLabel = operationLabels[operation] ?? operation
    const operationField = this.page.getByRole('combobox', { name: 'Operation' })
    const currentValue = (await operationField.textContent())?.trim().toLowerCase() ?? ''

    if (currentValue === optionLabel.toLowerCase()) {
      return
    }

    await operationField.click()
    await this.page.getByRole('option', {
      name: new RegExp(`^${escapeRegExp(optionLabel)}$`, 'i'),
    }).click()
  }

  private async selectFirstReferenceMatchingCurrentUi(pattern: RegExp) {
    const targetId = await this.page.evaluate(
      ({ source, flags }) => {
        const matcher = new RegExp(source, flags)
        const targets = window.__cadTestState?.selectableTargets ?? []
        return targets.find((target) => matcher.test(`Select viewport target ${target}`)) ?? null
      },
      { source: pattern.source, flags: pattern.flags },
    )

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
    return this.page.evaluate(() => window.__cadTestState?.revision ?? 'loading')
  }

  private async machineLabel() {
    return this.page.evaluate(() => window.__cadTestState?.machineState ?? '')
  }

  private async featureSessionLabel() {
    return this.page.evaluate(() => window.__cadTestState?.featureSession ?? '')
  }

  private async currentPreviewDiagnosticsText() {
    return this.page.evaluate(() => window.__cadTestState?.previewDiagnostics ?? '')
  }

  private async hasVisibleFeatureErrorDiagnostics() {
    return this.page.locator('aside').getByText(/^error$/i).isVisible().catch(() => false)
  }

  private async projectTargetToScreen(targetId: string) {
    return this.page.evaluate((id) => window.__cadProjectToScreen?.(id) ?? null, targetId)
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

const SIDEBAR_TARGET_LABELS: Record<string, string | RegExp> = {
  'body_feature_extrude-1': 'feature_extrude-1',
  'body_feature_extrude-2': 'feature_extrude-2',
  'construction_plane-xy': 'Top Plane',
  'construction_plane-yz': 'Right Plane',
  'construction_plane-xz': 'Front Plane',
}
