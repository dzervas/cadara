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
  const browserClientSource = readFileSync(join(process.cwd(), 'src/infrastructure/workers/document-sync-worker-browser-client.ts'), 'utf8')
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
    !clientSource.includes("new URL('./document-sync.worker.ts', import.meta.url)"),
    'Document sync worker client should not hand a raw TypeScript asset URL to Worker construction.',
  )
  assert(
    browserClientSource.includes("import DocumentSyncWorkerModule from './document-sync.worker.ts?worker'")
      && browserClientSource.includes("kind: 'bootstrap'")
      && browserClientSource.includes("search: options.search ?? ''"),
    'Browser document sync worker client should bootstrap a Vite worker module with the current search params.',
  )
  assert(
    workerSource.includes("message.kind === 'bootstrap'")
      && workerSource.includes("const workerSearchParams = new URLSearchParams(search)")
      && workerSource.includes("workerSearchParams.get('cadLocalPeerSync') === '1'")
      && workerSource.includes("workerSearchParams.get('cadLocalPeerSyncChannel')")
      && workerSource.includes("workerSearchParams.get('cadRepositoryDbName')"),
    'Document sync worker should consume opt-in peer-sync and repository database bootstrap parameters.',
  )
})
