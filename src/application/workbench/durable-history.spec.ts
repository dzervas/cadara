import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createDurableHistoryService } from '@/application/workbench/durable-history'
import type { DocumentRepository } from '@/domain/modeling/document-repository'
import { createModelingService, type ModelingService } from '@/domain/modeling/modeling-service'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import type { FeatureDefinition } from '@/contracts/modeling/schema'
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import type { AppResultAsync } from '@/contracts/errors'
import { SketchConstraintSolverAdapter } from '@/domain/solver/sketch-constraint-solver-adapter'

test('src/application/workbench/durable-history.spec.ts', async () => {
  type ExtrudeFeatureDefinition = Extract<FeatureDefinition, { kind: 'extrude' }>

  async function unwrapModelingResult<T>(result: AppResultAsync<T>): Promise<T> {
    const resolved = await result
    expectTrue(resolved.isOk(), resolved.isErr() ? resolved.error.message : 'Expected modeling result to be ok.')
    return resolved.value
  }

  async function getSeedExtrudeDefinition(service: ModelingService): Promise<ExtrudeFeatureDefinition> {
    const snapshot = await service.getCurrentDocumentSnapshot()
    const seedExtrude = snapshot.document.features.find(
      (feature) => feature.featureId === 'feature_extrude-1' && feature.definition.kind === 'extrude',
    )

    if (!seedExtrude || seedExtrude.definition.kind !== 'extrude') {
      throw new Error('Seed extrude feature must exist.')
    }

    return {
      ...seedExtrude.definition,
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    }
  }

  async function createBackgroundDurableHistoryFixture(documentRepository: DocumentRepository = createMemoryDocumentRepository()) {
    const modelingService = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      sketchSolver: new SketchConstraintSolverAdapter({
        documentId: 'doc_workspace',
        revisionId: null,
      }),
      documentRepository,
      documentRepositoryPersistence: 'background',
    })
    const durableHistory = createDurableHistoryService({
      documentRepository,
      modelingService,
    })

    return {
      documentRepository,
      modelingService,
      durableHistory,
    }
  }

  async function testImmediateUndoAfterBackgroundVariableUpdate() {
    const { modelingService, durableHistory } = await createBackgroundDurableHistoryFixture()
    const initial = await modelingService.getCurrentDocumentSnapshot()

    const added = await unwrapModelingResult(
      modelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: 'Width',
        valueText: '10',
      }),
    )
    expectTrue(added.revisionState.kind === 'accepted', 'Variable setup should be accepted.')
    await modelingService.waitForPersistence()

    const withVariable = await modelingService.getCurrentDocumentSnapshot()
    const variable = withVariable.document.variables.find((entry) => entry.name === 'Width')
    expectTrue(variable, 'Added variable should exist before update undo coverage runs.')

    const updated = await unwrapModelingResult(
      modelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: '25',
      }),
    )
    expectTrue(updated.revisionState.kind === 'accepted', 'Variable update should be accepted.')

    const availability = await durableHistory.getAvailability({
      documentId: withVariable.document.documentId,
      sketchSession: null,
    })
    expectTrue(availability.canUndo, 'Immediate durable-history availability should reflect a background variable update.')

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
      sketchSession: null,
    })
    expectTrue(undone?.context === 'document', 'Immediate undo after a variable update should restore a document snapshot.')
    expectTrue(
      undone?.context === 'document'
        && undone.snapshot.document.variables.some((entry) => entry.variableId === variable.variableId && entry.valueText === '10'),
      'Immediate undo after a variable update should restore the prior variable value.',
    )
  }

  async function testImmediateUndoAfterBackgroundExtrudeUpdate() {
    const { modelingService, durableHistory } = await createBackgroundDurableHistoryFixture()
    const initial = await modelingService.getCurrentDocumentSnapshot()
    const definition = await getSeedExtrudeDefinition(modelingService)
    const initialExtrude = initial.document.features.find((feature) => feature.featureId === 'feature_extrude-1')
    expectTrue(initialExtrude?.definition.kind === 'extrude', 'Seed extrude should exist before extrude undo coverage runs.')
    const initialDistance = (
      initialExtrude.definition.parameters.extent.mode === 'oneSide'
      && initialExtrude.definition.parameters.extent.end.kind === 'blind'
    )
      ? initialExtrude.definition.parameters.extent.end.distance
      : null

    const updated = await unwrapModelingResult(
      modelingService.updateFeature({
        baseRevisionId: initial.document.revisionId,
        featureId: 'feature_extrude-1',
        featureLabel: 'Extrude',
        definition: {
          ...definition,
          parameters: {
            ...definition.parameters,
            extent: {
              mode: 'oneSide',
              end: {
                kind: 'blind',
                direction: 'positive',
                distance: { source: 'literal', value: 23 },
              },
            },
          },
        },
      }),
    )
    expectTrue(updated.revisionState.kind === 'accepted', 'Extrude update should be accepted.')

    const availability = await durableHistory.getAvailability({
      documentId: initial.document.documentId,
      sketchSession: null,
    })
    expectTrue(availability.canUndo, 'Immediate durable-history availability should reflect a background extrude update.')

    const undone = await durableHistory.undo({
      documentId: initial.document.documentId,
      sketchSession: null,
    })
    const restoredExtrude = undone?.context === 'document'
      ? undone.snapshot.document.features.find((feature) => feature.featureId === 'feature_extrude-1')
      : null
    expectTrue(restoredExtrude?.definition.kind === 'extrude', 'Immediate undo after an extrude update should restore the extrude feature.')
    expectTrue(
      restoredExtrude?.definition.kind === 'extrude'
        && restoredExtrude.definition.parameters.extent.mode === 'oneSide'
        && restoredExtrude.definition.parameters.extent.end.kind === 'blind'
        && JSON.stringify(restoredExtrude.definition.parameters.extent.end.distance) === JSON.stringify(initialDistance),
      'Immediate undo after an extrude update should restore the prior extrude extent distance.',
    )
  }

  async function testImmediateUndoAfterBackgroundSketchPlaneCommit() {
    const { modelingService, durableHistory } = await createBackgroundDurableHistoryFixture()
    const initial = await modelingService.getCurrentDocumentSnapshot()
    const sketch = initial.document.sketches[0]
    expectTrue(sketch, 'Seed sketch should exist for sketch-plane undo coverage.')

    const committed = await unwrapModelingResult(
      modelingService.commitSketch({
        baseRevisionId: initial.document.revisionId,
        sketchId: sketch.sketchId,
        sketchLabel: sketch.label,
        plane: createStandardPlaneDefinition('yz'),
        definition: sketch.sketch.definition,
        solverCorrelation: modelingService.sketchSolver?.createCommitCorrelation('request_background_sketch_plane_undo') ?? null,
      }),
    )
    expectTrue(committed.revisionState.kind === 'accepted', 'Sketch-plane commit should be accepted.')

    const availability = await durableHistory.getAvailability({
      documentId: initial.document.documentId,
      sketchSession: null,
    })
    expectTrue(availability.canUndo, 'Immediate durable-history availability should reflect a background sketch-plane commit.')

    const undone = await durableHistory.undo({
      documentId: initial.document.documentId,
      sketchSession: null,
    })
    const restoredSketch = undone?.context === 'document'
      ? undone.snapshot.document.sketches.find((entry) => entry.sketchId === sketch.sketchId)
      : null
    expectTrue(restoredSketch, 'Immediate undo after a sketch-plane commit should restore the committed sketch.')
    expectTrue(
      restoredSketch?.plane.key === sketch.plane.key,
      'Immediate undo after a sketch-plane commit should restore the prior sketch plane.',
    )
  }

  async function testImmediateUndoWaitsForDelayedRepositoryUndoEvent() {
    const documentRepository = createDelayedUndoNotificationRepository()
    const { modelingService, durableHistory } = await createBackgroundDurableHistoryFixture(documentRepository)
    const initial = await modelingService.getCurrentDocumentSnapshot()

    const added = await unwrapModelingResult(
      modelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: 'Depth',
        valueText: '5',
      }),
    )
    expectTrue(added.revisionState.kind === 'accepted', 'Delayed-notification variable setup should be accepted.')
    await modelingService.waitForPersistence()

    const withVariable = await modelingService.getCurrentDocumentSnapshot()
    const variable = withVariable.document.variables.find((entry) => entry.name === 'Depth')
    expectTrue(variable, 'Delayed-notification variable should exist before undo coverage runs.')

    const updated = await unwrapModelingResult(
      modelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: '15',
      }),
    )
    expectTrue(updated.revisionState.kind === 'accepted', 'Delayed-notification variable update should be accepted.')

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
      sketchSession: null,
    })
    expectTrue(
      undone?.context === 'document'
        && undone.snapshot.document.variables.some((entry) => entry.variableId === variable.variableId && entry.valueText === '5'),
      'Document undo should wait for the delayed repository undo event before fetching the restored snapshot.',
    )
  }

  async function testImmediateUndoDoesNotRequireLatestEventReplay() {
    const { documentRepository, modelingService: baseModelingService } = await createBackgroundDurableHistoryFixture()
    const durableHistory = createDurableHistoryService({
      documentRepository,
      modelingService: createNoReplayModelingService(baseModelingService),
    })
    const initial = await baseModelingService.getCurrentDocumentSnapshot()

    const added = await unwrapModelingResult(
      baseModelingService.addDocumentVariable({
        baseRevisionId: initial.document.revisionId,
        name: 'Height',
        valueText: '30',
      }),
    )
    expectTrue(added.revisionState.kind === 'accepted', 'No-replay variable setup should be accepted.')
    await baseModelingService.waitForPersistence()

    const withVariable = await baseModelingService.getCurrentDocumentSnapshot()
    const variable = withVariable.document.variables.find((entry) => entry.name === 'Height')
    expectTrue(variable, 'No-replay variable should exist before undo coverage runs.')

    const updated = await unwrapModelingResult(
      baseModelingService.updateDocumentVariable({
        baseRevisionId: withVariable.document.revisionId,
        variableId: variable.variableId,
        name: variable.name,
        valueText: '35',
      }),
    )
    expectTrue(updated.revisionState.kind === 'accepted', 'No-replay variable update should be accepted.')

    const undone = await durableHistory.undo({
      documentId: withVariable.document.documentId,
      sketchSession: null,
    })
    expectTrue(
      undone?.context === 'document'
        && undone.snapshot.document.variables.some((entry) => entry.variableId === variable.variableId && entry.valueText === '30'),
      'Document undo should subscribe before mutating so synchronous repository events are not missed.',
    )
  }

  await testImmediateUndoAfterBackgroundVariableUpdate()
  await testImmediateUndoAfterBackgroundExtrudeUpdate()
  await testImmediateUndoAfterBackgroundSketchPlaneCommit()
  await testImmediateUndoWaitsForDelayedRepositoryUndoEvent()
  await testImmediateUndoDoesNotRequireLatestEventReplay()
})

