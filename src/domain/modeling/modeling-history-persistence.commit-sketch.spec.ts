import { test } from 'bun:test'
import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type { CommitSketchRequest, DocumentSnapshot, SketchSnapshotRecord } from '@/contracts/modeling/schema'
import { SOLVED_SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createModelingService } from '@/domain/modeling/modeling-service'

test('src/domain/modeling/modeling-history-persistence.commit-sketch.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createDraftSketchDefinition(sketchId: `sketch_${string}`) {
    return {
      schemaVersion: 'sketch-definition/v1alpha1' as const,
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_1_rect-bottom-left',
        'sketch_point_1_rect-bottom-right',
        'sketch_point_1_rect-top-right',
        'sketch_point_1_rect-top-left',
      ] as const,
      points: [
        {
          pointId: 'sketch_point_1_rect-bottom-left',
          label: 'Rectangle 1 bottom left',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-bottom-left' },
          position: [-15.5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-bottom-right',
          label: 'Rectangle 1 bottom right',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-bottom-right' },
          position: [-5, -5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-top-right',
          label: 'Rectangle 1 top right',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-top-right' },
          position: [-5, 4.5] as const,
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_1_rect-top-left',
          label: 'Rectangle 1 top left',
          target: { kind: 'sketchPoint' as const, sketchId, pointId: 'sketch_point_1_rect-top-left' },
          position: [-15.5, 4.5] as const,
          isConstruction: false,
        },
      ],
      entityIds: [
        'sketch_entity_1_rect-bottom',
        'sketch_entity_1_rect-right',
        'sketch_entity_1_rect-top',
        'sketch_entity_1_rect-left',
      ] as const,
      entities: [
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-bottom',
          label: 'Rectangle 1 bottom',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-bottom' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-bottom-left',
          endPointId: 'sketch_point_1_rect-bottom-right',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-right',
          label: 'Rectangle 1 right',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-right' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-bottom-right',
          endPointId: 'sketch_point_1_rect-top-right',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-top',
          label: 'Rectangle 1 top',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-top' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-top-right',
          endPointId: 'sketch_point_1_rect-top-left',
        },
        {
          kind: 'lineSegment' as const,
          entityId: 'sketch_entity_1_rect-left',
          label: 'Rectangle 1 left',
          target: { kind: 'sketchEntity' as const, sketchId, entityId: 'sketch_entity_1_rect-left' },
          isConstruction: false,
          startPointId: 'sketch_point_1_rect-top-left',
          endPointId: 'sketch_point_1_rect-bottom-left',
        },
      ],
      constraintIds: [
        'constraint_1_bottom-horizontal',
        'constraint_1_top-horizontal',
        'constraint_1_right-vertical',
        'constraint_1_left-vertical',
      ] as const,
      constraints: [
        {
          constraintId: 'constraint_1_bottom-horizontal',
          kind: 'horizontal' as const,
          label: 'Rectangle 1 bottom horizontal',
          entityId: 'sketch_entity_1_rect-bottom',
        },
        {
          constraintId: 'constraint_1_top-horizontal',
          kind: 'horizontal' as const,
          label: 'Rectangle 1 top horizontal',
          entityId: 'sketch_entity_1_rect-top',
        },
        {
          constraintId: 'constraint_1_right-vertical',
          kind: 'vertical' as const,
          label: 'Rectangle 1 right vertical',
          entityId: 'sketch_entity_1_rect-right',
        },
        {
          constraintId: 'constraint_1_left-vertical',
          kind: 'vertical' as const,
          label: 'Rectangle 1 left vertical',
          entityId: 'sketch_entity_1_rect-left',
        },
      ],
      dimensionIds: ['dimension_1_width', 'dimension_1_height'] as const,
      dimensions: [
        {
          dimensionId: 'dimension_1_width',
          kind: 'distance' as const,
          label: 'Rectangle 1 width',
          axis: 'horizontal' as const,
          pointIds: ['sketch_point_1_rect-bottom-left', 'sketch_point_1_rect-bottom-right'] as const,
          value: 10.5,
        },
        {
          dimensionId: 'dimension_1_height',
          kind: 'distance' as const,
          label: 'Rectangle 1 height',
          axis: 'vertical' as const,
          pointIds: ['sketch_point_1_rect-bottom-right', 'sketch_point_1_rect-top-right'] as const,
          value: 9.5,
        },
      ],
    } satisfies CommitSketchRequest['definition']
  }

  function createLegacyCommitSketchHistory() {
    return {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'commitSketch' as const,
          payload: {
            sketchId: null,
            sketchLabel: 'Legacy Draft Sketch',
            plane: {
              key: 'xy' as const,
              support: { kind: 'construction' as const, constructionId: 'construction_plane-xy' as const },
              frame: {
                origin: [0, 0, 0] as const,
                xAxis: [1, 0, 0] as const,
                yAxis: [0, 1, 0] as const,
                normal: [0, 0, 1] as const,
                linearUnit: 'documentLength' as const,
                handedness: 'rightHanded' as const,
              },
            },
            planeTarget: { kind: 'construction' as const, constructionId: 'construction_plane-xy' as const },
            planeKey: 'xy' as const,
            definition: createDraftSketchDefinition('sketch_draft'),
          },
        },
      ],
    }
  }

  function normalizeDefinitionForSketchId(
    definition: CommitSketchRequest['definition'],
    sketchId: `sketch_${string}`,
  ): CommitSketchRequest['definition'] {
    return {
      ...definition,
      points: definition.points.map((point) => ({
        ...point,
        target: {
          ...point.target,
          sketchId,
        },
      })),
      entities: definition.entities.map((entity) => ({
        ...entity,
        target: {
          ...entity.target,
          sketchId,
        },
      })),
    }
  }

  function createWorkspaceSnapshot(
    revisionId: `rev_${string}`,
    sketches: DocumentSnapshot['sketches'] = [],
  ): DocumentSnapshot {
    const document = {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_workspace' as const,
      revisionId,
      settings: {
        linearUnit: 'millimeter' as const,
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: [],
        previewableFeatureKinds: [],
        supportedProfileKinds: [],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: false,
      },
      featureTree: [],
      objects: [],
      features: [],
      cursor: { kind: 'empty' as const },
      sketches,
      bodies: [],
      constructions: [],
      entities: [],
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
    }

    return {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_workspace',
      revisionId,
      settings: document.settings,
      capabilities: document.capabilities,
      featureTree: [],
      objects: [],
      features: [],
      cursor: { kind: 'empty' },
      sketches,
      bodies: [],
      constructions: [],
      entities: [],
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
      document,
      presentation: {
        featureTree: [],
        objects: [],
        entities: [],
      },
    }
  }

  function createLegacyReplayAdapter(): ModelingKernelAdapter {
    let currentSnapshot = createWorkspaceSnapshot('rev_0001')
    let revisionCounter = 1

    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: CONTRACT_VERSION,
          snapshot: currentSnapshot,
        }
      },
      async commitSketch(request) {
        revisionCounter += 1
        const revisionId = `rev_${String(revisionCounter).padStart(4, '0')}` as const
        const sketchId = request.sketchId ?? ('sketch_legacy_replayed' as const)
        const normalizedDefinition = normalizeDefinitionForSketchId(request.definition, sketchId)
        const sketch: SketchSnapshotRecord = {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: revisionId,
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          sketchId,
          label: request.sketchLabel,
          plane: request.plane,
          planeTarget: request.planeTarget,
          planeKey: request.planeKey,
          sketch: {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: revisionId,
            ownerFeatureId: null,
            ownerSketchId: sketchId,
            ownerBodyId: null,
            sketchId,
            label: request.sketchLabel,
            planeSupport: request.plane.support,
            definition: normalizedDefinition,
            solvedSnapshot: {
              schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
              status: {
                solveState: 'solved',
                constraintState: 'wellConstrained',
              },
              solvedEntities: [],
              solvedPoints: [],
              constraintStatuses: [],
              dimensionStatuses: [],
              diagnostics: [],
            },
            regions: [],
          },
        }
        currentSnapshot = createWorkspaceSnapshot(revisionId, [sketch])

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: 'doc_workspace',
          revisionId,
          sketchId,
          revisionState: {
            kind: 'accepted' as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: {
            kind: 'rebuilt' as const,
            revisionId,
            invalidatedTargets: [],
            diagnostics: [],
          },
          changedTargets: [],
          diagnostics: [],
        }
      },
      async createFeature() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async updateFeature() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async deleteFeature() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async reorderFeature() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async setFeatureCursor() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async evaluatePreview() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async resolveReference() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
    }
  }

  async function testCommitSketchPersistenceNormalizesSketchIds() {
    const store = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })

    const result = await service.commitSketch({
      baseRevisionId: 'rev_0001',
      solverCorrelation: {
        requestId: 'request_commit_history',
        projectionRequestId: 'request_commit_history:project',
        validationRequestId: 'request_commit_history:validate',
        solveRequestId: 'request_commit_history:solve',
        regionRequestId: 'request_commit_history:regions',
      },
      sketchId: null,
      sketchLabel: 'History Sketch',
      plane: {
        key: 'xy',
        support: { kind: 'construction', constructionId: 'construction_plane-xy' },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: 'documentLength',
          handedness: 'rightHanded',
        },
      },
      planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
      planeKey: 'xy',
      definition: createDraftSketchDefinition('sketch_draft'),
    })

    assert(result.revisionState.kind === 'accepted', 'Sketch commit should be accepted.')

    const savedHistory = store.savedPayloads.at(-1)
    assert(savedHistory, 'Accepted commitSketch mutations should persist history.')
    const persistedEntry = savedHistory.entries[0]
    assert(persistedEntry?.kind === 'commitSketch', 'Persisted history entry must remain commitSketch.')
    assert(
      persistedEntry?.kind === 'commitSketch' && persistedEntry.payload.sketchId === result.sketchId,
      'Persisted commitSketch entries must store the committed sketch id.',
    )
    assert(
      persistedEntry?.kind === 'commitSketch'
        && persistedEntry.payload.definition.points.every((point) => point.target.sketchId === result.sketchId),
      'Persisted commitSketch point targets must be normalized to the committed sketch id.',
    )
    assert(
      persistedEntry?.kind === 'commitSketch'
        && persistedEntry.payload.definition.entities.every((entity) => entity.target.sketchId === result.sketchId),
      'Persisted commitSketch entity targets must be normalized to the committed sketch id.',
    )

    const reloadedStore = createMemoryOperationHistoryStore(savedHistory)
    const loadResult = reloadedStore.load()
    assert(loadResult.ok, 'Persisted commitSketch history should remain loadable after save.')
  }

  async function testLegacyCommitSketchHistoryRestores() {
    const service = createModelingService(createLegacyReplayAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(createLegacyCommitSketchHistory()),
    })

    const restoreState = await service.getHistoryRestoreState()
    assert(restoreState.kind === 'restored', 'Legacy commitSketch history should still restore successfully.')
    assert(restoreState.entriesReplayed === 1, 'Legacy commitSketch history should replay its single entry.')

    const snapshot = await service.getCurrentDocumentSnapshot()
    assert(
      snapshot.sketches.some((entry) => entry.label === 'Legacy Draft Sketch' && entry.sketchId === 'sketch_legacy_replayed'),
      'Legacy commitSketch history should rebuild the committed sketch snapshot.',
    )
    assert(
      snapshot.sketches[0]?.sketch.definition.points.every((point) => point.target.sketchId === 'sketch_legacy_replayed'),
      'Legacy commitSketch replay should normalize point targets to the committed sketch id.',
    )
    assert(
      snapshot.sketches[0]?.sketch.definition.entities.every((entity) => entity.target.sketchId === 'sketch_legacy_replayed'),
      'Legacy commitSketch replay should normalize entity targets to the committed sketch id.',
    )
  }

  await testCommitSketchPersistenceNormalizesSketchIds()
  await testLegacyCommitSketchHistoryRestores()
})
