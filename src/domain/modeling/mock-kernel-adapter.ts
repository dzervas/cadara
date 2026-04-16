import type { SketchDefinition, SketchRecord } from '@/contracts/sketch/schema'
import type { SketchSolverAdapter } from '@/contracts/solver/adapter'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import type {
  ConstraintId,
  BodyId,
  ConstructionId,
  FaceId,
  DimensionId,
  FeatureId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  RegionId,
  RenderableId,
  RevisionId,
  SketchId,
  SketchEntityId,
  SketchPointId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import { getPrimitiveRefKey } from '@/domain/editor/schema'
import {
  createDocumentHistoryItems,
  createTailDocumentCursor,
  getAppliedFeatureIdsForDocumentCursor,
  getFeatureInsertionIndexForDocumentCursor,
  isValidDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import { modelingDocumentRequestEnvelopeSchema } from '@/contracts/modeling/runtime-schema'
import type {
  CommitSketchRequest,
  CommitSketchResponse,
  CreateFeatureRequest,
  CreateFeatureResponse,
  DeleteFeatureRequest,
  DeleteFeatureResponse,
  DocumentSnapshot,
  EvaluatePreviewRequest,
  EvaluatePreviewResponse,
  FeatureDefinition,
  GetDocumentSnapshotRequest,
  GetDocumentSnapshotResponse,
  RenameBodyRequest,
  RenameBodyResponse,
  ReorderFeatureRequest,
  ReorderFeatureResponse,
  ResolveReferenceRequest,
  ResolveReferenceResponse,
  SetFeatureCursorRequest,
  SetFeatureCursorResponse,
  SnapshotEntityRecord,
  UpdateFeatureRequest,
  UpdateFeatureResponse,
} from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { DurableRef } from '@/contracts/shared/references'
import { getAdvancedParticipant, isAdvancedSolidFeatureKind } from '@/contracts/modeling/advanced-solid'
import {
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import type { ModelingCommitSketchCorrelation } from '@/domain/modeling/modeling-service'
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  DEFAULT_MOCK_SOLVER_TOLERANCES,
  MockSketchSolverAdapter,
  evaluateMockSketchDefinition,
} from '@/domain/solver/mock-sketch-solver-adapter'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

const CONTRACT_VERSION = 'modeling-contract/v1alpha1' as const
const REVISION_ID = 'rev_0001' as const
const DOCUMENT_ID = 'doc_workspace' as const
const SKETCH_ID = 'sketch_primary' as const
const CONSTRUCTION_PICK_PRIORITY = 40

function applyCursorToMockSnapshot(snapshot: DocumentSnapshot) {
  const appliedFeatureIds = getAppliedFeatureIdsForDocumentCursor(
    snapshot.presentation.documentHistory,
    snapshot.document.cursor,
  )

  snapshot.document.render.records = snapshot.document.render.records.filter(
    (record) => record.ownerFeatureId === null || appliedFeatureIds.has(record.ownerFeatureId),
  )
  snapshot.render = snapshot.document.render

  return snapshot
}

function createConstructionPlaneRenderRecords(): RenderableEntityRecord[] {
  const planeDefinitions = [
    {
      id: 'xy' as const,
      label: 'Top Plane',
      target: { kind: 'construction' as const, constructionId: 'construction_plane-xy' as ConstructionId },
      vertices: [
        [-8, -8, 0],
        [8, -8, 0],
        [8, 8, 0],
        [-8, 8, 0],
      ] as const,
      normal: [0, 0, 1] as const,
      outline: [
        [-8, -8, 0],
        [8, -8, 0],
        [8, 8, 0],
        [-8, 8, 0],
      ] as const,
    },
    {
      id: 'yz' as const,
      label: 'Right Plane',
      target: { kind: 'construction' as const, constructionId: 'construction_plane-yz' as ConstructionId },
      vertices: [
        [0, -8, -8],
        [0, 8, -8],
        [0, 8, 8],
        [0, -8, 8],
      ] as const,
      normal: [1, 0, 0] as const,
      outline: [
        [0, -8, -8],
        [0, 8, -8],
        [0, 8, 8],
        [0, -8, 8],
      ] as const,
    },
    {
      id: 'xz' as const,
      label: 'Front Plane',
      target: { kind: 'construction' as const, constructionId: 'construction_plane-xz' as ConstructionId },
      vertices: [
        [-8, 0, -8],
        [8, 0, -8],
        [8, 0, 8],
        [-8, 0, 8],
      ] as const,
      normal: [0, -1, 0] as const,
      outline: [
        [-8, 0, -8],
        [8, 0, -8],
        [8, 0, 8],
        [-8, 0, 8],
      ] as const,
    },
  ]

  return planeDefinitions.flatMap((plane) => [
    {
      id: `renderable_construction_${plane.id}_surface` as RenderableId,
      label: `${plane.label} surface`,
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: `pick_construction_${plane.id}_surface` as PickId,
        pickPriority: CONSTRUCTION_PICK_PRIORITY,
        target: plane.target,
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: plane.vertices,
        vertexNormals: [plane.normal, plane.normal, plane.normal, plane.normal],
        triangleIndices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
    },
    {
      id: `renderable_construction_${plane.id}_outline` as RenderableId,
      label: `${plane.label} outline`,
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: `pick_construction_${plane.id}_outline` as PickId,
        pickPriority: CONSTRUCTION_PICK_PRIORITY,
        target: plane.target,
        topology: null,
        semanticClass: 'construction',
      },
      geometry: {
        kind: 'polyline',
        points: plane.outline,
        isClosed: true,
      },
    },
  ])
}

function assertSupportedModelingRequest(request: { contractVersion: string; documentId: string }) {
  const parsed = modelingDocumentRequestEnvelopeSchema.safeParse(request)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid modeling request envelope.')
  }

  if (request.documentId !== DOCUMENT_ID) {
    throw new Error(
      `Unsupported document ${request.documentId}; expected ${DOCUMENT_ID}.`,
    )
  }
}

function createRebuildResult(
  input:
    | {
        kind: 'rebuilt'
        revisionId: RevisionId
        diagnostics?: CreateFeatureResponse['diagnostics']
        invalidatedTargets?: CreateFeatureResponse['changedTargets']
      }
    | {
        kind: 'skipped'
        reasonCode: 'revisionConflict' | 'validationRejected' | 'noOp'
        diagnostics?: CreateFeatureResponse['diagnostics']
      }
    | {
        kind: 'failed'
        revisionId: RevisionId
        reasonCode: string
        diagnostics?: CreateFeatureResponse['diagnostics']
        invalidatedTargets?: CreateFeatureResponse['changedTargets']
      },
) {
  switch (input.kind) {
    case 'rebuilt':
      return {
        kind: 'rebuilt' as const,
        revisionId: input.revisionId,
        invalidatedTargets: input.invalidatedTargets ?? [],
        diagnostics: input.diagnostics ?? [],
      }
    case 'skipped':
      return {
        kind: 'skipped' as const,
        reasonCode: input.reasonCode,
        invalidatedTargets: [],
        diagnostics: input.diagnostics ?? [],
      }
    case 'failed':
      return {
        kind: 'failed' as const,
        revisionId: input.revisionId,
        reasonCode: input.reasonCode,
        invalidatedTargets: input.invalidatedTargets ?? [],
        diagnostics: input.diagnostics ?? [],
      }
  }
}

function createSketchTarget(sketchId: SketchId): DurableRef {
  return { kind: 'sketch', sketchId }
}

function isSketchRenameOnlyRequest(
  request: CommitSketchRequest,
  existing: DocumentSnapshot['document']['sketches'][number] | undefined,
) {
  if (!existing || !request.sketchId || existing.label === request.sketchLabel) {
    return false
  }

  return JSON.stringify(existing.plane) === JSON.stringify(request.plane)
    && JSON.stringify(existing.sketch.definition) === JSON.stringify(request.definition)
}

function getFeatureDefinitionLabel(definition: FeatureDefinition) {
  return definition.kind
}

function getFeatureDefinitionChangedTargets(definition: FeatureDefinition) {
  switch (definition.kind) {
    case 'extrude':
      return [...definition.parameters.profiles]
    case 'fillet':
      return [...definition.parameters.edgeTargets]
    case 'plane':
      return [definition.parameters.reference.target]
    case 'revolve':
      return [...definition.parameters.profiles, definition.parameters.axis]
    case 'shell':
      return [definition.parameters.bodyTarget, ...definition.parameters.faceTargets]
    default:
      return definition.parameters.participants.flatMap((participant) => [...participant.targets])
  }
}

function createUnsupportedFeatureDiagnostic(
  target: FeatureDefinition,
  message: string,
) {
  const advancedDetail = isAdvancedSolidFeatureKind(target.kind)
    ? {
        kind: 'advancedFeatureValidation' as const,
        diagnostic: {
          code: 'advanced-feature-unsupported-kernel-case' as const,
          severity: 'error' as const,
          message,
          role: null,
          target: null,
        },
      }
    : null

  return {
    code: `mock-unsupported-${target.kind}`,
    severity: 'error' as const,
    message,
    target: null,
    detail: advancedDetail,
  }
}

function createMissingFeatureDiagnostic(featureId: FeatureId) {
  return {
    code: 'mock-missing-feature',
    severity: 'error' as const,
    message: `Feature ${featureId} does not resolve in the current revision.`,
    target: { kind: 'feature' as const, featureId },
    detail: {
      kind: 'invalidReference' as const,
      reference: {
        reason: 'mock-missing-feature',
        target: { kind: 'feature' as const, featureId },
        ownerFeatureId: featureId,
        ownerSketchId: null,
        sourceTarget: null,
      },
    },
  }
}

function createMissingFeatureAnchorDiagnostic(featureId: FeatureId) {
  return {
    code: 'mock-missing-reorder-anchor',
    severity: 'error' as const,
    message: `Reorder anchor ${featureId} does not resolve in the current revision.`,
    target: { kind: 'feature' as const, featureId },
    detail: {
      kind: 'invalidReference' as const,
      reference: {
        reason: 'mock-missing-reorder-anchor',
        target: { kind: 'feature' as const, featureId },
        ownerFeatureId: featureId,
        ownerSketchId: null,
        sourceTarget: null,
      },
    },
  }
}

function createMissingBodyDiagnostic(bodyId: BodyId) {
  return {
    code: 'mock-missing-body',
    severity: 'error' as const,
    message: `Body ${bodyId} does not resolve in the current revision.`,
    target: { kind: 'body' as const, bodyId },
    detail: {
      kind: 'invalidReference' as const,
      reference: {
        reason: 'mock-missing-body',
        target: { kind: 'body' as const, bodyId },
        ownerFeatureId: null,
        ownerSketchId: null,
        sourceTarget: null,
      },
    },
  }
}

