import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  createFeatureEditSession,
  patchFeatureEditSession,
} from '@/domain/editor/feature-editing'
import {
  initialEditorState,
  transitionEditorState,
  type FeatureEditorState,
} from './index'
import type { RenderableEntityRecord, RenderPoint3D } from '@/contracts/render/schema'
import type {
  BodyId,
  CommandSessionId,
  FaceId,
  PickId,
  RenderableId,
  RegionId,
  RequestId,
  RevisionId,
  SketchId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'

test('feature preview completion preselects boolean targets and preserves later manual overrides', () => {
  const session = {
    ...createFeatureEditSession({
      featureType: 'extrude',
      selectedTarget: { kind: 'region', sketchId: 'sketch_a' as SketchId, regionId: 'region_profile' as RegionId },
    }),
    status: 'previewing' as const,
  }
  const previewCompleted = transitionEditorState(createPreviewState(session, 'request_feature-preview-1' as RequestId), {
    type: 'effect.featurePreviewCompleted',
    requestId: 'request_feature-preview-1' as RequestId,
    documentId: 'doc_workspace',
    commandSessionId: 'command_extrude-1' as CommandSessionId,
    baseRevisionId: 'rev_1' as RevisionId,
    revisionId: 'rev_1' as RevisionId,
    stale: false,
    diagnostics: [],
    renderables: [boxMesh('preview_intersecting', null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5])],
  })

  expectTrue(previewCompleted.state.kind === 'editingFeature', 'Preview completion should stay in feature editing.')
  expectTrue(
    previewCompleted.state.kind === 'editingFeature'
    && previewCompleted.state.session.draft.operation === 'cut'
    && previewCompleted.state.session.draft.booleanScope.kind === 'targetBody'
    && previewCompleted.state.session.draft.booleanScope.bodyId === 'body_a',
    'Successful preview completion should preselect cut and the intersecting target body.',
  )

  if (previewCompleted.state.kind !== 'editingFeature') {
    throw new Error('Expected feature editing after preview completion.')
  }

  const manualSession = {
    ...patchFeatureEditSession(previewCompleted.state.session, {
      operation: 'join',
      booleanTargetBodyId: 'body_manual' as BodyId,
    }),
    status: 'previewing' as const,
  }
  const laterPreviewCompleted = transitionEditorState(createPreviewState(manualSession, 'request_feature-preview-2' as RequestId), {
    type: 'effect.featurePreviewCompleted',
    requestId: 'request_feature-preview-2' as RequestId,
    documentId: 'doc_workspace',
    commandSessionId: 'command_extrude-1' as CommandSessionId,
    baseRevisionId: 'rev_1' as RevisionId,
    revisionId: 'rev_1' as RevisionId,
    stale: false,
    diagnostics: [],
    renderables: [boxMesh('preview_other_intersection', null, [9.5, 9.5, 9.5], [10.5, 10.5, 10.5])],
  })

  expectTrue(
    laterPreviewCompleted.state.kind === 'editingFeature'
    && laterPreviewCompleted.state.session.draft.operation === 'join'
    && laterPreviewCompleted.state.session.draft.booleanScope.kind === 'targetBody'
    && laterPreviewCompleted.state.session.draft.booleanScope.bodyId === 'body_manual',
    'Manual operation and target selections should survive later preview completion classifications.',
  )
})

