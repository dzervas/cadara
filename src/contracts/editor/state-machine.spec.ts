import { test } from 'bun:test'
import {
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
  DocumentId,
  RevisionId,
  SketchId,
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
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
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
      consumedByFeatureIds: [],
      selectionSemantics: ['existingSketch'] as const,
    }

    const baseSnapshot = createSnapshot()

    return {
      ...baseSnapshot,
      sketches: [
        ...baseSnapshot.sketches,
        yzSketch,
      ],
      document: {
        ...baseSnapshot.document,
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
      'fillType',
      'fillSolid',
      'fillGradient',
      'strokeOptions',
      'strokeWidth',
      'strokeCap',
      'strokeJoin',
      'strokeMiter',
      'strokeDash',
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
      assert(result.state.session.activeStyleFocus.target?.kind === 'sketchEntity', `${toolId} should bind the selected style target.`)
      assert(
        (getSketchToolPresentation(result.state.session)?.controlGroups?.[0]?.controls.length ?? 0) > 0,
        `${toolId} should expose focused style controls for the selected target.`,
      )
    }
  }

  function createConstraintAuthoringEditorState(): {
    state: SketchEditorState
    pointTarget: PrimitiveRef
    lineTarget: PrimitiveRef
  } {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [10, 0])
    session = beginSketchTool(session, 'dimensionDistance')

    const pointTarget = session.definition.points[0]?.target
    const lineTarget = session.definition.entities[0]?.target

    assert(pointTarget, 'Constraint routing fixture should create a selectable sketch point.')
    assert(lineTarget, 'Constraint routing fixture should create a selectable sketch entity.')

    return {
      pointTarget,
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
          commandSessionId: 'command_dimensionDistance-1',
          toolId: 'dimensionDistance',
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

  function testConstraintAuthoringIgnoresInvalidViewportSelection() {
    const { state, lineTarget } = createConstraintAuthoringEditorState()

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
  testConstraintAuthoringIgnoresInvalidViewportSelection()
  testCommittedAnnotationSelectionAndDeletionRoutesThroughSketchMutation()
  testCommittedDimensionAnnotationEditRequestOpensAndCommitsValueForm()
  testSketchStylePatchRoutesThroughSelectionAndUpdatesCommitRequest()
  testRejectedSketchCommitShowsValidationMessage()
  await testModelingServiceRuntimePreservesResultRejections()
  testReplayIsDeterministic()
  testSelectionKeyUsesDurableRefs()
  await testRuntimeLoopProcessesSketchOpen()
  await testRuntimeLoopOpensSketchFromPlanarFace()
  await testRuntimeLoopOpensSketchFromNonXYConstruction()
  await testRuntimeLoopReopensStoredSketchPlane()
  await testRuntimeLoopReopensCommittedFeatureFromExplicitIntent()
  await testRuntimeLoopReopensSketchFromExplicitIntent()
  await testXStateRuntimeBootstrapsAndLoadsSnapshot()
  await testXStateRuntimeCancelsObsoleteSketchOpenEffects()
})
