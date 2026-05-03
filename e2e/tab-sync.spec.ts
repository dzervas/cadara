import { expect, test, type Page } from '@playwright/test'

test.setTimeout(90_000)
test.use({ viewport: { width: 1440, height: 960 } })

test('opt-in local peer sync propagates authored document changes between tabs', async ({ context }, testInfo) => {
  const channelName = `cad-e2e-tab-sync-${testInfo.workerIndex}-${Date.now()}`
  const firstTabUrl = createSyncedWorkbenchUrl(channelName, `${channelName}-a`)
  const secondTabUrl = createSyncedWorkbenchUrl(channelName, `${channelName}-b`)
  const firstTab = await context.newPage()
  const secondTab = await context.newPage()

  await openSyncedWorkbench(firstTab, firstTabUrl)
  await waitForRepositoryUrl(firstTab, `${channelName}-a`)
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
    cadTestMode: '1',
  })

  return `/?${params}`
}

async function openSyncedWorkbench(page: Page, url: string) {
  await page.goto(url)
  await expect.poll(() => page.evaluate(() => window.__cadaraDebug?.getState()?.machineState ?? ''), { timeout: 30_000 }).not.toBe('')
  await expect.poll(() => revisionLabel(page), { timeout: 30_000 }).not.toBe('loading')
}

async function waitForRepositoryUrl(page: Page, databaseName: string) {
  const storageKey = `cad.documentRepository.automergeUrls.v1:${databaseName}`
  await expect.poll(
    () => page.evaluate(
      (key) => window.localStorage.getItem(key),
      storageKey,
    ),
    { timeout: 30_000 },
  ).toContain('doc_workspace')
}

async function revisionLabel(page: Page) {
  return page.evaluate(() => window.__cadaraDebug?.getState()?.revision ?? 'loading')
}
