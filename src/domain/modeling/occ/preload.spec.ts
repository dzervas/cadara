import { test } from 'bun:test'

import { createOccPreloadController } from '@/domain/modeling/occ/preload'

test('src/domain/modeling/occ/preload.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function testPreloadStartsOnceForRepeatedCalls() {
    let preloadCalls = 0
    const controller = createOccPreloadController({
      preload: async () => {
        preloadCalls += 1
      },
    })

    await Promise.all([controller.preload(), controller.preload(), controller.preload()])

    assert(preloadCalls === 1, 'OCC eager preload must not duplicate an in-flight runtime load.')
  }

  async function testPreloadRetriesAfterFailure() {
    let preloadCalls = 0
    const controller = createOccPreloadController({
      preload: async () => {
        preloadCalls += 1
        if (preloadCalls === 1) {
          throw new Error('preload failed')
        }
      },
    })

    let failed = false
    try {
      await controller.preload()
    } catch (error) {
      failed = error instanceof Error && error.message === 'preload failed'
    }

    await controller.preload()

    assert(failed, 'OCC preload failures must be surfaced to the caller.')
    assert(preloadCalls === 2, 'OCC preload must retry after a failed load.')
  }

  await testPreloadStartsOnceForRepeatedCalls()
  await testPreloadRetriesAfterFailure()
})
