import { expect, test } from '@playwright/test'

import {
  createCreateFeatureHistoryEntry,
  type ModelingOperationHistoryPayload,
} from '../src/contracts/modeling/operation-history'
import type { DocumentId, RegionId, RevisionId, SketchId } from '../src/contracts/shared/ids'
import { CONTRACT_VERSION, EXTRUDE_FEATURE_SCHEMA_VERSION } from '../src/contracts/shared/versioning'
import { FeatureWorkbenchHarness } from './helpers/feature-workbench'
import { createRectangleProfileOperationHistory } from './helpers/modeling-fixtures'

test.setTimeout(90_000)
test.use({ viewport: { width: 640, height: 480 } })

test('feature error timeline tooltip remains fully visible above the history bar', async ({ page }) => {
  const workbench = new FeatureWorkbenchHarness(page)

  await workbench.openWithOperationHistory(createRepairableFeatureErrorHistory())

  const errorFeatureButton = page.locator('button[data-feature-error="true"]').first()
  await expect(errorFeatureButton).toBeVisible({ timeout: 30_000 })

  await errorFeatureButton.hover()

  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Edit Repairable Profile and choose a valid profile selection.')

  const geometry = await page.evaluate(() => {
    const tooltipElement = document.querySelector<HTMLElement>('[role="tooltip"]')
    const errorButtonElement = document.querySelector<HTMLElement>('button[data-feature-error="true"]')
    const historyScrollerElement = errorButtonElement
      ?.closest('section')
      ?.querySelector<HTMLElement>('.overflow-x-auto.overflow-y-hidden')

    if (!tooltipElement || !errorButtonElement || !historyScrollerElement) {
      throw new Error('Expected tooltip, error feature button, and history scroller to be present.')
    }

    const tooltipRect = tooltipElement.getBoundingClientRect()
    const buttonRect = errorButtonElement.getBoundingClientRect()

    return {
      tooltip: {
        left: tooltipRect.left,
        top: tooltipRect.top,
        right: tooltipRect.right,
        bottom: tooltipRect.bottom,
        width: tooltipRect.width,
        height: tooltipRect.height,
      },
      button: {
        top: buttonRect.top,
      },
      historyScroller: {
        top: historyScrollerElement.getBoundingClientRect().top,
        clientHeight: historyScrollerElement.clientHeight,
        scrollHeight: historyScrollerElement.scrollHeight,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      tooltipParentIsBody: tooltipElement.parentElement === document.body,
      historyScrollerContainsTooltip: historyScrollerElement.contains(tooltipElement),
      historyScrollerOverflowY: getComputedStyle(historyScrollerElement).overflowY,
      tooltipPosition: getComputedStyle(tooltipElement).position,
      tooltipZIndex: Number(getComputedStyle(tooltipElement).zIndex),
    }
  })
  const tolerance = 1

  expect(geometry.tooltipParentIsBody).toBe(true)
  expect(geometry.historyScrollerContainsTooltip).toBe(false)
  expect(geometry.historyScrollerOverflowY).toBe('hidden')
  expect(geometry.tooltipPosition).toBe('fixed')
  expect(geometry.tooltipZIndex).toBeGreaterThan(1_000_000)
  expect(geometry.tooltip.width).toBeGreaterThan(0)
  expect(geometry.tooltip.height).toBeGreaterThan(0)
  expect(geometry.tooltip.left).toBeGreaterThanOrEqual(-tolerance)
  expect(geometry.tooltip.top).toBeGreaterThanOrEqual(-tolerance)
  expect(geometry.tooltip.right).toBeLessThanOrEqual(geometry.viewport.width + tolerance)
  expect(geometry.tooltip.bottom).toBeLessThanOrEqual(geometry.viewport.height + tolerance)
  expect(geometry.tooltip.bottom).toBeLessThanOrEqual(geometry.button.top - 4)
  expect(geometry.tooltip.bottom).toBeLessThanOrEqual(geometry.historyScroller.top - 4)
  expect(geometry.historyScroller.scrollHeight).toBeLessThanOrEqual(geometry.historyScroller.clientHeight + tolerance)
})

function createRepairableFeatureErrorHistory(): ModelingOperationHistoryPayload {
  const base = createRectangleProfileOperationHistory()

  return {
    ...base,
    entries: [
      ...base.entries,
      createCreateFeatureHistoryEntry({
        contractVersion: CONTRACT_VERSION,
        documentId: 'doc_workspace' as DocumentId,
        baseRevisionId: 'rev_fixture' as RevisionId,
        featureLabel: 'Repairable Profile',
        definition: {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: [{
              kind: 'region',
              sketchId: 'sketch_deleted' as SketchId,
              regionId: 'region_deleted' as RegionId,
            }],
            startExtent: { kind: 'profilePlane' },
            extent: {
              mode: 'oneSide',
              end: { kind: 'blind', direction: 'positive', distance: 4 },
            },
            operation: 'newBody',
            booleanScope: { kind: 'standalone' },
          },
        },
      }),
    ],
  }
}
