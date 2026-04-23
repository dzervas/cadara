import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { SketchWorkbenchHarness } from './helpers/sketch-workbench'

const MODELING_OPERATION_HISTORY_STORAGE_KEY = 'cad.modeling.operationHistory.v1'

test.setTimeout(60_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('dragging an active sketch vertex updates the committed sketch definition', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()
  await workbench.activateTool('Create line geometry.')

  const canvas = page.locator('main canvas').first()
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 420, y: 320 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('1 entities staged')

  const box = await canvas.boundingBox()
  if (!box) {
    throw new Error('Viewport canvas is not visible.')
  }

  await page.mouse.move(box.x + 360, box.y + 260)
  await page.mouse.down()
  await page.mouse.move(box.x + 500, box.y + 260, { steps: 8 })
  await page.mouse.up()

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')

  const pointPositions = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey)
    if (!serialized) {
      return []
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            points?: Array<{ position: readonly [number, number] }>
          }
        }
      }>
    }

    return payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)?.payload?.definition?.points
      ?.map((point) => point.position) ?? []
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(pointPositions.length).toBeGreaterThanOrEqual(2)
  expect(pointPositions[0]![0]).toBeGreaterThan(pointPositions[1]![0])
})

test('repository-backed sketch commit stays responsive and survives immediate refresh without file system access', async ({
  page,
}, testInfo) => {
  const workbench = new SketchWorkbenchHarness(page)
  const repositoryName = `sketch-refresh-${testInfo.workerIndex}-${Date.now()}`
  const repositoryPath = `/?cadRepositoryDbName=${repositoryName}`

  await installRepositoryDelayAndNoFileSystemAccess(page)
  await workbench.openWithRepository(repositoryPath)
  await page.evaluate(() => {
    window.__cadDelayDocumentSyncMutations = true
  })

  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()
  await workbench.activateTool('Create line geometry.')

  const canvas = page.locator('main canvas').first()
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 440, y: 320 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('1 entities staged')

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')
  await expect.poll(() => page.evaluate(() => window.__cadDelayedDocumentSyncMutations?.length ?? 0), {
    timeout: 10_000,
  }).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Select Sketch Draft. Double-click to reopen.' })).toBeVisible({
    timeout: 30_000,
  })

  const persistedSketch = await page.evaluate((storageKey) => {
    const serialized = window.__cadLastOperationHistoryPayload ?? window.localStorage.getItem(storageKey)
    if (!serialized) {
      return null
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            authoringOperations?: unknown[]
            entities?: unknown[]
          }
        }
      }>
    }
    const commitSketch = payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)

    return {
      authoringOperationCount: commitSketch?.payload?.definition?.authoringOperations?.length ?? 0,
      entityCount: commitSketch?.payload?.definition?.entities?.length ?? 0,
    }
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(persistedSketch?.entityCount).toBeGreaterThanOrEqual(1)
  expect(persistedSketch?.authoringOperationCount).toBe(0)

  await page.evaluate(() => {
    window.__cadDelayDocumentSyncMutations = false
  })
  await workbench.reloadPreservingRepositoryStorage(repositoryPath)

  await expect(page.getByText('History restore failed')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Select Sketch Draft. Double-click to reopen.' })).toBeVisible({
    timeout: 30_000,
  })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toBe('none')
})

async function installRepositoryDelayAndNoFileSystemAccess(page: Page) {
  await page.addInitScript((storageKey) => {
    type DelayedMutation = {
      message: unknown
      transfer?: Transferable[]
      worker: Worker
    }
    type TestWindow = typeof window & {
      __cadDelayDocumentSyncMutations?: boolean
      __cadDelayedDocumentSyncMutations?: DelayedMutation[]
      __cadLastOperationHistoryPayload?: string | null
      __cadReleaseDelayedDocumentSyncMutations?: () => void
    }

    const testWindow = window as TestWindow
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })

    const nativeSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string) {
      if (key === storageKey) {
        testWindow.__cadLastOperationHistoryPayload = value
      }

      return nativeSetItem.call(this, key, value)
    }

    testWindow.__cadDelayedDocumentSyncMutations = []
    const NativeWorker = window.Worker

    class DelayedDocumentSyncWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[]) {
        if (
          testWindow.__cadDelayDocumentSyncMutations
          && typeof message === 'object'
          && message !== null
          && (message as { kind?: unknown }).kind === 'mutate'
        ) {
          testWindow.__cadDelayedDocumentSyncMutations?.push({ message, transfer, worker: this })
          return
        }

        if (transfer) {
          super.postMessage(message, transfer)
          return
        }

        super.postMessage(message)
      }
    }

    window.Worker = DelayedDocumentSyncWorker

    testWindow.__cadReleaseDelayedDocumentSyncMutations = () => {
      const delayed = testWindow.__cadDelayedDocumentSyncMutations?.splice(0) ?? []

      for (const item of delayed) {
        if (item.transfer) {
          item.worker.postMessage(item.message, item.transfer)
          continue
        }

        item.worker.postMessage(item.message)
      }
    }
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)
}
