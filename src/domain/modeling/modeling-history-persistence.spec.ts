import { test } from 'bun:test'
import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import type { FeatureDefinition } from '@/contracts/modeling/schema'
import { EXTRUDE_FEATURE_SCHEMA_VERSION, PLANE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import type { AppResultAsync } from '@/contracts/errors'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import {
  createModelingService,
  type ModelingService,
} from '@/domain/modeling/modeling-service'
import { evaluateDocumentVariableExpressions } from '@/domain/modeling/document-variable-expressions'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'

test('src/domain/modeling/modeling-history-persistence.spec.ts', async () => {
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
        endExtent: { kind: 'blind', direction: 'positive', distance: 9 },
      },
    }
  }

  async function createServiceWithStore(
    initialHistory = createEmptyOperationHistory('doc_workspace'),
  ) {
    const store = createMemoryOperationHistoryStore(initialHistory)
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })

    return { service, store }
  }

  async function testOnlyCommittedMutationsAreStored() {
    const { service, store } = await createServiceWithStore()
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)

    await service.evaluatePreview({
      baseRevisionId: snapshot.revisionId,
      previewId: 'preview_history',
      definition,
    })

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
    assert(rejected.code === 'modeling/diagnostic', 'Unsupported mock plane create should be rejected.')

    const accepted = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    }))

    assert(accepted.revisionState.kind === 'accepted', 'Valid feature create should commit.')
    assert(store.savedPayloads.length === 1, 'Only accepted mutations should write operation history.')
    assert(store.savedPayloads[0]?.entries.length === 1, 'Exactly one operation should be stored.')
    assert(store.savedPayloads[0]?.entries[0]?.kind === 'createFeature', 'Stored operation kind should match the committed mutation.')
  }

  async function testPersistedHistoryReplaysSketchAndFeatureMutations() {
    const { service, store } = await createServiceWithStore()
    const before = await service.getCurrentDocumentSnapshot()
    const seedSketch = before.sketches[0]
    assert(seedSketch, 'Seed sketch must exist.')

    const sketch = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: before.revisionId,
      solverCorrelation: {
        requestId: 'request_history_commit',
        projectionRequestId: 'request_history_commit:project',
        validationRequestId: 'request_history_commit:validate',
        solveRequestId: 'request_history_commit:solve',
        regionRequestId: 'request_history_commit:regions',
      },
      sketchId: 'sketch_history',
      sketchLabel: 'History Sketch',
      plane: seedSketch.plane,
      planeTarget: seedSketch.planeTarget,
      planeKey: seedSketch.planeKey,
      definition: seedSketch.sketch.definition,
    }))
    assert(sketch.revisionState.kind === 'accepted', 'Sketch commit should be stored for replay.')

    const renamedSketch = await unwrapModelingResult(service.commitSketch({
      baseRevisionId: sketch.revisionId,
      solverCorrelation: {
        requestId: 'request_history_rename_sketch',
        projectionRequestId: 'request_history_rename_sketch:project',
        validationRequestId: 'request_history_rename_sketch:validate',
        solveRequestId: 'request_history_rename_sketch:solve',
        regionRequestId: 'request_history_rename_sketch:regions',
      },
      sketchId: 'sketch_history',
      sketchLabel: 'Renamed History Sketch',
      plane: seedSketch.plane,
      planeTarget: seedSketch.planeTarget,
      planeKey: seedSketch.planeKey,
      definition: seedSketch.sketch.definition,
    }))
    assert(renamedSketch.revisionState.kind === 'accepted', 'Sketch rename should be stored for replay.')

    const definition = await getSeedExtrudeDefinition(service)
    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: renamedSketch.revisionId,
      definition,
    }))
    assert(created.revisionState.kind === 'accepted', 'Feature create should be stored for replay.')

    const updated = await unwrapModelingResult(service.updateFeature({
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
      featureLabel: 'Renamed Extrude',
      definition: {
        ...definition,
        parameters: {
          ...definition.parameters,
          endExtent: { kind: 'blind', direction: 'positive', distance: 12 },
        },
      },
    }))
    assert(updated.revisionState.kind === 'accepted', 'Feature update should be stored for replay.')

    const reordered = await unwrapModelingResult(service.reorderFeature({
      baseRevisionId: updated.revisionId,
      featureId: created.featureId,
      beforeFeatureId: 'feature_extrude-1',
    }))
    assert(reordered.revisionState.kind === 'accepted', 'Feature reorder should be stored for replay.')

    const documentHistoryReordered = await unwrapModelingResult(service.reorderDocumentHistory({
      baseRevisionId: reordered.revisionId,
      item: { kind: 'feature', featureId: created.featureId },
      beforeItem: { kind: 'sketch', sketchId: 'sketch_history' },
    }))
    assert(
      documentHistoryReordered.revisionState.kind === 'accepted',
      'Mixed document history reorder should be stored for replay.',
    )

    const cursor = await unwrapModelingResult(service.setFeatureCursor({
      baseRevisionId: documentHistoryReordered.revisionId,
      cursor: { kind: 'feature', featureId: 'feature_extrude-1' },
    }))
    assert(cursor.revisionState.kind === 'accepted', 'Feature cursor rollback should be stored for replay.')

    const renamedBody = await unwrapModelingResult(service.renameBody({
      baseRevisionId: cursor.revisionId,
      bodyId: 'body_part-1',
      bodyLabel: 'Renamed Part',
    }))
    assert(renamedBody.revisionState.kind === 'accepted', 'Body rename should be stored for replay.')

    const originalSnapshot = await service.getCurrentDocumentSnapshot()
    const finalHistory = store.savedPayloads.at(-1)
    assert(finalHistory, 'Committed mutations should save a final history payload.')

    const restoredStore = createMemoryOperationHistoryStore(finalHistory)
    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: restoredStore,
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Valid persisted history should restore explicitly.')
    assert(restoreState.entriesReplayed === finalHistory.entries.length, 'Restore should replay every entry in order.')
    assert(
      restoredSnapshot.sketches.some((entry) => entry.sketchId === 'sketch_history'),
      'Replay should rebuild persisted sketches.',
    )
    assert(
      restoredSnapshot.features.map((feature) => feature.featureId).join(',')
        === originalSnapshot.features.map((feature) => feature.featureId).join(','),
      'Replay should preserve feature order.',
    )
    assert(
      finalHistory.entries.some((entry) => entry.kind === 'reorderDocumentHistory'),
      'Accepted mixed document history reorders should be persisted.',
    )
    assert(
      restoredSnapshot.presentation.documentHistory.map((item) => item.kind === 'sketch' ? item.sketchId : item.featureId).join(',')
        === originalSnapshot.presentation.documentHistory.map((item) => item.kind === 'sketch' ? item.sketchId : item.featureId).join(','),
      'Replay should preserve mixed sketch and feature document history order.',
    )
    assert(
      restoredSnapshot.features.find((feature) => feature.featureId === created.featureId)?.definition.kind === 'extrude',
      'Replay should rebuild persisted feature definitions.',
    )
    assert(
      originalSnapshot.features.find((feature) => feature.featureId === created.featureId)?.label === 'Renamed Extrude'
        && restoredSnapshot.features.find((feature) => feature.featureId === created.featureId)?.label === 'Renamed Extrude',
      'Replay should preserve persisted feature rename labels.',
    )
    assert(
      originalSnapshot.sketches.find((entry) => entry.sketchId === 'sketch_history')?.label === 'Renamed History Sketch'
        && restoredSnapshot.sketches.find((entry) => entry.sketchId === 'sketch_history')?.label === 'Renamed History Sketch',
      'Replay should preserve persisted sketch rename labels.',
    )
    assert(
      originalSnapshot.bodies.find((entry) => entry.bodyId === 'body_part-1')?.label === 'Renamed Part'
        && restoredSnapshot.bodies.find((entry) => entry.bodyId === 'body_part-1')?.label === 'Renamed Part'
        && restoredSnapshot.presentation.objects.find((entry) => entry.target.kind === 'body' && entry.target.bodyId === 'body_part-1')?.label === 'Renamed Part',
      'Replay should preserve persisted body rename labels in body and object records.',
    )
    assert(
      restoredSnapshot.cursor.kind === originalSnapshot.cursor.kind
        && restoredSnapshot.cursor.kind === 'feature'
        && originalSnapshot.cursor.kind === 'feature'
        && restoredSnapshot.cursor.featureId === originalSnapshot.cursor.featureId,
      'Replay should preserve persisted document cursor state.',
    )
  }

  async function testDeleteFeatureReplayMatchesFinalState() {
    const { service, store } = await createServiceWithStore()
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)
    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    }))
    assert(created.revisionState.kind === 'accepted', 'Feature create should commit before delete.')

    const deleted = await unwrapModelingResult(service.deleteFeature({
      baseRevisionId: created.revisionId,
      featureId: created.featureId,
    }))
    assert(deleted.revisionState.kind === 'accepted', 'Feature delete should commit.')

    const finalHistory = store.savedPayloads.at(-1)
    assert(finalHistory, 'Create/delete sequence should save history.')

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    })
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(
      !restoredSnapshot.features.some((feature) => feature.featureId === created.featureId),
      'Replay should apply persisted feature deletes.',
    )
  }

  async function testPersistedHistoryReplaysDocumentVariables() {
    const { service, store } = await createServiceWithStore()
    const snapshot = await service.getCurrentDocumentSnapshot()
    const added = await unwrapModelingResult(service.addDocumentVariable({
      baseRevisionId: snapshot.revisionId,
      variableId: 'variable_width',
      name: 'width',
      valueText: '12',
    }))
    assert(added.revisionState.kind === 'accepted', 'Variable add should be stored for replay.')

    const updated = await unwrapModelingResult(service.updateDocumentVariable({
      baseRevisionId: added.revisionId,
      variableId: added.variableId,
      name: 'width',
      valueText: '18',
    }))
    assert(updated.revisionState.kind === 'accepted', 'Variable update should be stored for replay.')

    const dependent = await unwrapModelingResult(service.addDocumentVariable({
      baseRevisionId: updated.revisionId,
      variableId: 'variable_depth',
      name: 'depth',
      valueText: 'width + 50',
    }))
    assert(dependent.revisionState.kind === 'accepted', 'Dependent variable add should be stored for replay.')

    const finalHistory = store.savedPayloads.at(-1)
    assert(finalHistory, 'Variable mutations should save history.')
    assert(finalHistory.entries[0]?.kind === 'addDocumentVariable', 'Variable create should persist as document history.')
    assert(finalHistory.entries[1]?.kind === 'updateDocumentVariable', 'Variable edit should persist as document history.')
    assert(finalHistory.entries[2]?.kind === 'addDocumentVariable', 'Dependent variable create should persist as document history.')
    assert(!('isValid' in finalHistory.entries[1]!.payload), 'Variable history must not persist validation state.')

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    })
    const restoreState = await restoredService.getHistoryRestoreState()
    const restoredSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(restoreState.kind === 'restored', 'Variable history should restore explicitly.')
    assert(
      restoredSnapshot.document.variables.map((variable) => `${variable.variableId}:${variable.name}:${variable.valueText}`).join(',')
        === 'variable_width:width:18,variable_depth:depth:width + 50',
      'Replay should restore ordered document variable records without expression evaluation.',
    )
    const evaluation = evaluateDocumentVariableExpressions(restoredSnapshot.document.variables)
    assert(evaluation.ok && evaluation.valuesByName.get('depth') === 68, 'Restored dependent variable expressions should remain evaluable.')
    assert(
      restoredSnapshot.document.references.length > 0,
      'Variable replay should preserve snapshot reference records.',
    )
  }

  async function testUnsupportedHistoryVersionFailsRestore() {
    const store = createMemoryOperationHistoryStore({
      ...createEmptyOperationHistory('doc_workspace'),
      schemaVersion: 'modeling-operation-history/v0' as never,
    })
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })

    const state = await service.getHistoryRestoreState()
    assert(state.kind === 'failed', 'Unsupported history versions should fail restore explicitly.')
    assert(
      state.diagnostics[0]?.reasonCode === 'unsupported-schema-version',
      'Unsupported history version restore failures should expose diagnostics.',
    )
  }

  async function testInvalidCursorHistoryFailsRestore() {
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore({
        ...createEmptyOperationHistory('doc_workspace'),
        entries: [
          {
            kind: 'setFeatureCursor',
            payload: {
              cursor: { kind: 'feature', featureId: 'feature_missing' },
            },
          },
        ],
      }),
    })

    const state = await service.getHistoryRestoreState()
    assert(state.kind === 'failed', 'Invalid persisted cursor references should fail restore explicitly.')
    assert(
      state.diagnostics[0]?.reasonCode === 'mock-invalid-document-cursor',
      'Invalid persisted cursor restore failures should expose cursor diagnostics.',
    )
  }

  async function testStartupSnapshotWaitsForReplay() {
    const { service, store } = await createServiceWithStore()
    const snapshot = await service.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(service)
    const created = await unwrapModelingResult(service.createFeature({
      baseRevisionId: snapshot.revisionId,
      definition,
    }))
    assert(created.revisionState.kind === 'accepted', 'Feature create should produce startup replay history.')

    const finalHistory = store.savedPayloads.at(-1)
    assert(finalHistory, 'Feature create should save history.')

    const restoredService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(finalHistory),
    })
    const startupSnapshot = await restoredService.getCurrentDocumentSnapshot()

    assert(
      startupSnapshot.features.some((feature) => feature.featureId === created.featureId),
      'Startup snapshot should include replayed history before editor exposure.',
    )
  }

  await testOnlyCommittedMutationsAreStored()
  await testPersistedHistoryReplaysSketchAndFeatureMutations()
  await testDeleteFeatureReplayMatchesFinalState()
  await testPersistedHistoryReplaysDocumentVariables()
  await testUnsupportedHistoryVersionFailsRestore()
  await testInvalidCursorHistoryFailsRestore()
  await testStartupSnapshotWaitsForReplay()
})