function createInvalidFeatureDiagnostic(
  definition: FeatureDefinition,
  target: NonNullable<ReturnType<typeof getFeatureDefinitionChangedTargets>[number]>,
  message: string,
) {
  return {
    code: `mock-invalid-${definition.kind}`,
    severity: 'error' as const,
    message,
    target: null,
    detail: {
      kind: 'invalidReference' as const,
      reference: {
        reason: `mock-${definition.kind}-invalid-input`,
        target: getFeatureDefinitionChangedTargets(definition)[0] ?? target,
        ownerFeatureId: null,
        ownerSketchId: null,
        sourceTarget: null,
      },
    },
  }
}

function isSupportedPlanarFace(faceId: FaceId) {
  return faceId === 'face_top'
}

function hasRegionTarget(snapshot: DocumentSnapshot, target: Extract<FeatureDefinition, { kind: 'extrude' }>['parameters']['profiles'][number]) {
  return target.kind === 'region'
    && snapshot.sketches.some((sketch) =>
      sketch.sketchId === target.sketchId && sketch.sketch.regions.some((region) => region.regionId === target.regionId),
    )
}

function hasFaceTarget(snapshot: DocumentSnapshot, bodyId: string, faceId: FaceId) {
  return snapshot.bodies.some((body) => body.bodyId === bodyId && body.topology.faceIds.includes(faceId))
}

function hasBodyTarget(snapshot: DocumentSnapshot, bodyId: string) {
  return snapshot.bodies.some((body) => body.bodyId === bodyId)
}

function hasEdgeTarget(snapshot: DocumentSnapshot, bodyId: string, edgeId: string) {
  return snapshot.bodies.some((body) => body.bodyId === bodyId && body.topology.edgeIds.includes(edgeId as typeof body.topology.edgeIds[number]))
}

function hasConstructionTarget(snapshot: DocumentSnapshot, constructionId: string) {
  return snapshot.constructions.some((construction) => construction.constructionId === constructionId)
}

function hasSketchEntityTarget(snapshot: DocumentSnapshot, sketchId: SketchId, entityId: SketchEntityId) {
  return snapshot.sketches.some((sketch) =>
    sketch.sketchId === sketchId && sketch.sketch.definition.entities.some((entity) => entity.entityId === entityId),
  )
}

function createPreviewRenderableSet(targetKey: string): RenderableEntityRecord[] {
  return [
    {
      id: `renderable_${targetKey}_face` as RenderableId,
      label: 'Preview top face',
      ownerBodyId: 'body_preview',
      ownerFeatureId: null,
      binding: {
        pickId: `pick_${targetKey}_face` as PickId,
        pickPriority: 20,
        target: { kind: 'face', bodyId: 'body_preview', faceId: 'face_preview-top' },
        topology: 'face',
        semanticClass: 'planarFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [
          [-4, -3, 12],
          [4, -3, 12],
          [4, 3, 12],
          [-4, 3, 12],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
    },
    {
      id: `renderable_${targetKey}_edge` as RenderableId,
      label: 'Preview profile edge',
      ownerBodyId: 'body_preview',
      ownerFeatureId: null,
      binding: {
        pickId: `pick_${targetKey}_edge` as PickId,
        pickPriority: 10,
        target: { kind: 'edge', bodyId: 'body_preview', edgeId: 'edge_preview-0' },
        topology: 'edge',
        semanticClass: 'featureEdge',
      },
      geometry: {
        kind: 'polyline',
        points: [[-4, -3, 12], [4, -3, 12]],
        isClosed: false,
      },
    },
  ]
}

function validateFeatureDefinitionAgainstSnapshot(
  definition: FeatureDefinition,
  snapshot: DocumentSnapshot,
) {
  switch (definition.kind) {
    case 'extrude': {
      const distance = definition.parameters.endExtent.distance
      const firstProfile = definition.parameters.profiles[0]

      if (distance <= 0) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-extrude',
          diagnostics: [
            createInvalidFeatureDiagnostic(definition, firstProfile, 'Extrude depth must be positive.'),
          ],
        }
      }

      if (definition.parameters.profiles.length > 1) {
        return {
          accepted: false as const,
          reasonCode: 'mock-unsupported-profile-group',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              firstProfile,
              'Mock kernel does not support multi-profile extrude groups yet.',
            ),
          ],
        }
      }

      if (
        (firstProfile.kind === 'region' && !hasRegionTarget(snapshot, firstProfile)) ||
        (firstProfile.kind === 'face' && !hasFaceTarget(snapshot, firstProfile.bodyId, firstProfile.faceId))
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-extrude',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              firstProfile,
              'Extrude profile targets must resolve to a live durable region or face in the current snapshot.',
            ),
          ],
        }
      }

      if (firstProfile.kind === 'face' && !isSupportedPlanarFace(firstProfile.faceId)) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-extrude',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              firstProfile,
              'Mock kernel only accepts planar top faces as extrude profile seeds.',
            ),
          ],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'fillet':
      if (definition.parameters.radius <= 0 || definition.parameters.edgeTargets.length === 0) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-fillet',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              definition.parameters.edgeTargets[0] ?? { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
              'Fillet requires a positive radius and at least one durable edge target.',
            ),
          ],
        }
      }

      if (definition.parameters.edgeTargets.some((target) => !hasEdgeTarget(snapshot, target.bodyId, target.edgeId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-fillet',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              definition.parameters.edgeTargets[0]!,
              'Fillet edge targets must resolve to live durable edges in the current snapshot.',
            ),
          ],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    case 'plane':
      if (
        (definition.parameters.reference.target.kind === 'construction' && !hasConstructionTarget(snapshot, definition.parameters.reference.target.constructionId)) ||
        (definition.parameters.reference.target.kind === 'face' && !hasFaceTarget(snapshot, definition.parameters.reference.target.bodyId, definition.parameters.reference.target.faceId))
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-plane',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              definition.parameters.reference.target,
              'Plane references must resolve to a live construction plane or planar face in the current snapshot.',
            ),
          ],
        }
      }

      return {
        accepted: false as const,
        reasonCode: 'mock-unsupported-plane',
        diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock kernel does not implement plane creation yet.')],
      }
    case 'revolve': {
      if (definition.parameters.profiles.length > 1) {
        return {
          accepted: false as const,
          reasonCode: 'mock-unsupported-profile-group',
          diagnostics: [
            createInvalidFeatureDiagnostic(
              definition,
              definition.parameters.profiles[0],
              'Mock kernel does not support multi-profile revolve groups yet.',
            ),
          ],
        }
      }
      return {
        accepted: false as const,
        reasonCode: 'mock-unsupported-revolve',
        diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock kernel does not implement revolve creation yet.')],
      }
    }
    case 'shell':
      return {
        accepted: false as const,
        reasonCode: 'mock-unsupported-shell',
        diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock kernel does not implement shell creation yet.')],
      }
    case 'sweep': {
      const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
      const pathTargets = getAdvancedParticipant(definition, 'path')?.targets ?? []
      const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []
      const targetBodyTargets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []
      const firstProfile = profileTargets[0]
      const firstPath = pathTargets[0]

      if (!firstProfile || !firstPath || profileTargets.length === 0 || pathTargets.length !== 1) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-sweep',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Sweep requires at least one profile participant and exactly one path participant.')],
        }
      }

      if (profileTargets.some((target) => target.kind !== 'region' && target.kind !== 'face')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-sweep',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Sweep profile participants must be region or face targets.')],
        }
      }

      if (firstPath.kind !== 'edge' && firstPath.kind !== 'sketchEntity') {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-sweep',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Sweep path participant must be an edge or sketch entity target.')],
        }
      }

      if (
        profileTargets.some((target) =>
          (target.kind === 'region' && !hasRegionTarget(snapshot, target)) ||
          (target.kind === 'face' && !hasFaceTarget(snapshot, target.bodyId, target.faceId)),
        ) ||
        (firstPath.kind === 'edge' && !hasEdgeTarget(snapshot, firstPath.bodyId, firstPath.edgeId)) ||
        (firstPath.kind === 'sketchEntity' && !hasSketchEntityTarget(snapshot, firstPath.sketchId, firstPath.entityId))
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-sweep',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Sweep profile and path participants must resolve to live durable targets.')],
        }
      }

      if (guideCurveTargets.length > 0) {
        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock sweep does not implement guide-curve participants yet.')],
        }
      }

      if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
        if (targetBodyTargets.length === 0 || targetBodyTargets.some((target) => target.kind !== 'body')) {
          return {
            accepted: false as const,
            reasonCode: 'mock-invalid-sweep',
            diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Sweep boolean operation intents require explicit targetBody participants.')],
          }
        }

        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock sweep does not implement boolean composition yet.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'loft': {
      const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
      const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []
      const targetBodyTargets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []

      if (profileTargets.length < 2) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-loft',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Loft requires at least two ordered profile participants.')],
        }
      }

      if (profileTargets.some((target) => target.kind !== 'region' && target.kind !== 'face')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-loft',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Loft profile participants must be region or face targets.')],
        }
      }

      if (
        profileTargets.some((target) =>
          (target.kind === 'region' && !hasRegionTarget(snapshot, target)) ||
          (target.kind === 'face' && !hasFaceTarget(snapshot, target.bodyId, target.faceId)),
        )
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-loft',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Loft profile participants must resolve to live durable targets.')],
        }
      }

      if (guideCurveTargets.length > 0) {
        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock loft does not implement guide-curve participants yet.')],
        }
      }

      if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
        if (targetBodyTargets.length === 0 || targetBodyTargets.some((target) => target.kind !== 'body')) {
          return {
            accepted: false as const,
            reasonCode: 'mock-invalid-loft',
            diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Loft boolean operation intents require explicit targetBody participants.')],
          }
        }

        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock loft does not implement boolean composition yet.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'chamfer': {
      const edgeTargets = getAdvancedParticipant(definition, 'edge')?.targets ?? []
      const distance = definition.parameters.options?.distance

      if (edgeTargets.length === 0 || edgeTargets.some((target) => target.kind !== 'edge')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-chamfer',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Chamfer requires at least one durable edge participant.')],
        }
      }

      if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-chamfer',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Chamfer requires a positive constant distance option.')],
        }
      }

      if (edgeTargets.some((target) => target.kind !== 'edge' || !hasEdgeTarget(snapshot, target.bodyId, target.edgeId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-chamfer',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Chamfer edge participants must resolve to live durable edges.')],
        }
      }

      if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock chamfer does not implement operation intents yet.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'thicken': {
      const faceTargets = getAdvancedParticipant(definition, 'face')?.targets ?? []
      const targetBodyTargets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []
      const thickness = definition.parameters.options?.thickness
      const side = definition.parameters.options?.side

      if (faceTargets.length === 0 || faceTargets.some((target) => target.kind !== 'face')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-thicken',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Thicken requires at least one durable face participant.')],
        }
      }

      if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-thicken',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Thicken requires a positive thickness option.')],
        }
      }

      if (side !== undefined && side !== 'oneSide' && side !== 'symmetric') {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-thicken',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Thicken side must be oneSide or symmetric.')],
        }
      }

      if (faceTargets.some((target) => target.kind !== 'face' || !hasFaceTarget(snapshot, target.bodyId, target.faceId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-thicken',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Thicken face participants must resolve to live durable faces.')],
        }
      }

      if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
        if (targetBodyTargets.length === 0 || targetBodyTargets.some((target) => target.kind !== 'body')) {
          return {
            accepted: false as const,
            reasonCode: 'mock-invalid-thicken',
            diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Thicken boolean operation intents require explicit targetBody participants.')],
          }
        }

        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock thicken does not implement boolean composition yet.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'split': {
      const targetBodyTargets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []
      const toolBodyTargets = getAdvancedParticipant(definition, 'toolBody')?.targets ?? []
      const planeTargets = getAdvancedParticipant(definition, 'plane')?.targets ?? []

      if (targetBodyTargets.length !== 1 || targetBodyTargets.some((target) => target.kind !== 'body')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-split',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Split requires exactly one explicit targetBody participant.')],
        }
      }

      if (toolBodyTargets.length !== 1 || toolBodyTargets.some((target) => target.kind !== 'body')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-split',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Split requires exactly one explicit toolBody participant in the initial implementation.')],
        }
      }

      if (planeTargets.length > 0) {
        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock split does not implement plane split tools yet.')],
        }
      }

      const [targetBody] = targetBodyTargets
      const [toolBody] = toolBodyTargets
      if (targetBody?.kind !== 'body' || toolBody?.kind !== 'body') {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-split',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Split targetBody and toolBody participants must resolve to live durable bodies.')],
        }
      }

      if (!hasBodyTarget(snapshot, targetBody.bodyId) || !hasBodyTarget(snapshot, toolBody.bodyId)) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-split',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Split targetBody and toolBody participants must resolve to live durable bodies.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'deleteSolid': {
      const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []

      if (bodyTargets.length === 0 || bodyTargets.some((target) => target.kind !== 'body')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-delete-solid',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Delete-solid requires one or more explicit body participants.')],
        }
      }

      if (bodyTargets.some((target) => target.kind !== 'body' || !hasBodyTarget(snapshot, target.bodyId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-delete-solid',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Delete-solid body participants must resolve to live durable bodies.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'mirror': {
      const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []
      const planeTargets = getAdvancedParticipant(definition, 'plane')?.targets ?? []
      const copy = definition.parameters.options?.copy

      if (bodyTargets.length === 0 || bodyTargets.some((target) => target.kind !== 'body')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-mirror',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mirror requires one or more explicit body participants.')],
        }
      }

      if (planeTargets.length !== 1 || planeTargets.some((target) => target.kind !== 'construction' && target.kind !== 'face')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-mirror',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mirror requires exactly one planar face or construction plane participant.')],
        }
      }

      if (copy !== true) {
        return {
          accepted: false as const,
          reasonCode: 'advanced-feature-unsupported-kernel-case',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mock mirror currently supports copy=true only.')],
        }
      }

      if (bodyTargets.some((target) => target.kind !== 'body' || !hasBodyTarget(snapshot, target.bodyId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-mirror',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mirror body participants must resolve to live durable bodies.')],
        }
      }

      const [planeTarget] = planeTargets
      if (
        planeTarget?.kind === 'construction' && !hasConstructionTarget(snapshot, planeTarget.constructionId)
        || planeTarget?.kind === 'face' && !hasFaceTarget(snapshot, planeTarget.bodyId, planeTarget.faceId)
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-mirror',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Mirror planar references must resolve to live construction planes or planar faces.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    case 'transform': {
      const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []
      const referenceTargets = getAdvancedParticipant(definition, 'transformReference')?.targets ?? []
      const distance = definition.parameters.options?.distance

      if (bodyTargets.length === 0 || bodyTargets.some((target) => target.kind !== 'body')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-transform',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Transform requires one or more explicit body participants.')],
        }
      }

      if (referenceTargets.length !== 1 || referenceTargets.some((target) => target.kind !== 'construction' && target.kind !== 'face')) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-transform',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Transform requires exactly one planar face or construction plane participant.')],
        }
      }

      if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-transform',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Transform requires a positive distance option.')],
        }
      }

      if (bodyTargets.some((target) => target.kind !== 'body' || !hasBodyTarget(snapshot, target.bodyId))) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-transform',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Transform body participants must resolve to live durable bodies.')],
        }
      }

      const [referenceTarget] = referenceTargets
      if (
        referenceTarget?.kind === 'construction' && !hasConstructionTarget(snapshot, referenceTarget.constructionId)
        || referenceTarget?.kind === 'face' && !hasFaceTarget(snapshot, referenceTarget.bodyId, referenceTarget.faceId)
      ) {
        return {
          accepted: false as const,
          reasonCode: 'mock-invalid-transform',
          diagnostics: [createUnsupportedFeatureDiagnostic(definition, 'Transform planar references must resolve to live construction planes or planar faces.')],
        }
      }

      return { accepted: true as const, diagnostics: [] }
    }
    default:
      return {
        accepted: false as const,
        reasonCode: 'advanced-feature-unsupported-kernel-case',
        diagnostics: [createUnsupportedFeatureDiagnostic(definition, `Mock kernel does not implement ${definition.kind} advanced solid features yet.`)],
      }
  }
}

