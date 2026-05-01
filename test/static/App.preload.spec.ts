import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('test/static/App.preload.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
  const bootstrapSource = readFileSync(join(process.cwd(), 'src/bootstrap.tsx'), 'utf8')
  const runtimeSource = readFileSync(
    join(process.cwd(), 'src/infrastructure/occ/browser-kernel-runtime.ts'),
    'utf8',
  )

  assert(
    bootstrapSource.includes('startBrowserOccWarmup()'),
    'Browser bootstrap should start OCC eager warmup before React mount.',
  )
  assert(
    runtimeSource.includes('createOccPreloadController')
      && runtimeSource.includes('getBrowserOccKernelAdapter().preloadRuntime()'),
    'Bootstrap warmup should preload the shared browser OCC runtime owner.',
  )
  assert(
    appSource.includes('errorReporter.report') && /source:\s*['"]occ-preload['"]/.test(appSource),
    'OCC warmup failures should use the existing reported error path.',
  )
  assert(
    appSource.includes('OccWarmupErrorEffect') && !appSource.includes('OccPreloadEffect'),
    'App should observe bootstrap warmup failures without owning the startup trigger.',
  )
  assert(
    runtimeSource.includes('workerSnapshotClient: browserOccWorkerClient'),
    'Browser app snapshots and mutations should route through the shared worker-backed OCC client.',
  )
})
