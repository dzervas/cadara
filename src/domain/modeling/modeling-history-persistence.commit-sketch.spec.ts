import { test } from 'bun:test'
import {
  createCreateFeatureHistoryEntry,
  createDeleteTargetHistoryEntry,
  createEmptyOperationHistory,
} from '@/contracts/modeling/operation-history'
import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
  DocumentSnapshot,
  FeatureSnapshotRecord,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import { SOLVED_SKETCH_SCHEMA_VERSION } from '@/contracts/sketch/schema'
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import type { AppResultAsync } from '@/contracts/errors'
import { createMemoryOperationHistoryStore } from '@/domain/modeling/modeling-history-persistence'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import type { ModelingCommitSketchResult } from '@/domain/modeling/modeling-service'
import { createModelingService } from '@/domain/modeling/modeling-service'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'

test('src/domain/modeling/modeling-history-persistence.commit-sketch.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  async function unwrapModelingResult<T>(result: AppResultAsync<T>): Promise<T> {
    const resolved = await result
    assert(resolved.isOk(), resolved.isErr() ? resolved.error.message : 'Modeling result should be ok.')
    return resolved.value
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

  function getFirstDerivedRegionId(
    documentId: 'doc_workspace',
    revisionId: `rev_${string}`,
    sketchId: `sketch_${string}`,
    definition: ReturnType<typeof createDraftSketchDefinition>,
  ) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'failOnConflict',
    })
    const regions = deriveSketchRegionsCore({
      documentId,
      revisionId,
      sketchId,
      definition,
      solvedSnapshot: solved.solvedSnapshot,
    }).regions
    const regionId = regions[0]?.regionId
    assert(regionId, 'Draft sketch should derive a region for persisted feature replay.')
    return regionId
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
    features: DocumentSnapshot['features'] = [],
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
      documentHistory: [],
      features,
      cursor: { kind: 'empty' as const },
      sketches,
      bodies: [],
      constructions: [],
      variables: [],
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
      features,
      cursor: { kind: 'empty' },
      sketches,
      bodies: [],
      constructions: [],
      variables: [],
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
        documentHistory: [],
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
      async deleteTarget() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async renameBody() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async reorderFeature() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async setFeatureCursor() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async addDocumentVariable() {
        throw new Error('Not implemented for legacy commitSketch replay test.')
      },
      async updateDocumentVariable() {
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

  function createStrictReplayAdapter(): ModelingKernelAdapter {
    let currentSnapshot = createWorkspaceSnapshot('rev_0001')
    let revisionCounter = 1

    function nextRevisionId() {
      revisionCounter += 1
      return `rev_${String(revisionCounter).padStart(4, '0')}` as const
    }

    function allocateSketchId() {
      if (!currentSnapshot.document.sketches.some((entry) => entry.sketchId === 'sketch_primary')) {
        return 'sketch_primary' as const
      }

      let maxOrdinal = 1
      for (const sketch of currentSnapshot.document.sketches) {
        const match = /^sketch_(\d+)$/.exec(sketch.sketchId)
        if (match) {
          maxOrdinal = Math.max(maxOrdinal, Number.parseInt(match[1]!, 10))
        }
      }

      return `sketch_${maxOrdinal + 1}` as const
    }

    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: CONTRACT_VERSION,
          snapshot: currentSnapshot,
        }
      },
      async commitSketch(request) {
        if (
          request.sketchId !== null
          && !currentSnapshot.document.sketches.some((entry) => entry.sketchId === request.sketchId)
        ) {
          return {
            contractVersion: CONTRACT_VERSION,
            documentId: 'doc_workspace',
            revisionId: currentSnapshot.revisionId,
            sketchId: request.sketchId,
            revisionState: {
              kind: 'rejected' as const,
              reasonCode: 'occ-missing-sketch',
            },
            rebuildResult: {
              kind: 'skipped' as const,
              reasonCode: 'validationRejected' as const,
              invalidatedTargets: [],
              diagnostics: [],
            },
            changedTargets: [],
            diagnostics: [],
          }
        }

        const revisionId = nextRevisionId()
        const sketchId = request.sketchId ?? allocateSketchId()
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
        currentSnapshot = createWorkspaceSnapshot(revisionId, [...currentSnapshot.document.sketches, sketch])

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
      async createFeature(request) {
        const revisionId = nextRevisionId()
        const feature: FeatureSnapshotRecord = {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: revisionId,
          ownerFeatureId: 'feature_extrude-1',
          ownerSketchId: null,
          ownerBodyId: null,
          featureId: 'feature_extrude-1',
          label: 'Extrude 1',
          producedTargets: [],
          definition: request.definition,
        }
        currentSnapshot = createWorkspaceSnapshot(
          revisionId,
          currentSnapshot.document.sketches,
          [...currentSnapshot.document.features, feature],
        )

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: 'doc_workspace',
          revisionId,
          featureId: 'feature_extrude-1',
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
      async updateFeature() {
        throw new Error('Not implemented for strict replay test.')
      },
      async deleteFeature() {
        throw new Error('Not implemented for strict replay test.')
      },
      async deleteTarget(request) {
        if (request.target.kind !== 'sketch') {
          throw new Error('Only sketch deletes are implemented for strict replay test.')
        }

        if (!currentSnapshot.document.sketches.some((entry) => entry.sketchId === request.target.sketchId)) {
          return {
            contractVersion: CONTRACT_VERSION,
            documentId: 'doc_workspace',
            revisionId: currentSnapshot.revisionId,
            deletedTarget: request.target,
            revisionState: {
              kind: 'rejected' as const,
              reasonCode: 'occ-missing-sketch',
            },
            rebuildResult: {
              kind: 'skipped' as const,
              reasonCode: 'validationRejected' as const,
              invalidatedTargets: [],
              diagnostics: [],
            },
            changedTargets: [],
            diagnostics: [],
          }
        }

        const revisionId = nextRevisionId()
        currentSnapshot = createWorkspaceSnapshot(
          revisionId,
          currentSnapshot.document.sketches.filter((entry) => entry.sketchId !== request.target.sketchId),
          currentSnapshot.document.features,
        )

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: 'doc_workspace',
          revisionId,
          deletedTarget: request.target,
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
          changedTargets: [request.target],
          diagnostics: [],
        }
      },
      async renameBody() {
        throw new Error('Not implemented for strict replay test.')
      },
      async reorderFeature() {
        throw new Error('Not implemented for strict replay test.')
      },
      async setFeatureCursor() {
        throw new Error('Not implemented for strict replay test.')
      },
      async addDocumentVariable() {
        throw new Error('Not implemented for strict replay test.')
      },
      async updateDocumentVariable() {
        throw new Error('Not implemented for strict replay test.')
      },
      async evaluatePreview() {
        throw new Error('Not implemented for strict replay test.')
      },
      async resolveReference() {
        throw new Error('Not implemented for strict replay test.')
      },
    }
  }

  async function testCommitSketchPersistenceNormalizesSketchIds() {
    const store = createMemoryOperationHistoryStore(createEmptyOperationHistory('doc_workspace'))
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: store,
    })

    const result: ModelingCommitSketchResult = await unwrapModelingResult(service.commitSketch({
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
    }))

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

  async function testExplicitAllocatorCompatibleSketchIdsReplayDuringRestore() {
    const draftDefinition = createDraftSketchDefinition('sketch_primary')
    const sketchRequest = {
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      solverCorrelation: {
        requestId: 'request_commit_restore',
        projectionRequestId: 'request_commit_restore:project',
        validationRequestId: 'request_commit_restore:validate',
        solveRequestId: 'request_commit_restore:solve',
        regionRequestId: 'request_commit_restore:regions',
      },
      sketchId: 'sketch_primary',
      sketchLabel: 'Replay Sketch',
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
      definition: draftDefinition,
    } satisfies CommitSketchRequest
    const replayRegionId = getFirstDerivedRegionId('doc_workspace', 'rev_0002', 'sketch_primary', draftDefinition)
    const extrudeRequest = {
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0002',
      definition: {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: 'sketch_primary', regionId: replayRegionId }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 10 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      },
    } satisfies CreateFeatureRequest
    const persistedHistory = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'commitSketch' as const,
          payload: {
            sketchId: sketchRequest.sketchId,
            sketchLabel: sketchRequest.sketchLabel,
            plane: sketchRequest.plane,
            planeTarget: sketchRequest.planeTarget,
            planeKey: sketchRequest.planeKey,
            definition: sketchRequest.definition,
          },
        },
        createCreateFeatureHistoryEntry(extrudeRequest),
      ],
    }
    const service = createModelingService(createStrictReplayAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(persistedHistory),
    })

    const restoreState = await service.getHistoryRestoreState()

    assert(
      restoreState.kind === 'restored',
      'Allocator-compatible explicit sketch ids should restore successfully on an empty strict adapter.',
    )
    assert(restoreState.entriesReplayed === 2, 'Replay should apply both the sketch and feature entries.')

    const snapshot = await service.getCurrentDocumentSnapshot()

    assert(
      snapshot.sketches.some((entry) => entry.sketchId === 'sketch_primary'),
      'Replay should recreate the expected primary sketch id.',
    )
    assert(
      snapshot.features.some((entry) => entry.featureId === 'feature_extrude-1' && entry.definition.kind === 'extrude'),
      'Replay should continue into downstream feature history after recreating the sketch.',
    )
  }

  async function testSketchDeleteReplayAllowsReusedAllocatorSketchId() {
    const firstDefinition = createDraftSketchDefinition('sketch_primary')
    const secondDefinition = createDraftSketchDefinition('sketch_2')
    const reusedDefinition = createDraftSketchDefinition('sketch_primary')
    const sketchRequest = {
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
      baseRevisionId: 'rev_0001',
      solverCorrelation: {
        requestId: 'request_commit_restore_reuse',
        projectionRequestId: 'request_commit_restore_reuse:project',
        validationRequestId: 'request_commit_restore_reuse:validate',
        solveRequestId: 'request_commit_restore_reuse:solve',
        regionRequestId: 'request_commit_restore_reuse:regions',
      },
      sketchId: 'sketch_primary',
      sketchLabel: 'Original Replay Sketch',
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
      definition: firstDefinition,
    } satisfies CommitSketchRequest
    const secondSketchRequest = {
      ...sketchRequest,
      baseRevisionId: 'rev_0002',
      solverCorrelation: {
        requestId: 'request_commit_restore_reuse_secondary',
        projectionRequestId: 'request_commit_restore_reuse_secondary:project',
        validationRequestId: 'request_commit_restore_reuse_secondary:validate',
        solveRequestId: 'request_commit_restore_reuse_secondary:solve',
        regionRequestId: 'request_commit_restore_reuse_secondary:regions',
      },
      sketchId: 'sketch_2',
      sketchLabel: 'Secondary Replay Sketch',
      definition: secondDefinition,
    } satisfies CommitSketchRequest
    const reusedSketchRequest = {
      ...sketchRequest,
      baseRevisionId: 'rev_0004',
      solverCorrelation: {
        requestId: 'request_commit_restore_reuse_after_delete',
        projectionRequestId: 'request_commit_restore_reuse_after_delete:project',
        validationRequestId: 'request_commit_restore_reuse_after_delete:validate',
        solveRequestId: 'request_commit_restore_reuse_after_delete:solve',
        regionRequestId: 'request_commit_restore_reuse_after_delete:regions',
      },
      sketchLabel: 'Reused Replay Sketch',
      definition: reusedDefinition,
    } satisfies CommitSketchRequest
    const persistedHistory = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        {
          kind: 'commitSketch' as const,
          payload: {
            sketchId: sketchRequest.sketchId,
            sketchLabel: sketchRequest.sketchLabel,
            plane: sketchRequest.plane,
            planeTarget: sketchRequest.planeTarget,
            planeKey: sketchRequest.planeKey,
            definition: sketchRequest.definition,
          },
        },
        {
          kind: 'commitSketch' as const,
          payload: {
            sketchId: secondSketchRequest.sketchId,
            sketchLabel: secondSketchRequest.sketchLabel,
            plane: secondSketchRequest.plane,
            planeTarget: secondSketchRequest.planeTarget,
            planeKey: secondSketchRequest.planeKey,
            definition: secondSketchRequest.definition,
          },
        },
        createDeleteTargetHistoryEntry({
          contractVersion: 'modeling-contract/v1alpha1',
          documentId: 'doc_workspace',
          baseRevisionId: 'rev_0003',
          target: { kind: 'sketch', sketchId: 'sketch_primary' },
        }),
        {
          kind: 'commitSketch' as const,
          payload: {
            sketchId: reusedSketchRequest.sketchId,
            sketchLabel: reusedSketchRequest.sketchLabel,
            plane: reusedSketchRequest.plane,
            planeTarget: reusedSketchRequest.planeTarget,
            planeKey: reusedSketchRequest.planeKey,
            definition: reusedSketchRequest.definition,
          },
        },
      ],
    }
    const service = createModelingService(createStrictReplayAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(persistedHistory),
    })

    const restoreState = await service.getHistoryRestoreState()

    assert(
      restoreState.kind === 'restored',
      'Sketch delete replay should remove deleted sketches from the cursor before resolving reused sketch ids.',
    )
    assert(restoreState.entriesReplayed === 4, 'Replay should apply create, secondary create, delete, and recreated sketch entries.')

    const snapshot = await service.getCurrentDocumentSnapshot()

    assert(
      snapshot.sketches.length === 2
        && snapshot.sketches.some((entry) => entry.sketchId === 'sketch_2')
        && snapshot.sketches.some((entry) => entry.sketchId === 'sketch_primary'),
      'Replay should recreate the allocator-compatible sketch id after deletion.',
    )
    assert(
      snapshot.sketches.find((entry) => entry.sketchId === 'sketch_primary')?.label === 'Reused Replay Sketch',
      'Replay should preserve the final reused sketch entry.',
    )
  }

  async function testSketchDeleteReplayUsesNextOrdinalAfterMiddleDelete() {
    function createRequest(
      sketchId: 'sketch_primary' | 'sketch_2' | 'sketch_3' | 'sketch_4',
      baseRevisionId: `rev_${string}`,
      label: string,
    ) {
      return {
        contractVersion: 'modeling-contract/v1alpha1',
        documentId: 'doc_workspace',
        baseRevisionId,
        solverCorrelation: {
          requestId: `request_commit_restore_gap_${sketchId}` as const,
          projectionRequestId: `request_commit_restore_gap_${sketchId}:project` as const,
          validationRequestId: `request_commit_restore_gap_${sketchId}:validate` as const,
          solveRequestId: `request_commit_restore_gap_${sketchId}:solve` as const,
          regionRequestId: `request_commit_restore_gap_${sketchId}:regions` as const,
        },
        sketchId,
        sketchLabel: label,
        plane: {
          key: 'xy',
          support: { kind: 'construction' as const, constructionId: 'construction_plane-xy' },
          frame: {
            origin: [0, 0, 0],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
            normal: [0, 0, 1],
            linearUnit: 'documentLength' as const,
            handedness: 'rightHanded' as const,
          },
        },
        planeTarget: { kind: 'construction' as const, constructionId: 'construction_plane-xy' },
        planeKey: 'xy',
        definition: createDraftSketchDefinition(sketchId),
      } satisfies CommitSketchRequest
    }

    function createHistoryEntry(request: CommitSketchRequest) {
      return {
        kind: 'commitSketch' as const,
        payload: {
          sketchId: request.sketchId,
          sketchLabel: request.sketchLabel,
          plane: request.plane,
          planeTarget: request.planeTarget,
          planeKey: request.planeKey,
          definition: request.definition,
        },
      }
    }

    const primaryRequest = createRequest('sketch_primary', 'rev_0001', 'Primary Replay Sketch')
    const secondRequest = createRequest('sketch_2', 'rev_0002', 'Second Replay Sketch')
    const thirdRequest = createRequest('sketch_3', 'rev_0003', 'Third Replay Sketch')
    const fourthRequest = createRequest('sketch_4', 'rev_0005', 'Fourth Replay Sketch')
    const persistedHistory = {
      ...createEmptyOperationHistory('doc_workspace'),
      entries: [
        createHistoryEntry(primaryRequest),
        createHistoryEntry(secondRequest),
        createHistoryEntry(thirdRequest),
        createDeleteTargetHistoryEntry({
          contractVersion: 'modeling-contract/v1alpha1',
          documentId: 'doc_workspace',
          baseRevisionId: 'rev_0004',
          target: { kind: 'sketch', sketchId: 'sketch_2' },
        }),
        createHistoryEntry(fourthRequest),
      ],
    }
    const service = createModelingService(createStrictReplayAdapter(), {
      currentDocumentId: 'doc_workspace',
      operationHistoryStore: createMemoryOperationHistoryStore(persistedHistory),
    })

    const restoreState = await service.getHistoryRestoreState()

    assert(
      restoreState.kind === 'restored',
      'Sketch delete replay should resolve allocator-compatible ids from the max remaining sketch ordinal.',
    )
    assert(restoreState.entriesReplayed === 5, 'Replay should apply all entries across the middle sketch delete.')

    const snapshot = await service.getCurrentDocumentSnapshot()

    assert(
      !snapshot.sketches.some((entry) => entry.sketchId === 'sketch_2')
        && snapshot.sketches.some((entry) => entry.sketchId === 'sketch_3')
        && snapshot.sketches.some((entry) => entry.sketchId === 'sketch_4'),
      'Replay should skip the deleted ordinal and restore the next allocated sketch id.',
    )
  }

  await testCommitSketchPersistenceNormalizesSketchIds()
  await testLegacyCommitSketchHistoryRestores()
  await testExplicitAllocatorCompatibleSketchIdsReplayDuringRestore()
  await testSketchDeleteReplayAllowsReusedAllocatorSketchId()
  await testSketchDeleteReplayUsesNextOrdinalAfterMiddleDelete()
})
