import { test } from 'bun:test'

test('src/app/cad-workbench-history-routing.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = await Bun.file(new URL('./cad-workbench.tsx', import.meta.url)).text()

  assert(
    !source.includes('modelingService.setFeatureCursor'),
    'Workbench document history UI should not call modelingService.setFeatureCursor directly.',
  )
  assert(
    source.includes("type: 'document.historyCursorRequested'"),
    'Workbench document history UI should dispatch editor cursor requests.',
  )
})
