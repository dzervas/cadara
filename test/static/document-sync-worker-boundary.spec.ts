import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('test/static/document-sync-worker-boundary.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const modelingServiceSource = readFileSync(join(process.cwd(), 'src/domain/modeling/modeling-service.ts'), 'utf8')
  const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
  const clientSource = readFileSync(join(process.cwd(), 'src/infrastructure/workers/document-sync-worker-client.ts'), 'utf8')
  const workerSource = readFileSync(join(process.cwd(), 'src/infrastructure/workers/document-sync.worker.ts'), 'utf8')

  assert(
    !modelingServiceSource.includes('normalizeCollaborativeAuthoredModelDocument'),
    'Modeling service should consume worker-normalized authored documents instead of importing main-thread collaborative normalization.',
  )
  assert(
    appSource.includes('createBrowserDocumentSyncWorkerClient({ search: window.location.search })'),
    'App should pass repository URL parameters to the browser document sync worker.',
  )
  assert(
    clientSource.includes("workerUrl.search = options.search ?? ''"),
    'Browser document sync worker client should forward search params through the worker URL.',
  )
  assert(
    workerSource.includes("workerSearchParams.get('cadLocalPeerSync') === '1'")
      && workerSource.includes("workerSearchParams.get('cadLocalPeerSyncChannel')")
      && workerSource.includes("workerSearchParams.get('cadRepositoryDbName')"),
    'Document sync worker should consume opt-in peer-sync and repository database URL parameters.',
  )
})
