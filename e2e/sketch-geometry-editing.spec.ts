import { expect, test } from '@playwright/test'
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
