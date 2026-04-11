import { expect, test } from '@playwright/test'

test('toolbar uses local SVG icons and rich tooltips across buttons, dropdowns, and search rows', async ({
  page,
}) => {
  await page.goto('/')

  const extrudeButton = page.locator('button[data-tool-id="extrude"]').first()
  await expect(extrudeButton.locator('img[src="/icons/extrude.svg"]')).toBeVisible()

  await extrudeButton.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip.getByText('Extrude', { exact: true })).toBeVisible()
  await expect(tooltip.getByText('Create an extruded solid or surface.')).toBeVisible()

  const patternButton = page.locator('button[data-tool-id="pattern"]')
  await expect(patternButton.locator('img[src="/icons/linear-pattern.svg"]')).toBeVisible()

  await patternButton.hover()
  await expect(tooltip.getByText('Pattern', { exact: true })).toBeVisible()
  await expect(tooltip.getByText('Choose a pattern tool.')).toBeVisible()

  await patternButton.click()
  const circularPatternItem = page.getByRole('menuitem').filter({ hasText: 'Circular Pattern' })
  await expect(circularPatternItem.locator('img[src="/icons/circular-pattern.svg"]')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByPlaceholder('Search tools').fill('mirror')
  const mirrorSearchRow = page.locator('button[data-tool-source="search"][data-tool-id="mirror"]')
  await expect(mirrorSearchRow.locator('img[src="/icons/mirror.svg"]')).toBeVisible()
})