function buildPreviewRenderables(definition: FeatureDefinition, snapshot: DocumentSnapshot) {
  if (definition.kind === 'sweep') {
    const profile = getAdvancedParticipant(definition, 'profile')?.targets[0]
    return profile ? createPreviewRenderableSet(getPrimitiveRefKey(profile)) : []
  }

  if (definition.kind === 'loft') {
    const profile = getAdvancedParticipant(definition, 'profile')?.targets[0]
    return profile ? createPreviewRenderableSet(getPrimitiveRefKey(profile)) : []
  }

  if (definition.kind === 'chamfer') {
    const edge = getAdvancedParticipant(definition, 'edge')?.targets[0]
    return edge ? createPreviewRenderableSet(getPrimitiveRefKey(edge)) : []
  }

  if (definition.kind === 'thicken') {
    const face = getAdvancedParticipant(definition, 'face')?.targets[0]
    return face ? createPreviewRenderableSet(getPrimitiveRefKey(face)) : []
  }

  if (definition.kind === 'split') {
    const body = getAdvancedParticipant(definition, 'targetBody')?.targets[0]
    return body ? createPreviewRenderableSet(getPrimitiveRefKey(body)) : []
  }

  if (definition.kind === 'deleteSolid') {
    const body = getAdvancedParticipant(definition, 'body')?.targets[0]
    return body ? createPreviewRenderableSet(getPrimitiveRefKey(body)) : []
  }

  if (definition.kind === 'mirror' || definition.kind === 'transform') {
    const body = getAdvancedParticipant(definition, 'body')?.targets[0]
    return body ? createPreviewRenderableSet(getPrimitiveRefKey(body)) : []
  }

  if (definition.kind !== 'extrude') {
    return []
  }

  const profile = definition.parameters.profiles[0]

  if (profile.kind === 'face') {
    return hasFaceTarget(snapshot, profile.bodyId, profile.faceId)
      ? createPreviewRenderableSet(getPrimitiveRefKey(profile))
      : []
  }

  return hasRegionTarget(snapshot, profile)
    ? createPreviewRenderableSet(getPrimitiveRefKey(profile))
    : []
}

function hasRevisionConflict(baseRevisionId: RevisionId, currentRevisionId: RevisionId) {
  return baseRevisionId !== currentRevisionId
}

function createRevisionConflictDiagnostic(baseRevisionId: RevisionId, currentRevisionId: RevisionId) {
  return {
    code: 'mock-revision-conflict',
    severity: 'error' as const,
    message: `Request revision ${baseRevisionId} does not match current revision ${currentRevisionId}.`,
    target: null,
    detail: {
      kind: 'revisionConflict' as const,
      expectedRevisionId: baseRevisionId as `rev_${string}`,
      actualRevisionId: currentRevisionId,
    },
  }
}

function getCommitSolverCorrelation(
  request: CommitSketchRequest & { solverCorrelation?: ModelingCommitSketchCorrelation | null },
): ModelingCommitSketchCorrelation {
  if (!request.solverCorrelation) {
    throw new Error('Sketch commit request must include explicit solverCorrelation request IDs.')
  }

  return request.solverCorrelation
}

function mapSketchSolverDiagnostic(
  sketchId: SketchId,
  diagnostic: {
    code: string
    severity: 'info' | 'warning' | 'error'
    message: string
    target: { kind: 'entity'; entityId: SketchEntityId }
      | { kind: 'point'; pointId: SketchPointId }
      | { kind: 'constraint'; constraintId: ConstraintId }
      | { kind: 'dimension'; dimensionId: DimensionId }
      | { kind: 'region'; regionId: RegionId }
      | null
  },
) {
  return {
    code: `mock-solver:${diagnostic.code}`,
    severity: diagnostic.severity,
    message: diagnostic.message,
    target:
      diagnostic.target?.kind === 'entity'
        ? { kind: 'sketchEntity' as const, sketchId, entityId: diagnostic.target.entityId }
        : diagnostic.target?.kind === 'point'
          ? { kind: 'sketchPoint' as const, sketchId, pointId: diagnostic.target.pointId }
          : diagnostic.target?.kind === 'region'
            ? { kind: 'region' as const, sketchId, regionId: diagnostic.target.regionId }
            : null,
    detail: null,
  }
}

