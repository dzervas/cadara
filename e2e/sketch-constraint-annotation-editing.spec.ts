import { expect, test } from '@playwright/test'

import { SketchWorkbenchHarness } from './helpers/sketch-workbench'

const MODELING_OPERATION_HISTORY_STORAGE_KEY = 'cad.modeling.operationHistory.doc_workspace.v1'

test.setTimeout(60_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('committed distance annotation input keeps Backspace local and saves durable value edits', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()

  const canvas = page.locator('main canvas').first()

  await workbench.activateTool('Create line geometry.')
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 460, y: 320 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('1 entities staged')

  await workbench.activateTool('Create point-to-point distance dimensions.')
  await page.getByRole('menuitem', { name: /Distance Create aligned distance dimensions/ }).click()
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 460, y: 320 }, force: true })
  await canvas.click({ position: { x: 420, y: 240 }, force: true })

  const floatingInput = page.locator('[data-sketch-viewport-floating-input]')
  await expect(floatingInput).toBeVisible()
  await floatingInput.locator('input').fill('24')
  await floatingInput.getByRole('button', { name: 'Commit' }).click()

  const distanceGlyph = page.locator('[data-sketch-annotation-kind="dimension"]').first()
  await expect(distanceGlyph).toBeVisible()

  await distanceGlyph.dblclick()
  await expect(floatingInput).toBeVisible()

  const editInput = floatingInput.locator('input')
  await expect(editInput).toHaveValue('24')
  await editInput.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await editInput.press('Backspace')

  await expect(distanceGlyph).toBeVisible()
  await expect(floatingInput).toBeVisible()

  await floatingInput.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Enter a value before saving.')).toBeVisible()
  await expect(distanceGlyph).toBeVisible()

  await editInput.fill('31')
  await floatingInput.getByRole('button', { name: 'Save' }).click()

  await expect(floatingInput).toBeHidden()
  await expect(distanceGlyph).toHaveAttribute('aria-label', /31\.00/)

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')

  const committedDimensionValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey)
    if (!serialized) {
      return []
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            dimensions?: Array<{ kind: string; value?: number }>
          }
        }
      }>
    }

    return payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)?.payload?.definition?.dimensions
      ?.map((dimension) => dimension.value ?? null) ?? []
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(committedDimensionValues).toContain(31)
})

test('edited rectangle width annotation solves and still finishes the sketch', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()

  const canvas = page.locator('main canvas').first()

  await workbench.activateTool('Create rectangle geometry.')
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 500, y: 360 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('4 entities staged')

  const widthGlyph = page.locator('[data-sketch-annotation-glyph="dimensionHorizontal"]').first()
  await expect(widthGlyph).toBeVisible()

  await widthGlyph.dblclick()

  const floatingInput = page.locator('[data-sketch-viewport-floating-input]')
  await expect(floatingInput).toBeVisible()
  await floatingInput.locator('input').fill('31')
  await floatingInput.getByRole('button', { name: 'Save' }).click()

  await expect(floatingInput).toBeHidden()
  await expect(widthGlyph).toHaveAttribute('aria-label', /31\.00/)

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')

  const committedWidthValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey)
    if (!serialized) {
      return []
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            dimensions?: Array<{ axis?: string; kind: string; value?: number }>
          }
        }
      }>
    }

    return payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)?.payload?.definition?.dimensions
      ?.filter((dimension) => dimension.kind === 'distance' && dimension.axis === 'horizontal')
      .map((dimension) => dimension.value ?? null) ?? []
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(committedWidthValues).toContain(31)
})

test('edited rectangle height annotation solves and still finishes the sketch', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()

  const canvas = page.locator('main canvas').first()

  await workbench.activateTool('Create rectangle geometry.')
  await canvas.click({ position: { x: 360, y: 260 }, force: true })
  await canvas.click({ position: { x: 500, y: 360 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('4 entities staged')

  const heightGlyph = page.locator('[data-sketch-annotation-glyph="dimensionVertical"]').first()
  await expect(heightGlyph).toBeVisible()

  await heightGlyph.dblclick()

  const floatingInput = page.locator('[data-sketch-viewport-floating-input]')
  await expect(floatingInput).toBeVisible()
  await floatingInput.locator('input').fill('29')
  await floatingInput.getByRole('button', { name: 'Save' }).click()

  await expect(floatingInput).toBeHidden()
  await expect(heightGlyph).toHaveAttribute('aria-label', /29\.00/)

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')

  const committedHeightValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey)
    if (!serialized) {
      return []
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            dimensions?: Array<{ axis?: string; kind: string; value?: number }>
          }
        }
      }>
    }

    return payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)?.payload?.definition?.dimensions
      ?.filter((dimension) => dimension.kind === 'distance' && dimension.axis === 'vertical')
      .map((dimension) => dimension.value ?? null) ?? []
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(committedHeightValues).toContain(29)
})

test('edited circle radius annotation solves and still finishes the sketch', async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page)

  await workbench.open()
  await workbench.activateTool('Start a new sketch.')
  await page.getByRole('button', { name: /Top Plane/ }).first().click()
  await workbench.expectSketchSessionActive()

  const canvas = page.locator('main canvas').first()

  await workbench.activateTool('Create circular geometry.')
  await canvas.click({ position: { x: 430, y: 320 }, force: true })
  await canvas.click({ position: { x: 500, y: 320 }, force: true })
  await expect.poll(() => workbench.currentSketchSession(), { timeout: 10_000 }).toContain('1 entities staged')

  const radiusGlyph = page.locator('[data-sketch-annotation-glyph="dimensionRadius"]').first()
  await expect(radiusGlyph).toBeVisible()

  await radiusGlyph.dblclick()

  const floatingInput = page.locator('[data-sketch-viewport-floating-input]')
  await expect(floatingInput).toBeVisible()
  await floatingInput.locator('input').fill('18')
  await floatingInput.getByRole('button', { name: 'Save' }).click()

  await expect(floatingInput).toBeHidden()
  await expect(radiusGlyph).toHaveAttribute('aria-label', /18\.00/)

  await workbench.activateTool('Exit the active sketch.')
  await workbench.expectMachine('idle')

  const committedRadiusValues = await page.evaluate((storageKey) => {
    const serialized = window.localStorage.getItem(storageKey)
    if (!serialized) {
      return []
    }

    const payload = JSON.parse(serialized) as {
      entries?: Array<{
        kind: string
        payload?: {
          definition?: {
            dimensions?: Array<{ kind: string; value?: number }>
            entities?: Array<{ kind: string; radius?: number }>
          }
        }
      }>
    }

    const definition = payload.entries?.filter((entry) => entry.kind === 'commitSketch').at(-1)?.payload?.definition
    return {
      dimensionValues: definition?.dimensions
        ?.filter((dimension) => dimension.kind === 'circleRadius')
        .map((dimension) => dimension.value ?? null) ?? [],
      entityRadii: definition?.entities
        ?.filter((entity) => entity.kind === 'circle')
        .map((entity) => entity.radius ?? null) ?? [],
    }
  }, MODELING_OPERATION_HISTORY_STORAGE_KEY)

  expect(committedRadiusValues.dimensionValues).toContain(18)
  expect(committedRadiusValues.entityRadii).toContain(18)
})