function createNoReplayModelingService(modelingService: ModelingService): ModelingService {
  return {
    ...modelingService,
    subscribeToDocumentChanges(listener) {
      let skippedReplayEvent = false
      return modelingService.subscribeToDocumentChanges((event) => {
        if (!skippedReplayEvent) {
          skippedReplayEvent = true
          return
        }

        listener(event)
      })
    },
  }
}

function createDelayedUndoNotificationRepository(): DocumentRepository {
  const repository = createMemoryDocumentRepository()

  return {
    load(input) {
      return repository.load(input)
    },
    mutate(input) {
      return repository.mutate(input)
    },
    subscribe(documentId, listener) {
      return repository.subscribe(documentId, (event) => {
        if (event.metadata.source === 'undo' || event.metadata.source === 'redo') {
          setTimeout(() => {
            listener(event)
          }, 0)
          return
        }

        listener(event)
      })
    },
    reset(documentId) {
      return repository.reset(documentId)
    },
    getRestoreStatus(documentId) {
      return repository.getRestoreStatus(documentId)
    },
    getMetadata(documentId) {
      return repository.getMetadata(documentId)
    },
    getDurableHistoryAvailability(documentId) {
      return repository.getDurableHistoryAvailability(documentId)
    },
    undoDurableHistory(documentId) {
      return repository.undoDurableHistory(documentId)
    },
    redoDurableHistory(documentId) {
      return repository.redoDurableHistory(documentId)
    },
    getSketchDraftHistory(documentId, draftKey) {
      return repository.getSketchDraftHistory(documentId, draftKey)
    },
    saveSketchDraftHistory(documentId, draftKey, session) {
      return repository.saveSketchDraftHistory(documentId, draftKey, session)
    },
    undoSketchDraftHistory(documentId, draftKey) {
      return repository.undoSketchDraftHistory(documentId, draftKey)
    },
    redoSketchDraftHistory(documentId, draftKey) {
      return repository.redoSketchDraftHistory(documentId, draftKey)
    },
    clearSketchDraftHistory(documentId, draftKey) {
      return repository.clearSketchDraftHistory(documentId, draftKey)
    },
  }
}
