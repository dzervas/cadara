import { test } from 'bun:test'
import {
  getEditorHistoryAvailability,
  getEditorViewState,
  getEditorSelectionKey,
  type EditorEffectRuntime,
  initialEditorState,
  replayEditorEvents,
  replayEditorEventsWithRuntime,
  type SketchEditorState,
  transitionEditorState,
  type EditorEvent,
  createModelingServiceEditorEffectRuntime,
} from './state-machine'
import { createEditorRuntimeActor } from './runtime-machine'
import {
  getDefaultSelectionFilterForMode,
  primitiveRefEquals,
  type PrimitiveRef,
  type SelectionTargetCatalog,
} from '@/domain/editor/schema'
import type { ToolId } from '@/domain/tools/tool-registry'
import type { DocumentSnapshot, ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { SnapshotEntityRecord, SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type {
  ConstructionId,
  CommandSessionId,
  DocumentId,
  FeatureId,
  PickId,
  RegionId,
  RenderableId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  getSketchAnnotationDescriptors,
  getSketchSessionPreviewLabel,
  getSketchToolPresentation,
  mapSketchPointToWorld,
  patchSketchConstraintValue,
  selectSketchConstraintTarget,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import { getPreviousDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createMemoryDocumentRepository } from '@/domain/modeling/memory-document-repository'
import { createModelingService } from '@/domain/modeling/modeling-service'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createAppError, ResultAsync, type AppError } from '@/contracts/errors'

test('src/contracts/editor/state-machine.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        'sketch:sketch_a',
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
        'face:body_a:face_top',
        'body:body_a',
        'edge:body_a:edge_a',
        'edge:body_a:edge_axis',
      ],
      existingSketchKeys: ['sketch:sketch_a'],
      constructionPlaneKeys: [
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
      ],
      planarFaceKeys: ['face:body_a:face_top'],
    }
  }

  function createRegionSelectionCatalog(): SelectionTargetCatalog {
    return {
      selectableTargetKeys: [
        'sketch:sketch_a',
        'region:sketch_a:region_profile_a',
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
        'face:body_a:face_top',
        'body:body_a',
        'edge:body_a:edge_a',
        'edge:body_a:edge_axis',
      ],
      existingSketchKeys: ['sketch:sketch_a', 'region:sketch_a:region_profile_a'],
      constructionPlaneKeys: [
        'construction:construction_plane-xy',
        'construction:construction_plane-yz',
        'construction:construction_plane-xz',
      ],
      planarFaceKeys: ['face:body_a:face_top'],
    }
  }

  function createSectionSelectionSnapshot(): DocumentSnapshot {
    const base = createSnapshot()
    const plane = createStandardPlaneDefinition('xy')

    return {
      ...base,
      sketches: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: 'sketch_a',
          ownerBodyId: null,
          sketchId: 'sketch_a',
          label: 'Sketch A',
          plane,
          planeTarget: plane.support,
          planeKey: plane.key,
          sketch: {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            sketchId: 'sketch_a',
            label: 'Sketch A',
            planeSupport: plane.support,
            definition: {
              schemaVersion: 'sketch-definition/v1alpha1',
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
            solvedSnapshot: {
              schemaVersion: 'solved-sketch/v1alpha1',
              status: {
                solveState: 'solved',
                constraintState: 'underConstrained',
              },
              solvedEntities: [],
              solvedPoints: [],
              constraintStatuses: [],
              dimensionStatuses: [],
              diagnostics: [],
            },
            regions: [],
          },
        },
      ],
      document: {
        ...base.document,
        sketches: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            sketchId: 'sketch_a',
            label: 'Sketch A',
            plane,
            planeTarget: plane.support,
            planeKey: plane.key,
            sketch: {
              ownerDocumentId: 'doc_workspace',
              ownerRevisionId: 'rev_1',
              ownerFeatureId: null,
              ownerSketchId: 'sketch_a',
              ownerBodyId: null,
              sketchId: 'sketch_a',
              label: 'Sketch A',
              planeSupport: plane.support,
              definition: {
                schemaVersion: 'sketch-definition/v1alpha1',
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
              solvedSnapshot: {
                schemaVersion: 'solved-sketch/v1alpha1',
                status: {
                  solveState: 'solved',
                  constraintState: 'underConstrained',
                },
                solvedEntities: [],
                solvedPoints: [],
                constraintStatuses: [],
                dimensionStatuses: [],
                diagnostics: [],
              },
              regions: [],
            },
          },
        ],
        entities: [
          ...base.document.entities,
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: 'body_a',
            id: 'snapshot_entity_face_top' as SnapshotEntityId,
            label: 'Top face',
            target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['face', 'planarFace', 'planarReference'],
          },
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            id: 'snapshot_entity_region_a' as SnapshotEntityId,
            label: 'Sketch region',
            target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['regionProfile'],
          },
        ],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [
            {
              id: 'renderable_face_top' as RenderableId,
              label: 'Top face',
              ownerBodyId: 'body_a',
              ownerFeatureId: null,
              binding: {
                pickId: 'pick_face_top' as PickId,
                pickPriority: 8,
                target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
                topology: 'face',
                semanticClass: 'planarFace',
              },
              geometry: {
                kind: 'mesh',
                vertexPositions: [
                  [0, 0, 0],
                  [4, 0, 0],
                  [0, 4, 0],
                ],
                vertexNormals: [
                  [0, 0, 1],
                  [0, 0, 1],
                  [0, 0, 1],
                ],
                triangleIndices: [[0, 1, 2]],
              },
            },
          ],
        },
      },
      presentation: {
        ...base.presentation,
        entities: [
          ...base.presentation.entities,
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: 'body_a',
            id: 'snapshot_entity_face_top' as SnapshotEntityId,
            label: 'Top face',
            target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['face', 'planarFace', 'planarReference'],
          },
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: 'sketch_a',
            ownerBodyId: null,
            id: 'snapshot_entity_region_a' as SnapshotEntityId,
            label: 'Sketch region',
            target: { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['regionProfile'],
          },
        ],
      },
    }
  }

  function createSnapshot(): DocumentSnapshot {
    return {
      contractVersion: 'modeling-contract/v1alpha1',
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      settings: {
        linearUnit: 'millimeter',
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: ['extrude'],
        previewableFeatureKinds: ['extrude'],
        supportedProfileKinds: ['region', 'face'],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: false,
      },
      featureTree: [],
      objects: [],
      documentHistory: [],
      references: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [],
      },
      sketches: [],
      features: [],
      cursor: { kind: 'empty' },
      bodies: [],
      constructions: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: 'construction_plane-xy' as ConstructionId,
          label: 'Top Plane',
          constructionType: 'plane',
          plane: createStandardPlaneDefinition('xy'),
          target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
        },
      ],
      variables: [],
      entities: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
          label: 'Top Plane',
          target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ['constructionPlane', 'planarReference'],
        },
      ],
      diagnostics: [],
      document: {
        contractVersion: CONTRACT_VERSION,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
        settings: {
          linearUnit: 'millimeter',
          modelingTolerance: 0.001,
          angularToleranceRadians: 0.0001,
        },
        capabilities: {
          supportedFeatureKinds: ['extrude'],
          previewableFeatureKinds: ['extrude'],
          supportedProfileKinds: ['region', 'face'],
          supportsFaceBackedSketchPlanes: true,
          supportsDurableTopologyNaming: false,
        },
        featureTree: [],
        objects: [],
        features: [],
        cursor: { kind: 'empty' },
        sketches: [],
        bodies: [],
        constructions: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: 'construction_plane-xy' as ConstructionId,
            label: 'Top Plane',
            constructionType: 'plane',
            plane: createStandardPlaneDefinition('xy'),
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
          },
        ],
        variables: [],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
            label: 'Top Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
        references: [],
        diagnostics: [],
        render: {
          schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
          records: [],
        },
      },
      presentation: {
        featureTree: [],
        objects: [],
        documentHistory: [],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_xy' as SnapshotEntityId,
            label: 'Top Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
    }
  }

  async function createMockWorkspaceSnapshot() {
    const adapter = new MockKernelAdapter()
    const response = await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })

    return response.snapshot
  }

  function cloneSnapshotWithCursor(
    snapshot: DocumentSnapshot,
    cursor: DocumentSnapshot['document']['cursor'],
    revisionId: RevisionId,
  ): DocumentSnapshot {
    return {
      ...snapshot,
      revisionId,
      cursor: structuredClone(cursor),
      document: {
        ...snapshot.document,
        revisionId,
        cursor: structuredClone(cursor),
      },
    }
  }

  function createRenderRecord(id: string, featureId: FeatureId): DocumentSnapshot['document']['render']['records'][number] {
    return {
      id: id as RenderableId,
      label: id,
      ownerBodyId: null,
      ownerFeatureId: featureId,
      binding: {
        pickId: `pick_${id}` as PickId,
        pickPriority: 10,
        target: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'marker',
        position: [0, 0, 0],
        displayRadius: 1,
      },
    }
  }

  function createCursorAwareRuntime(initialSnapshot: DocumentSnapshot) {
    let snapshot = structuredClone(initialSnapshot)
    let nextRevisionSequence = 1
    const cursorMoves: {
      baseRevisionId: RevisionId
      cursor: DocumentSnapshot['document']['cursor']
      transient?: boolean
    }[] = []
    const previewCalls: {
      baseRevisionId: RevisionId
      cursor: DocumentSnapshot['document']['cursor']
    }[] = []
    const featureCommitCalls: RevisionId[] = []
    const sketchCommitCalls: RevisionId[] = []

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => snapshot,
      commitSketch: async (input) => {
        sketchCommitCalls.push(input.baseRevisionId)
        const revisionId = `rev_sketch_commit_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, snapshot.document.cursor, revisionId)

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        }
      },
      projectSketchReferences: async () => ({
        projectedReferences: [],
        diagnostics: [],
      }),
      evaluatePreview: async (input) => {
        previewCalls.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(snapshot.document.cursor),
        })

        return {
          revisionId: input.baseRevisionId,
          stale: false,
          diagnostics: [],
          renderables: [],
        }
      },
      commitFeature: async (input) => {
        featureCommitCalls.push(input.baseRevisionId)
        const revisionId = `rev_feature_commit_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, snapshot.document.cursor, revisionId)

        return {
          revisionId,
          featureId: input.featureSession.featureId ?? ('feature_created' as const),
          accepted: true,
          diagnostics: [],
        }
      },
      setDocumentCursor: async (input) => {
        cursorMoves.push({
          baseRevisionId: input.baseRevisionId,
          cursor: structuredClone(input.cursor),
          transient: input.transient,
        })
        const revisionId = `rev_cursor_${nextRevisionSequence++}` as RevisionId
        snapshot = cloneSnapshotWithCursor(snapshot, input.cursor, revisionId)

        return {
          revisionId,
          accepted: true,
          diagnostics: [],
        }
      },
    }

    return {
      runtime,
      cursorMoves,
      previewCalls,
      featureCommitCalls,
      sketchCommitCalls,
      getSnapshot: () => snapshot,
    }
  }

  async function createSketchExtrudeSketchRevolveSnapshot() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot())
    const history = snapshot.presentation.documentHistory
    const sketchItem = history.find((item) => item.kind === 'sketch')
    const extrudeItem = history.find((item) => item.kind === 'feature' && item.featureId === 'feature_extrude-1')

    if (!sketchItem || sketchItem.kind !== 'sketch' || !extrudeItem || extrudeItem.kind !== 'feature') {
      throw new Error('Mock snapshot must expose sketch and extrude history for rollback tests.')
    }

    const sketch2 = {
      ...structuredClone(snapshot.sketches[0]!),
      sketchId: 'sketch_second' as SketchId,
      ownerSketchId: 'sketch_second' as SketchId,
      label: 'Sketch 2',
      sketch: {
        ...structuredClone(snapshot.sketches[0]!.sketch),
        sketchId: 'sketch_second' as SketchId,
        ownerSketchId: 'sketch_second' as SketchId,
        label: 'Sketch 2',
      },
    }
    const revolve = {
      ...structuredClone(snapshot.features.find((feature) => feature.featureId === 'feature_extrude-1')!),
      featureId: 'feature_revolve-1',
      ownerFeatureId: 'feature_revolve-1',
      label: 'Revolve 1',
    }
    const sketch2Item = {
      ...structuredClone(sketchItem),
      id: 'document_history_item_sketch_sketch_second',
      label: 'Sketch 2',
      target: { kind: 'sketch' as const, sketchId: sketch2.sketchId },
      sketchId: sketch2.sketchId,
    }
    const revolveItem = {
      ...structuredClone(extrudeItem),
      id: 'document_history_item_feature_feature_revolve-1',
      label: 'Revolve 1',
      target: { kind: 'feature' as const, featureId: revolve.featureId },
      featureId: revolve.featureId,
    }
    const documentHistory = [
      structuredClone(sketchItem),
      structuredClone(extrudeItem),
      sketch2Item,
      revolveItem,
    ]
    const cursor = { kind: 'feature' as const, featureId: revolve.featureId }

    return {
      ...snapshot,
      cursor,
      documentHistory,
      sketches: [...snapshot.sketches, sketch2],
      features: [
        ...snapshot.features.filter((feature) => feature.featureId === 'feature_extrude-1'),
        revolve,
      ],
      document: {
        ...snapshot.document,
        cursor,
        sketches: [...snapshot.document.sketches, sketch2],
        features: [
          ...snapshot.document.features.filter((feature) => feature.featureId === 'feature_extrude-1'),
          revolve,
        ],
      },
      presentation: {
        ...snapshot.presentation,
        documentHistory,
      },
    } satisfies DocumentSnapshot
  }

  function runEventTrace(events: readonly EditorEvent[]) {
    return replayEditorEvents(events)
  }

  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  }

  function testSketchActivationEmitsCorrelatedOpenEffect() {
    const result = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    assert(result.state.kind === 'selectionCommand', 'Sketch activation should arm a selection command.')
    assert(result.state.command.commandSessionId === 'command_sketch-1', 'Sketch command session ID should be deterministic.')
    assert(result.effects.length === 0, 'Sketch without a selection should not emit an effect yet.')

    const openResult = transitionEditorState(
      {
        ...result.state,
      },
      {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
    )

    assert(openResult.effects.length === 1, 'Selecting a valid sketch plane should emit one open-session effect.')
    assert(openResult.effects[0]?.type === 'sketch.openSession', 'The emitted effect should be sketch.openSession.')
    assert(
      openResult.effects[0]?.commandSessionId === 'command_sketch-1',
      'The open-session effect must preserve the originating command session ID.',
    )
  }

  function testSketchActivationAcceptsAllPrimaryConstructionPlanes() {
    const baseState = {
      ...initialEditorState,
      document: {
        documentId: 'doc_workspace' as DocumentId,
        revisionId: 'rev_1' as RevisionId,
      },
      snapshot: createSnapshot(),
      selectionCatalog: createSelectionCatalog(),
    }

    for (const constructionId of [
      'construction_plane-xy',
      'construction_plane-yz',
      'construction_plane-xz',
    ] as const) {
      const activated = transitionEditorState(baseState, {
        type: 'tool.activated',
        toolId: 'sketch',
      })
      const openResult = transitionEditorState(activated.state, {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId },
      })

      assert(
        openResult.effects[0]?.type === 'sketch.openSession',
        `Primary construction plane ${constructionId} should emit sketch.openSession.`,
      )
    }
  }

  function testSketchActivationAcceptsPlanarFaces() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )
    const openResult = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
    })

    assert(openResult.effects.length === 1, 'Selecting a planar face should emit one open-session effect.')
    assert(openResult.effects[0]?.type === 'sketch.openSession', 'Planar-face sketch selection should open a sketch session.')
  }

  function testSectionViewActivationCollectsPlanarSeeds() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )

    assert(activated.state.kind === 'selectionCommand', 'Section View activation should arm a selection command.')
    assert(activated.state.command.toolId === 'sectionView', 'Section View activation should preserve the tool id.')
    assert(activated.effects.length === 0, 'Section View activation should stay local until a seed is selected.')

    for (const target of [
      { kind: 'construction', constructionId: 'construction_plane-xy' },
      { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      { kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' as RegionId },
    ] as const) {
      const selected = transitionEditorState(activated.state, {
        type: 'viewport.selectionRequested',
        target,
        cameraPosition: [0, 0, 20],
      })

      assert(selected.state.kind === 'inspectingSection', `Section View should accept ${target.kind} seeds.`)
      assert(selected.state.section.seed.kind === target.kind, `Section View should store the ${target.kind} seed.`)
      assert(selected.state.section.offset === 0, 'Accepted section seeds should start from the seed plane.')
      assert(selected.state.section.retainedSide === 'negative', 'Positive-Z camera should retain the opposite half-space by default.')
    }
  }

  function testSectionViewRejectsUnsupportedOrCameraLessSeeds() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )

    const invalidTarget = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_a' },
      cameraPosition: [0, 0, 20],
    })

    assert(
      invalidTarget.state.kind === 'selectionCommand',
      'Unsupported section seeds should keep the editor in seed-collection mode.',
    )

    const missingCamera = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
    })

    assert(
      missingCamera.state.kind === 'selectionCommand',
      'Section View should require viewport camera context before accepting a seed.',
    )
    assert(
      missingCamera.state.preview?.label.includes('viewport-picked'),
      'Camera-less section seed attempts should explain that viewport selection context is required.',
    )
  }

  function testSectionViewFlipAndClearPreservePlanePosition() {
    const snapshot = createSectionSelectionSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'sectionView',
      },
    )
    const selected = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_top' },
      cameraPosition: [0, 0, 20],
    })

    assert(selected.state.kind === 'inspectingSection', 'Accepted section seeds should enter active section inspection.')
    const moved = transitionEditorState(selected.state, {
      type: 'section.offsetUpdated',
      commandSessionId: selected.state.command.commandSessionId,
      offset: 7.5,
    })
    const flipped = transitionEditorState(moved.state, {
      type: 'section.flipRequested',
      commandSessionId: moved.state.kind === 'inspectingSection'
        ? moved.state.command.commandSessionId
        : ('command_unreachable' as CommandSessionId),
    })

    assert(flipped.state.kind === 'inspectingSection', 'Flipping should keep the section active.')
    assert(flipped.state.section.offset === 7.5, 'Flipping should preserve the current plane position.')
    assert(flipped.state.section.retainedSide === 'positive', 'Flipping should invert the retained half-space.')

    const cleared = transitionEditorState(flipped.state, {
      type: 'section.cleared',
      commandSessionId: flipped.state.command.commandSessionId,
    })

    assert(cleared.state.kind === 'idle', 'Clearing an active section should exit the command session.')
  }

  async function testMeasureActivationPairsSelectionsAndCleansUp() {
    const snapshot = await createMockWorkspaceSnapshot()
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
      {
        type: 'tool.activated',
        toolId: 'measure',
      },
    )

    assert(activated.state.kind === 'selectionCommand', 'Measure activation should start a transient selection command.')
    assert(activated.state.mode === 'part', 'Measure activation should force the workbench into part mode.')
    assert(activated.state.selectionFilter.label === 'Measurement targets', 'Measure activation should install the measurement selection filter.')

    const firstSelection = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
    })
    assert(firstSelection.state.selection.length === 1, 'Measure should accept a first measurable target.')

    const pairedSelection = transitionEditorState(firstSelection.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
    })
    assert(pairedSelection.state.selection.length === 2, 'Measure should pair supported two-target selections.')

    const replacedSelection = transitionEditorState(pairedSelection.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_part-1' },
    })
    assert(
      replacedSelection.state.selection.length === 1
        && replacedSelection.state.selection[0]?.kind === 'body',
      'Selecting a fresh single-target body should replace an existing pairwise measurement.',
    )

    const clearedSelection = transitionEditorState(replacedSelection.state, { type: 'selection.cleared' })
    assert(
      clearedSelection.state.kind === 'selectionCommand' && clearedSelection.state.selection.length === 0,
      'Selection clearing should remove active measurement targets without exiting the command.',
    )

    const cancelled = transitionEditorState(clearedSelection.state, {
      type: 'command.cancelled',
      commandSessionId: clearedSelection.state.command.commandSessionId,
    })
    assert(cancelled.state.kind === 'idle', 'Measure cancellation should return the editor to idle.')
  }

  function testSketchSessionPreservesStoredPlaneDefinition() {
    const yzPlane: SketchPlaneDefinition = {
      support: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: 'yz',
    }

    const session = createSketchSessionFromSnapshot({
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_1',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_yz',
      ownerBodyId: null,
      sketchId: 'sketch_yz',
      label: 'Sketch YZ',
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: 'yz',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_yz',
        ownerBodyId: null,
        sketchId: 'sketch_yz',
        label: 'Sketch YZ',
        planeSupport: yzPlane.support,
        definition: {
          schemaVersion: 'sketch-definition/v1alpha1',
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
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: {
            solveState: 'solved',
            constraintState: 'underConstrained',
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        regions: [],
      },
    })

    const worldPoint = mapSketchPointToWorld(session.plane, [2, 3])

    assert(session.plane.frame.normal[0] === 1, 'Sketch sessions should retain the stored plane definition.')
    assert(worldPoint[0] === 0 && worldPoint[1] === 2 && worldPoint[2] === 3, 'Sketch display mapping must use the stored plane definition.')
  }

  function createReopenableYzSketchSnapshot(): DocumentSnapshot {
    const yzSketchId = 'sketch_yz' as SketchId
    const yzPlane: SketchPlaneDefinition = {
      support: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, 1, 0],
        yAxis: [0, 0, 1],
        normal: [1, 0, 0],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: 'yz',
    }

    const yzSketch: SketchSnapshotRecord = {
      ownerDocumentId: 'doc_workspace' as DocumentId,
      ownerRevisionId: 'rev_1' as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      sketchId: yzSketchId,
      label: 'Sketch YZ',
      plane: yzPlane,
      planeTarget: yzPlane.support,
      planeKey: 'yz' as const,
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1',
        ownerFeatureId: null,
        ownerSketchId: yzSketchId,
        ownerBodyId: null,
        sketchId: yzSketchId,
        label: 'Sketch YZ',
        planeSupport: yzPlane.support,
        definition: {
            schemaVersion: 'sketch-definition/v1alpha1',
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
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: {
            solveState: 'solved',
            constraintState: 'underConstrained',
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

    const yzSketchEntity: SnapshotEntityRecord = {
      ownerDocumentId: 'doc_workspace' as DocumentId,
      ownerRevisionId: 'rev_1' as RevisionId,
      ownerFeatureId: null,
      ownerSketchId: yzSketchId,
      ownerBodyId: null,
      id: 'snapshot_entity_sketch_yz' as SnapshotEntityId,
      label: 'Sketch YZ',
      target: { kind: 'sketch' as const, sketchId: yzSketchId },
      relatedTargets: [],
      contributingFeatureIds: [],
      consumedByFeatureIds: [],
      selectionSemantics: ['existingSketch'] as const,
    }
    const yzHistoryItem = {
      id: 'document_history_item_sketch_sketch_yz',
      label: 'Sketch YZ',
      description: 'Authored sketch',
      kind: 'sketch' as const,
      target: { kind: 'sketch' as const, sketchId: yzSketchId },
      sketchId: yzSketchId,
      featureId: null,
    }

    const baseSnapshot = createSnapshot()

    return {
      ...baseSnapshot,
      cursor: { kind: 'sketch', sketchId: yzSketchId },
      documentHistory: [yzHistoryItem],
      sketches: [
        ...baseSnapshot.sketches,
        yzSketch,
      ],
      document: {
        ...baseSnapshot.document,
        cursor: { kind: 'sketch', sketchId: yzSketchId },
        sketches: [
          ...baseSnapshot.document.sketches,
          yzSketch,
        ],
        entities: [
          ...baseSnapshot.document.entities,
          yzSketchEntity,
        ],
      },
      entities: [
        ...baseSnapshot.entities,
        yzSketchEntity,
      ],
      presentation: {
        ...baseSnapshot.presentation,
        documentHistory: [yzHistoryItem],
        entities: [
          ...baseSnapshot.presentation.entities,
          yzSketchEntity,
        ],
      },
    }
  }

  function testFeaturePreviewIgnoresStaleResponseIds() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'extrude',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Extrude activation should enter feature editing.')
    assert(activation.effects.length === 1, 'Extrude activation should emit a preview effect.')
    assert(activation.effects[0]?.type === 'feature.evaluatePreview', 'The emitted effect should be feature.evaluatePreview.')

    const staleIgnored = transitionEditorState(activation.state, {
      type: 'effect.featurePreviewCompleted',
      requestId: 'request_feature-preview-stale',
      documentId: 'doc_workspace',
      commandSessionId: 'command_extrude-1',
      baseRevisionId: 'rev_1',
      revisionId: 'rev_1',
      stale: false,
      diagnostics: [],
      renderables: [],
    })

    assert(
      staleIgnored.state === activation.state,
      'A preview response with the wrong request ID must be ignored.',
    )
  }

  function testRevolveActivationStartsFeaturePreviewFlow() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'region', sketchId: 'sketch_a', regionId: 'region_profile_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'revolve',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Revolve activation should enter feature editing.')
    assert(activation.state.session.featureType === 'revolve', 'Revolve activation should create a revolve session.')
    assert(activation.effects.length === 0, 'Revolve activation without an axis should stay local until the draft is complete.')

    const completed = transitionEditorState(activation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_axis' },
    })

    assert(completed.state.kind === 'editingFeature', 'Revolve selection updates should remain in feature editing.')
    assert(completed.effects.length === 1, 'Selecting the missing revolve axis should emit one preview effect.')
    assert(completed.effects[0]?.type === 'feature.evaluatePreview', 'Completed revolve drafts should request a preview effect.')
  }

  function testRevolveActivationSupportsFaceThenEdgeSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...createRegionSelectionCatalog(),
          selectableTargetKeys: [
            ...createRegionSelectionCatalog().selectableTargetKeys,
            'face:body_a:face_side',
            'body:body_b',
          ],
        },
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'revolve',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Face-selected revolve activation should enter feature editing.')
    assert(activation.state.session.featureType === 'revolve', 'Face-selected revolve activation should create a revolve session.')
    assert(
      activation.state.session.draft.profileTargets[0]?.kind === 'face',
      'Face-selected revolve activation should keep the selected face as the revolve profile.',
    )
    assert(activation.effects.length === 0, 'Face-selected revolve activation should wait for an axis before previewing.')

    const completed = transitionEditorState(activation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_axis' },
    })

    assert(completed.state.kind === 'editingFeature', 'Revolve face-then-edge flow should remain in feature editing.')
    assert(completed.state.session.featureType === 'revolve', 'Revolve face-then-edge flow should preserve the revolve session kind.')
    assert(
      completed.state.session.draft.axisTarget?.kind === 'edge',
      'Revolve face-then-edge flow should preserve the selected edge as the axis target.',
    )
    assert(completed.effects.length === 1, 'Selecting the axis after a face profile should emit one preview effect.')
    assert(completed.effects[0]?.type === 'feature.evaluatePreview', 'Completed face-then-edge revolve drafts should request a preview effect.')
  }

  function testShellActivationSeedsBodyFromSelectedFace() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')
    assert(activation.state.session.featureType === 'shell', 'Shell activation should create a shell session.')
    assert(activation.state.session.draft.bodyTarget?.bodyId === 'body_a', 'Shell activation should infer the source body from a selected face.')
    assert(activation.effects.length === 1, 'Shell activation with a face target should emit one preview effect.')
    assert(activation.effects[0]?.type === 'feature.evaluatePreview', 'Shell activation should request a preview effect.')
  }

  function testThickenActivationSeedsFaceTargetsFromSelection() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'thicken',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Thicken activation should enter feature editing.')
    assert(activation.state.session.featureType === 'thicken', 'Thicken activation should create a thicken session.')
    assert(
      activation.state.session.draft.faceTargets[0]?.faceId === 'face_top',
      'Thicken activation should seed the selected face into the draft.',
    )
    assert(activation.effects.length === 1, 'Thicken activation with a face target should emit one preview effect.')
    assert(activation.effects[0]?.type === 'feature.evaluatePreview', 'Thicken activation should request a preview effect.')
  }

  function testSplitAndDeleteSolidActivationStartFeatureSessions() {
    const combineCatalog = createRegionSelectionCatalog()
    const combineActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...combineCatalog,
          selectableTargetKeys: [...combineCatalog.selectableTargetKeys, 'body:body_b'],
        },
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'combine',
      },
    )

    assert(combineActivation.state.kind === 'editingFeature', 'Combine activation should enter feature editing.')
    assert(combineActivation.state.session.featureType === 'combine', 'Combine activation should create a combine session.')
    assert(
      combineActivation.state.session.draft.targetBodyTargets[0]?.bodyId === 'body_a',
      'Combine activation should seed the selected body as a target body.',
    )
    assert(combineActivation.effects.length === 0, 'Combine activation should wait for explicit tool bodies before previewing.')

    const combineToolSelection = transitionEditorState(combineActivation.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_b' },
    })

    assert(
      combineToolSelection.state.kind === 'editingFeature' &&
        combineToolSelection.state.session.featureType === 'combine' &&
        combineToolSelection.state.session.draft.toolBodyTargets[0]?.bodyId === 'body_b',
      'Combine body selection should fill explicit tool bodies after the target role is populated.',
    )
    assert(combineToolSelection.effects[0]?.type === 'feature.evaluatePreview', 'Complete Combine drafts should request a preview effect.')

    const splitActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'split',
      },
    )

    assert(splitActivation.state.kind === 'editingFeature', 'Split activation should enter feature editing.')
    assert(splitActivation.state.session.featureType === 'split', 'Split activation should create a split session.')
    assert(
      splitActivation.state.session.draft.targetBodyTarget?.bodyId === 'body_a',
      'Split activation should seed the selected body as the target body.',
    )
    assert(splitActivation.effects.length === 0, 'Split activation should wait for the tool body before previewing.')

    const deleteSolidActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'deleteSolid',
      },
    )

    assert(deleteSolidActivation.state.kind === 'editingFeature', 'Delete-solid activation should enter feature editing.')
    assert(deleteSolidActivation.state.session.featureType === 'deleteSolid', 'Delete-solid activation should create a delete-solid session.')
    assert(
      deleteSolidActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a',
      'Delete-solid activation should seed the selected body into the delete list.',
    )
    assert(deleteSolidActivation.effects.length === 1, 'Delete-solid activation with a selected body should emit one preview effect.')
    assert(deleteSolidActivation.effects[0]?.type === 'feature.evaluatePreview', 'Delete-solid activation should request a preview effect.')
  }

  function testMirrorAndTransformActivationStartFeatureSessions() {
    const mirrorActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'mirror',
      },
    )

    assert(mirrorActivation.state.kind === 'editingFeature', 'Mirror activation should enter feature editing.')
    assert(mirrorActivation.state.session.featureType === 'mirror', 'Mirror activation should create a mirror session.')
    assert(mirrorActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a', 'Mirror activation should seed the selected body as a mirror target.')
    assert(mirrorActivation.effects.length === 0, 'Mirror activation should wait for an explicit plane before previewing.')

    const transformActivation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'body', bodyId: 'body_a' }],
      },
      {
        type: 'tool.activated',
        toolId: 'transform',
      },
    )

    assert(transformActivation.state.kind === 'editingFeature', 'Transform activation should enter feature editing.')
    assert(transformActivation.state.session.featureType === 'transform', 'Transform activation should create a transform session.')
    assert(transformActivation.state.session.draft.bodyTargets[0]?.bodyId === 'body_a', 'Transform activation should seed the selected body as a transform target.')
    assert(transformActivation.effects.length === 0, 'Transform activation should wait for an explicit transform reference before previewing.')
  }

  function testActiveReferencePickerRoutesSingleAndMultiSelections() {
    const catalog = createRegionSelectionCatalog()
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: {
          ...catalog,
          selectableTargetKeys: [
            ...catalog.selectableTargetKeys,
            'face:body_a:face_side',
            'body:body_b',
          ],
        },
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')

    const facesActive = transitionEditorState(activation.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-faces',
    })

    assert(facesActive.state.kind === 'editingFeature', 'Reference picker activation should stay in feature editing.')
    assert(
      facesActive.state.activeReferencePickerFieldId === 'shell-faces',
      'Reference picker activation should track the active form field id.',
    )
    assert(
      facesActive.state.selectionFilter?.label === 'Shell faces',
      'Reference picker activation should switch to the field selection filter.',
    )

    const faceAppended = transitionEditorState(facesActive.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_side' },
    })

    assert(faceAppended.state.kind === 'editingFeature', 'Multi-reference selection should stay in feature editing.')
    assert(
      faceAppended.state.session.featureType === 'shell' && faceAppended.state.session.draft.faceTargets.length === 2,
      'Active multi-reference picker selection should append unique selected instances.',
    )

    const bodyActive = transitionEditorState(faceAppended.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-body',
    })

    assert(bodyActive.state.kind === 'editingFeature', 'Switching active picker fields should stay in feature editing.')
    assert(
      bodyActive.state.activeReferencePickerFieldId === 'shell-body',
      'Switching active picker fields should update the active field id.',
    )
    assert(
      bodyActive.state.selectionFilter?.label === 'Shell body',
      'Switching active picker fields should update the current selection filter.',
    )

    const bodySelected = transitionEditorState(bodyActive.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'body', bodyId: 'body_b' },
    })

    assert(bodySelected.state.kind === 'editingFeature', 'Single-reference selection should stay in feature editing.')
    assert(
      bodySelected.state.session.featureType === 'shell' && bodySelected.state.session.draft.bodyTarget?.bodyId === 'body_b',
      'Active single-reference picker selection should replace the bound reference.',
    )
  }

  function testReferencePickerCancellationAndSessionCleanup() {
    const activation = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        selectionCatalog: createRegionSelectionCatalog(),
        selection: [{ kind: 'face', bodyId: 'body_a', faceId: 'face_top' }],
      },
      {
        type: 'tool.activated',
        toolId: 'shell',
      },
    )

    assert(activation.state.kind === 'editingFeature', 'Shell activation should enter feature editing.')

    const active = transitionEditorState(activation.state, {
      type: 'form.referencePickerActivated',
      fieldId: 'shell-faces',
    })

    assert(active.state.kind === 'editingFeature', 'Reference picker activation should stay in feature editing.')

    const escaped = transitionEditorState(active.state, {
      type: 'form.referencePickerCancelled',
    })

    assert(escaped.state.kind === 'editingFeature', 'Escape cancellation should not cancel the whole feature session.')
    assert(escaped.state.activeReferencePickerFieldId === null, 'Escape cancellation should clear the active picker field.')
    assert(escaped.state.selection.length === 0, 'Escape cancellation should clear picker-specific pending selection.')
    assert(
      escaped.state.selectionFilter?.label === 'Shell references',
      'Escape cancellation should restore the feature-level selection filter.',
    )

    const cancelled = transitionEditorState(active.state, {
      type: 'command.cancelled',
      commandSessionId: active.state.command.commandSessionId,
    })

    assert(cancelled.state.kind === 'idle', 'Feature session cancellation should leave feature editing.')

    const switched = transitionEditorState(active.state, {
      type: 'tool.activated',
      toolId: 'fillet',
    })

    assert(switched.state.kind === 'editingFeature', 'Switching to another feature tool should enter the new feature session.')
    assert(
      switched.state.activeReferencePickerFieldId === null,
      'Switching to another feature session should clear active picker state.',
    )
  }

  function testSelectionClearEventClearsSelectionAndPreservesActiveState() {
    const selectedTarget = { kind: 'body', bodyId: 'body_a' } as PrimitiveRef
    const hoverTarget = { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' } as PrimitiveRef
    const selectedState = {
      ...initialEditorState,
      document: {
        documentId: 'doc_workspace' as const,
        revisionId: 'rev_1' as const,
      },
      snapshot: createSnapshot(),
      selection: [selectedTarget],
      hoverTarget,
      selectionCatalog: createSelectionCatalog(),
    }

    const idleCleared = transitionEditorState(selectedState, { type: 'selection.cleared' })

    assert(idleCleared.state.kind === 'idle', 'Selection clearing should keep idle state idle.')
    assert(idleCleared.state.selection.length === 0, 'Selection clearing should remove idle selection.')
    assert(idleCleared.state.hoverTarget === null, 'Selection clearing should remove idle hover.')

    const commandStarted = transitionEditorState(selectedState, {
      type: 'tool.activated',
      toolId: 'sketch',
    })

    assert(commandStarted.state.kind === 'selectionCommand', 'Sketch activation should create a selection command.')

    const commandCleared = transitionEditorState(commandStarted.state, { type: 'selection.cleared' })

    assert(commandCleared.state.kind === 'selectionCommand', 'Selection clearing should preserve active command state.')
    assert(
      commandCleared.state.command.commandSessionId === commandStarted.state.command.commandSessionId,
      'Selection clearing should preserve the active command session.',
    )
    assert(commandCleared.state.selection.length === 0, 'Selection clearing should remove active-command selection.')
    assert(commandCleared.state.hoverTarget === null, 'Selection clearing should remove active-command hover.')

    const sketchSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const sketchState: SketchEditorState = {
      ...selectedState,
      kind: 'editingSketch',
      mode: 'sketch',
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(sketchSession),
        target: sketchSession.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session: sketchSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
    }

    const sketchCleared = transitionEditorState(sketchState, { type: 'selection.cleared' })

    assert(sketchCleared.state.kind === 'editingSketch', 'Selection clearing should preserve sketch editing state.')
    assert(
      sketchCleared.state.command.commandSessionId === sketchState.command.commandSessionId,
      'Selection clearing should preserve the sketch command session.',
    )
    assert(sketchCleared.state.selection.length === 0, 'Selection clearing should remove sketch selection.')
    assert(sketchCleared.state.hoverTarget === null, 'Selection clearing should remove sketch hover.')
  }

  function testReplayIsDeterministic() {
    const snapshot = createSnapshot()
    const payload = {
      requestId: 'request_snapshot-1' as const,
      documentId: snapshot.documentId,
      revisionId: snapshot.revisionId,
      snapshot,
      selectionCatalog: createSelectionCatalog(),
    }

    const events: EditorEvent[] = [
      { type: 'session.started' },
      { type: 'effect.snapshotLoaded', payload },
      { type: 'tool.activated', toolId: 'sketch' },
      {
        type: 'viewport.selectionRequested',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
    ]

    const first = runEventTrace(events)
    const second = runEventTrace(events)

    assert(
      JSON.stringify(first.state) === JSON.stringify(second.state),
      'Replaying the same event trace should reach the same machine state.',
    )
    assert(
      JSON.stringify(first.effects) === JSON.stringify(second.effects),
      'Replaying the same event trace should emit the same effect sequence.',
    )
  }

  function testDirectSnapshotLoadUpdatesDocumentWithoutFetch() {
    const initialSnapshot = createSnapshot()
    const loadedState = {
      ...initialEditorState,
      document: {
        documentId: initialSnapshot.documentId,
        revisionId: initialSnapshot.revisionId,
      },
      snapshot: initialSnapshot,
      selectionCatalog: buildSelectionTargetCatalog(initialSnapshot),
    }
    const nextSnapshot = structuredClone(initialSnapshot)
    nextSnapshot.revisionId = 'rev_2'
    nextSnapshot.document.revisionId = 'rev_2'

    const loaded = transitionEditorState(loadedState, {
      type: 'document.snapshotLoaded',
      snapshot: nextSnapshot,
    })

    assert(loaded.effects.length === 0, 'Direct snapshot loads should not request another snapshot fetch.')
    assert(loaded.state.snapshot?.revisionId === 'rev_2', 'Direct snapshot loads should update visible snapshot state immediately.')
    assert(loaded.state.document.revisionId === 'rev_2', 'Direct snapshot loads should update the editor document revision.')
  }

  function testSelectionKeyUsesDurableRefs() {
    const key = getEditorSelectionKey({ kind: 'feature', featureId: 'feature_alpha' })
    assert(key === 'feature:feature_alpha', 'Selection key derivation should remain deterministic.')
  }

  async function testRuntimeLoopProcessesSketchOpen() {
    const runtimeSnapshot: DocumentSnapshot = createSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'Runtime loop should enter sketch editing after opening a sketch session.')
    assert(
      result.state.session.planeTarget.kind === 'construction',
      'Opened sketch session should preserve the selected construction plane.',
    )
    assert(
      result.state.command.commandSessionId === 'command_sketch-1',
      'Runtime loop should preserve the originating command session ID.',
    )
  }

  async function testRuntimeLoopOpensSketchFromPlanarFace() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot()
    const planarFace = runtimeSnapshot.document.render.records.find((record) =>
      record.binding.target.kind === 'face'
      && record.binding.semanticClass === 'planarFace',
    )?.binding.target
    assert(planarFace?.kind === 'face', 'Mock runtime snapshot should expose a planar face render target.')

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: runtimeSnapshot.documentId,
            revisionId: runtimeSnapshot.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: planarFace,
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'Runtime loop should enter sketch editing after selecting a planar face.')
    assert(result.state.session.planeTarget.kind === 'face', 'Face-backed sketch session should preserve the selected face support.')
    assert(result.state.session.plane.support.kind === 'face', 'Face-backed sketch session should derive a face-supported plane.')
    assert(result.state.session.plane.frame.origin[2] === 12, 'Face-backed sketch plane should derive its origin from the selected face mesh.')
  }

  async function testRuntimeLoopOpensSketchFromNonXYConstruction() {
    const runtimeSnapshot: DocumentSnapshot = {
      ...createSnapshot(),
      constructions: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          constructionId: 'construction_plane-yz' as ConstructionId,
          label: 'Right Plane',
          constructionType: 'plane',
          plane: createStandardPlaneDefinition('yz'),
          target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
        },
      ],
      document: {
        ...createSnapshot().document,
        constructions: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            constructionId: 'construction_plane-yz' as ConstructionId,
            label: 'Right Plane',
            constructionType: 'plane',
            plane: createStandardPlaneDefinition('yz'),
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
          },
        ],
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
            label: 'Right Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
      entities: [
        {
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_1',
          ownerFeatureId: null,
          ownerSketchId: null,
          ownerBodyId: null,
          id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
          label: 'Right Plane',
          target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
          relatedTargets: [],
          contributingFeatureIds: [],
          consumedByFeatureIds: [],
          selectionSemantics: ['constructionPlane', 'planarReference'],
        },
      ],
      presentation: {
        ...createSnapshot().presentation,
        entities: [
          {
            ownerDocumentId: 'doc_workspace',
            ownerRevisionId: 'rev_1',
            ownerFeatureId: null,
            ownerSketchId: null,
            ownerBodyId: null,
            id: 'snapshot_entity_plane_yz' as SnapshotEntityId,
            label: 'Right Plane',
            target: { kind: 'construction', constructionId: 'construction_plane-yz' as ConstructionId },
            relatedTargets: [],
            contributingFeatureIds: [],
            consumedByFeatureIds: [],
            selectionSemantics: ['constructionPlane', 'planarReference'],
          },
        ],
      },
    }
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: createSelectionCatalog(),
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'construction', constructionId: 'construction_plane-yz' },
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'YZ construction plane should also open a sketch session.')
    assert(result.state.session.plane.key === 'yz', 'Sketch session should preserve the selected YZ plane definition.')
  }

  async function testRuntimeLoopReopensStoredSketchPlane() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [...createSelectionCatalog().selectableTargetKeys, 'sketch:sketch_yz'],
              existingSketchKeys: ['sketch:sketch_a', 'sketch:sketch_yz'],
            },
          },
        },
        { type: 'tool.activated', toolId: 'sketch' },
        {
          type: 'viewport.selectionRequested',
          target: { kind: 'sketch', sketchId: 'sketch_yz' },
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'Existing sketches should reopen into the sketch editor.')
    assert(result.state.session.sketchId === 'sketch_yz', 'Reopened sketch sessions should preserve the sketch identity.')
    assert(result.state.session.plane.key === 'yz', 'Reopened sketch sessions should preserve the stored sketch plane.')
  }

  async function testRuntimeLoopReopensCommittedFeatureFromExplicitIntent() {
    const runtimeSnapshot = await createMockWorkspaceSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: runtimeSnapshot.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: runtimeSnapshot.revisionId,
        featureId: 'feature_extrude-1' as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: runtimeSnapshot.revisionId,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: runtimeSnapshot.documentId,
            revisionId: runtimeSnapshot.revisionId,
            snapshot: runtimeSnapshot,
            selectionCatalog: buildSelectionTargetCatalog(runtimeSnapshot),
          },
        },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingFeature', 'Committed feature reopen should enter feature editing.')
    assert(result.state.session.mode === 'edit', 'Committed feature reopen should hydrate an edit session.')
    assert(result.state.session.featureId === 'feature_extrude-1', 'Committed feature reopen should preserve the feature identity.')
  }

  async function testRuntimeLoopReopensSketchFromExplicitIntent() {
    const runtimeSnapshot = createReopenableYzSketchSnapshot()
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => runtimeSnapshot,
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: 'rev_1' as const,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: 'rev_1' as const,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
      setDocumentCursor: async () => ({
        revisionId: 'rev_1' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: 'request_snapshot-1',
            documentId: 'doc_workspace',
            revisionId: 'rev_1',
            snapshot: runtimeSnapshot,
            selectionCatalog: {
              ...createSelectionCatalog(),
              selectableTargetKeys: [...createSelectionCatalog().selectableTargetKeys, 'sketch:sketch_yz'],
              existingSketchKeys: ['sketch:sketch_a', 'sketch:sketch_yz'],
            },
          },
        },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_yz' },
          toolId: 'sketch',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'Committed sketch reopen should enter sketch editing.')
    assert(result.state.session.sketchId === 'sketch_yz', 'Committed sketch reopen should preserve the sketch identity.')
    assert(result.state.session.plane.key === 'yz', 'Committed sketch reopen should preserve the stored sketch plane.')
  }

  async function testFeatureEditEntryRollsBackBeforeHydrationFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves, previewCalls } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingFeature', 'Feature reopen should enter editing after rollback.')
    assert(cursorMoves.length === 1, 'Feature reopen should move the document cursor before hydration.')
    assert(cursorMoves[0]?.cursor.kind === 'sketch', 'Editing extrude should roll back to the preceding sketch.')
    assert(cursorMoves[0]?.transient === true, 'Edit-entry rollback should be transient.')
    assert(
      result.state.snapshot?.document.cursor.kind === 'sketch',
      'Feature edit snapshot should be refreshed at the rollback cursor.',
    )
    assert(previewCalls.length === 1, 'Feature edit preview should run after rollback snapshot refresh.')
    assert(
      previewCalls[0]?.cursor.kind === 'sketch',
      'Feature edit preview should evaluate against the rolled-back document basis.',
    )
  }

  async function testSketchEditEntryRollsBackBeforeOpenFromTail() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'editingSketch', 'Committed sketch reopen should enter sketch editing.')
    assert(cursorMoves.length === 1, 'Sketch reopen should move the document cursor before opening.')
    assert(
      cursorMoves[0]?.cursor.kind === 'feature' && cursorMoves[0].cursor.featureId === 'feature_extrude-1',
      'Editing sketch2 should roll back to the preceding extrude.',
    )
    assert(
      result.state.snapshot?.document.cursor.kind === 'feature'
        && result.state.snapshot.document.cursor.featureId === 'feature_extrude-1',
      'Sketch edit snapshot should remain at the document rollback cursor.',
    )
    assert(
      result.state.session.historyCursor.kind !== 'empty',
      'Reopened sketch editing should preserve sketch-local history while the document is rolled back.',
    )
  }

  async function testFeatureEditCancelRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.cancelled',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'idle', 'Feature edit cancel should return to idle.')
    assert(cursorMoves.length === 2, 'Feature edit cancel should restore the captured entry cursor.')
    assert(
      cursorMoves[1]?.cursor.kind === 'feature' && cursorMoves[1].cursor.featureId === 'feature_revolve-1',
      'Feature edit cancel should restore the captured tail cursor.',
    )
  }

  async function testFeatureEditCommitRestoresNonTailCursor() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const entryCursor = { kind: 'sketch' as const, sketchId: 'sketch_second' as SketchId }
    const snapshot = cloneSnapshotWithCursor(tailSnapshot, entryCursor, tailSnapshot.revisionId)
    const { runtime, cursorMoves, featureCommitCalls } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.commitRequested',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'idle', 'Feature edit commit should return to idle after restore.')
    assert(featureCommitCalls.length === 1, 'Feature edit commit should submit the hydrated edit session.')
    assert(cursorMoves.length === 2, 'Feature edit commit should restore the captured entry cursor.')
    assert(
      cursorMoves[1]?.cursor.kind === 'sketch' && cursorMoves[1].cursor.sketchId === 'sketch_second',
      'Feature edit commit should restore the captured non-tail cursor instead of the history tail.',
    )
  }

  async function testSketchAbortRestoresTailCursor() {
    const snapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
        {
          type: 'command.cancelled',
          commandSessionId: 'command_sketch-1',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'idle', 'Sketch abort should return to idle.')
    assert(cursorMoves.length === 2, 'Sketch abort should restore the captured entry cursor.')
    assert(
      cursorMoves[1]?.cursor.kind === 'feature' && cursorMoves[1].cursor.featureId === 'feature_revolve-1',
      'Sketch abort should restore the captured tail cursor.',
    )
  }

  async function testFinishSketchRestoresNonTailCursor() {
    const tailSnapshot = await createSketchExtrudeSketchRevolveSnapshot()
    const entryCursor = { kind: 'sketch' as const, sketchId: 'sketch_second' as SketchId }
    const snapshot = cloneSnapshotWithCursor(tailSnapshot, entryCursor, tailSnapshot.revisionId)
    const { runtime, cursorMoves } = createCursorAwareRuntime(snapshot)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'sketch', sketchId: 'sketch_second' },
          toolId: 'sketch',
        },
        {
          type: 'tool.activated',
          toolId: 'finishSketch',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'idle', 'Finish sketch should return to idle after restore.')
    assert(cursorMoves.length === 2, 'Finish sketch should restore the captured entry cursor.')
    const sketchCommitIndex = result.effects.findIndex((effect) => effect.type === 'sketch.commit')
    const restoreFetchIndex = result.effects.findIndex(
      (effect, index) => index > sketchCommitIndex && effect.type === 'document.fetchSnapshot',
    )
    const restoreCursorIndex = result.effects.findIndex(
      (effect, index) => index > restoreFetchIndex && effect.type === 'document.moveHistoryCursor',
    )
    assert(
      sketchCommitIndex >= 0 && restoreFetchIndex > sketchCommitIndex && restoreCursorIndex > restoreFetchIndex,
      'Finish sketch should refresh the committed snapshot before restoring the entry cursor.',
    )
    assert(
      cursorMoves[1]?.cursor.kind === 'sketch' && cursorMoves[1].cursor.sketchId === 'sketch_second',
      'Finish sketch should restore the captured non-tail cursor instead of the history tail.',
    )
  }

  async function testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore() {
    const documentRepository = createMemoryDocumentRepository()
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: 'doc_workspace',
      documentRepository,
    })
    const runtime = createModelingServiceEditorEffectRuntime(service)

    const result = await replayEditorEventsWithRuntime(
      [
        { type: 'session.started' },
        {
          type: 'authoring.reopenRequested',
          target: { kind: 'feature', featureId: 'feature_extrude-1' },
          toolId: 'extrude',
        },
        {
          type: 'command.commitRequested',
          commandSessionId: 'command_extrude-1',
        },
      ],
      runtime,
    )

    assert(result.state.kind === 'idle', 'Repository-backed feature edit commit should exit after cursor restore.')
    assert(
      result.state.snapshot?.document.cursor.kind === 'feature'
        && result.state.snapshot.document.cursor.featureId === 'feature_fillet-1',
      'Repository-backed feature edit commit should restore the tail cursor captured at edit entry.',
    )
    assert(
      result.state.preview?.label !== 'The authored document changed after the current snapshot was loaded. Refresh before retrying this mutation.',
      'Edit-exit cursor restore should not run against stale repository provenance.',
    )
  }

  async function testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict() {
    const snapshot = structuredClone(await createMockWorkspaceSnapshot())
    snapshot.provenance = {
      repositoryHeads: ['head_a'],
      repositorySource: 'peer',
    }
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot)
    assert(previousCursor, 'Repository cursor fixture should expose a previous cursor.')

    const boot = transitionEditorState(initialEditorState, { type: 'session.started' })
    const fetchEffect = boot.effects[0]
    assert(fetchEffect?.type === 'document.fetchSnapshot', 'Session start should fetch a snapshot.')
    const loaded = transitionEditorState(boot.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: fetchEffect.requestId,
        documentId: snapshot.documentId,
        revisionId: snapshot.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
    })
    const requested = transitionEditorState(loaded.state, {
      type: 'document.historyCursorRequested',
      cursor: previousCursor,
    })
    const cursorEffect = requested.effects[0]

    assert(cursorEffect?.type === 'document.moveHistoryCursor', 'Timeline cursor requests should emit the document cursor effect.')
    assert(
      cursorEffect.mutationBasis.baseRevisionId === snapshot.revisionId
        && cursorEffect.mutationBasis.baseRepositoryHeads?.[0] === 'head_a',
      'Document cursor effects should carry the loaded snapshot repository basis.',
    )
    assert(
      !getEditorHistoryAvailability(requested.state).canUndo && !getEditorHistoryAvailability(requested.state).canRedo,
      'Document history actions should be unavailable while the cursor mutation is pending.',
    )

    const conflicted = transitionEditorState(requested.state, {
      type: 'effect.documentCursorMoved',
      requestId: cursorEffect.requestId,
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
      revisionId: 'rev_9999',
      accepted: false,
      actualRevisionId: 'rev_9999',
      diagnostics: [{
        code: 'repository-head-conflict',
        severity: 'error',
        message: 'The authored document changed after the current snapshot was loaded.',
        target: null,
        detail: null,
      }],
    })

    assert(conflicted.effects[0]?.type === 'document.fetchSnapshot', 'Repository cursor conflicts should request a refresh.')
    assert(conflicted.state.pendingHistoryCursorRequestId === null, 'Repository cursor conflicts should clear the pending cursor request.')
    assert(conflicted.state.pendingSnapshotRequestId === conflicted.effects[0]?.requestId, 'Conflict refresh should be tracked as pending.')
  }

  function testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics() {
    const previous = createSnapshot()
    const featureId = 'feature_broken' as FeatureId
    const previousRender = createRenderRecord('render_previous', featureId)
    previous.document.render.records = [previousRender]
    previous.render = previous.document.render

    const loaded = transitionEditorState(initialEditorState, {
      type: 'document.snapshotLoaded',
      snapshot: previous,
    })
    const refresh = transitionEditorState(loaded.state, { type: 'document.refreshRequested' })
    const effect = refresh.effects[0]
    assert(effect?.type === 'document.fetchSnapshot', 'Refresh should request a document snapshot.')

    const next = structuredClone(previous)
    next.revisionId = 'rev_2'
    next.document.revisionId = 'rev_2'
    next.document.render = {
      ...next.document.render,
      records: [createRenderRecord('render_failed_rebuild', featureId)],
    }
    next.render = next.document.render
    next.document.diagnostics = [{
      code: 'occ-missing-reference',
      severity: 'error',
      message: 'Extrude profile selection is incorrect.',
      featureId,
      fieldId: 'profiles',
      fieldPath: ['parameters', 'profiles'],
      repairGuidance: 'Edit Extrude and choose a valid profile selection.',
      target: { kind: 'region', sketchId: 'sketch_missing' as SketchId, regionId: 'region_missing' as RegionId },
      detail: null,
    }]
    next.diagnostics = next.document.diagnostics

    const failedRefresh = transitionEditorState(refresh.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: effect.requestId,
        documentId: next.documentId,
        revisionId: next.revisionId,
        snapshot: next,
        selectionCatalog: buildSelectionTargetCatalog(next),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    })

    assert(
      failedRefresh.state.snapshot?.document.render.records[0]?.id === previousRender.id,
      'Feature-scoped failed refreshes should preserve previous viewport render records.',
    )
    assert(
      failedRefresh.state.snapshot?.document.diagnostics[0]?.featureId === featureId,
      'Feature-scoped failed refreshes should still expose the new repair diagnostic.',
    )
    assert(
      failedRefresh.state.snapshot?.revisionId === 'rev_2',
      'Render preservation should not roll back the authored snapshot revision.',
    )

    const fixed = structuredClone(next)
    fixed.revisionId = 'rev_3'
    fixed.document.revisionId = 'rev_3'
    fixed.document.diagnostics = []
    fixed.diagnostics = []
    fixed.document.render = {
      ...fixed.document.render,
      records: [createRenderRecord('render_fixed', featureId)],
    }
    fixed.render = fixed.document.render
    const secondRefresh = transitionEditorState(failedRefresh.state, { type: 'document.refreshRequested' })
    const secondEffect = secondRefresh.effects[0]
    assert(secondEffect?.type === 'document.fetchSnapshot', 'Second refresh should request a document snapshot.')
    const fixedRefresh = transitionEditorState(secondRefresh.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: secondEffect.requestId,
        documentId: fixed.documentId,
        revisionId: fixed.revisionId,
        snapshot: fixed,
        selectionCatalog: buildSelectionTargetCatalog(fixed),
        preserveRenderRecordsOnFeatureDiagnostics: true,
      },
    })

    assert(
      fixedRefresh.state.snapshot?.document.render.records[0]?.id === 'render_fixed',
      'Successful corrected refreshes should swap in the new render records.',
    )
    assert(
      fixedRefresh.state.snapshot?.document.diagnostics.length === 0,
      'Corrected refreshes should clear feature diagnostics.',
    )
  }

  async function testXStateRuntimeBootstrapsAndLoadsSnapshot() {
    const snapshot = createSnapshot()
    let snapshotCallCount = 0
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => {
        snapshotCallCount += 1
        return snapshot
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const actor = createEditorRuntimeActor(runtime)

    actor.start()
    await flushAsyncWork()

    const machineState = actor.getSnapshot().context.machineState

    assert(snapshotCallCount === 1, 'The XState runtime should bootstrap the initial snapshot load itself.')
    assert(machineState.document.documentId === snapshot.documentId, 'Bootstrap should hydrate the document id.')
    assert(machineState.document.revisionId === snapshot.revisionId, 'Bootstrap should hydrate the revision id.')
    assert(machineState.snapshot?.revisionId === snapshot.revisionId, 'Bootstrap should store the loaded snapshot.')
    actor.stop()
  }

  async function testXStateRuntimeCancelsObsoleteSketchOpenEffects() {
    const snapshot = createSnapshot()
    let snapshotCallCount = 0
    let resolveOpenSnapshot: ((value: DocumentSnapshot) => void) | null = null

    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: () => {
        snapshotCallCount += 1

        if (snapshotCallCount === 1) {
          return Promise.resolve(snapshot)
        }

        return new Promise<DocumentSnapshot>((resolve) => {
          resolveOpenSnapshot = resolve
        })
      },
      commitSketch: async () => null,
      evaluatePreview: async () => ({
        revisionId: snapshot.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }),
      commitFeature: async () => ({
        revisionId: snapshot.revisionId,
        featureId: 'feature_alpha' as const,
        accepted: true,
        diagnostics: [],
      }),
    }

    const actor = createEditorRuntimeActor(runtime)

    actor.start()
    await flushAsyncWork()
    actor.send({ type: 'tool.activated', toolId: 'sketch' })
    actor.send({
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    await flushAsyncWork()

    const selectionState = actor.getSnapshot().context.machineState
    assert(selectionState.kind === 'selectionCommand', 'Sketch activation should reach the selection workflow before opening.')

    actor.send({
      type: 'command.cancelled',
      commandSessionId: selectionState.command.commandSessionId,
    })

    const pendingOpenSnapshotResolver = resolveOpenSnapshot as ((value: DocumentSnapshot) => void) | null

    if (pendingOpenSnapshotResolver) {
      pendingOpenSnapshotResolver(snapshot)
    }
    await flushAsyncWork()

    const cancelledState = actor.getSnapshot().context.machineState

    assert(cancelledState.kind === 'idle', 'Cancelling sketch selection should return the runtime to idle.')
    actor.stop()
  }

  function testSketchToolClearStaysInSketchEditing() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })

    const openEffect = openRequested.effects[0]

    assert(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })

    assert(opened.state.kind === 'editingSketch', 'Sketch open fixture should enter sketch editing.')

    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    assert(withTool.state.kind === 'editingSketch', 'Sketch tool activation should stay in sketch editing.')
    assert(withTool.state.session.activeTool === 'line', 'Sketch tool activation should mark the active tool.')

    const cleared = transitionEditorState(withTool.state, {
      type: 'sketch.activeToolCleared',
    })

    assert(cleared.state.kind === 'editingSketch', 'Clearing an active sketch tool should keep the sketch session open.')
    assert(cleared.state.session.activeTool === null, 'Clearing an active sketch tool should remove the active tool.')
    assert(cleared.state.command.toolId === 'sketch', 'Clearing an active sketch tool should restore sketch-session command identity.')
  }

  function testRemainingSketchToolsActivateWithoutDroppingSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    const openEffect = openRequested.effects[0]

    assert(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })
    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    assert(withTool.state.kind === 'editingSketch', 'Sketch tool fixture should enter sketch editing.')

    const activeSketchToolIds = [
      ['spline', 'spline'],
      ['dimension', 'dimensionDistance'],
      ['trim', 'trim'],
      ['offset', 'offset'],
    ] as const satisfies readonly (readonly [ToolId, string])[]

    for (const [toolId, expectedActiveTool] of activeSketchToolIds) {
      const result = transitionEditorState(withTool.state, {
        type: 'tool.activated',
        toolId,
      })
      const viewState = getEditorViewState(result.state)

      assert(result.effects.length === 0, `${toolId} should not emit effects while editing a sketch.`)
      assert(result.state.kind === 'editingSketch', `${toolId} should keep the editor in sketch editing.`)
      assert(result.state.mode === 'sketch', `${toolId} should keep sketch toolbar mode.`)
      assert(viewState.sketchSession !== null, `${toolId} should keep the sketch session visible to the UI.`)
      assert(viewState.mode === 'sketch', `${toolId} should keep sketch view mode.`)
      assert(result.state.command.toolId === toolId, `${toolId} should replace the active sketch command.`)
      assert(result.state.session.activeTool === expectedActiveTool, `${toolId} should activate its sketch workflow.`)
    }
  }

  function testPassiveSketchStyleToolsDoNotDropSketchSession() {
    const activated = transitionEditorState(
      {
        ...initialEditorState,
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selectionCatalog: createSelectionCatalog(),
      },
      {
        type: 'tool.activated',
        toolId: 'sketch',
      },
    )

    const openRequested = transitionEditorState(activated.state, {
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    const openEffect = openRequested.effects[0]

    assert(openEffect?.type === 'sketch.openSession', 'Sketch fixture should emit an open-session effect.')

    const opened = transitionEditorState(openRequested.state, {
      type: 'effect.sketchSessionOpened',
      requestId: openEffect.requestId,
      documentId: 'doc_workspace',
      revisionId: 'rev_1',
      commandSessionId: openEffect.commandSessionId,
      session: createNewSketchSession(createStandardPlaneDefinition('xy')),
    })
    const withTool = transitionEditorState(opened.state, {
      type: 'tool.activated',
      toolId: 'line',
    })

    assert(withTool.state.kind === 'editingSketch', 'Sketch tool fixture should enter sketch editing.')

    const passiveSketchToolIds = [
      'fill',
      'stroke',
    ] as const satisfies readonly ToolId[]

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(withTool.state, {
        type: 'tool.activated',
        toolId,
      })
      const viewState = getEditorViewState(result.state)

      assert(result.effects.length === 0, `${toolId} should not emit effects while editing a sketch.`)
      assert(result.state.kind === 'editingSketch', `${toolId} should keep the editor in sketch editing.`)
      assert(result.state.mode === 'sketch', `${toolId} should keep sketch toolbar mode.`)
      assert(viewState.sketchSession !== null, `${toolId} should keep the sketch session visible to the UI.`)
      assert(viewState.mode === 'sketch', `${toolId} should keep sketch view mode.`)
      assert(result.state.command.toolId === 'line', `${toolId} should not replace the active sketch command.`)
      assert(result.state.session.activeTool === 'line', `${toolId} should not clear the active sketch tool.`)
      assert(result.state.session.activeStyleFocus?.toolId === toolId, `${toolId} should open style focus state.`)
      assert(result.state.session.activeStyleFocus.target === null, `${toolId} should show target guidance without a selection.`)
      assert(
        getSketchToolPresentation(result.state.session)?.selectionGuide?.requiredCount === 1,
        `${toolId} should expose style target guidance.`,
      )
    }

    let styledSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
    styledSession = beginSketchTool(styledSession, 'line')
    styledSession = startSketchDraw(styledSession, [0, 0])
    styledSession = acceptSketchDraw(styledSession, [8, 0])

    const target = styledSession.definition.entities[0]?.target
    assert(target, 'Style focus fixture should create a selectable local sketch entity.')

    const styledBaseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: target,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(styledSession),
        target: styledSession.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-style-1',
        toolId: 'line',
        phase: 'editing',
      },
      session: styledSession,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
    }

    for (const toolId of passiveSketchToolIds) {
      const result = transitionEditorState(styledBaseState, {
        type: 'tool.activated',
        toolId,
      })

      assert(result.state.kind === 'editingSketch', `${toolId} with a target should keep sketch editing.`)
      assert(result.state.session.activeStyleFocus?.toolId === toolId, `${toolId} should become the active style focus.`)
      if (toolId === 'stroke') {
        assert(result.state.session.activeStyleFocus.target?.kind === 'sketchEntity', `${toolId} should bind the selected style target.`)
        assert(
          (getSketchToolPresentation(result.state.session)?.controlGroups?.[0]?.controls.length ?? 0) > 0,
          `${toolId} should expose focused style controls for the selected target.`,
        )
      } else {
        assert(result.state.session.activeStyleFocus.target === null, `${toolId} should reject a non-region style target.`)
        assert(
          getSketchToolPresentation(result.state.session)?.selectionGuide?.acceptedKinds.includes('region'),
          `${toolId} should request an enclosed region target.`,
        )
      }
    }
  }

  function createConstraintAuthoringEditorState(toolId: 'dimensionDistance' | 'dimensionHorizontal' = 'dimensionDistance'): {
    state: SketchEditorState
    pointTarget: PrimitiveRef
    secondPointTarget: PrimitiveRef
    lineTarget: PrimitiveRef
  } {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, toolId)

    const pointTarget = session.definition.points[0]?.target
    const secondPointTarget = session.definition.points[1]?.target
    const lineTarget = session.definition.entities[0]?.target

    assert(pointTarget, 'Constraint routing fixture should create a selectable sketch point.')
    assert(secondPointTarget, 'Constraint routing fixture should create a second selectable sketch point.')
    assert(lineTarget, 'Constraint routing fixture should create a selectable sketch entity.')

    return {
      pointTarget,
      secondPointTarget,
      lineTarget,
      state: {
        ...initialEditorState,
        kind: 'editingSketch',
        mode: 'sketch',
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode('sketch'),
        selectionCatalog: null,
        preview: {
          kind: 'sketch',
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: `command_${toolId}-1` as CommandSessionId,
          toolId,
          phase: 'editing',
        },
        session,
        pendingCommitRequestId: null,
      },
    }
  }

  function testConstraintAuthoringReceivesViewportHoverAndSelection() {
    const { state, pointTarget } = createConstraintAuthoringEditorState()

    const hovered = transitionEditorState(state, {
      type: 'viewport.hovered',
      target: pointTarget,
    })

    assert(hovered.state.kind === 'editingSketch', 'Hover fixture should remain in sketch editing.')
    assert(
      hovered.state.session.constraintAuthoring?.hoverTarget?.target &&
        primitiveRefEquals(hovered.state.session.constraintAuthoring.hoverTarget.target, pointTarget),
      'Active constraint authoring should record valid viewport hover targets.',
    )

    const selected = transitionEditorState(hovered.state, {
      type: 'viewport.selectionRequested',
      target: pointTarget,
    })

    assert(selected.state.kind === 'editingSketch', 'Selection fixture should remain in sketch editing.')
    assert(
      selected.state.session.constraintAuthoring?.selectedTargets.length === 1 &&
        primitiveRefEquals(selected.state.session.constraintAuthoring.selectedTargets[0]!.target, pointTarget),
      'Active constraint authoring should record valid viewport click targets.',
    )
  }

  function testDimensionSelectionClickPinsReadyValuePreview() {
    const { state, pointTarget, secondPointTarget, lineTarget } = createConstraintAuthoringEditorState()

    const selectedFirst = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: pointTarget,
    })
    assert(selectedFirst.state.kind === 'editingSketch', 'First dimension target selection should keep sketch editing.')

    const selectedSecond = transitionEditorState(selectedFirst.state, {
      type: 'viewport.selectionRequested',
      target: secondPointTarget,
    })
    assert(selectedSecond.state.kind === 'editingSketch', 'Second dimension target selection should keep sketch editing.')

    const moved = transitionEditorState(selectedSecond.state, {
      type: 'sketch.pointerMoved',
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [5, 3]),
    })
    assert(moved.state.kind === 'editingSketch', 'Pointer movement over ready dimension preview should keep sketch editing.')

    const clickedGeometry = transitionEditorState(moved.state, {
      type: 'viewport.selectionRequested',
      target: lineTarget,
    })

    assert(clickedGeometry.state.kind === 'editingSketch', 'Dimension placement click fixture should keep sketch editing.')
    assert(
      clickedGeometry.state.session.constraintAuthoring?.isPreviewPinned === true
        && clickedGeometry.state.session.constraintAuthoring.selectedTargets.length === 2,
      'Clicking geometry while a value-backed dimension is ready should pin placement instead of replacing operands.',
    )
    assert(
      getSketchToolPresentation(clickedGeometry.state.session)?.floatingInput?.label === 'Distance',
      'Pinning placement from a target click should open the floating value-entry input.',
    )
  }

  function testDimensionReleaseOverSecondLineDefersToAngleSelection() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [5, -5])
    session = acceptSketchDraw(session, [5, 5])
    session = beginSketchTool(session, 'dimensionDistance')

    const [firstLineTarget, secondLineTarget] = session.definition.entities.map((entity) => entity.target)
    assert(firstLineTarget && secondLineTarget, 'Angle dimension release fixture should create two selectable lines.')

    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_dimension-angle-release-1' as CommandSessionId,
        toolId: 'dimensionDistance',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
    }

    const selectedFirst = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: firstLineTarget,
    })
    assert(selectedFirst.state.kind === 'editingSketch', 'First line selection should keep sketch editing.')

    const releaseOverSecond = transitionEditorState(selectedFirst.state, {
      type: 'sketch.pointerReleased',
      point: mapSketchPointToWorld(selectedFirst.state.session.plane, [5, 0]),
      target: secondLineTarget,
    })
    assert(releaseOverSecond.state.kind === 'editingSketch', 'Release over second line should keep sketch editing.')
    assert(
      releaseOverSecond.state.session.constraintAuthoring?.isPreviewPinned === false
        && releaseOverSecond.state.session.constraintAuthoring.selectedTargets.length === 1,
      'Pointer release over a selectable second line should not pin the first line length preview before click selection.',
    )

    const selectedSecond = transitionEditorState(releaseOverSecond.state, {
      type: 'viewport.selectionRequested',
      target: secondLineTarget,
    })
    assert(selectedSecond.state.kind === 'editingSketch', 'Second line selection should keep sketch editing.')

    let anglePreview = getSketchToolPresentation(selectedSecond.state.session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    assert(
      selectedSecond.state.session.constraintAuthoring?.selectedTargets.length === 2
        && anglePreview?.kind === 'angleArc',
      'Selecting the second non-parallel line should preserve the two-line angle preview.',
    )

    const moved = transitionEditorState(selectedSecond.state, {
      type: 'sketch.pointerMoved',
      point: mapSketchPointToWorld(selectedSecond.state.session.plane, [8, 3]),
    })
    assert(moved.state.kind === 'editingSketch', 'Pointer movement after angle selection should keep sketch editing.')
    anglePreview = getSketchToolPresentation(moved.state.session)?.overlays?.find((overlay) => overlay.kind === 'angleArc')
    const lengthPreview = getSketchToolPresentation(moved.state.session)?.overlays?.find(
      (overlay) => overlay.kind === 'dimensionLine' && overlay.referenceKind === 'lineLength',
    )
    assert(
      anglePreview?.kind === 'angleArc' && !lengthPreview,
      'Pointer movement after two selected lines should not fall back to the first line length dimension.',
    )

    const placed = transitionEditorState(moved.state, {
      type: 'sketch.pointerReleased',
      point: mapSketchPointToWorld(moved.state.session.plane, [4, -1]),
      target: null,
    })
    assert(placed.state.kind === 'editingSketch', 'Angle placement click should keep sketch editing.')
    assert(
      placed.state.session.constraintAuthoring?.isPreviewPinned === true
        && getSketchToolPresentation(placed.state.session)?.floatingInput?.label === 'Angle',
      'Clicking the primary viewport after angle preview should pin placement and keep the value entry open.',
    )
  }

  function testConstraintAuthoringIgnoresInvalidViewportSelection() {
    const { state, lineTarget } = createConstraintAuthoringEditorState('dimensionHorizontal')

    const selected = transitionEditorState(state, {
      type: 'viewport.selectionRequested',
      target: lineTarget,
    })

    assert(selected.state.kind === 'editingSketch', 'Invalid constraint selection fixture should remain in sketch editing.')
    assert(
      selected.state.session.constraintAuthoring?.selectedTargets.length === 0,
      'Dimension point authoring should ignore viewport clicks on rejected sketch entity targets.',
    )
  }

  function createConnectedSelectionEditorState(): {
    state: SketchEditorState
    localTarget: PrimitiveRef
    projectedTarget: PrimitiveRef
  } {
    const sketchId = 'sketch_draft' as SketchId
    const pointA = 'sketch_point_a' as SketchPointId
    const pointB = 'sketch_point_b' as SketchPointId
    const pointC = 'sketch_point_c' as SketchPointId
    const entityAB = 'sketch_entity_ab' as SketchEntityId
    const entityBC = 'sketch_entity_bc' as SketchEntityId
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [pointA, pointB, pointC],
      points: [
        {
          pointId: pointA,
          label: 'A',
          target: { kind: 'sketchPoint', sketchId, pointId: pointA },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: pointB,
          label: 'B',
          target: { kind: 'sketchPoint', sketchId, pointId: pointB },
          position: [1, 0],
          isConstruction: false,
        },
        {
          pointId: pointC,
          label: 'C',
          target: { kind: 'sketchPoint', sketchId, pointId: pointC },
          position: [2, 0],
          isConstruction: false,
        },
      ],
      entityIds: [entityAB, entityBC],
      entities: [
        {
          kind: 'lineSegment',
          entityId: entityAB,
          label: 'AB',
          target: { kind: 'sketchEntity', sketchId, entityId: entityAB },
          isConstruction: false,
          startPointId: pointA,
          endPointId: pointB,
        },
        {
          kind: 'lineSegment',
          entityId: entityBC,
          label: 'BC',
          target: { kind: 'sketchEntity', sketchId, entityId: entityBC },
          isConstruction: false,
          startPointId: pointB,
          endPointId: pointC,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
    const session = {
      ...createNewSketchSession(createStandardPlaneDefinition('xy')),
      sketchId,
      definition,
      fullDefinition: definition,
    }
    const localTarget = definition.entities[0]!.target
    const projectedTarget: PrimitiveRef = {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_projected',
      geometryId: 'projected_geometry_line',
      geometryKind: 'lineSegment',
    }

    return {
      localTarget,
      projectedTarget,
      state: {
        ...initialEditorState,
        kind: 'editingSketch',
        mode: 'sketch',
        document: {
          documentId: 'doc_workspace',
          revisionId: 'rev_1',
        },
        snapshot: createSnapshot(),
        selection: [],
        hoverTarget: null,
        selectionFilter: getDefaultSelectionFilterForMode('sketch'),
        selectionCatalog: null,
        preview: {
          kind: 'sketch',
          label: getSketchSessionPreviewLabel(session),
          target: session.planeTarget,
        },
        command: {
          commandSessionId: 'command_sketch-connected-selection-1',
          toolId: 'sketch',
          phase: 'editing',
        },
        session,
        pendingCommitRequestId: null,
        pendingProjectionRequestId: null,
      },
    }
  }

  function testConnectedSketchSelectionEventUpdatesNormalSelectionState() {
    const { state, localTarget } = createConnectedSelectionEditorState()
    const selected = transitionEditorState(state, {
      type: 'sketch.connectedSelectionRequested',
      target: localTarget,
    })

    assert(selected.state.kind === 'editingSketch', 'Connected selection should stay in sketch editing.')
    assert(
      selected.state.selection.length === 2
        && selected.state.selection.every((target) => target.kind === 'sketchEntity'),
      'Connected selection should update the normal editor selection with the connected sketch entities.',
    )
  }

  function testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 3])
    const localTarget = session.definition.entities[0]?.target
    assert(localTarget, 'Rectangle fixture should create a selectable sketch entity.')

    const selected = transitionEditorState({
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-connected-rectangle-1',
        toolId: 'rectangle',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
      pendingProjectionRequestId: null,
    }, {
      type: 'sketch.connectedSelectionRequested',
      target: localTarget,
    })

    assert(selected.state.kind === 'editingSketch', 'Connected rectangle selection should stay in sketch editing.')
    assert(
      selected.state.selection.length === 4
        && selected.state.selection.every((target) => target.kind === 'sketchEntity'),
      'Double-clicking one accepted rectangle edge while Rectangle remains active should select all four rectangle edges.',
    )
  }

  function testConnectedSketchSelectionEventRejectsUnsupportedTargets() {
    const { state, projectedTarget } = createConnectedSelectionEditorState()
    const selected = transitionEditorState(state, {
      type: 'sketch.connectedSelectionRequested',
      target: projectedTarget,
    })

    assert(selected.state.kind === 'editingSketch', 'Unsupported connected selection should stay in sketch editing.')
    assert(selected.state.selection.length === 0, 'Projected reference geometry should not expand through the connected selection event.')
  }

  function testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 1])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 6])

    const [firstLineId, secondLineId] = session.definition.entityIds
    assert(firstLineId && secondLineId, 'Annotation deletion fixture should create two sketch lines.')

    session = beginSketchTool(session, 'constraintParallel')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: firstLineId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_draft',
      entityId: secondLineId,
    })

    const annotation = getSketchAnnotationDescriptors(session)[0]
    assert(annotation, 'Annotation deletion fixture should create a committed annotation descriptor.')

    const selected = transitionEditorState({
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-annotation-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }, {
      type: 'viewport.selectionRequested',
      target: annotation.target,
    })

    assert(selected.state.kind === 'editingSketch', 'Selecting an annotation should stay in sketch editing.')
    assert(
      selected.state.session.selectedAnnotation
        && primitiveRefEquals(selected.state.session.selectedAnnotation, annotation.target),
      'Viewport annotation selection should select the durable annotation target.',
    )
    assert(
      selected.state.session.definition.constraintIds.length === 1,
      'Selecting an annotation should not select or delete affected geometry.',
    )

    const deleted = transitionEditorState(selected.state, { type: 'sketch.annotationDeleteRequested' })

    assert(deleted.state.kind === 'editingSketch', 'Deleting an annotation should stay in sketch editing.')
    assert(
      deleted.state.session.definition.constraintIds.length === 0,
      'Annotation deletion should remove the durable constraint record from sketch state.',
    )
    assert(
      deleted.state.session.commitRequest?.definition.constraintIds.length === 0,
      'Annotation deletion should update the durable sketch commit request.',
    )
  }

  function testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 5])
    session = acceptSketchDraw(session, [10, 5])

    const [firstPointId, , , diagonalPointId] = session.definition.pointIds
    assert(firstPointId && diagonalPointId, 'Annotation edit fixture should create selectable sketch points.')

    session = beginSketchTool(session, 'dimensionDistance')
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: firstPointId,
    })
    session = selectSketchConstraintTarget(session, {
      kind: 'sketchPoint',
      sketchId: 'sketch_draft',
      pointId: diagonalPointId,
    })
    session = patchSketchConstraintValue(session, { value: 24 })
    session = patchSketchConstraintValue(session, { intent: 'commitConstraintValue' })

    const annotation = getSketchAnnotationDescriptors(session).find((entry) => entry.target.kind === 'dimension')
    assert(annotation?.target.kind === 'dimension', 'Annotation edit fixture should create a committed dimension annotation.')

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-annotation-edit-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }

    const opened = transitionEditorState(baseState, {
      type: 'sketch.annotationEditRequested',
      target: annotation.target,
    })

    assert(opened.state.kind === 'editingSketch', 'Annotation edit request should stay in sketch editing.')
    assert(
      opened.state.session.activeAnnotationEdit?.target.kind === 'dimension',
      'Annotation edit request should open a committed dimension edit session.',
    )
    assert(
      opened.state.session.toolPresentation?.floatingInput?.value === 24,
      'Committed dimension edit form should open with the durable dimension value.',
    )

    const changed = transitionEditorState(opened.state, {
      type: 'sketch.toolPatched',
      patch: { value: 33 },
    })
    const committed = transitionEditorState(changed.state, {
      type: 'sketch.toolPatched',
      patch: { intent: 'commitAnnotationValue' },
    })

    assert(committed.state.kind === 'editingSketch', 'Committed dimension edit should stay in sketch editing.')
    assert(
      committed.state.session.definition.dimensions[0]?.kind === 'distance'
        && committed.state.session.definition.dimensions[0].value === 33,
      'Committed dimension edit should update the existing durable dimension record.',
    )
  }

  function testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [8, 0])

    const target = session.definition.entities[0]?.target
    assert(target, 'Style patch routing fixture should create a selectable local sketch entity.')

    const baseState: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [target],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-style-patch-1',
        toolId: 'line',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }

    const patched = transitionEditorState(baseState, {
      type: 'sketch.toolPatched',
      patch: { intent: 'patchSketchStyle', field: 'strokeColor', value: '#ff00ff' },
    })

    assert(patched.state.kind === 'editingSketch', 'Sketch style patch event should remain in sketch editing.')
    assert(
      patched.state.session.definition.entities[0]?.style?.strokeColor === '#ff00ff',
      'Sketch style patch should update the selected local entity style via sketch.toolPatched routing.',
    )
    assert(
      patched.state.session.commitRequest?.definition.entities[0]?.style?.strokeColor === '#ff00ff',
      'Sketch style patch should rebuild the durable commit request payload.',
    )
  }

  function testRejectedSketchCommitShowsValidationMessage() {
    const session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    const diagnostic: ModelingDiagnostic = {
      code: 'mock-invalid-sketch',
      severity: 'error',
      message: 'Sketch solve ended with residual 12.',
      target: null,
      detail: null,
    }
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      snapshot: createSnapshot(),
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-commit-1',
        toolId: 'finishSketch',
        phase: 'awaitingEffect',
      },
      session,
      pendingCommitRequestId: 'request_sketch-commit-1',
    }

    const rejected = transitionEditorState(state, {
      type: 'effect.sketchCommitted',
      requestId: 'request_sketch-commit-1',
      documentId: 'doc_workspace',
      commandSessionId: 'command_sketch-commit-1',
      baseRevisionId: 'rev_1',
      revisionId: 'rev_1',
      accepted: false,
      diagnostics: [diagnostic],
    })

    assert(rejected.state.kind === 'editingSketch', 'Rejected sketch commit should keep the sketch open.')
    assert(
      rejected.state.session.validationMessage === diagnostic.message,
      'Rejected sketch commit diagnostics should surface in the visible sketch validation message.',
    )
  }

  function testSketchCommitConflictRefreshesBeforeRetry() {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [8, 0])
    assert(session.commitRequest, 'Sketch conflict fixture should have a commit payload.')

    const staleSnapshot = createSnapshot()
    staleSnapshot.revisionId = 'rev_0001'
    staleSnapshot.document.revisionId = 'rev_0001'
    const diagnostic: ModelingDiagnostic = {
      code: 'occ-revision-conflict',
      severity: 'error',
      message: 'Request revision rev_0001 does not match current revision rev_0002.',
      target: null,
      detail: {
        kind: 'revisionConflict',
        expectedRevisionId: 'rev_0001',
        actualRevisionId: 'rev_0002',
      },
    }
    const state: SketchEditorState = {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_0001',
      },
      snapshot: staleSnapshot,
      selection: [],
      hoverTarget: null,
      selectionFilter: getDefaultSelectionFilterForMode('sketch'),
      selectionCatalog: null,
      preview: {
        kind: 'sketch',
        label: getSketchSessionPreviewLabel(session),
        target: session.planeTarget,
      },
      command: {
        commandSessionId: 'command_sketch-commit-1',
        toolId: 'finishSketch',
        phase: 'awaitingEffect',
      },
      session,
      pendingCommitRequestId: 'request_sketch-commit-1',
    }

    const conflicted = transitionEditorState(state, {
      type: 'effect.sketchCommitted',
      requestId: 'request_sketch-commit-1',
      documentId: 'doc_workspace',
      commandSessionId: 'command_sketch-commit-1',
      baseRevisionId: 'rev_0001',
      revisionId: 'rev_0002',
      accepted: false,
      actualRevisionId: 'rev_0002',
      diagnostics: [diagnostic],
    })

    const refreshEffect = conflicted.effects[0]
    assert(refreshEffect?.type === 'document.fetchSnapshot', 'Sketch commit conflicts should request a snapshot refresh.')
    assert(conflicted.state.kind === 'editingSketch', 'Sketch commit conflicts should keep the sketch open.')
    assert(conflicted.state.document.revisionId === 'rev_0002', 'Sketch commit conflicts should advance the editor revision.')
    assert(conflicted.state.pendingSnapshotRequestId === refreshEffect.requestId, 'Conflict refresh should be tracked as pending.')

    const refreshedSnapshot = createSnapshot()
    refreshedSnapshot.revisionId = 'rev_0002'
    refreshedSnapshot.document.revisionId = 'rev_0002'
    const refreshed = transitionEditorState(conflicted.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: refreshEffect.requestId,
        documentId: refreshedSnapshot.documentId,
        revisionId: refreshedSnapshot.revisionId,
        snapshot: refreshedSnapshot,
        selectionCatalog: buildSelectionTargetCatalog(refreshedSnapshot),
      },
    })
    const retry = transitionEditorState(refreshed.state, {
      type: 'tool.activated',
      toolId: 'finishSketch',
    })
    const retryEffect = retry.effects[0]

    assert(retryEffect?.type === 'sketch.commit', 'Retrying Finish Sketch should emit another sketch commit.')
    assert(retryEffect.baseRevisionId === 'rev_0002', 'Sketch commit retries should use the refreshed revision.')
  }

  async function testModelingServiceRuntimePreservesResultRejections() {
    const appError = createAppError({
      code: 'modeling/diagnostic',
      message: 'The authored document changed after the current snapshot was loaded.',
      context: [
        { key: 'diagnosticCode', value: 'repository-head-conflict' },
        { key: 'reasonCode', value: 'repositoryChanged' },
        { key: 'diagnosticCount', value: 2 },
        { key: 'diagnosticCodes', value: 'feature-warning,repository-head-conflict' },
        { key: 'actualRevisionId', value: 'rev_2' },
      ],
    })
    const runtime = createModelingServiceEditorEffectRuntime({
      async getCurrentDocumentSnapshot() {
        return createSnapshot()
      },
      async projectSketchExternalReferences() {
        return { projectedReferences: [], diagnostics: [] }
      },
      sketchSolver: null,
      commitSketch() {
        throw new Error('Sketch commit is not used by this test.')
      },
      evaluatePreview() {
        throw new Error('Feature preview is not used by this test.')
      },
      createFeature() {
        throw new Error('Feature create is not used by this test.')
      },
      updateFeature() {
        throw new Error('Feature update is not used by this test.')
      },
      setFeatureCursor() {
        return ResultAsync.fromPromise(Promise.reject(appError), (error) => error as AppError)
      },
    })

    assert(runtime.setDocumentCursor, 'Modeling service runtime should expose document cursor mutation.')
    const rejected = await runtime.setDocumentCursor({
      baseRevisionId: 'rev_1',
      cursor: { kind: 'feature', featureId: 'feature_a' },
    })

    assert(!rejected.accepted, 'Modeling service Result Errs should become typed rejected mutation results.')
    assert(rejected.revisionId === 'rev_2', 'Rejected mutation results should retain actual revision ids.')
    assert(
      rejected.diagnostics[0]?.code === 'repository-head-conflict',
      'Rejected mutation diagnostics should retain the modeling diagnostic code.',
    )
    assert(
      rejected.errorContext?.some((entry) => entry.key === 'diagnosticCodes' && entry.value === 'feature-warning,repository-head-conflict'),
      'Rejected mutation results should retain structured modeling error context.',
    )
  }

  testSketchActivationEmitsCorrelatedOpenEffect()
  testSketchActivationAcceptsAllPrimaryConstructionPlanes()
  testSketchActivationAcceptsPlanarFaces()
  testSectionViewActivationCollectsPlanarSeeds()
  testSectionViewRejectsUnsupportedOrCameraLessSeeds()
  testSectionViewFlipAndClearPreservePlanePosition()
  await testMeasureActivationPairsSelectionsAndCleansUp()
  testSketchSessionPreservesStoredPlaneDefinition()
  testFeaturePreviewIgnoresStaleResponseIds()
  testRevolveActivationStartsFeaturePreviewFlow()
  testRevolveActivationSupportsFaceThenEdgeSelection()
  testShellActivationSeedsBodyFromSelectedFace()
  testThickenActivationSeedsFaceTargetsFromSelection()
  testSplitAndDeleteSolidActivationStartFeatureSessions()
  testMirrorAndTransformActivationStartFeatureSessions()
  testActiveReferencePickerRoutesSingleAndMultiSelections()
  testReferencePickerCancellationAndSessionCleanup()
  testSelectionClearEventClearsSelectionAndPreservesActiveState()
  testSketchToolClearStaysInSketchEditing()
  testRemainingSketchToolsActivateWithoutDroppingSketchSession()
  testPassiveSketchStyleToolsDoNotDropSketchSession()
  testConstraintAuthoringReceivesViewportHoverAndSelection()
  testDimensionSelectionClickPinsReadyValuePreview()
  testDimensionReleaseOverSecondLineDefersToAngleSelection()
  testConstraintAuthoringIgnoresInvalidViewportSelection()
  testConnectedSketchSelectionEventUpdatesNormalSelectionState()
  testConnectedSketchSelectionEventWorksAfterRectangleToolAcceptsShape()
  testConnectedSketchSelectionEventRejectsUnsupportedTargets()
  testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation()
  testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm()
  testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest()
  testRejectedSketchCommitShowsValidationMessage()
  testSketchCommitConflictRefreshesBeforeRetry()
  await testModelingServiceRuntimePreservesResultRejections()
  testReplayIsDeterministic()
  testDirectSnapshotLoadUpdatesDocumentWithoutFetch()
  testSelectionKeyUsesDurableRefs()
  await testRuntimeLoopProcessesSketchOpen()
  await testRuntimeLoopOpensSketchFromPlanarFace()
  await testRuntimeLoopOpensSketchFromNonXYConstruction()
  await testRuntimeLoopReopensStoredSketchPlane()
  await testRuntimeLoopReopensCommittedFeatureFromExplicitIntent()
  await testRuntimeLoopReopensSketchFromExplicitIntent()
  await testFeatureEditEntryRollsBackBeforeHydrationFromTail()
  await testSketchEditEntryRollsBackBeforeOpenFromTail()
  await testFeatureEditCancelRestoresTailCursor()
  await testFeatureEditCommitRestoresNonTailCursor()
  await testSketchAbortRestoresTailCursor()
  await testFinishSketchRestoresNonTailCursor()
  await testRepositoryBackedFeatureEditCommitRefreshesBeforeRestore()
  await testDocumentCursorRequestUsesSnapshotBasisAndRefreshesOnConflict()
  testSnapshotRefreshCanPreserveRenderRecordsForFeatureDiagnostics()
  await testXStateRuntimeBootstrapsAndLoadsSnapshot()
  await testXStateRuntimeCancelsObsoleteSketchOpenEffects()
})
