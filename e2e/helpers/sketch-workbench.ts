import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { ModelingOperationHistoryPayload } from '../../src/contracts/modeling/operation-history'

const MODELING_OPERATION_HISTORY_STORAGE_KEY = 'cad.modeling.operationHistory.v1'

export class SketchWorkbenchHarness {
  constructor(readonly page: Page) {}

  async seedOperationHistory(payload: ModelingOperationHistoryPayload) {
    const serializedPayload = JSON.stringify(payload)

    await this.page.addInitScript(
      ({ storageKey, serialized }) => {
        if (window.localStorage.getItem(storageKey) === null) {
          window.localStorage.setItem(storageKey, serialized)
        }
      },
      {
        storageKey: MODELING_OPERATION_HISTORY_STORAGE_KEY,
        serialized: serializedPayload,
      },
    )
  }

  async openWithOperationHistory(payload: ModelingOperationHistoryPayload, path = '/') {
    await this.seedOperationHistory(payload)
    await this.open(path)
  }

  async open(path = '/') {
    await this.openPreservingStorage(withDisabledRepository(path))
  }

  async openPreservingStorage(path = '/') {
    await this.page.goto(path)
    await expect.poll(() => this.readMachineLabel(), { timeout: 30_000 }).not.toBe('')
    await expect.poll(() => this.revisionLabel(), { timeout: 30_000 }).not.toBe('loading')
  }

  async reloadPreservingStorage(path?: string) {
    await this.openPreservingStorage(withDisabledRepository(path ?? await this.currentPath()))
  }

  toolbarButton(name: string): Locator {
    return this.page.locator(
      `button[aria-label="${name}"], button[data-tool-tooltip="${name}"]`,
    )
  }

  viewport(): Locator {
    return this.page.locator('main canvas').first()
  }

  viewportSurface(): Locator {
    return this.page.getByTestId('cad-viewport')
  }

  async activateTool(name: string) {
    await this.toolbarButton(name).click()
  }

  async hoverViewportAt(point: { x: number; y: number }) {
    const box = await this.viewport().boundingBox()

    if (!box) {
      throw new Error('Viewport canvas is not visible.')
    }

    await this.page.mouse.move(box.x + point.x, box.y + point.y)
  }

  async hoverViewportAtReal(point: { x: number; y: number }) {
    const box = await this.viewportSurface().boundingBox()

    if (!box) {
      throw new Error('Viewport surface is not visible.')
    }

    const targetX = box.x + point.x
    const targetY = box.y + point.y

    await this.page.mouse.move(targetX - 4, targetY - 4)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.page.mouse.move(targetX, targetY)
      if (attempt < 2) {
        await this.page.waitForTimeout(50)
      }
    }
  }

  async clickViewportAt(point: { x: number; y: number }) {
    const box = await this.viewport().boundingBox()

    if (!box) {
      throw new Error('Viewport canvas is not visible.')
    }

    await this.page.mouse.click(box.x + point.x, box.y + point.y)
  }

  async clickViewportAtReal(point: { x: number; y: number }) {
    const box = await this.viewportSurface().boundingBox()

    if (!box) {
      throw new Error('Viewport surface is not visible.')
    }

    await this.page.mouse.click(box.x + point.x, box.y + point.y)
  }

  async currentHoverTarget() {
    return this.page.evaluate(() => window.__cadTestState?.hoverTarget ?? 'none')
  }

  async currentEditorSelection() {
    return this.page.evaluate(() => window.__cadTestState?.selectionTargets ?? '')
  }

  async currentSketchSession() {
    return this.page.evaluate(() => window.__cadTestState?.sketchSession ?? 'none')
  }

  async currentMachineSelectionCount() {
    return this.page.evaluate(() => window.__cadTestState?.selectionCount ?? Number.NaN)
  }

  async clearHoverByLeavingViewport() {
    const box = await this.viewportSurface().boundingBox()

    if (!box) {
      throw new Error('Viewport surface is not visible.')
    }

    await this.page.mouse.move(box.x - 24, box.y - 24)
  }

  async viewportCrop(point: { x: number; y: number }, radius = 48) {
    const box = await this.viewportSurface().boundingBox()

    if (!box) {
      throw new Error('Viewport surface is not visible.')
    }

    const size = radius * 2
    return this.page.screenshot({
      clip: {
        x: Math.round(box.x + point.x - radius),
        y: Math.round(box.y + point.y - radius),
        width: size,
        height: size,
      },
    })
  }

  async waitForAnimationFrames(count = 2) {
    await this.page.evaluate((frames) => new Promise<void>((resolve) => {
      let remaining = frames

      const advance = () => {
        remaining -= 1

        if (remaining <= 0) {
          resolve()
          return
        }

        window.requestAnimationFrame(advance)
      }

      window.requestAnimationFrame(advance)
    }), count)
  }

  async expectSketchPlane(label: string) {
    await expect.poll(() => this.page.evaluate(() => window.__cadTestState?.sketchPlane ?? 'none')).toBe(label)
  }

  async expectSketchSessionActive() {
    await this.expectMachine('editingSketch')
    await expect.poll(() => this.page.evaluate(() => window.__cadTestState?.sketchPlane ?? 'none')).not.toBe('none')
  }

  async expectMachine(kind: string, timeout = 10_000) {
    await expect.poll(() => this.readMachineLabel(), { timeout }).toContain(kind)
  }

  private async revisionLabel() {
    return this.page.evaluate(() => window.__cadTestState?.revision ?? 'loading')
  }

  private async readMachineLabel() {
    return this.page.evaluate(() => window.__cadTestState?.machineState ?? '')
  }

  private async currentPath() {
    return this.page.evaluate(() => `${window.location.pathname}${window.location.search}${window.location.hash}`)
  }

}

function withDisabledRepository(path: string) {
  const url = new URL(path, 'http://127.0.0.1:3000')
  url.searchParams.set('cadDisableRepository', '1')
  url.searchParams.set('cadTestMode', '1')

  return path.startsWith('http://') || path.startsWith('https://')
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`
}
