import { test } from 'bun:test'

import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from '@/contracts/modeling/authored-document'
import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import type {
  CreateFeatureRequest,
  CreateFeatureResponse,
  FeatureDefinition,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import type { GeometryAssetResolver } from '@/contracts/modeling/adapter'
import type { BodyId } from '@/contracts/shared/ids'
import { CONTRACT_VERSION, EXTRUDE_FEATURE_SCHEMA_VERSION, PLANE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import type { AppResultAsync } from '@/contracts/errors'
import { getDocumentHistoryCursorIndex } from '@/domain/modeling/document-history'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import { createModelingService, type ModelingService } from '@/domain/modeling/modeling-service'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'

test('src/domain/modeling/modeling-service-document-repository.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  type ExtrudeFeatureDefinition = Extract<FeatureDefinition, { kind: 'extrude' }>

  async function unwrapModelingResult<T>(result: AppResultAsync<T>): Promise<T> {
    const resolved = await result
    assert(resolved.isOk(), resolved.isErr() ? resolved.error.message : 'Modeling result should be ok.')
    return resolved.value
  }

  async function expectModelingError<T>(result: AppResultAsync<T>) {
    const resolved = await result
    assert(resolved.isErr(), 'Modeling result should be an error.')
    return resolved.error
  }

  async function waitFor(condition: () => boolean, message: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (condition()) {
        return
      }
      await Promise.resolve()
    }

    throw new Error(message)
  }

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

  function createInvalidOperationHistoryStore() {
    const historyStore = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        ...Array.from({ length: 17 }, (_, index) => ({
          kind: 'renameBody' as const,
          payload: {
            bodyId: 'body_part-1',
            bodyLabel: `Stale History Body ${index + 1}`,
          },
        })),
        {},
      ] as never,
    })
    const clear = historyStore.clear.bind(historyStore)
    let clearCount = 0

    historyStore.clear = () => {
      clearCount += 1
      clear()
    }

    return {
      historyStore,
      getClearCount: () => clearCount,
    }
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

    const rejected = await expectModelingError(service.createFeature({
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
    }))
    assert(rejected.code === 'modeling/diagnostic', 'Invalid feature creation should be rejected.')
    assert(documentRepository.savedDocuments.length === 0, 'Rejected mutations should not persist authored documents.')

    const accepted = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    }))
    assert(accepted.revisionState.kind === 'accepted', 'Accepted feature creation should commit.')
    assert(documentRepository.savedDocuments.length === 1, 'Accepted mutations should persist authored documents.')
    assert(
      documentRepository.savedDocuments[0]?.features.some((feature) => feature.featureId === accepted.featureId),
      'Persisted authored documents should include the accepted feature rebuild input.',
    )
  }

  async function testRepositoryCursorPersistenceExportsCompleteAuthoredState() {
    class AppliedOnlySnapshotAdapter extends MockKernelAdapter {
      override async getDocumentSnapshot(request: GetDocumentSnapshotRequest): Promise<GetDocumentSnapshotResponse> {
        const response = await super.getDocumentSnapshot(request)
        const snapshot = structuredClone(response.snapshot)
        const cursorIndex = getDocumentHistoryCursorIndex(snapshot.presentation.documentHistory, snapshot.document.cursor)
        const appliedHistory = snapshot.document.cursor.kind === 'empty'
          ? []
          : snapshot.presentation.documentHistory.slice(0, cursorIndex + 1)
        const appliedFeatureIds = new Set(
          appliedHistory.flatMap((item) => item.kind === 'feature' ? [item.featureId] : []),
        )
        const appliedSketchIds = new Set(
          appliedHistory.flatMap((item) => item.kind === 'sketch' ? [item.sketchId] : []),
        )

        snapshot.document.features = snapshot.document.features.filter((feature) => appliedFeatureIds.has(feature.featureId))
        snapshot.features = snapshot.document.features
        snapshot.document.sketches = snapshot.document.sketches.filter((sketch) => appliedSketchIds.has(sketch.sketchId))
        snapshot.sketches = snapshot.document.sketches
        snapshot.presentation.documentHistory = appliedHistory
        snapshot.documentHistory = appliedHistory

        return {
          ...response,
          snapshot,
        }
      }
    }

    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new AppliedOnlySnapshotAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const initial = await service.getCurrentDocumentSnapshot()
    const sourceSketch = initial.sketches[0]

    assert(sourceSketch, 'Seed sketch should exist for repository cursor persistence coverage.')
    const secondSketch = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: initial.revisionId,
      sketchId: 'sketch_after_tail',
      sketchLabel: 'Sketch After Tail',
      plane: sourceSketch.plane,
      planeTarget: sourceSketch.planeTarget,
      planeKey: sourceSketch.planeKey,
      solverCorrelation: {
        requestId: 'request_repository_cursor_sketch',
        projectionRequestId: 'request_repository_cursor_sketch:project',
        validationRequestId: 'request_repository_cursor_sketch:validate',
        solveRequestId: 'request_repository_cursor_sketch:solve',
        regionRequestId: 'request_repository_cursor_sketch:regions',
      },
      definition: {
        schemaVersion: SKETCH_SCHEMA_VERSION,
        referenceIds: [],
        references: [],
        pointIds: [],
        points: [],
        entityIds: [],
        entities: [],
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
      },
    }))
    assert(secondSketch.revisionState.kind === 'accepted', 'Second sketch commit should be accepted.')

    const rollback = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: secondSketch.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))
    assert(rollback.revisionState.kind === 'accepted', 'Cursor rollback should be accepted.')

    const persisted = documentRepository.savedDocuments.at(-1)
    assert(persisted, 'Accepted cursor rollback should persist an authored document.')
    assert(
      persisted.sketches.some((sketch) => sketch.sketchId === 'sketch_after_tail'),
      'Persisted authored document should include future sketches after the cursor.',
    )
    assert(
      persisted.features.some((feature) => feature.featureId === 'feature_fillet-1'),
      'Persisted authored document should include future features after the cursor.',
    )
    assert(
      persisted.featureOrder.join('>') === 'feature_extrude-1>feature_fillet-1',
      'Persisted authored document should keep the complete feature order.',
    )
    assert(
      persisted.historyOrder?.map((item) => item.kind === 'sketch' ? item.sketchId : item.featureId).join('>') ===
        'sketch_primary>feature_extrude-1>feature_fillet-1>sketch_after_tail',
      'Persisted authored document should keep the complete history order.',
    )
    assert(
      persisted.cursor.kind === 'feature' && persisted.cursor.featureId === 'feature_extrude-1',
      'Persisted authored document should keep the requested cursor.',
    )
  }

  async function testRepositoryCursorMovesBackAndForthWithoutRefreshConflict() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const rollback = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: snapshot.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))
    const forward = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: rollback.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_fillet-1' },
    }))
    const rollbackAgain = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: forward.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))

    assert(rollback.revisionState.kind === 'accepted', 'Repository-backed cursor rollback should be accepted.')
    assert(forward.revisionState.kind === 'accepted', 'Repository-backed cursor redo should be accepted without a refresh.')
    assert(rollbackAgain.revisionState.kind === 'accepted', 'Repository-backed repeated cursor rollback should be accepted without a refresh.')
    assert(documentRepository.savedDocuments.length === 3, 'Each accepted cursor move should persist the authored document.')
    assert(
      documentRepository.savedDocuments.at(-1)?.cursor.kind === 'feature'
        && documentRepository.savedDocuments.at(-1)?.cursor.featureId === 'feature_extrude-1',
      'The final persisted cursor should match the last requested rollback target.',
    )
  }

  async function testRepositoryCursorMovesUseRefreshedHeadsAcrossRollbackRedoLoop() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const initial = await service.getCurrentDocumentSnapshot()
    const rollback = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: initial.revisionId,
      baseRepositoryHeads: initial.provenance?.repositoryHeads,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))
    const afterRollback = await service.getCurrentDocumentSnapshot()
    const redo = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: afterRollback.revisionId,
      baseRepositoryHeads: afterRollback.provenance?.repositoryHeads,
      cursor: { kind: 'feature', featureId: 'feature_fillet-1' },
    }))
    const afterRedo = await service.getCurrentDocumentSnapshot()
    const rollbackAgain = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: afterRedo.revisionId,
      baseRepositoryHeads: afterRedo.provenance?.repositoryHeads,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))

    assert(rollback.revisionState.kind === 'accepted', 'First rollback should be accepted against the loaded heads.')
    assert(redo.revisionState.kind === 'accepted', 'Redo should be accepted against refreshed heads.')
    assert(rollbackAgain.revisionState.kind === 'accepted', 'Second rollback should be accepted against refreshed heads.')
    assert(
      [...rollback.diagnostics, ...redo.diagnostics, ...rollbackAgain.diagnostics]
        .every((diagnostic) => diagnostic.code !== 'repository-head-conflict'),
      'Refreshed repository heads should avoid repeated authored-document conflict diagnostics.',
    )
    assert(
      documentRepository.savedDocuments.at(-1)?.features.some((feature) => feature.featureId === 'feature_fillet-1'),
      'Cursor rollback persistence should preserve future authored history for redo.',
    )
  }

  async function testRepositoryRestoreHydratesFreshModelingService() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const renamed = await unwrapModelingResult(service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Repository Restored Body',
    }))
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

  async function testRepositoryRestorePreservesRepairableBrokenAuthoredDocument() {
    const repositoryDocument = await createSeedAuthoredDocument()
    const brokenExtrude = repositoryDocument.features.find((feature) => feature.definition.kind === 'extrude')
    assert(brokenExtrude?.definition.kind === 'extrude', 'Repository restore fixture should include an extrude feature.')
    repositoryDocument.features = repositoryDocument.features.map((feature) =>
      feature.featureId === brokenExtrude.featureId && feature.definition.kind === 'extrude'
        ? {
            ...feature,
            definition: {
              ...feature.definition,
              parameters: {
                ...feature.definition.parameters,
                operation: 'join',
                booleanScope: { kind: 'targetBody', bodyId: 'body_missing_for_repair' as BodyId },
              },
            },
          }
        : feature,
    )

    const documentRepository = createMemoryDocumentRepository([repositoryDocument])
    const reset = documentRepository.reset.bind(documentRepository)
    let resetCount = 0
    documentRepository.reset = async (documentId) => {
      resetCount += 1
      return reset(documentId)
    }

    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const restoreState = await service.getHistoryRestoreState()
    const restoredSnapshot = await service.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Repairable broken authored documents should restore as authored state.')
    assert(resetCount === 0, 'Repairable broken authored documents should not trigger repository reset.')
    assert(documentRepository.savedDocuments.length === 0, 'Repairable broken restore should not seed an empty replacement document.')
    assert(
      restoredSnapshot.features.some((feature) => feature.featureId === brokenExtrude.featureId),
      'Repairable broken features should remain available in restored authored history.',
    )
  }

  async function testRepositoryRestoreIgnoresStaleOperationHistory() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const historySnapshot = await historyService.getCurrentDocumentSnapshot()
    const historyRename = await unwrapModelingResult(historyService.renameBody({
      baseRevisionId: historySnapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Stale History Body',
    }))
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

  async function testSeededRepositoryClearsInvalidOperationHistory() {
    const { historyStore, getClearCount } = createInvalidOperationHistoryStore()
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })

    const restoreState = await service.getHistoryRestoreState()
    assert(restoreState.kind === 'empty', 'Invalid stale operation history should not fail a freshly seeded repository.')
    assert(restoreState.entriesReplayed === 0, 'Recovered stale history should not replay entries.')
    assert(getClearCount() === 1, 'Recovery should clear only the stale operation history store.')
    assert(documentRepository.savedDocuments.length === 0, 'Recovery should keep the seeded repository document without migration writes.')

    const snapshot = await service.getCurrentDocumentSnapshot()
    const renamed = await unwrapModelingResult(service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Recovered Body',
    }))

    assert(renamed.revisionState.kind === 'accepted', 'Recovered services should continue accepting mutations.')
    assert(documentRepository.savedDocuments.length === 1, 'Recovered services should continue persisting authored documents.')
    assert(historyStore.savedPayloads.length === 1, 'Recovered services should append fresh operation history after clearing stale data.')
    assert(historyStore.savedPayloads[0]?.entries[0]?.kind === 'renameBody', 'Fresh operation history should start from the next accepted mutation.')
  }

  async function testRestoredRepositoryLeavesInvalidOperationHistoryAlone() {
    const { historyStore, getClearCount } = createInvalidOperationHistoryStore()
    const repositoryDocument = await createSeedAuthoredDocument()
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map((label) =>
      label.bodyId === 'body_part-1'
        ? { ...label, label: 'Repository Existing Body' }
        : label,
    )
    const documentRepository = createMemoryDocumentRepository([repositoryDocument])
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })

    const restoreState = await service.getHistoryRestoreState()
    const restoredSnapshot = await service.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Existing authored repository documents should still ignore invalid stale history.')
    assert(getClearCount() === 0, 'Existing authored repository restore should not clear ignored operation history.')
    assert(documentRepository.savedDocuments.length === 0, 'Existing authored repository restore should not rewrite the restored document.')
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Repository Existing Body',
      'Existing authored repository data should remain authoritative over invalid stale history.',
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
    const renamed = await unwrapModelingResult(firstService.renameBody({
      baseRevisionId: firstSnapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Migrated Body',
    }))
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

  async function testSeedRepositoryRestoreReplaysOperationHistoryFallback() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const historySnapshot = await historyService.getCurrentDocumentSnapshot()
    const historyRename = await unwrapModelingResult(historyService.renameBody({
      baseRevisionId: historySnapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Recovered History Body',
    }))
    assert(historyRename.revisionState.kind === 'accepted', 'History mutation should prepare a browser fallback payload.')

    const seedDocument = await createSeedAuthoredDocument()
    const documentRepository = createMemoryDocumentRepository([seedDocument])
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Seed repository restores should replay valid operation-history fallback entries.')
    assert(restoreState.entriesReplayed === 1, 'Seed repository restore should replay the browser fallback operation.')
    assert(documentRepository.savedDocuments.length === 1, 'Recovered browser fallback history should migrate into the repository.')
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Recovered History Body',
      'Restored seed repositories should recover the document from operation history before exposing snapshots.',
    )
  }

  async function testRestoredRepositoryRestoreReplaysRepositoryBasedOperationHistoryFallback() {
    const repositoryDocument = await createSeedAuthoredDocument()
    repositoryDocument.bodyLabels = repositoryDocument.bodyLabels.map((label) =>
      label.bodyId === 'body_part-1'
        ? { ...label, label: 'Repository Basis Body' }
        : label,
    )
    const documentRepository = createMemoryDocumentRepository([repositoryDocument])
    const historyStore = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory('doc_workspace', documentRepository.getMetadata('doc_workspace').heads),
      entries: [{
        kind: 'renameBody',
        payload: {
          bodyId: 'body_part-1',
          bodyLabel: 'Recovered Repository Tail Body',
        },
      }],
    })
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Repository-based operation-history fallback should restore successfully.')
    assert(restoreState.entriesReplayed === 1, 'Repository-based operation-history fallback should replay its pending entry.')
    assert(documentRepository.savedDocuments.length === 1, 'Recovered repository fallback history should migrate into the repository.')
    assert(
      restoredSnapshot.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Recovered Repository Tail Body',
      'Restored repository documents should replay operation-history entries saved against the same repository heads.',
    )
  }

  async function testBackgroundRepositoryPersistenceDoesNotBlockAcceptedMutation() {
    const documentRepository = createMemoryDocumentRepository()
    const mutate = documentRepository.mutate.bind(documentRepository)
    let releaseMutate: (() => void) | null = null
    let resolveMutateComplete: (() => void) | null = null
    const mutateComplete = new Promise<void>((resolve) => {
      resolveMutateComplete = resolve
    })
    let mutateStarted = false
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    documentRepository.mutate = async (input) => {
      mutateStarted = true
      await new Promise<void>((resolve) => {
        releaseMutate = resolve
      })
      const result = await mutate(input)
      resolveMutateComplete?.()
      return result
    }
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)

    const accepted = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    }))

    assert(accepted.revisionState.kind === 'accepted', 'Background repository persistence should still accept the mutation.')
    assert(documentRepository.savedDocuments.length === 0, 'Accepted mutation should return before the repository write finishes.')
    const pendingHistory = historyStore.load()
    assert(pendingHistory.ok && pendingHistory.payload, 'Background persistence should keep a browser fallback until the repository write finishes.')
    assert(
      pendingHistory.payload.baseRepositoryHeads?.join('|') === snapshot.provenance?.repositoryHeads.join('|'),
      'Background persistence fallback should record the repository heads it extends.',
    )

    await Promise.resolve()
    assert(mutateStarted, 'Background persistence should enqueue the repository write after accepting the mutation.')
    releaseMutate?.()
    await mutateComplete
    await Promise.resolve()
    assert(documentRepository.savedDocuments.length === 1, 'Background repository persistence should still write the authored document.')
    const clearedHistory = historyStore.load()
    assert(clearedHistory.ok && clearedHistory.payload === null, 'Completed background repository persistence should clear the browser fallback log.')
  }

  async function testBackgroundSketchCommitCompactsFallbackAuthoringOperations() {
    const documentRepository = createMemoryDocumentRepository()
    const mutate = documentRepository.mutate.bind(documentRepository)
    let releaseMutate: (() => void) | null = null
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    documentRepository.mutate = async (input) => {
      await new Promise<void>((resolve) => {
        releaseMutate = resolve
      })
      return mutate(input)
    }
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const sourceSketch = snapshot.sketches[0]
    assert(sourceSketch, 'Seed sketch should exist for compact background sketch fallback coverage.')
    const firstPointId = sourceSketch.sketch.definition.pointIds[0]
    const firstEntityId = sourceSketch.sketch.definition.entityIds[0]
    assert(firstPointId && firstEntityId, 'Seed sketch should expose graph members for compact fallback coverage.')

    const committed = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: snapshot.revisionId,
      sketchId: sourceSketch.sketchId,
      sketchLabel: 'Compacted Background Sketch',
      plane: sourceSketch.plane,
      planeTarget: sourceSketch.planeTarget,
      planeKey: sourceSketch.planeKey,
      solverCorrelation: {
        requestId: 'request_compact_background_sketch',
        projectionRequestId: 'request_compact_background_sketch:project',
        validationRequestId: 'request_compact_background_sketch:validate',
        solveRequestId: 'request_compact_background_sketch:solve',
        regionRequestId: 'request_compact_background_sketch:regions',
      },
      definition: {
        ...sourceSketch.sketch.definition,
        authoringOperations: [{
          operationId: 'sketch_operation_compact_background',
          label: 'Compacted metadata',
          kind: 'operation',
          targets: {
            created: [
              { kind: 'point', pointId: firstPointId },
              { kind: 'entity', entityId: firstEntityId },
            ],
          },
          createdGraph: {
            points: sourceSketch.sketch.definition.points.slice(0, 1),
            entities: sourceSketch.sketch.definition.entities.slice(0, 1),
          },
        }],
      },
    }))

    assert(committed.revisionState.kind === 'accepted', 'Background sketch commit should still accept compact fallback payloads.')
    const pendingHistory = historyStore.load()
    assert(pendingHistory.ok && pendingHistory.payload?.entries[0]?.kind === 'commitSketch', 'Background sketch commits should persist a fallback entry.')
    assert(
      pendingHistory.payload.entries[0].payload.definition.authoringOperations?.length === 0,
      'Background sketch commit fallback should omit bulky sketch-local authoring operations.',
    )
    releaseMutate?.()
  }

  async function testBackgroundRepositoryPersistenceAdvancesFallbackTail() {
    const documentRepository = createMemoryDocumentRepository()
    const mutate = documentRepository.mutate.bind(documentRepository)
    const mutateCalls: Array<{
      release: () => void
      complete: Promise<void>
      resolveComplete: () => void
    }> = []
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    documentRepository.mutate = async (input) => {
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let resolveComplete = () => {}
      const complete = new Promise<void>((resolve) => {
        resolveComplete = resolve
      })
      mutateCalls.push({ release, complete, resolveComplete })
      await gate
      const result = await mutate(input)
      resolveComplete()
      return result
    }
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const first = await unwrapModelingResult(service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'First Background Body',
    }))
    assert(first.revisionState.kind === 'accepted', 'First background mutation should be accepted.')
    await waitFor(() => mutateCalls.length === 1, 'First background repository write should start.')

    const second = await unwrapModelingResult(service.renameBody({
      baseRevisionId: first.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Second Background Body',
    }))
    assert(second.revisionState.kind === 'accepted', 'Second background mutation should be accepted while the first write is pending.')

    mutateCalls[0]?.release()
    await mutateCalls[0]?.complete
    await waitFor(() => mutateCalls.length === 2, 'Second background repository write should start after the first completes.')

    const pendingHistory = historyStore.load()
    assert(pendingHistory.ok && pendingHistory.payload, 'Partial background writes should keep the unpersisted fallback tail.')
    assert(pendingHistory.payload.entries.length === 1, 'Partial background writes should trim only the persisted prefix.')
    assert(
      pendingHistory.payload.entries[0]?.kind === 'renameBody'
        && pendingHistory.payload.entries[0].payload.bodyLabel === 'Second Background Body',
      'Partial background writes should keep the newer pending operation.',
    )
    assert(
      pendingHistory.payload.baseRepositoryHeads?.join('|') === documentRepository.getMetadata('doc_workspace').heads.join('|'),
      'Partial background writes should advance the fallback basis to the repository heads that were written.',
    )

    mutateCalls[1]?.release()
    await mutateCalls[1]?.complete
    await Promise.resolve()
    const clearedHistory = historyStore.load()
    assert(clearedHistory.ok && clearedHistory.payload === null, 'Final background write should clear the fallback tail.')
  }

  async function testLocalRepositoryHeadAdvancesDoNotConflictWithCurrentRevisionMutation() {
    const documentRepository = createMemoryDocumentRepository()
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const initial = await service.getCurrentDocumentSnapshot()

    const renamed = await unwrapModelingResult(service.renameBody({
      baseRevisionId: initial.revisionId,
      baseRepositoryHeads: initial.provenance?.repositoryHeads,
      bodyId: 'body_part-1',
      bodyLabel: 'Local Background Body',
    }))
    assert(renamed.revisionState.kind === 'accepted', 'Local setup mutation should be accepted.')
    await waitFor(() => documentRepository.savedDocuments.length === 1, 'Local background repository write should complete.')

    const current = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)
    const committed = await unwrapModelingResult(service.createFeature({
      baseRevisionId: current.revisionId,
      baseRepositoryHeads: initial.provenance?.repositoryHeads,
      definition,
    }))

    assert(committed.revisionState.kind === 'accepted', 'Mutations should not conflict with local background repository head advances.')
    assert(
      committed.diagnostics.every((diagnostic) => diagnostic.code !== 'repository-head-conflict'),
      'Mutations after local background writes should not report repository head conflicts.',
    )
  }

  async function testMigrationWriteFailureResetsSeededRepositoryForRetry() {
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const historyService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: historyStore,
    })
    const snapshot = await historyService.getCurrentDocumentSnapshot()
    const renamed = await unwrapModelingResult(historyService.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Retry Migrated Body',
    }))
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
    const renamed = await unwrapModelingResult(service.renameBody({
      baseRevisionId: snapshot.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Must Not Overwrite Unsupported Document',
    }))
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
    const peerResult = await documentRepository.receivePeerDocument(peerDocument)
    assert(peerResult.ok, 'Test peer document should be accepted by the repository.')

    const staleMutation = await expectModelingError(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      baseRepositoryHeads: snapshot.provenance?.repositoryHeads,
      definition,
    }))
    assert(staleMutation.code === 'modeling/diagnostic', 'Mutations against a peer-superseded snapshot should conflict.')
    assert(
      staleMutation.context.some((entry) =>
        entry.key === 'diagnosticCodes'
        && typeof entry.value === 'string'
        && entry.value.includes('repository-head-conflict'),
      ),
      'Stale repository heads should be reported with a stable diagnostic code.',
    )

    const refreshed = await service.getCurrentDocumentSnapshot()
    assert(peerEventCount === 1, 'Modeling service subscribers should receive peer repository events.')
    assert(refreshed.provenance?.repositorySource === 'peer', 'Peer-refreshed snapshots should carry peer provenance.')
    assert(
      refreshed.bodies.find((body) => body.bodyId === 'body_part-1')?.label === 'Peer Synced Body',
      'Peer repository changes should hydrate the modeling snapshot through the service.',
    )
    const accepted = await unwrapModelingResult(service.createFeature({
      baseRevisionId: refreshed.revisionId,
      baseRepositoryHeads: refreshed.provenance?.repositoryHeads,
      definition,
    }))
    assert(accepted.revisionState.kind === 'accepted', 'Fresh repository heads should allow the mutation.')
    unsubscribe()
  }

  async function testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory() {
    const documentRepository = createMemoryDocumentRepository()
    const historyStore = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    let publishPeerDocument = async () => {}
    class PeerDuringAcceptedMutationAdapter extends MockKernelAdapter {
      override async createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse> {
        const response = await super.createFeature(request)
        await publishPeerDocument()
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
    publishPeerDocument = async () => {
      publishPeerDocument = async () => {}
      const peerResult = await documentRepository.receivePeerDocument(peerDocument)
      assert(peerResult.ok, 'In-flight peer document should be accepted by the repository.')
    }

    const result = await expectModelingError(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      baseRepositoryHeads: snapshot.provenance?.repositoryHeads,
      definition,
    }))
    assert(result.code === 'modeling/diagnostic', 'In-flight repository head changes should convert accepted mutations to conflicts.')
    assert(
      result.context.some((entry) =>
        entry.key === 'diagnosticCodes'
        && typeof entry.value === 'string'
        && entry.value.includes('repository-head-conflict'),
      ),
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

  async function testPackagedAssetImportStoresAssetsBeforeRestore() {
    const documentRepository = createMemoryDocumentRepository()
    class AssetResolvingRestoreAdapter extends MockKernelAdapter {
      sawAssetBytes = false

      override async restoreAuthoredModelDocument(
        document: AuthoredModelDocument,
        diagnostics: readonly ModelingDiagnostic[] = [],
        assetResolver?: GeometryAssetResolver,
      ) {
        const asset = document.assets.records[0]
        if (asset) {
          const bytes = await assetResolver?.getGeometryAssetBytes(asset.hash)
          this.sawAssetBytes = bytes?.byteLength === asset.byteLength
        }

        await super.restoreAuthoredModelDocument(document, diagnostics)
      }
    }
    const adapter = new AssetResolvingRestoreAdapter()
    const service = createModelingService(adapter, {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const snapshot = await service.getCurrentDocumentSnapshot()
    const document = createAuthoredModelDocumentFromSnapshot(snapshot)
    const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [document.features[0]!.featureId] })
    document.assets = {
      schemaVersion: 'geometry-asset-manifest/v1alpha1',
      records: [asset.asset],
    }

    const result = await service.importDocument({ document })

    assert(result.ok, 'JSON import should accept authored documents with embedded geometry data.')
    assert(adapter.sawAssetBytes, 'Imported asset bytes should be stored before adapter restore resolves assets.')
    assert(
      await documentRepository.getGeometryAssetRecord(asset.asset) !== null,
      'Imported asset bytes should remain available from the repository after restore.',
    )
    assert(
      (await adapter.exportAuthoredModelDocument(document.documentId)).assets.records[0]?.hash === asset.asset.hash,
      'Adapter authored exports should preserve restored geometry asset manifests.',
    )
    const exportResult = await service.exportCurrentDocument()
    assert(typeof exportResult.payload === 'string', 'Current document export should serialize documents with geometry assets as JSON.')
    assert(
	      (JSON.parse(exportResult.payload) as AuthoredModelDocument).assets.records[0]?.data?.kind === 'cadaraBrep',
	      'Current document export should include translated Cadara B-rep geometry inside the cadara JSON.',
    )

    const snapshotAfterImport = await service.getCurrentDocumentSnapshot()
    const rename = await unwrapModelingResult(service.renameBody({
      baseRevisionId: snapshotAfterImport.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Asset Body',
    }))
    assert(rename.revisionState.kind === 'accepted', 'Post-import authored mutations should still be accepted.')
    assert(
      documentRepository.savedDocuments.at(-1)?.assets.records[0]?.hash === asset.asset.hash,
      'Post-import repository mutations should not drop restored geometry asset manifests.',
    )
  }

  await testAcceptedMutationsPersistButPreviewAndRejectedMutationsDoNot()
  await testRepositoryCursorPersistenceExportsCompleteAuthoredState()
  await testRepositoryCursorMovesBackAndForthWithoutRefreshConflict()
  await testRepositoryCursorMovesUseRefreshedHeadsAcrossRollbackRedoLoop()
  await testRepositoryRestoreHydratesFreshModelingService()
  await testRepositoryRestorePreservesRepairableBrokenAuthoredDocument()
  await testRepositoryRestoreIgnoresStaleOperationHistory()
  await testSeededRepositoryClearsInvalidOperationHistory()
  await testRestoredRepositoryLeavesInvalidOperationHistoryAlone()
  await testOperationHistoryMigratesOnlyWhenRepositoryIsMissing()
  await testSeedRepositoryRestoreReplaysOperationHistoryFallback()
  await testRestoredRepositoryRestoreReplaysRepositoryBasedOperationHistoryFallback()
  await testBackgroundRepositoryPersistenceDoesNotBlockAcceptedMutation()
  await testBackgroundSketchCommitCompactsFallbackAuthoringOperations()
  await testBackgroundRepositoryPersistenceAdvancesFallbackTail()
  await testLocalRepositoryHeadAdvancesDoNotConflictWithCurrentRevisionMutation()
  await testMigrationWriteFailureResetsSeededRepositoryForRetry()
  await testInvalidRepositoryDocumentBlocksFutureWrites()
  await testPeerRepositoryChangesRefreshSnapshotsAndStaleMutationsConflict()
  await testInFlightRepositoryHeadConflictSkipsPersistenceAndHistory()
  await testPackagedAssetImportStoresAssetsBeforeRestore()
})