const sketchDefinition: SketchDefinition = {
  schemaVersion: 'sketch-definition/v1alpha1',
  referenceIds: ['ref_sketch_primary_plane' as const],
  references: [
    {
      referenceId: 'ref_sketch_primary_plane' as const,
      kind: 'constructionPlane',
      label: 'Sketch plane',
      source: { kind: 'construction', constructionId: 'construction_plane-xy' },
      projectionMode: 'coplanar',
    },
  ],
  pointIds: [
    'sketch_point_1_rect-bottom-left' as SketchPointId,
    'sketch_point_1_rect-bottom-right' as SketchPointId,
    'sketch_point_1_rect-top-right' as SketchPointId,
    'sketch_point_1_rect-top-left' as SketchPointId,
  ],
  points: [
    {
      pointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
      label: 'Rectangle 1 bottom left',
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_1_rect-bottom-left' as SketchPointId },
      position: [-4, -3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
      label: 'Rectangle 1 bottom right',
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_1_rect-bottom-right' as SketchPointId },
      position: [4, -3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-top-right' as SketchPointId,
      label: 'Rectangle 1 top right',
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_1_rect-top-right' as SketchPointId },
      position: [4, 3],
      isConstruction: false,
    },
    {
      pointId: 'sketch_point_1_rect-top-left' as SketchPointId,
      label: 'Rectangle 1 top left',
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_1_rect-top-left' as SketchPointId },
      position: [-4, 3],
      isConstruction: false,
    },
  ],
  entityIds: [
    'sketch_entity_1_rect-bottom' as SketchEntityId,
    'sketch_entity_1_rect-right' as SketchEntityId,
    'sketch_entity_1_rect-top' as SketchEntityId,
    'sketch_entity_1_rect-left' as SketchEntityId,
  ],
  entities: [
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId,
      label: 'Rectangle 1 bottom',
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
      endPointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-right' as SketchEntityId,
      label: 'Rectangle 1 right',
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_1_rect-right' as SketchEntityId },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-bottom-right' as SketchPointId,
      endPointId: 'sketch_point_1_rect-top-right' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-top' as SketchEntityId,
      label: 'Rectangle 1 top',
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_1_rect-top' as SketchEntityId },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-top-right' as SketchPointId,
      endPointId: 'sketch_point_1_rect-top-left' as SketchPointId,
    },
    {
      kind: 'lineSegment',
      entityId: 'sketch_entity_1_rect-left' as SketchEntityId,
      label: 'Rectangle 1 left',
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_1_rect-left' as SketchEntityId },
      isConstruction: false,
      startPointId: 'sketch_point_1_rect-top-left' as SketchPointId,
      endPointId: 'sketch_point_1_rect-bottom-left' as SketchPointId,
    },
  ],
  constraintIds: [
    'constraint_1_bottom-horizontal' as ConstraintId,
    'constraint_1_top-horizontal' as ConstraintId,
    'constraint_1_right-vertical' as ConstraintId,
    'constraint_1_left-vertical' as ConstraintId,
  ],
  constraints: [
    {
      constraintId: 'constraint_1_bottom-horizontal' as ConstraintId,
      kind: 'horizontal',
      label: 'Rectangle 1 bottom horizontal',
      entityId: 'sketch_entity_1_rect-bottom' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_top-horizontal' as ConstraintId,
      kind: 'horizontal',
      label: 'Rectangle 1 top horizontal',
      entityId: 'sketch_entity_1_rect-top' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_right-vertical' as ConstraintId,
      kind: 'vertical',
      label: 'Rectangle 1 right vertical',
      entityId: 'sketch_entity_1_rect-right' as SketchEntityId,
    },
    {
      constraintId: 'constraint_1_left-vertical' as ConstraintId,
      kind: 'vertical',
      label: 'Rectangle 1 left vertical',
      entityId: 'sketch_entity_1_rect-left' as SketchEntityId,
    },
  ],
  dimensionIds: [
    'dimension_1_width' as DimensionId,
    'dimension_1_height' as DimensionId,
  ],
  dimensions: [
    {
      dimensionId: 'dimension_1_width' as DimensionId,
      kind: 'distance',
      label: 'Rectangle 1 width',
      axis: 'horizontal',
      pointIds: [
        'sketch_point_1_rect-bottom-left' as SketchPointId,
        'sketch_point_1_rect-bottom-right' as SketchPointId,
      ],
      value: 8,
    },
    {
      dimensionId: 'dimension_1_height' as DimensionId,
      kind: 'distance',
      label: 'Rectangle 1 height',
      axis: 'vertical',
      pointIds: [
        'sketch_point_1_rect-bottom-left' as SketchPointId,
        'sketch_point_1_rect-top-left' as SketchPointId,
      ],
      value: 6,
    },
  ],
}

function createSketchReferenceFrame(input: {
  planeTarget: CommitSketchRequest['planeTarget'] | SketchRecord['definition']['references'][number]['source']
  planeKey: 'xy' | 'yz' | 'xz'
}) {
  const byPlaneKey = {
    xy: {
      ...DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
      normal: [0, 0, 1] as const,
    },
    yz: {
      ...DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      xAxis: [0, 1, 0] as const,
      yAxis: [0, 0, 1] as const,
      normal: [1, 0, 0] as const,
    },
    xz: {
      ...DEFAULT_MOCK_SKETCH_PLANE_FRAME,
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 0, 1] as const,
      normal: [0, -1, 0] as const,
    },
  } satisfies Record<'xy' | 'yz' | 'xz', typeof DEFAULT_MOCK_SKETCH_PLANE_FRAME>

  return byPlaneKey[input.planeKey]
}

function createSketchPlaneDefinition(input: {
  planeTarget: CommitSketchRequest['planeTarget']
  planeKey: CommitSketchRequest['planeKey']
}): CommitSketchRequest['plane'] {
  const key = input.planeKey ?? 'xy'

  return {
    support: input.planeTarget,
    frame: createSketchReferenceFrame({
      planeTarget: input.planeTarget,
      planeKey: key,
    }),
    key: input.planeKey,
  }
}

async function buildSketchRecord(
  _solverAdapter: SketchSolverAdapter,
  input: {
    documentId: typeof DOCUMENT_ID
    revisionId: typeof REVISION_ID
    sketchId: 'sketch_primary'
    label: string
    definition: SketchDefinition
  },
): Promise<SketchRecord> {
  const evaluation = evaluateMockSketchDefinition({
    documentId: input.documentId,
    revisionId: input.revisionId,
    sketchId: input.sketchId,
    plane: createSketchReferenceFrame({
      planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
      planeKey: 'xy',
    }),
    tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
    definition: input.definition,
    requestId: 'request_mock-snapshot-bootstrap',
  })

  return {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: input.sketchId,
    ownerBodyId: null,
    sketchId: input.sketchId,
    label: input.label,
    planeSupport: { kind: 'construction', constructionId: 'construction_plane-xy' },
    definition: input.definition,
    solvedSnapshot: evaluation.solve.solvedSnapshot,
    regions: evaluation.regions.regions,
  }
}

