import { test } from 'bun:test'

import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import type { CreateFeatureRequest, CreateFeatureResponse, FeatureDefinition } from '@/contracts/modeling/schema'
import { CONTRACT_VERSION, EXTRUDE_FEATURE_SCHEMA_VERSION, PLANE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import { createModelingService, type ModelingService } from '@/domain/modeling/modeling-service'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/modeling/modeling-service-document-repository.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  type ExtrudeFeatureDefinition = Extract<FeatureDefinition, { kind: 'extrude' }>

  async function getSeedExtrudeDefinition(service: ModelingService): Promise<ExtrudeFeatureDefinition> {
    const snapshot = await service.getCurrentDocumentSnapshot()
    const seedExtrude = snapshot.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!seedExtrude || seedExtrude.definition.kind !== 'extrude') {
      throw new Error('Seed extrude feature must exist.')
    }

    return {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        ...seedExtrude.definition.parameters,
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 7 },
      },
    }
  }

  async function createSeedAuthoredDocument() {
    const snapshot = (await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: 'doc_workspace',
    })).snapshot

    return createAuthoredModelDocumentFromSnapshot(snapshot)
  }

  async function testAcceptedMutationsPersistButPreviewAndRejectedMutationsDoNot() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)

    await service.evaluatePreview({
      baseRevisionId: snapshot.revisionId,
      previewId: 'preview_repository',
      definition,
    })
    assert(documentRepository.savedDocuments.length === 0, 'Preview evaluations should not persist authored documents.')

    const rejected = await service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition: {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: {
            target: { kind: 'construction', constructionId: 'construction_plane-xy' },
          },
        },
      },
    })
    assert(rejected.revisionState.kind === 'rejected', 'Invalid feature creation should be rejected.')
    assert(documentRepository.savedDocuments.length === 0, 'Rejected mutations should not persist authored documents.')

    const accepted = await service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    })
    assert(accepted.revisionState.kind === 'accepted', 'Accepted feature creation should commit.')
    assert(documentRepository.savedDocuments.length === 1, 'Accepted mutations should persist authored documents.')
    assert(
      documentRepository.savedDocuments[0]?.features.some((feature) => feature.featureId === accepted.featureId),
      'Persisted authored documents should include the accepted feature rebuild input.',
    )
  }

  async function testRepositoryRestoreHydratesFreshModelingService() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const renamed = await service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Repository Restored Body',
    })
    assert(renamed.revisionState.kind === 'accepted', 'Body rename should be accepted.')

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const restoredState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()
    assert(restoredState.kind === 'restored', 'Existing authored repository documents should restore on startup.')
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Repository Restored Body',
      'Repository-authored state should hydrate the kernel snapshot before exposure.',
    )
  }

  async function testRepositoryRestoreIgnoresStaleOperationHistory() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const historySnapshot = await historyService.getCurrentDocumentSnapshot()
    const historyRename = await historyService.renameBody({
      baseRevisionId: historySnapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Stale History Body',
    })
    assert(historyRename.revisionState.kind === 'accepted', 'History setup mutation should be accepted.')

    const repositoryDocument = await createSeedAuthoredDocument()
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map((label) =>
      label.bodyId === 'body_part-1'
        ? { ...label, label: 'Repository Wins Body' }
        : label,
    )
    const documentRepository = createMemoryDocumentRepository([repositoryDocument])

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()
    assert(restoreState.kind === 'restored', 'Existing authored repository documents should restore on startup.')
    assert(restoreState.entriesReplayed === 0, 'Repository restore should not replay stale operation history.')
    assert(documentRepository.savedDocuments.length === 0, 'Repository restore should not rewrite the restored document.')
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Repository Wins Body',
      'Repository restore should hydrate the authored document instead of replaying stale operation history.',
    )
  }

  async function testOperationHistoryMigratesOnlyWhenRepositoryIsMissing() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const documentRepository = createMemoryDocumentRepository()
    const firstService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const firstSnapshot = await firstService.getCurrentDocumentSnapshot()
    const renamed = await firstService.renameBody({
      baseRevisionId: firstSnapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Migrated Body',
    })
    assert(renamed.revisionState.kind === 'accepted', 'History seed mutation should be accepted.')

    const migratingService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const restoreState = await migratingService.getHistoryRestoreState()
    assert(restoreState.kind === 'restored', 'Valid operation history should migrate into a missing repository document.')
    assert(documentRepository.savedDocuments.length === 1, 'Migration should write one authored repository document.')

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Migrated Body',
      'Existing authored documents should be preferred over operation history after migration.',
    )
  }

  async function testMigrationWriteFailureResetsSeededRepositoryForRetry() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const snapshot = await historyService.getCurrentDocumentSnapshot()
    const renamed = await historyService.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Retry Migrated Body',
    })
    assert(renamed.revisionState.kind === 'accepted', 'History mutation should prepare a migration payload.')

    const documentRepository = createMemoryDocumentRepository()
    const mutate = documentRepository.mutate.bind(documentRepository)
    const reset = documentRepository.reset.bind(documentRepository)
    let failNextMutate = true
    let resetCount = 0

    documentRepository.mutate = async (input) => {
      if (!failNextMutate) {
        return mutate(input)
      }

      failNextMutate = false
      return {
        ok: false,
        status: {
          kind: 'failed',
          documentId: input.documentId,
          diagnostic: {
            reasonCode: 'automerge-write-failed',
            message: 'Migration write failed.',
          },
        },
      }
    }
    documentRepository.reset = async (documentId) => {
      resetCount += 1
      return reset(documentId)
    }

    const failedMigrationService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const failedRestore = await failedMigrationService.getHistoryRestoreState()
    assert(failedRestore.kind === 'failed', 'Migration write failures should surface as restore failures.')
    assert(resetCount === 1, 'Migration write failures should reset the seeded repository document.')

    const retriedMigrationService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const retriedRestore = await retriedMigrationService.getHistoryRestoreState()
    assert(retriedRestore.kind === 'restored', 'Resetting the seed should let the next startup retry migration.')
    assert(documentRepository.savedDocuments.length === 1, 'Retried migration should write the authored repository document.')
  }

  async function testInvalidRepositoryDocumentBlocksFutureWrites() {
    const seedDocument = await createSeedAuthoredDocument()
    const invalidDocument: AuthoredModelDocument = {
      ...seedDocument,
      schemaVersion: 'authored-model-document/v9' as AuthoredModelDocument['schemaVersion'],
    }
    const documentRepository = createMemoryDocumentRepository([invalidDocument])
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })

    const restoreState = await service.getHistoryRestoreState()
    assert(restoreState.kind === 'failed', 'Unsupported repository documents should surface restore failure.')
    assert(
      restoreState.diagnostics[0]?.reasonCode === 'unsupported-schema-version',
      'Unsupported repository documents should preserve the schema diagnostic.',
    )

    const snapshot = await service.getCurrentDocumentSnapshot()
    const renamed = await service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Must Not Overwrite Unsupported Document',
    })
    assert(renamed.revisionState.kind === 'accepted', 'The active seed adapter may still accept local mutations.')
    assert(documentRepository.savedDocuments.length === 0, 'Restore failures should block later repository writes from the seed adapter.')
    assert(
      renamed.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-schema-version'),
      'Blocked repository writes should keep surfacing the restore diagnostic.',
    )
  }

  async function testPeerRepositoryChangesRefreshSnapshotsAndStaleMutationsConflict() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)
    const peerDocument = createAuthoredModelDocumentFromSnapshot(snapshot)
    peerDocument.revisionId = 'rev_9999'
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === 'body_part-1'
        ? { ...label, label: 'Peer Synced Body' }
        : label,
    )

    let peerEventCount = 0
    const unsubscribe = service.subscribeToDocumentChanges((event) => {
      if (event.metadata.source === 'peer') {
        peerEventCount += 1
      }
    })
    const peerResult = documentRepository.receivePeerDocument(peerDocument)
    assert(peerResult.ok, 'Test peer document should be accepted by the repository.')

    const staleMutation = await service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    })
    assert(staleMutation.revisionState.kind === 'conflict', 'Mutations against a peer-superseded snapshot should conflict.')
    assert(
      staleMutation.diagnostics.some((diagnostic) => diagnostic.code === 'repository-head-conflict'),
      'Stale repository heads should be reported with a stable diagnostic code.',
    )

    const refreshed = await service.getCurrentDocumentSnapshot()
    assert(peerEventCount === 1, 'Modeling service subscribers should receive peer repository events.')
    assert(refreshed.provenance?.repositorySource === 'peer', 'Peer-refreshed snapshots should carry peer provenance.')
    assert(
      refreshed.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Peer Synced Body',
      'Peer repository changes should hydrate the modeling snapshot through the service.',
    )
    unsubscribe()
  }

  async function testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory() {
    const documentRepository = createMemoryDocumentRepository()
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    let publishPeerDocument = () => {}
    class PeerDuringAcceptedMutationAdapter extends MockKernelAdapter {
      override async createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse> {
        const response = await super.createFeature(request)
        publishPeerDocument()
        return response
      }
    }
    const service = createModelingService(new PeerDuringAcceptedMutationAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)
    const peerDocument = createAuthoredModelDocumentFromSnapshot(snapshot)
    peerDocument.revisionId = 'rev_9999'
    peerDocument.bodyLabels = peerDocument.bodyLabels.map((label) =>
      label.bodyId === 'body_part-1'
        ? { ...label, label: 'In-flight Peer Body' }
        : label,
    )
    publishPeerDocument = () => {
      publishPeerDocument = () => {}
      const peerResult = documentRepository.receivePeerDocument(peerDocument)
      assert(peerResult.ok, 'In-flight peer document should be accepted by the repository.')
    }

    const result = await service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    })
    assert(result.revisionState.kind === 'conflict', 'In-flight repository head changes should convert accepted mutations to conflicts.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'repository-head-conflict'),
      'In-flight repository head conflicts should retain a stable diagnostic.',
    )
    assert(documentRepository.savedDocuments.length === 0, 'Repository head conflicts should not persist stale authored documents.')
    assert(historyStore.savedPayloads.length === 0, 'Repository head conflicts should not append operation history.')

    const refreshed = await service.getCurrentDocumentSnapshot()
    assert(
      refreshed.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'In-flight Peer Body',
      'Repository head conflict handling should leave the service on the peer-authored snapshot.',
    )
  }

  await testAcceptedMutationsPersistButPreviewAndRejectedMutationsDoNot()
  await testRepositoryRestoreHydratesFreshModelingService()
  await testRepositoryRestoreIgnoresStaleOperationHistory()
  await testOperationHistoryMigratesOnlyWhenRepositoryIsMissing()
  await testMigrationWriteFailureResetsSeededRepositoryForRetry()
  await testInvalidRepositoryDocumentBlocksFutureWrites()
  await testPeerRepositoryChangesRefreshSnapshotsAndStaleMutationsConflict()
  await testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory()
})
