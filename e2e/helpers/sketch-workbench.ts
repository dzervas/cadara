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

  async openWithOperationHistory(payload: ModelingOperationHistoryPayload) {
    await this.seedOperationHistory(payload)
    await this.open()
  }

  async open() {
    await this.openPreservingStorage()
  }

  async openPreservingStorage() {
    await this.page.goto('/')
    await expect(this.page.getByText('Machine:')).toBeVisible()
  }

  async reloadPreservingStorage() {
    await this.page.reload()
    await expect(this.page.getByText('Machine:')).toBeVisible()
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

    await this.page.mouse.move(box.x + point.x, box.y + point.y)
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
    const bodyText = await this.page.locator('body').textContent()
    return bodyText?.match(/Hover target:\s*([\s\S]*?)Selection detail:/)?.[1]?.replace(/\s+/g, '').trim() ?? 'none'
  }

  async currentEditorSelection() {
    const bodyText = await this.page.locator('body').textContent()
    const match = bodyText?.match(/Selection targets:\s*(.*?)Revision:/s)
    return match?.[1]?.trim() ?? ''
  }

  async currentSketchSession() {
    const bodyText = await this.page.locator('body').textContent()
    const match = bodyText?.match(/Sketch session:\s*(.*?)Sketch plane:/s)
    return match?.[1]?.trim() ?? 'none'
  }

  async currentMachineSelectionCount() {
    const bodyText = await this.page.locator('body').textContent()
    const match = bodyText?.match(/Machine:\s*[^\n]*Command:\s*[^\n]*Phase:\s*[^\n]*Selection:\s*(\d+)/s)
    return match ? Number(match[1]) : NaN
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
    await expect(this.page.getByText('Sketch plane:')).toContainText(label)
  }

  async expectSketchSessionActive() {
    await this.expectMachine('editingSketch')
    await expect(this.page.getByText('Sketch plane:')).not.toContainText('none')
  }

  async expectMachine(kind: string) {
    await expect(this.page.getByText('Machine:')).toContainText(kind)
  }
}