async function buildSnapshot(solverAdapter: SketchSolverAdapter): Promise<DocumentSnapshot> {
  const sketchRecord = await buildSketchRecord(solverAdapter, {
    documentId: DOCUMENT_ID,
    revisionId: REVISION_ID,
    sketchId: SKETCH_ID,
    label: 'Sketch 1',
    definition: sketchDefinition,
  })
  const primaryRegion = sketchRecord.regions[0]

  if (!primaryRegion) {
    throw new Error('Mock snapshot bootstrap expected a solver-derived primary region.')
  }

  const entities = [
    entity({
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      id: 'snapshot_entity_construction_origin_planes' as SnapshotEntityId,
      label: 'Origin planes',
      target: { kind: 'construction', constructionId: 'construction_origin-planes' },
      relatedTargets: [
        { kind: 'construction', constructionId: 'construction_plane-xy' },
        { kind: 'construction', constructionId: 'construction_plane-yz' },
        { kind: 'construction', constructionId: 'construction_plane-xz' },
      ],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      id: 'snapshot_entity_construction_plane_xy' as SnapshotEntityId,
      label: 'Plane XY',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      relatedTargets: [{ kind: 'construction', constructionId: 'construction_origin-planes' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      id: 'snapshot_entity_construction_plane_yz' as SnapshotEntityId,
      label: 'Plane YZ',
      target: { kind: 'construction', constructionId: 'construction_plane-yz' },
      relatedTargets: [{ kind: 'construction', constructionId: 'construction_origin-planes' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      id: 'snapshot_entity_construction_plane_xz' as SnapshotEntityId,
      label: 'Plane XZ',
      target: { kind: 'construction', constructionId: 'construction_plane-xz' },
      relatedTargets: [{ kind: 'construction', constructionId: 'construction_origin-planes' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: null,
      ownerSketchId: SKETCH_ID,
      ownerBodyId: null,
      id: 'snapshot_entity_sketch_primary' as SnapshotEntityId,
      label: 'Sketch 1',
      target: { kind: 'sketch', sketchId: SKETCH_ID },
      relatedTargets: [
        { kind: 'construction', constructionId: 'construction_plane-xy' },
        ...sketchRecord.regions.map((region) => region.target),
        ...sketchRecord.definition.entities.map((entry) => entry.target),
        ...sketchRecord.definition.points.map((entry) => entry.target),
      ],
      consumedByFeatureIds: ['feature_extrude-1'],
    }),
    entity({
      ownerFeatureId: null,
      ownerSketchId: SKETCH_ID,
      ownerBodyId: null,
      id: 'snapshot_entity_sketch_primary_region_outer' as SnapshotEntityId,
      label: primaryRegion.label,
      target: primaryRegion.target,
      relatedTargets: [
        { kind: 'sketch', sketchId: SKETCH_ID },
        ...sketchRecord.definition.entities.map((entry) => entry.target),
      ],
      consumedByFeatureIds: ['feature_extrude-1'],
    }),
    ...sketchRecord.definition.entities.map((entry, index) =>
      entity({
        ownerFeatureId: null,
        ownerSketchId: SKETCH_ID,
        ownerBodyId: null,
        id: `snapshot_entity_sketch_primary_entity_${index}` as SnapshotEntityId,
        label: entry.label,
        target: entry.target,
        relatedTargets: [{ kind: 'sketch', sketchId: SKETCH_ID }],
        consumedByFeatureIds: [],
      }),
    ),
    ...sketchRecord.definition.points.map((point, index) =>
      entity({
        ownerFeatureId: null,
        ownerSketchId: SKETCH_ID,
        ownerBodyId: null,
        id: `snapshot_entity_sketch_primary_point_${index}` as SnapshotEntityId,
        label: point.label,
        target: point.target,
        relatedTargets: [{ kind: 'sketch', sketchId: SKETCH_ID }],
        consumedByFeatureIds: [],
      }),
    ),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: null,
      id: 'snapshot_entity_feature_extrude_1' as SnapshotEntityId,
      label: 'Extrude 1',
      target: { kind: 'feature', featureId: 'feature_extrude-1' },
      relatedTargets: [
        primaryRegion.target,
        { kind: 'body', bodyId: 'body_part-1' },
      ],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_fillet-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_feature_fillet_1' as SnapshotEntityId,
      label: 'Fillet 1',
      target: { kind: 'feature', featureId: 'feature_fillet-1' },
      relatedTargets: [
        { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
        { kind: 'body', bodyId: 'body_part-1' },
      ],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_body_part_1' as SnapshotEntityId,
      label: 'Part 1 body',
      target: { kind: 'body', bodyId: 'body_part-1' },
      relatedTargets: [
        { kind: 'feature', featureId: 'feature_extrude-1' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_bottom' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-front' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-right' },
        { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
        { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-1' },
        { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-2' },
        { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-3' },
        { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_front-right' },
        { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_front-left' },
        { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_back-right' },
        { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_back-left' },
      ],
      consumedByFeatureIds: ['feature_fillet-1'],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_face_top' as SnapshotEntityId,
      label: 'Top face',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }, { kind: 'feature', featureId: 'feature_extrude-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_face_bottom' as SnapshotEntityId,
      label: 'Bottom face',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_bottom' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }, { kind: 'feature', featureId: 'feature_extrude-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_fillet-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_face_side_front' as SnapshotEntityId,
      label: 'Front side face',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-front' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }, { kind: 'feature', featureId: 'feature_fillet-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_fillet-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_face_side_right' as SnapshotEntityId,
      label: 'Right side face',
      target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-right' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }, { kind: 'feature', featureId: 'feature_fillet-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_fillet-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_edge_outer_0' as SnapshotEntityId,
      label: 'Outer edge',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }, { kind: 'feature', featureId: 'feature_fillet-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_edge_outer_1' as SnapshotEntityId,
      label: 'Outer edge 1',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-1' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_edge_outer_2' as SnapshotEntityId,
      label: 'Outer edge 2',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-2' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_edge_outer_3' as SnapshotEntityId,
      label: 'Outer edge 3',
      target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-3' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_vertex_front_right' as SnapshotEntityId,
      label: 'Front right vertex',
      target: { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_front-right' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_vertex_front_left' as SnapshotEntityId,
      label: 'Front left vertex',
      target: { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_front-left' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_vertex_back_right' as SnapshotEntityId,
      label: 'Back right vertex',
      target: { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_back-right' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
    entity({
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      id: 'snapshot_entity_vertex_back_left' as SnapshotEntityId,
      label: 'Back left vertex',
      target: { kind: 'vertex', bodyId: 'body_part-1', vertexId: 'vertex_back-left' },
      relatedTargets: [{ kind: 'body', bodyId: 'body_part-1' }],
      consumedByFeatureIds: [],
    }),
  ]

  const features: DocumentSnapshot['document']['features'] = [
    {
      ownerDocumentId: DOCUMENT_ID,
      ownerRevisionId: REVISION_ID,
      ownerFeatureId: 'feature_extrude-1',
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: 'feature_extrude-1',
      label: 'Extrude 1',
      definition: {
        kind: 'extrude',
        featureTypeVersion: 'feature-type/extrude/v1alpha1',
        parameters: {
          profiles: [primaryRegion.target],
          startExtent: {
            kind: 'profilePlane',
          },
          endExtent: {
            kind: 'blind',
            direction: 'positive',
            distance: 12,
          },
          operation: 'newBody',
          booleanScope: {
            kind: 'standalone',
          },
        },
      },
      producedTargets: [
        { kind: 'body', bodyId: 'body_part-1' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_bottom' },
      ],
    },
    {
      ownerDocumentId: DOCUMENT_ID,
      ownerRevisionId: REVISION_ID,
      ownerFeatureId: 'feature_fillet-1',
      ownerSketchId: null,
      ownerBodyId: 'body_part-1',
      featureId: 'feature_fillet-1',
      label: 'Fillet 1',
      definition: {
        kind: 'fillet',
        featureTypeVersion: 'feature-type/fillet/v1alpha1',
        parameters: {
          radius: 1.5,
          edgeTargets: [{ kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' }],
        },
      },
      producedTargets: [
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-front' },
        { kind: 'face', bodyId: 'body_part-1', faceId: 'face_side-right' },
      ],
    },
  ]

  const document: DocumentSnapshot['document'] = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    documentId: DOCUMENT_ID,
    revisionId: REVISION_ID,
    settings: {
      linearUnit: 'millimeter',
      modelingTolerance: 0.001,
      angularToleranceRadians: 0.0001,
    },
    capabilities: {
      supportedFeatureKinds: ['extrude', 'fillet', 'sweep', 'loft', 'chamfer', 'thicken', 'split', 'deleteSolid'],
      previewableFeatureKinds: ['extrude', 'sweep', 'loft', 'chamfer', 'thicken', 'split', 'deleteSolid'],
      supportedProfileKinds: ['region', 'face'],
      supportsFaceBackedSketchPlanes: true,
      supportsDurableTopologyNaming: false,
    },
    featureTree: [
      {
        id: 'feature_tree_node_plane_xy' as FeatureTreeNodeId,
        label: 'Top Plane',
        description: 'Primary XY reference plane',
        kind: 'plane',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        ownerFeatureId: null,
        ownerSketchId: null,
        sourceFeatureId: null,
      },
      {
        id: 'feature_tree_node_sketch_1' as FeatureTreeNodeId,
        label: 'Sketch 1',
        description: 'Primary sketch on the XY plane',
        kind: 'sketch',
        target: { kind: 'sketch', sketchId: SKETCH_ID },
        ownerFeatureId: null,
        ownerSketchId: SKETCH_ID,
        sourceFeatureId: null,
      },
      {
        id: 'feature_tree_node_feature_extrude_1' as FeatureTreeNodeId,
        label: 'Extrude 1',
        description: 'Extrude from the derived outer sketch region',
        kind: 'feature',
        target: { kind: 'feature', featureId: 'feature_extrude-1' },
        ownerFeatureId: 'feature_extrude-1',
        ownerSketchId: null,
        sourceFeatureId: null,
      },
    ],
    objects: [
      {
        id: 'object_tree_node_body_part_1' as ObjectTreeNodeId,
        label: 'Part 1',
        description: 'Primary solid body',
        kind: 'body',
        target: { kind: 'body', bodyId: 'body_part-1' },
        ownerBodyId: 'body_part-1',
        ownerFeatureId: 'feature_extrude-1',
        ownerSketchId: null,
      },
      {
        id: 'object_tree_node_sketch_1' as ObjectTreeNodeId,
        label: 'Sketch 1',
        description: 'Primary sketch on the XY plane',
        kind: 'sketch',
        target: { kind: 'sketch', sketchId: SKETCH_ID },
        ownerBodyId: null,
        ownerFeatureId: null,
        ownerSketchId: SKETCH_ID,
      },
      {
        id: 'object_tree_node_plane_xy' as ObjectTreeNodeId,
        label: 'Top Plane',
        description: 'Construction plane',
        kind: 'construction',
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
        ownerBodyId: null,
        ownerFeatureId: null,
        ownerSketchId: null,
      },
    ],
    features,
    cursor: { kind: 'empty' },
    sketches: [
      {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: null,
        ownerSketchId: SKETCH_ID,
        ownerBodyId: null,
        sketchId: SKETCH_ID,
        label: 'Sketch 1',
        plane: createSketchPlaneDefinition({
          planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' },
          planeKey: 'xy',
        }),
        planeTarget: { kind: 'construction', constructionId: 'construction_plane-xy' as ConstructionId },
        planeKey: 'xy',
        sketch: sketchRecord,
      },
    ],
    bodies: [
      {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: 'feature_extrude-1',
        ownerSketchId: null,
        ownerBodyId: 'body_part-1',
        bodyId: 'body_part-1',
        label: 'Part 1',
        topology: {
          faceIds: ['face_top', 'face_bottom', 'face_side-front', 'face_side-right'],
          edgeIds: ['edge_outer-0', 'edge_outer-1', 'edge_outer-2', 'edge_outer-3'],
          vertexIds: ['vertex_front-right', 'vertex_front-left', 'vertex_back-right', 'vertex_back-left'],
        },
      },
    ],
    constructions: [
      {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: null,
        constructionId: 'construction_plane-xy',
        label: 'Top Plane',
        constructionType: 'plane',
        plane: createStandardPlaneDefinition('xy'),
        target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      },
      {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: null,
        constructionId: 'construction_plane-yz',
        label: 'Right Plane',
        constructionType: 'plane',
        plane: createStandardPlaneDefinition('yz'),
        target: { kind: 'construction', constructionId: 'construction_plane-yz' },
      },
      {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: null,
        ownerSketchId: null,
        ownerBodyId: null,
        constructionId: 'construction_plane-xz',
        label: 'Front Plane',
        constructionType: 'plane',
        plane: createStandardPlaneDefinition('xz'),
        target: { kind: 'construction', constructionId: 'construction_plane-xz' },
      },
    ],
    entities,
    references: [
      {
        id: 'ref_feature_extrude_region' as const,
        label: 'Extrude region',
        target: primaryRegion.target,
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: REVISION_ID,
        ownerFeatureId: 'feature_extrude-1',
        ownerSketchId: SKETCH_ID,
        ownerBodyId: null,
        invalidation: null,
      },
    ],
    diagnostics: [],
    render: {
      schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
      records: [
        ...createConstructionPlaneRenderRecords(),
        {
          id: 'renderable_face_top' as RenderableId,
          label: 'Top face',
          ownerBodyId: 'body_part-1',
          ownerFeatureId: 'feature_extrude-1',
          binding: {
            pickId: 'pick_face_top' as PickId,
            pickPriority: 20,
            target: { kind: 'face', bodyId: 'body_part-1', faceId: 'face_top' },
            topology: 'face',
            semanticClass: 'planarFace',
          },
          geometry: {
            kind: 'mesh',
            vertexPositions: [
              [-4, -3, 12],
              [4, -3, 12],
              [4, 3, 12],
              [-4, 3, 12],
            ],
            vertexNormals: [
              [0, 0, 1],
              [0, 0, 1],
              [0, 0, 1],
              [0, 0, 1],
            ],
            triangleIndices: [
              [0, 1, 2],
              [0, 2, 3],
            ],
          },
        },
        {
          id: 'renderable_edge_outer_0' as RenderableId,
          label: 'Outer edge',
          ownerBodyId: 'body_part-1',
          ownerFeatureId: 'feature_extrude-1',
          binding: {
            pickId: 'pick_edge_outer_0' as PickId,
            pickPriority: 10,
            target: { kind: 'edge', bodyId: 'body_part-1', edgeId: 'edge_outer-0' },
            topology: 'edge',
            semanticClass: 'featureEdge',
          },
          geometry: {
            kind: 'polyline',
            points: [[-4, -3, 12], [4, -3, 12]],
            isClosed: false,
          },
        },
      ],
    },
  }
  document.cursor = createTailDocumentCursor(createDocumentHistoryItems({
    featureTree: document.featureTree,
    features: document.features,
    sketches: document.sketches,
  }))

  const presentation: DocumentSnapshot['presentation'] = {
    featureTree: document.featureTree,
    objects: document.objects,
    documentHistory: createDocumentHistoryItems({
      featureTree: document.featureTree,
      features: document.features,
      sketches: document.sketches,
    }),
    entities,
  }

  return {
    document,
    presentation,
    contractVersion: document.contractVersion,
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    revisionId: document.revisionId,
    settings: document.settings,
    capabilities: document.capabilities,
    featureTree: presentation.featureTree,
    objects: presentation.objects,
    documentHistory: presentation.documentHistory,
    features: document.features,
    cursor: document.cursor,
    sketches: document.sketches,
    bodies: document.bodies,
    constructions: document.constructions,
    entities: presentation.entities,
    references: document.references,
    diagnostics: document.diagnostics,
    render: document.render,
  }
}

function entity(
  input: Omit<SnapshotEntityRecord, 'ownerDocumentId' | 'ownerRevisionId' | 'selectionSemantics'> & {
    selectionSemantics?: SnapshotEntityRecord['selectionSemantics']
  },
): SnapshotEntityRecord {
  const selectionSemantics = input.selectionSemantics ?? getSelectionSemanticsForTarget(input.target)
  return {
    ownerDocumentId: DOCUMENT_ID,
    ownerRevisionId: REVISION_ID,
    ...input,
    selectionSemantics,
  }
}

function updateSketchRecordRevision(sketch: SketchRecord, revisionId: RevisionId) {
  sketch.ownerRevisionId = revisionId
  sketch.solvedSnapshot.constraintStatuses = [...sketch.solvedSnapshot.constraintStatuses]
  sketch.solvedSnapshot.dimensionStatuses = [...sketch.solvedSnapshot.dimensionStatuses]
  sketch.solvedSnapshot.solvedEntities = [...sketch.solvedSnapshot.solvedEntities]
  sketch.solvedSnapshot.solvedPoints = [...sketch.solvedSnapshot.solvedPoints]
  sketch.regions = sketch.regions.map((region) => ({ ...region, ownerRevisionId: revisionId }))
}

function stampSnapshotRevision(snapshot: DocumentSnapshot, revisionId: RevisionId) {
  snapshot.revisionId = revisionId
  snapshot.document.revisionId = revisionId

  for (const feature of snapshot.document.features) {
    feature.ownerRevisionId = revisionId
  }

  for (const sketch of snapshot.document.sketches) {
    sketch.ownerRevisionId = revisionId
    updateSketchRecordRevision(sketch.sketch, revisionId)
  }

  for (const body of snapshot.document.bodies) {
    body.ownerRevisionId = revisionId
  }

  for (const construction of snapshot.document.constructions) {
    construction.ownerRevisionId = revisionId
  }

  for (const entityRecord of snapshot.presentation.entities) {
    entityRecord.ownerRevisionId = revisionId
  }

  for (const reference of snapshot.document.references) {
    reference.ownerRevisionId = revisionId
  }
}

function getSelectionSemanticsForTarget(target: SnapshotEntityRecord['target']): SnapshotEntityRecord['selectionSemantics'] {
  switch (target.kind) {
    case 'body':
      return ['body']
    case 'face':
      return target.faceId === 'face_top' ? ['face', 'planarFace', 'planarReference'] : ['face']
    case 'edge':
      return ['edge']
    case 'vertex':
      return ['vertex']
    case 'construction':
      return ['constructionPlane', 'planarReference']
    case 'sketch':
      return ['existingSketch']
    case 'region':
      return ['existingSketch']
    case 'sketchEntity':
      return ['sketchEntity']
    case 'sketchPoint':
      return ['sketchPoint']
    case 'constraint':
      return ['constraintAnnotation']
    case 'dimension':
      return ['dimensionAnnotation']
    default:
      return []
  }
}

function updateFeatureEntityRelationship(
  snapshot: DocumentSnapshot,
  featureId: FeatureId,
  changedTargets: DurableRef[],
) {
  const changedKeys = new Set(changedTargets.map((target) => getPrimitiveRefKey(target)))

  for (const entityRecord of snapshot.presentation.entities) {
    const entityKey = getPrimitiveRefKey(entityRecord.target)
    if (changedKeys.has(entityKey) && !entityRecord.consumedByFeatureIds.includes(featureId)) {
      entityRecord.consumedByFeatureIds = [...entityRecord.consumedByFeatureIds, featureId]
    }
  }
}

function rebuildFeatureTree(snapshot: DocumentSnapshot) {
  snapshot.presentation.featureTree = [
    {
      id: 'feature_tree_node_plane_xy' as FeatureTreeNodeId,
      label: 'Top Plane',
      description: 'Primary XY reference plane',
      kind: 'plane',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
      ownerFeatureId: null,
      ownerSketchId: null,
      sourceFeatureId: null,
    },
    {
      id: 'feature_tree_node_plane_yz' as FeatureTreeNodeId,
      label: 'Right Plane',
      description: 'Primary YZ reference plane',
      kind: 'plane',
      target: { kind: 'construction', constructionId: 'construction_plane-yz' },
      ownerFeatureId: null,
      ownerSketchId: null,
      sourceFeatureId: null,
    },
    {
      id: 'feature_tree_node_plane_xz' as FeatureTreeNodeId,
      label: 'Front Plane',
      description: 'Primary XZ reference plane',
      kind: 'plane',
      target: { kind: 'construction', constructionId: 'construction_plane-xz' },
      ownerFeatureId: null,
      ownerSketchId: null,
      sourceFeatureId: null,
    },
    ...snapshot.document.sketches.map((sketch, index) => ({
      id: (index === 0 ? 'feature_tree_node_sketch_1' : `feature_tree_node_sketch_${index + 1}`) as FeatureTreeNodeId,
      label: sketch.label,
      description: `Sketch on ${(sketch.planeKey ?? 'xy').toUpperCase()} plane`,
      kind: 'sketch' as const,
      target: { kind: 'sketch' as const, sketchId: sketch.sketchId },
      ownerFeatureId: null,
      ownerSketchId: sketch.sketchId,
      sourceFeatureId: null,
    })),
    ...snapshot.document.features.map((feature) => ({
      id: `feature_tree_node_${feature.featureId}` as FeatureTreeNodeId,
      label: feature.label,
      description: `${feature.definition.kind} feature`,
      kind: 'feature' as const,
      target: { kind: 'feature' as const, featureId: feature.featureId },
      ownerFeatureId: feature.featureId,
      ownerSketchId: null,
      sourceFeatureId: null,
    })),
  ]
  snapshot.featureTree = snapshot.presentation.featureTree
  snapshot.presentation.documentHistory = createDocumentHistoryItems({
    featureTree: snapshot.presentation.featureTree,
    features: snapshot.document.features,
    sketches: snapshot.document.sketches,
  })
  snapshot.documentHistory = snapshot.presentation.documentHistory
}

function rebuildObjectTree(snapshot: DocumentSnapshot) {
  const nonSketchObjects = snapshot.presentation.objects.filter((item) => item.kind !== 'sketch')
  snapshot.presentation.objects = [
    ...nonSketchObjects,
    ...snapshot.document.sketches.map((sketch, index) => ({
      id: (index === 0 ? 'object_tree_node_sketch_1' : `object_tree_node_sketch_${index + 1}`) as ObjectTreeNodeId,
      label: sketch.label,
      description: `Sketch on ${(sketch.planeKey ?? 'xy').toUpperCase()} plane`,
      kind: 'sketch' as const,
      target: { kind: 'sketch' as const, sketchId: sketch.sketchId },
      ownerBodyId: null,
      ownerFeatureId: null,
      ownerSketchId: sketch.sketchId,
    })),
  ]
  snapshot.document.objects = snapshot.presentation.objects
  snapshot.objects = snapshot.presentation.objects
}

function allocateFeatureId(snapshot: DocumentSnapshot, kind: FeatureDefinition['kind']): FeatureId {
  const prefix = `feature_${kind}-`
  let nextOrdinal = 1

  for (const feature of snapshot.document.features) {
    if (!feature.featureId.startsWith(prefix)) {
      continue
    }

    const ordinalText = feature.featureId.slice(prefix.length)
    const ordinal = Number.parseInt(ordinalText, 10)
    if (Number.isFinite(ordinal)) {
      nextOrdinal = Math.max(nextOrdinal, ordinal + 1)
    }
  }

  return `${prefix}${nextOrdinal}` as FeatureId
}

export class MockKernelAdapter implements ModelingKernelAdapter {
  private readonly solverAdapter: SketchSolverAdapter

  private snapshotPromise: Promise<DocumentSnapshot> | null = null
  private currentRevisionId: RevisionId = REVISION_ID
  private revisionSequence = 1

  constructor(options?: { solverAdapter?: SketchSolverAdapter }) {
    this.solverAdapter = options?.solverAdapter ?? new MockSketchSolverAdapter()
  }

  private async getSnapshot() {
    if (!this.snapshotPromise) {
      this.snapshotPromise = buildSnapshot(this.solverAdapter)
    }

    return this.snapshotPromise
  }

  private async mutateSnapshot<TResponse>(mutate: (snapshot: DocumentSnapshot, nextRevisionId: RevisionId) => TResponse): Promise<TResponse> {
    const snapshot = await this.getSnapshot()
    this.revisionSequence += 1
    const nextRevisionId = `rev_${String(this.revisionSequence).padStart(4, '0')}` as RevisionId
    const response = mutate(snapshot, nextRevisionId)
    stampSnapshotRevision(snapshot, nextRevisionId)
    this.currentRevisionId = nextRevisionId
    return response
  }

  async getDocumentSnapshot(_request: GetDocumentSnapshotRequest): Promise<GetDocumentSnapshotResponse> {
    assertSupportedModelingRequest(_request)

    return {
      contractVersion: CONTRACT_VERSION,
      snapshot: applyCursorToMockSnapshot(structuredClone(await this.getSnapshot())),
    }
  }

  async createFeature(request: CreateFeatureRequest): Promise<CreateFeatureResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()

    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: `feature_${getFeatureDefinitionLabel(request.definition)}-preview`,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    const validation = validateFeatureDefinitionAgainstSnapshot(request.definition, snapshot)

    if (!validation.accepted) {
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: request.baseRevisionId,
        featureId: `feature_${getFeatureDefinitionLabel(request.definition)}-preview`,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: validation.reasonCode,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics: validation.diagnostics,
        }),
        changedTargets: [],
        diagnostics: validation.diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      const featureId = allocateFeatureId(mutableSnapshot, request.definition.kind)
      const featureIndex = mutableSnapshot.document.features.filter((feature) => feature.definition.kind === request.definition.kind).length + 1
      const changedTargets = getFeatureDefinitionChangedTargets(request.definition)

      const featureLabel = request.featureLabel ?? `${request.definition.kind[0]!.toUpperCase()}${request.definition.kind.slice(1)} ${featureIndex}`
      const nextFeature = {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: nextRevisionId,
        ownerFeatureId: featureId,
        ownerSketchId: null,
        ownerBodyId: null,
        featureId,
        label: featureLabel,
        definition: request.definition,
        producedTargets: changedTargets,
      }
      mutableSnapshot.document.features.splice(
        getFeatureInsertionIndexForDocumentCursor(
          mutableSnapshot.presentation.documentHistory,
          mutableSnapshot.document.cursor,
        ),
        0,
        nextFeature,
      )
      mutableSnapshot.document.cursor = { kind: 'feature', featureId }
      mutableSnapshot.cursor = mutableSnapshot.document.cursor

      mutableSnapshot.presentation.entities.push(entity({
        ownerFeatureId: featureId,
        ownerSketchId: null,
        ownerBodyId: null,
        id: `snapshot_entity_${featureId}` as SnapshotEntityId,
        label: featureLabel,
        target: { kind: 'feature', featureId },
        relatedTargets: changedTargets,
        consumedByFeatureIds: [],
      }))

      updateFeatureEntityRelationship(mutableSnapshot, featureId, changedTargets)
      rebuildFeatureTree(mutableSnapshot)
      rebuildObjectTree(mutableSnapshot)

      const diagnostics = [
        {
          code: 'mock-create-feature',
          severity: 'info' as const,
          message: 'Mock kernel committed the feature create request into the current revision.',
          target: changedTargets[0] ?? null,
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        featureId,
        revisionState: {
          kind: 'accepted' as const,
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets,
        diagnostics,
      }
    })
  }

  async commitSketch(request: CommitSketchRequest): Promise<CommitSketchResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    const sketchId = request.sketchId ?? (`sketch_${snapshot.document.sketches.length + 1}` as SketchId)
    const solverCorrelation = getCommitSolverCorrelation(request)
    const referenceFrame = createSketchReferenceFrame({
      planeTarget: request.plane.support,
      planeKey: request.plane.key ?? 'xy',
    })

    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        sketchId,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    const existingSketch = snapshot.document.sketches.find((entry) => entry.sketchId === request.sketchId)
    if (isSketchRenameOnlyRequest(request, existingSketch)) {
      return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
        const mutableSketch = mutableSnapshot.document.sketches.find((entry) => entry.sketchId === request.sketchId)!
        mutableSketch.label = request.sketchLabel
        mutableSketch.ownerRevisionId = nextRevisionId
        mutableSketch.sketch = {
          ...mutableSketch.sketch,
          label: request.sketchLabel,
          ownerRevisionId: nextRevisionId,
        }

        for (const entityRecord of mutableSnapshot.presentation.entities) {
          if (entityRecord.target.kind === 'sketch' && entityRecord.target.sketchId === request.sketchId) {
            entityRecord.label = request.sketchLabel
          }
        }

        rebuildFeatureTree(mutableSnapshot)
        rebuildObjectTree(mutableSnapshot)

        const diagnostics = [
          {
            code: 'mock-rename-sketch',
            severity: 'info' as const,
            message: 'Mock kernel renamed the sketch without rebuilding unchanged geometry.',
            target: createSketchTarget(request.sketchId!),
            detail: null,
          },
        ]

        return {
          contractVersion: CONTRACT_VERSION,
          documentId: request.documentId,
          revisionId: nextRevisionId,
          sketchId: request.sketchId!,
          revisionState: {
            kind: 'accepted' as const,
            baseRevisionId: request.baseRevisionId,
          },
          rebuildResult: createRebuildResult({
            kind: 'rebuilt',
            revisionId: nextRevisionId,
            diagnostics,
          }),
          changedTargets: [createSketchTarget(request.sketchId!)],
          diagnostics,
        }
      })
    }

    const projection = await this.solverAdapter.projectExternalReferences({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: solverCorrelation.projectionRequestId,
      documentId: request.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: referenceFrame,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      references: request.definition.references.map((reference) => ({
        referenceId: reference.referenceId,
        reference,
      })),
    })
    const validation = await this.solverAdapter.validateSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: solverCorrelation.validationRequestId,
      documentId: request.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: referenceFrame,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      definition: request.definition,
      projectedReferences: projection.projectedReferences,
    })
    const solved = await this.solverAdapter.solveSketch({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: solverCorrelation.solveRequestId,
      documentId: request.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      plane: referenceFrame,
      tolerances: DEFAULT_MOCK_SOLVER_TOLERANCES,
      partialSolvePolicy: 'bestEffort',
      definition: request.definition,
      projectedReferences: projection.projectedReferences,
      incrementalEdit: null,
    })
    const regions = await this.solverAdapter.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: solverCorrelation.regionRequestId,
      documentId: request.documentId,
      revisionId: request.baseRevisionId,
      sketchId,
      solvedSnapshot: solved.solvedSnapshot,
      definition: request.definition,
    })

    const commitDiagnostics = [
      ...projection.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...validation.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...solved.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
      ...regions.diagnostics.map((diagnostic) => mapSketchSolverDiagnostic(sketchId, diagnostic)),
    ]

    if (!validation.isValid || solved.status.solveState === 'failed') {
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        sketchId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-invalid-sketch',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics: commitDiagnostics,
        }),
        changedTargets: [],
        diagnostics: commitDiagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      const sketchRecord: SketchRecord = {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: nextRevisionId,
        ownerFeatureId: null,
        ownerSketchId: sketchId,
        ownerBodyId: null,
        sketchId,
        label: request.sketchLabel,
        planeSupport: request.plane.support,
        definition: request.definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: regions.regions.map((region) => ({ ...region, ownerRevisionId: nextRevisionId })),
      }

      const changedTargets = [
        createSketchTarget(sketchId),
        ...regions.regions.map((region) => ({ ...region.target, sketchId })),
        ...request.definition.entities.map((entity) => ({ ...entity.target, sketchId })),
        ...request.definition.points.map((point) => ({ ...point.target, sketchId })),
      ]

      const existingIndex = mutableSnapshot.document.sketches.findIndex((entry) => entry.sketchId === sketchId)
      const snapshotSketch: DocumentSnapshot['sketches'][number] = {
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: nextRevisionId,
        ownerFeatureId: null,
        ownerSketchId: sketchId,
        ownerBodyId: null,
        sketchId,
        label: request.sketchLabel,
        plane: request.plane,
        planeTarget: request.planeTarget,
        planeKey: request.planeKey,
        sketch: sketchRecord,
      }

      if (existingIndex >= 0) {
        mutableSnapshot.document.sketches[existingIndex] = snapshotSketch
      } else {
        mutableSnapshot.document.sketches.push(snapshotSketch)
      }

      mutableSnapshot.presentation.entities = mutableSnapshot.presentation.entities.filter((entry) => entry.ownerSketchId !== sketchId)
      mutableSnapshot.entities = mutableSnapshot.presentation.entities
      mutableSnapshot.presentation.entities.push(entity({
        ownerFeatureId: null,
        ownerSketchId: sketchId,
        ownerBodyId: null,
        id: `snapshot_entity_${sketchId}` as SnapshotEntityId,
        label: request.sketchLabel,
        target: { kind: 'sketch', sketchId },
        relatedTargets: [request.planeTarget, ...sketchRecord.regions.map((region) => region.target)],
        consumedByFeatureIds: [],
      }))
      mutableSnapshot.presentation.entities.push(...sketchRecord.regions.map((region, index) =>
        entity({
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          id: `snapshot_entity_${sketchId}_region_${index}` as SnapshotEntityId,
          label: region.label,
          target: region.target,
          relatedTargets: [{ kind: 'sketch', sketchId }],
          consumedByFeatureIds: [],
        }),
      ))
      mutableSnapshot.presentation.entities.push(...request.definition.entities.map((entry, index) =>
        entity({
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          id: `snapshot_entity_${sketchId}_entity_${index}` as SnapshotEntityId,
          label: entry.label,
          target: { ...entry.target, sketchId },
          relatedTargets: [{ kind: 'sketch', sketchId }],
          consumedByFeatureIds: [],
        }),
      ))
      mutableSnapshot.presentation.entities.push(...request.definition.points.map((point, index) =>
        entity({
          ownerFeatureId: null,
          ownerSketchId: sketchId,
          ownerBodyId: null,
          id: `snapshot_entity_${sketchId}_point_${index}` as SnapshotEntityId,
          label: point.label,
          target: { ...point.target, sketchId },
          relatedTargets: [{ kind: 'sketch', sketchId }],
          consumedByFeatureIds: [],
        }),
      ))
      mutableSnapshot.entities = mutableSnapshot.presentation.entities

      rebuildFeatureTree(mutableSnapshot)
      rebuildObjectTree(mutableSnapshot)

      const diagnostics = [
        ...commitDiagnostics,
        {
          code: 'mock-commit-sketch',
          severity: 'info' as const,
          message: 'Mock kernel committed the sketch definition into the current revision.',
          target: createSketchTarget(sketchId),
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        sketchId,
        revisionState: {
          kind: 'accepted' as const,
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets,
        diagnostics,
      }
    })
  }

  async updateFeature(request: UpdateFeatureRequest): Promise<UpdateFeatureResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()

    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: request.featureId,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    const existingFeatureIndex = snapshot.document.features.findIndex((feature) => feature.featureId === request.featureId)
    if (existingFeatureIndex < 0) {
      const diagnostics = [createMissingFeatureDiagnostic(request.featureId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: request.featureId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-missing-feature',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    const validation = validateFeatureDefinitionAgainstSnapshot(request.definition, snapshot)

    if (!validation.accepted) {
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: request.baseRevisionId,
        featureId: request.featureId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: validation.reasonCode,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics: validation.diagnostics,
        }),
        changedTargets: [],
        diagnostics: validation.diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      const mutableFeature = mutableSnapshot.document.features.find((feature) => feature.featureId === request.featureId)!
      mutableFeature.definition = request.definition
      mutableFeature.label = request.featureLabel ?? mutableFeature.label
      mutableFeature.ownerRevisionId = nextRevisionId
      mutableFeature.producedTargets = getFeatureDefinitionChangedTargets(request.definition)

      const featureEntity = mutableSnapshot.presentation.entities.find(
        (entry) => entry.target.kind === 'feature' && entry.target.featureId === request.featureId,
      )
      if (featureEntity) {
        featureEntity.label = mutableFeature.label
        featureEntity.relatedTargets = mutableFeature.producedTargets
      }

      updateFeatureEntityRelationship(mutableSnapshot, request.featureId, mutableFeature.producedTargets)
      rebuildFeatureTree(mutableSnapshot)

      const diagnostics: UpdateFeatureResponse['diagnostics'] = [
        {
          code: 'mock-update-feature',
          severity: 'info',
          message: 'Mock kernel committed the feature update into the current revision.',
          target: mutableFeature.producedTargets[0] ?? { kind: 'feature', featureId: request.featureId },
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        featureId: request.featureId,
        revisionState: {
          kind: 'accepted',
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets: mutableFeature.producedTargets,
        diagnostics,
      }
    })
  }

  async deleteFeature(request: DeleteFeatureRequest): Promise<DeleteFeatureResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        deletedFeatureId: request.featureId,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    const existingFeature = snapshot.document.features.find((feature) => feature.featureId === request.featureId)
    if (!existingFeature) {
      const diagnostics = [createMissingFeatureDiagnostic(request.featureId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        deletedFeatureId: request.featureId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-missing-feature',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      mutableSnapshot.document.features = mutableSnapshot.document.features.filter((feature) => feature.featureId !== request.featureId)
      rebuildFeatureTree(mutableSnapshot)
      if (!isValidDocumentHistoryCursor(mutableSnapshot.presentation.documentHistory, mutableSnapshot.document.cursor)) {
        mutableSnapshot.document.cursor = createTailDocumentCursor(mutableSnapshot.presentation.documentHistory)
        mutableSnapshot.cursor = mutableSnapshot.document.cursor
      }
      mutableSnapshot.presentation.entities = mutableSnapshot.presentation.entities.filter(
        (entry) => !(entry.target.kind === 'feature' && entry.target.featureId === request.featureId),
      )
      mutableSnapshot.entities = mutableSnapshot.presentation.entities
      for (const entityRecord of mutableSnapshot.presentation.entities) {
        entityRecord.consumedByFeatureIds = entityRecord.consumedByFeatureIds.filter((featureId) => featureId !== request.featureId)
      }
      const diagnostics: DeleteFeatureResponse['diagnostics'] = [
        {
          code: 'mock-delete-feature',
          severity: 'info',
          message: 'Mock kernel committed the feature deletion into the current revision.',
          target: { kind: 'feature', featureId: request.featureId },
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        deletedFeatureId: request.featureId,
        revisionState: {
          kind: 'accepted',
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets: [{ kind: 'feature', featureId: request.featureId }],
        diagnostics,
      }
    })
  }

  async renameBody(request: RenameBodyRequest): Promise<RenameBodyResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        bodyId: request.bodyId,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    if (!snapshot.document.bodies.some((body) => body.bodyId === request.bodyId)) {
      const diagnostics = [createMissingBodyDiagnostic(request.bodyId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        bodyId: request.bodyId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-missing-body',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      const bodyTarget = { kind: 'body' as const, bodyId: request.bodyId }
      for (const body of mutableSnapshot.document.bodies) {
        if (body.bodyId === request.bodyId) {
          body.label = request.bodyLabel
          body.ownerRevisionId = nextRevisionId
        }
      }
      for (const item of mutableSnapshot.presentation.objects) {
        if (item.target.kind === 'body' && item.target.bodyId === request.bodyId) {
          item.label = request.bodyLabel
        }
      }
      for (const item of mutableSnapshot.document.objects) {
        if (item.target.kind === 'body' && item.target.bodyId === request.bodyId) {
          item.label = request.bodyLabel
        }
      }
      for (const entityRecord of mutableSnapshot.presentation.entities) {
        if (entityRecord.target.kind === 'body' && entityRecord.target.bodyId === request.bodyId) {
          entityRecord.label = request.bodyLabel
        }
      }
      mutableSnapshot.document.entities = mutableSnapshot.presentation.entities
      mutableSnapshot.entities = mutableSnapshot.presentation.entities

      const diagnostics: RenameBodyResponse['diagnostics'] = [
        {
          code: 'mock-rename-body',
          severity: 'info',
          message: 'Mock kernel committed the body rename into the current revision.',
          target: bodyTarget,
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        bodyId: request.bodyId,
        revisionState: {
          kind: 'accepted',
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets: [bodyTarget],
        diagnostics,
      }
    })
  }

  async reorderFeature(request: ReorderFeatureRequest): Promise<ReorderFeatureResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    if (!snapshot.document.features.some((feature) => feature.featureId === request.featureId)) {
      const diagnostics = [createMissingFeatureDiagnostic(request.featureId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-missing-feature',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    if (request.beforeFeatureId !== null && !snapshot.document.features.some((feature) => feature.featureId === request.beforeFeatureId)) {
      const diagnostics = [createMissingFeatureAnchorDiagnostic(request.beforeFeatureId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-missing-reorder-anchor',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      const fromIndex = mutableSnapshot.features.findIndex((feature) => feature.featureId === request.featureId)
      const [moved] = mutableSnapshot.features.splice(fromIndex, 1)
      const targetIndex = request.beforeFeatureId === null
        ? mutableSnapshot.features.length
        : mutableSnapshot.features.findIndex((feature) => feature.featureId === request.beforeFeatureId)
      mutableSnapshot.features.splice(targetIndex, 0, moved!)
      rebuildFeatureTree(mutableSnapshot)

      const diagnostics: ReorderFeatureResponse['diagnostics'] = [
        {
          code: 'mock-reorder-feature',
          severity: 'info',
          message: 'Mock kernel committed the feature reorder into the current revision.',
          target: { kind: 'feature', featureId: request.featureId },
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        featureId: request.featureId,
        beforeFeatureId: request.beforeFeatureId,
        revisionState: {
          kind: 'accepted',
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets: [{ kind: 'feature', featureId: request.featureId }],
        diagnostics,
      }
    })
  }

  async setFeatureCursor(request: SetFeatureCursorRequest): Promise<SetFeatureCursorResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()

    if (hasRevisionConflict(request.baseRevisionId, this.currentRevisionId)) {
      const diagnostics = [createRevisionConflictDiagnostic(request.baseRevisionId, this.currentRevisionId)]
      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        cursor: snapshot.document.cursor,
        revisionState: {
          kind: 'conflict',
          expectedRevisionId: request.baseRevisionId,
          actualRevisionId: this.currentRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'revisionConflict',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    if (!isValidDocumentHistoryCursor(snapshot.presentation.documentHistory, request.cursor)) {
      const diagnostics = request.cursor.kind === 'feature'
        ? [createMissingFeatureDiagnostic(request.cursor.featureId)]
        : [{
            code: 'mock-invalid-document-cursor',
            severity: 'error' as const,
            message: 'The requested document cursor does not resolve to an authored history item.',
            target: request.cursor.kind === 'sketch'
              ? { kind: 'sketch' as const, sketchId: request.cursor.sketchId }
              : null,
            detail: null,
          }]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: this.currentRevisionId,
        cursor: snapshot.document.cursor,
        revisionState: {
          kind: 'rejected',
          baseRevisionId: request.baseRevisionId,
          reasonCode: 'mock-invalid-document-cursor',
        },
        rebuildResult: createRebuildResult({
          kind: 'skipped',
          reasonCode: 'validationRejected',
          diagnostics,
        }),
        changedTargets: [],
        diagnostics,
      }
    }

    return this.mutateSnapshot((mutableSnapshot, nextRevisionId) => {
      mutableSnapshot.document.cursor = request.cursor
      mutableSnapshot.cursor = mutableSnapshot.document.cursor
      const changedTargets =
        request.cursor.kind === 'feature'
          ? [{ kind: 'feature' as const, featureId: request.cursor.featureId }]
          : request.cursor.kind === 'sketch'
            ? [{ kind: 'sketch' as const, sketchId: request.cursor.sketchId }]
            : []
      const diagnostics: SetFeatureCursorResponse['diagnostics'] = [
        {
          code: 'mock-set-feature-cursor',
          severity: 'info',
          message: 'Mock kernel moved the document feature cursor.',
          target: changedTargets[0] ?? null,
          detail: null,
        },
      ]

      return {
        contractVersion: CONTRACT_VERSION,
        documentId: request.documentId,
        revisionId: nextRevisionId,
        cursor: request.cursor,
        revisionState: {
          kind: 'accepted',
          baseRevisionId: request.baseRevisionId,
        },
        rebuildResult: createRebuildResult({
          kind: 'rebuilt',
          revisionId: nextRevisionId,
          diagnostics,
        }),
        changedTargets,
        diagnostics,
      }
    })
  }

  async evaluatePreview(request: EvaluatePreviewRequest): Promise<EvaluatePreviewResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    const validation = validateFeatureDefinitionAgainstSnapshot(request.definition, snapshot)
    return {
      contractVersion: CONTRACT_VERSION,
      documentId: request.documentId,
      revisionId: request.baseRevisionId === this.currentRevisionId ? request.baseRevisionId : this.currentRevisionId,
      previewId: request.previewId,
      freshness: request.baseRevisionId === this.currentRevisionId
        ? { kind: 'fresh', baseRevisionId: request.baseRevisionId }
        : {
            kind: 'stale',
            requestedRevisionId: request.baseRevisionId,
            currentRevisionId: this.currentRevisionId,
          },
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: validation.accepted ? buildPreviewRenderables(request.definition, snapshot) : [],
      },
      diagnostics: validation.diagnostics,
    }
  }

  async resolveReference(request: ResolveReferenceRequest): Promise<ResolveReferenceResponse> {
    assertSupportedModelingRequest(request)
    const snapshot = await this.getSnapshot()
    const entityRecord = snapshot.entities.find((entry) => getPrimitiveRefKey(entry.target) === getPrimitiveRefKey(request.target))

    return {
      contractVersion: CONTRACT_VERSION,
      resolution: {
        label: entityRecord?.label ?? 'Resolved target',
        target: request.target,
        ownerDocumentId: DOCUMENT_ID,
        ownerRevisionId: this.currentRevisionId,
        ownerFeatureId: entityRecord?.ownerFeatureId ?? null,
        ownerSketchId: entityRecord?.ownerSketchId ?? null,
        ownerBodyId: entityRecord?.ownerBodyId ?? null,
        invalidation: entityRecord
          ? null
          : {
              reason: 'mock-missing-reference',
              target: request.target,
              ownerFeatureId: null,
              ownerSketchId: null,
              sourceTarget: null,
            },
      },
      diagnostics: entityRecord
        ? []
        : [
            {
              code: 'mock-invalid-reference',
              severity: 'error',
              message: 'Requested durable reference does not resolve in the current snapshot.',
              target: request.target,
              detail: {
                kind: 'invalidReference',
                reference: {
                  reason: 'mock-missing-reference',
                  target: request.target,
                  ownerFeatureId: null,
                  ownerSketchId: null,
                  sourceTarget: null,
                },
              },
            },
          ],
    }
  }
}
