import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createOccPreloadController } from '@/domain/modeling/occ/preload'

test('src/domain/modeling/occ/preload.spec.ts', async () => {  async function testPreloadStartsOnceForRepeatedCalls() {
    let preloadCalls = 0
    const controller = createOccPreloadController({
      preload: async () => {
        preloadCalls += 1
      },
    })

    await Promise.all([controller.preload(), controller.preload(), controller.preload()])

    expectTrue(preloadCalls === 1, 'OCC eager preload must not duplicate an in-flight runtime load.')
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

    expectTrue(failed, 'OCC preload failures must be surfaced to the caller.')
    expectTrue(preloadCalls === 2, 'OCC preload must retry after a failed load.')
  }

  await testPreloadStartsOnceForRepeatedCalls()
  await testPreloadRetriesAfterFailure()
})