test('feature preview completion keeps unsupported advanced boolean families explicit', () => {
  const session = {
    ...createFeatureEditSession({
      featureType: 'thicken',
      selectedTarget: { kind: 'face', bodyId: 'body_a' as BodyId, faceId: 'face_top' as FaceId },
    }),
    status: 'previewing' as const,
  }
  const previewCompleted = transitionEditorState(
    createPreviewState(session, 'request_feature-preview-advanced' as RequestId, 'thicken'),
    {
      type: 'effect.featurePreviewCompleted',
      requestId: 'request_feature-preview-advanced' as RequestId,
      documentId: 'doc_workspace',
      commandSessionId: 'command_extrude-1' as CommandSessionId,
      baseRevisionId: 'rev_1' as RevisionId,
      revisionId: 'rev_1' as RevisionId,
      stale: false,
      diagnostics: [],
      renderables: [boxMesh('preview_intersecting', null, [0.5, 0.5, 0.5], [1.5, 1.5, 1.5])],
    },
  )

  expectTrue(
    previewCompleted.state.kind === 'editingFeature'
    && previewCompleted.state.session.featureType === 'thicken'
    && previewCompleted.state.session.draft.operationIntent === 'create'
    && previewCompleted.state.session.draft.targetBodyTargets.length === 0,
    'Preview completion should leave advanced families explicit until their boolean composition path is supported.',
  )
})

function createPreviewState(
  session: FeatureEditorState['session'],
  pendingPreviewRequestId: RequestId,
  toolId: FeatureEditorState['command']['toolId'] = 'extrude',
): FeatureEditorState {
  return {
    ...initialEditorState,
    kind: 'editingFeature',
    command: {
      commandSessionId: 'command_extrude-1' as CommandSessionId,
      toolId,
      phase: 'awaitingEffect',
    },
    document: {
      documentId: 'doc_workspace',
      revisionId: 'rev_1' as RevisionId,
    },
    snapshot: createSnapshot(),
    selection: [{ kind: 'region', sketchId: 'sketch_a' as SketchId, regionId: 'region_profile' as RegionId }],
    preview: null,
    previewRenderables: null,
    session,
    activeReferencePickerFieldId: null,
    pendingPreviewRequestId,
    pendingCommitRequestId: null,
  }
}

function createSnapshot(): WorkspaceSnapshot {
  const renderable = boxMesh('body_a', 'body_a' as BodyId, [0, 0, 0], [1, 1, 1])
  const entity = {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_1' as RevisionId,
    ownerFeatureId: null,
    ownerSketchId: null,
    ownerBodyId: 'body_a' as BodyId,
    id: 'snapshot_entity_body_a' as SnapshotEntityId,
    label: 'Body A',
    target: { kind: 'body', bodyId: 'body_a' as BodyId },
    relatedTargets: [],
    contributingFeatureIds: [],
    consumedByFeatureIds: [],
    selectionSemantics: ['body' as const],
  }

  return {
    document: {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_workspace',
      name: 'Workspace',
      revisionId: 'rev_1' as RevisionId,
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
      bodies: [{
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_1' as RevisionId,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: 'body_a' as BodyId,
        bodyId: 'body_a' as BodyId,
        label: 'Body A',
        topology: {
          faceIds: [],
          edgeIds: [],
          vertexIds: [],
        },
      }],
      constructions: [],
      variables: [],
      entities: [entity],
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: [renderable],
      },
    },
    presentation: {
      featureTree: [],
      objects: [],
      documentHistory: [],
      entities: [entity],
    },
    provenance: null,
  }
}

function boxMesh(
  id: string,
  ownerBodyId: BodyId | null,
  min: RenderPoint3D,
  max: RenderPoint3D,
): RenderableEntityRecord {
  const targetBodyId = ownerBodyId ?? 'body_preview'
  return {
    id: id as RenderableId,
    label: id,
    ownerBodyId,
    ownerFeatureId: null,
    binding: {
      pickId: `pick_${id}` as PickId,
      pickPriority: 0,
      target: { kind: 'face', bodyId: targetBodyId as BodyId, faceId: `face_${id}` as FaceId },
      topology: 'face',
      semanticClass: 'bodyFace',
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [min[0], min[1], min[2]],
        [max[0], min[1], min[2]],
        [max[0], max[1], min[2]],
        [min[0], max[1], min[2]],
        [min[0], min[1], max[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], max[2]],
        [min[0], max[1], max[2]],
      ],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
        [4, 6, 5],
        [4, 7, 6],
      ],
    },
  }
}
