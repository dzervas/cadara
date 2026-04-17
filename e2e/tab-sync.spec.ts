import { expect, test, type Page } from '@playwright/test'

const DOCUMENT_REPOSITORY_URL_STORAGE_KEY = 'cad.documentRepository.automergeUrls.v1'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('opt-in local peer sync propagates authored document changes between tabs', async ({ context }, testInfo) => {
  const channelName = `cad-e2e-tab-sync-${testInfo.workerIndex}-${Date.now()}`
  const firstTabUrl = createSyncedWorkbenchUrl(channelName, `${channelName}-a`)
  const secondTabUrl = createSyncedWorkbenchUrl(channelName, `${channelName}-b`)
  const firstTab = await context.newPage()
  const secondTab = await context.newPage()

  await openSyncedWorkbench(firstTab, firstTabUrl)
  await waitForRepositoryUrl(firstTab)
  await openSyncedWorkbench(secondTab, secondTabUrl)
  await expect(firstTab.locator('[data-variable-row]')).toHaveCount(0)
  await expect(secondTab.locator('[data-variable-row]')).toHaveCount(0)

  await firstTab.getByRole('button', { name: 'Add variable' }).click()
  await expect(firstTab.getByLabel('Variable name variable_1')).toHaveValue('var1', { timeout: 30_000 })
  await expect(firstTab.getByLabel('Variable value variable_1')).toHaveValue('0')

  await expect(secondTab.getByLabel('Variable name variable_1')).toHaveValue('var1', { timeout: 30_000 })
  await expect(secondTab.getByLabel('Variable value variable_1')).toHaveValue('0')

  await secondTab.close()
  await firstTab.close()
})

function createSyncedWorkbenchUrl(channelName: string, databaseName: string) {
  const params = new URLSearchParams({
    cadLocalPeerSync: '1',
    cadLocalPeerSyncChannel: channelName,
    cadRepositoryDbName: databaseName,
  })

  return `/?${params}`
}

async function openSyncedWorkbench(page: Page, url: string) {
  await page.goto(url)
  await ensureStateDebuggerExpanded(page)
  await expect(page.getByText('Machine:')).toBeVisible()
  await expect.poll(() => revisionLabel(page), { timeout: 30_000 }).not.toBe('loading')
}

async function waitForRepositoryUrl(page: Page) {
  await expect.poll(
    () => page.evaluate(
      (storageKey) => window.localStorage.getItem(storageKey),
      DOCUMENT_REPOSITORY_URL_STORAGE_KEY,
    ),
    { timeout: 30_000 },
  ).toContain('doc_workspace')
}

async function ensureStateDebuggerExpanded(page: Page) {
  const expandButton = page.getByRole('button', {
    name: 'Expand state debugger',
  })

  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click()
  }
}

async function revisionLabel(page: Page) {
  const bodyText = await page.locator('body').textContent()
  return bodyText?.match(/Revision:\s*([^\s]+)/)?.[1] ?? 'loading'
}
