import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

test.setTimeout(60_000)

test('toolbar file menu downloads and opens a cadara document copy', async ({ page }) => {
  await page.goto('/')

  const fileButton = page.getByRole('button', { name: 'File' })
  await expect(fileButton).toBeVisible()
  await fileButton.click()
  await expect(page.getByRole('menuitem', { name: 'New', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Open...' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Save As' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'New document', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Import' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Export' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'New', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Created a new document.' })).toBeVisible({
    timeout: 10_000,
  })
  await page.locator('[data-document-tab][aria-selected="true"] [data-document-tab-close]').click()
  await expect(page.getByText('This document is stored only in this browser.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download a copy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save and keep linked' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await fileButton.click()
  const firstDownloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Save As' }).click()
  await page.getByRole('button', { name: 'Download a copy' }).click()
  const firstDownload = await firstDownloadPromise
  expect(firstDownload.suggestedFilename()).toBe('document.cadara')

  const firstDownloadPath = await firstDownload.path()
  if (!firstDownloadPath) {
    throw new Error('Could not read exported cadara file.')
  }

  const exported = JSON.parse(await readFile(firstDownloadPath, 'utf8')) as {
    settings?: { modelingTolerance?: number }
    schemaVersion?: string
  }
  expect(exported.schemaVersion).toBe('authored-model-document/v1alpha1')

  if (!exported.settings) {
    throw new Error('Exported cadara document did not contain document settings.')
  }
  exported.settings.modelingTolerance = 0.123456

  await fileButton.click()
  await page.getByRole('menuitem', { name: 'Open...' }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a copy' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'imported.cadara',
    mimeType: 'application/vnd.cadara+json',
    buffer: Buffer.from(JSON.stringify(exported)),
  })
  await expect(page.getByRole('status').filter({ hasText: 'Opened imported.cadara.' })).toBeVisible({
    timeout: 10_000,
  })

  await fileButton.click()
  const secondDownloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Save As' }).click()
  await page.getByRole('button', { name: 'Download a copy' }).click()
  const secondDownload = await secondDownloadPromise
  const secondDownloadPath = await secondDownload.path()
  if (!secondDownloadPath) {
    throw new Error('Could not read re-exported cadara file.')
  }

  const reexported = JSON.parse(await readFile(secondDownloadPath, 'utf8')) as {
    settings?: { modelingTolerance?: number }
  }
  expect(reexported.settings?.modelingTolerance).toBe(0.123456)
})
