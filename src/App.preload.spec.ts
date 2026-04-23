import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/App.preload.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')

  assert(
    source.includes('createOccPreloadController') && source.includes('kernelAdapter.preloadRuntime()'),
    'App mount should start OCC eager preload through the current runtime owner.',
  )
  assert(
    source.includes('errorReporter.report') && /source:\s*['"]occ-preload['"]/.test(source),
    'OCC preload failures should use the existing reported error path.',
  )
  assert(
    source.includes('initialSnapshotRequiresRuntime: typeof window') && source.includes('<OccPreloadEffect'),
    'Browser app snapshots should wait for the first OCC-backed render while the preload effect is mounted.',
  )
  assert(
    source.includes('createBrowserOccWorkerClient') && source.includes('workerSnapshotClient: occWorkerClient'),
    'Browser app snapshots should route OCC initialization and snapshot builds through the worker client.',
  )
  assert(
    source.includes('occWorkerDisposeTimerRef') && source.includes('setTimeout') && source.includes('clearTimeout'),
    'OCC worker disposal should be deferred so React StrictMode cleanup does not dispose the active worker client.',
  )
})
