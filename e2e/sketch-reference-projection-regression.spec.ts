import { expect, test } from '@playwright/test'

import { SketchWorkbenchHarness } from './helpers/sketch-workbench'
import {
  createFaceBackedVertexReferencedCircleOperationHistory,
  createVertexReferencedCircleOperationHistory,
} from './helpers/modeling-fixtures'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('reload preserves a circle centered on a projected solid vertex', async ({ page }, testInfo) => {
  const workbench = new SketchWorkbenchHarness(page)
  const repositoryName = `reference-circle-${testInfo.workerIndex}-${Date.now()}`
  const path = `/?cadRepositoryDbName=${encodeURIComponent(repositoryName)}`

  await workbench.openWithOperationHistory(createVertexReferencedCircleOperationHistory(), path)
  await expect(page.getByText('Vertex Center Circle').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.locator('body').textContent(), { timeout: 30_000 }).not.toContain('replay-exception')

  await workbench.reloadPreservingStorage(path)

  await expect(page.getByText('Vertex Center Circle').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.locator('body').textContent(), { timeout: 30_000 }).not.toContain('replay-exception')
  await expect.poll(() => page.locator('body').textContent(), { timeout: 30_000 }).not.toContain('Authored sketch sketch_2 could not be restored')
})

test('reopen and finish preserves a face-backed referenced-vertex circle sketch', async ({ page }, testInfo) => {
  const workbench = new SketchWorkbenchHarness(page)
  const repositoryName = `face-reference-circle-${testInfo.workerIndex}-${Date.now()}`
  const path = `/?cadRepositoryDbName=${encodeURIComponent(repositoryName)}`

  await workbench.openWithOperationHistory(createFaceBackedVertexReferencedCircleOperationHistory(), path)
  await expect(page.getByText('Vertex Center Face Circle').first()).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', {
    name: 'Select Vertex Center Face Circle. Double-click to reopen.',
  }).dblclick()
  await workbench.expectMachine('editingSketch')
  await workbench.activateTool('Exit the active sketch.')

  await workbench.expectMachine('idle')
  await expect.poll(() => page.locator('body').textContent(), { timeout: 30_000 }).not.toContain('replay-exception')
})
