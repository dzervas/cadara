import type {
  BodySnapshotRecord,
  ConstructionSnapshotRecord,
  DocumentPresentationSnapshot,
  FeatureSnapshotRecord,
  FeatureTreeNodeRecord,
  KernelDocumentSnapshot,
  ModelingDiagnostic,
  ObjectTreeNodeRecord,
  ReferenceRecord,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
  WorkspaceSnapshot,
} from '@/contracts/modeling/schema'
import type {
  RenderPoint3D,
  RenderableEntityRecord,
} from '@/contracts/render/schema'
import type { SolvedSketchEntityGeometryRecord } from '@/contracts/sketch/schema'
import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  ReferenceId,
  RenderableId,
  SketchId,
  SnapshotEntityId,
  VertexId,
} from '@/contracts/shared/ids'
import type {
  ConstructionRef,
  DurableRef,
  EdgeRef,
  FaceRef,
  RegionRef,
  SketchEntityRef,
  SketchPointRef,
  VertexRef,
} from '@/contracts/shared/references'
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  OCC_CONTRACT_GAP_CODES,
  OCC_PHASE0_IMPLEMENTATION_NOTES,
} from '@/domain/modeling/occ/implementation-policy'
import { mapSketchPointToWorld } from '@/domain/modeling/occ/geometry'
import type { OccAuthoringState } from '@/domain/modeling/occ/authoring-state'
import {
  OCC_KERNEL_CAPABILITIES,
  OCC_KERNEL_SETTINGS,
} from '@/domain/modeling/opencascade-kernel-seed'
import { createDocumentHistoryItems } from '@/domain/modeling/document-history'
import { extractPlanarFaceData } from '@/domain/modeling/occ/planes'
import { buildRegionProfileFace } from '@/domain/modeling/occ/sketch-profile'
import { deleteOccObject } from '@/domain/modeling/occ/memory'
import {
  getOccDurableRefKey,
  type OccTrackedBody,
} from '@/domain/modeling/occ/topology'
import { getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'

const FACE_PICK_PRIORITY = 20
const SKETCH_CURVE_PICK_PRIORITY = 12
const EDGE_PICK_PRIORITY = 10
const REGION_PICK_PRIORITY = 8
const SKETCH_POINT_PICK_PRIORITY = 1
const VERTEX_PICK_PRIORITY = 0
const CONSTRUCTION_PICK_PRIORITY = 40

const DEFAULT_EDGE_SAMPLE_COUNT = 33
const DEFAULT_CIRCLE_SAMPLE_COUNT = 64
const DEFAULT_ARC_SAMPLE_COUNT = 33
const DEFAULT_ADVANCED_CURVE_SAMPLE_COUNT = 64
const DEFAULT_POINT_DISPLAY_RADIUS = 0.25
const DEFAULT_LINEAR_DEFLECTION = 0.1
const DEFAULT_ANGULAR_DEFLECTION = 0.5
const PROFILE_TEXT_WIDTH_FACTOR = 0.6

function sanitizeIdSegment(value: string) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+/g, '')
    .replace(/_+$/g, '')
}

function createReferenceId(target: DurableRef) {
  return `ref_occ_${sanitizeIdSegment(getOccDurableRefKey(target))}` as ReferenceId
}

function createSnapshotEntityId(target: DurableRef) {
  return `snapshot_entity_occ_${sanitizeIdSegment(getOccDurableRefKey(target))}` as SnapshotEntityId
}

function createRenderableId(target: DurableRef) {
  return `renderable_occ_${sanitizeIdSegment(getOccDurableRefKey(target))}` as RenderableId
}

function createPickId(target: DurableRef) {
  return `pick_occ_${sanitizeIdSegment(getOccDurableRefKey(target))}` as PickId
}

function createFeatureTreeNodeId(prefix: string, target: DurableRef) {
  return `feature_tree_node_occ_${prefix}_${sanitizeIdSegment(getOccDurableRefKey(target))}` as FeatureTreeNodeId
}

function createObjectTreeNodeId(prefix: string, target: DurableRef) {
  return `object_tree_node_occ_${prefix}_${sanitizeIdSegment(getOccDurableRefKey(target))}` as ObjectTreeNodeId
}

function createFaceTarget(bodyId: BodyId, faceId: FaceId): FaceRef {
  return { kind: 'face', bodyId, faceId }
}

function createEdgeTarget(bodyId: BodyId, edgeId: EdgeId): EdgeRef {
  return { kind: 'edge', bodyId, edgeId }
}

function createVertexTarget(bodyId: BodyId, vertexId: VertexId): VertexRef {
  return { kind: 'vertex', bodyId, vertexId }
}

function toRenderPoint(point: { X(): number; Y(): number; Z(): number }): RenderPoint3D {
  return [point.X(), point.Y(), point.Z()]
}

function buildFeatureLabel(featureId: FeatureId, explicitLabel?: string) {
  return explicitLabel ?? featureId
}

function createConstructionPlaneGapDiagnostic(
  construction: ConstructionSnapshotRecord,
): ModelingDiagnostic {
  return {
    code: OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable,
    severity: 'warning',
    message: OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionSnapshots,
    target: construction.target,
    detail: null,
  }
}

function getFaceSemanticClasses(
  state: OccAuthoringState,
  face: InstanceType<OccAuthoringState['oc']['TopoDS_Face']>,
) {
  try {
    extractPlanarFaceData(state.oc, face)
    return {
      entity: ['face', 'planarFace', 'planarReference'] as const,
      render: 'planarFace' as const,
    }
  } catch {
    return {
      entity: ['face'] as const,
      render: 'bodyFace' as const,
    }
  }
}

type FaceSemanticClasses = ReturnType<typeof getFaceSemanticClasses>

function collectFeatureConsumedTargets(definition: OccAuthoringState['features'][number]['definition']) {
  const targets: DurableRef[] = []
  let booleanScope:
    | Extract<typeof definition, { kind: 'extrude' }>['parameters']['booleanScope']
    | Extract<typeof definition, { kind: 'revolve' }>['parameters']['booleanScope']
    | Extract<typeof definition, { kind: 'shell' }>['parameters']['booleanScope']
    | null = null

  switch (definition.kind) {
    case 'extrude':
      targets.push(...definition.parameters.profiles)
      booleanScope = definition.parameters.booleanScope
      break
    case 'fillet':
      targets.push(...definition.parameters.edgeTargets)
      break
    case 'plane':
      targets.push(definition.parameters.reference.target)
      break
    case 'revolve':
      targets.push(...definition.parameters.profiles, definition.parameters.axis)
      booleanScope = definition.parameters.booleanScope
      break
    case 'shell':
      targets.push(definition.parameters.bodyTarget, ...definition.parameters.faceTargets)
      booleanScope = definition.parameters.booleanScope
      break
    default:
      targets.push(...definition.parameters.participants.flatMap((participant) => [...participant.targets]))
      break
  }

  if (booleanScope?.kind === 'targetBody') {
    targets.push({ kind: 'body', bodyId: booleanScope.bodyId })
  } else if (booleanScope?.kind === 'targetBodies') {
    targets.push(...booleanScope.bodyIds.map((bodyId) => ({ kind: 'body', bodyId } as const)))
  }

  return targets
}

function createFeatureConsumerMap(state: OccAuthoringState) {
  const consumers = new Map<string, FeatureId[]>()

  for (const feature of state.features) {
    const featureId = feature.featureId
    const uniqueKeys = new Set<string>()

    for (const target of collectFeatureConsumedTargets(feature.definition)) {
      uniqueKeys.add(getOccDurableRefKey(target))
    }

    for (const key of uniqueKeys) {
      const current = consumers.get(key)

      if (current) {
        current.push(featureId)
        continue
      }

      consumers.set(key, [featureId])
    }
  }

  return consumers
}

function createProducedTargetsByFeatureId(
  features: readonly OccAuthoringState['features'][number][],
) {
  const producedTargetsByFeatureId = new Map<FeatureId, DurableRef[]>()

  for (const feature of features) {
    if (!feature.producedTargets || feature.producedTargets.length === 0) {
      producedTargetsByFeatureId.set(feature.featureId, [])
      continue
    }

    producedTargetsByFeatureId.set(
      feature.featureId,
      [...feature.producedTargets].sort((left, right) =>
        getOccDurableRefKey(left).localeCompare(getOccDurableRefKey(right)),
      ),
    )
  }

  return producedTargetsByFeatureId
}

function createSnapshotFeatureDefinition(
  definition: OccAuthoringState['features'][number]['definition'],
): FeatureSnapshotRecord['definition'] {
  switch (definition.kind) {
    case 'extrude':
      return {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: definition.parameters.profiles,
          startExtent: { kind: 'profilePlane' },
          ...(definition.parameters.extent ? { extent: definition.parameters.extent } : {}),
          endExtent: definition.parameters.endExtent,
          operation: definition.parameters.operation,
          booleanScope: definition.parameters.booleanScope,
        },
      }
    case 'fillet':
      return {
        kind: 'fillet',
        featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
        parameters: {
          radius: definition.parameters.radius,
          edgeTargets: definition.parameters.edgeTargets,
        },
      }
    case 'plane':
      return {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: definition.parameters.reference,
        },
      }
    case 'revolve': {
      const revolveExtent = getRevolveFeatureExtent(definition.parameters)
      const firstRevolveEnd = revolveExtent.mode === 'twoSide' ? revolveExtent.firstEnd : revolveExtent.end
      return {
        kind: 'revolve',
        featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: definition.parameters.profiles,
          axis: definition.parameters.axis,
          startAngle: definition.parameters.startAngle,
          extent: definition.parameters.extent,
          angle: firstRevolveEnd.kind === 'blind' ? firstRevolveEnd.angle : definition.parameters.angle,
          operation: definition.parameters.operation,
          booleanScope: definition.parameters.booleanScope,
        },
      }
    }
    case 'shell':
      return {
        kind: 'shell',
        featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
        parameters: {
          bodyTarget: definition.parameters.bodyTarget,
          faceTargets: definition.parameters.faceTargets,
          thickness: definition.parameters.thickness,
          direction: definition.parameters.direction,
          operation: definition.parameters.operation,
          booleanScope: definition.parameters.booleanScope,
        },
      }
    default:
      return {
        kind: definition.kind,
        featureTypeVersion: definition.featureTypeVersion,
        parameters: {
          ...definition.parameters,
          participants: definition.parameters.participants.map((participant) => ({
            role: participant.role,
            targets: [...participant.targets],
          })),
        },
      }
  }
}

function buildSnapshotPresentationRecords(
  state: OccAuthoringState,
  producedTargetsByFeatureId: ReadonlyMap<FeatureId, readonly DurableRef[]>,
) {
  const features: FeatureSnapshotRecord[] = []
  const constructionFeatureTree: FeatureTreeNodeRecord[] = []
  const objects: ObjectTreeNodeRecord[] = []
  const sketchNodes = new Map<SketchId, FeatureTreeNodeRecord>()
  const featureNodes = new Map<FeatureId, FeatureTreeNodeRecord>()

  for (const construction of state.constructions) {
    constructionFeatureTree.push({
      id: createFeatureTreeNodeId('construction', construction.target),
      label: construction.label,
      description: 'Construction plane',
      kind: 'plane',
      target: construction.target,
      ownerFeatureId: construction.ownerFeatureId,
      ownerSketchId: null,
      sourceFeatureId: construction.ownerFeatureId,
    })
    objects.push({
      id: createObjectTreeNodeId('construction', construction.target),
      label: construction.label,
      description: 'Construction plane',
      kind: 'construction',
      target: construction.target,
      ownerBodyId: null,
      ownerFeatureId: construction.ownerFeatureId,
      ownerSketchId: null,
    })
  }

  for (const sketch of state.sketches) {
    const target = { kind: 'sketch', sketchId: sketch.sketchId } as const
    sketchNodes.set(sketch.sketchId, {
      id: createFeatureTreeNodeId('sketch', target),
      label: sketch.label,
      description: 'Authored sketch',
      kind: 'sketch',
      target,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      sourceFeatureId: sketch.ownerFeatureId,
    })
    objects.push({
      id: createObjectTreeNodeId('sketch', target),
      label: sketch.label,
      description: 'Authored sketch',
      kind: 'sketch',
      target,
      ownerBodyId: null,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
    })
  }

  for (const feature of state.features) {
    const snapshot: FeatureSnapshotRecord = {
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: feature.featureId,
      ownerSketchId: null,
      ownerBodyId: null,
      featureId: feature.featureId,
      label: buildFeatureLabel(feature.featureId, feature.label),
      definition: createSnapshotFeatureDefinition(feature.definition),
      producedTargets: [...(producedTargetsByFeatureId.get(feature.featureId) ?? [])],
    }

    features.push(snapshot)
    featureNodes.set(snapshot.featureId, {
      id: createFeatureTreeNodeId('feature', { kind: 'feature', featureId: snapshot.featureId }),
      label: snapshot.label,
      description: `${snapshot.definition.kind} feature`,
      kind: 'feature',
      target: { kind: 'feature', featureId: snapshot.featureId },
      ownerFeatureId: snapshot.featureId,
      ownerSketchId: null,
      sourceFeatureId: null,
    })
  }

  const historyItems = createDocumentHistoryItems({
    featureTree: [],
    features,
    sketches: state.sketches,
    historyOrder: state.historyOrder,
  })
  const featureTree: FeatureTreeNodeRecord[] = [
    ...constructionFeatureTree,
    ...historyItems.flatMap((item) => {
      const node = item.kind === 'sketch'
        ? sketchNodes.get(item.sketchId)
        : featureNodes.get(item.featureId)
      return node ? [node] : []
    }),
  ]

  for (const body of state.bodies) {
    const target = { kind: 'body', bodyId: body.bodyId } as const
    objects.push({
      id: createObjectTreeNodeId('body', target),
      label: body.label,
      description: 'Solid body',
      kind: 'body',
      target,
      ownerBodyId: body.bodyId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
    })
  }

  return {
    features,
    featureTree,
    objects,
  }
}

function createFaceSemanticClassMap(state: OccAuthoringState) {
  const faceSemanticClasses = new Map<string, FaceSemanticClasses>()

  for (const body of state.bodies) {
    for (const faceId of body.topology.faceIds) {
      const face = body.facesById.get(faceId)

      if (!face) {
        continue
      }

      const target = createFaceTarget(body.bodyId, faceId)
      faceSemanticClasses.set(getOccDurableRefKey(target), getFaceSemanticClasses(state, face))
    }
  }

  return faceSemanticClasses
}

function buildBodyEntities(
  state: OccAuthoringState,
  body: OccTrackedBody,
  consumerMap: ReadonlyMap<string, FeatureId[]>,
  faceSemanticClasses: ReadonlyMap<string, FaceSemanticClasses>,
): SnapshotEntityRecord[] {
  const bodyTarget = { kind: 'body', bodyId: body.bodyId } as const
  const records: SnapshotEntityRecord[] = [
    {
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
      id: createSnapshotEntityId(bodyTarget),
      label: body.label,
      target: bodyTarget,
      relatedTargets: [],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(bodyTarget)) ?? [],
      selectionSemantics: ['body'],
    },
  ]

  for (const faceId of body.topology.faceIds) {
    const target = createFaceTarget(body.bodyId, faceId)
    const face = body.facesById.get(faceId)

    if (!face) {
      continue
    }

    const semantics = faceSemanticClasses.get(getOccDurableRefKey(target)) ?? getFaceSemanticClasses(state, face)
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
      id: createSnapshotEntityId(target),
      label: `${body.label} ${faceId}`,
      target,
      relatedTargets: [bodyTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(target)) ?? [],
      selectionSemantics: [...semantics.entity],
    })
  }

  for (const edgeId of body.topology.edgeIds) {
    const target = createEdgeTarget(body.bodyId, edgeId)
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
      id: createSnapshotEntityId(target),
      label: `${body.label} ${edgeId}`,
      target,
      relatedTargets: [bodyTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(target)) ?? [],
      selectionSemantics: ['edge'],
    })
  }

  for (const vertexId of body.topology.vertexIds) {
    const target = createVertexTarget(body.bodyId, vertexId)
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
      id: createSnapshotEntityId(target),
      label: `${body.label} ${vertexId}`,
      target,
      relatedTargets: [bodyTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(target)) ?? [],
      selectionSemantics: ['vertex'],
    })
  }

  return records
}

function buildConstructionEntities(
  state: OccAuthoringState,
  consumerMap: ReadonlyMap<string, FeatureId[]>,
): SnapshotEntityRecord[] {
  return state.constructions.map((construction) => ({
    ownerDocumentId: state.documentId,
    ownerRevisionId: state.revisionId,
    ownerFeatureId: construction.ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: null,
    id: createSnapshotEntityId(construction.target),
    label: construction.label,
    target: construction.target,
    relatedTargets: [],
    consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(construction.target)) ?? [],
    selectionSemantics: ['constructionPlane', 'planarReference'],
  }))
}

function buildSketchEntities(
  state: OccAuthoringState,
  sketch: SketchSnapshotRecord,
  consumerMap: ReadonlyMap<string, FeatureId[]>,
): SnapshotEntityRecord[] {
  const sketchTarget = { kind: 'sketch', sketchId: sketch.sketchId } as const
  const records: SnapshotEntityRecord[] = [
    {
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      id: createSnapshotEntityId(sketchTarget),
      label: sketch.label,
      target: sketchTarget,
      relatedTargets: [],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(sketchTarget)) ?? [],
      selectionSemantics: ['existingSketch'],
    },
  ]

  for (const region of sketch.sketch.regions) {
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: region.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: region.ownerBodyId,
      id: createSnapshotEntityId(region.target),
      label: region.label,
      target: region.target,
      relatedTargets: [sketchTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(region.target)) ?? [],
      selectionSemantics: ['existingSketch'],
    })
  }

  for (const entity of sketch.sketch.definition.entities) {
    const target = { kind: 'sketchEntity', sketchId: sketch.sketchId, entityId: entity.entityId } as const
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      id: createSnapshotEntityId(target),
      label: entity.label,
      target,
      relatedTargets: [sketchTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(target)) ?? [],
      selectionSemantics: ['sketchEntity'],
    })
  }

  for (const point of sketch.sketch.definition.points) {
    const target = { kind: 'sketchPoint', sketchId: sketch.sketchId, pointId: point.pointId } as const
    records.push({
      ownerDocumentId: state.documentId,
      ownerRevisionId: state.revisionId,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      id: createSnapshotEntityId(target),
      label: point.label,
      target,
      relatedTargets: [sketchTarget],
      consumedByFeatureIds: consumerMap.get(getOccDurableRefKey(target)) ?? [],
      selectionSemantics: [],
    })
  }

  return records
}

function buildSnapshotEntities(
  state: OccAuthoringState,
  consumerMap: ReadonlyMap<string, FeatureId[]>,
  faceSemanticClasses: ReadonlyMap<string, FaceSemanticClasses>,
) {
  return [
    ...buildConstructionEntities(state, consumerMap),
    ...state.sketches.flatMap((sketch) => buildSketchEntities(state, sketch, consumerMap)),
    ...state.bodies.flatMap((body) => buildBodyEntities(state, body, consumerMap, faceSemanticClasses)),
  ]
}

function buildReferenceRecords(state: OccAuthoringState): ReferenceRecord[] {
  const entries = [
    ...state.referenceState.liveReferencesByKey.values(),
    ...state.referenceState.invalidatedReferencesByKey.values(),
  ]

  return entries
    .slice()
    .sort((left, right) => getOccDurableRefKey(left.target).localeCompare(getOccDurableRefKey(right.target)))
    .map((reference) => ({
      id: createReferenceId(reference.target),
      label: reference.label,
      target: reference.target,
      ownerDocumentId: reference.ownerDocumentId,
      ownerRevisionId: reference.ownerRevisionId,
      ownerFeatureId: reference.ownerFeatureId,
      ownerSketchId: reference.ownerSketchId,
      ownerBodyId: reference.ownerBodyId,
      invalidation: reference.invalidation,
    }))
}

export function buildOccSnapshotDiagnostics(
  state: OccAuthoringState,
  extraDiagnostics: readonly ModelingDiagnostic[],
): ModelingDiagnostic[] {
  const diagnostics = [...state.diagnostics, ...extraDiagnostics]

  for (const construction of state.constructions) {
    if (construction.ownerFeatureId !== null) {
      diagnostics.push(createConstructionPlaneGapDiagnostic(construction))
    }
  }

  return diagnostics
}

function buildConstructionRenderRecords(state: OccAuthoringState): RenderableEntityRecord[] {
  return state.constructions.flatMap((construction) => {
    const plane = state.constructionPlanes.get(construction.constructionId)

    if (!plane) {
      return []
    }

    const size = 10
    const { origin, xAxis, yAxis } = plane.frame
    const points: RenderPoint3D[] = [
      [
        origin[0] + xAxis[0] * -size + yAxis[0] * -size,
        origin[1] + xAxis[1] * -size + yAxis[1] * -size,
        origin[2] + xAxis[2] * -size + yAxis[2] * -size,
      ],
      [
        origin[0] + xAxis[0] * size + yAxis[0] * -size,
        origin[1] + xAxis[1] * size + yAxis[1] * -size,
        origin[2] + xAxis[2] * size + yAxis[2] * -size,
      ],
      [
        origin[0] + xAxis[0] * size + yAxis[0] * size,
        origin[1] + xAxis[1] * size + yAxis[1] * size,
        origin[2] + xAxis[2] * size + yAxis[2] * size,
      ],
      [
        origin[0] + xAxis[0] * -size + yAxis[0] * size,
        origin[1] + xAxis[1] * -size + yAxis[1] * size,
        origin[2] + xAxis[2] * -size + yAxis[2] * size,
      ],
    ]

    const target = construction.target as ConstructionRef
    const normal = plane.frame.normal

    return [
      {
        id: createRenderableId(target),
        label: construction.label,
        ownerBodyId: null,
        ownerFeatureId: construction.ownerFeatureId,
        binding: {
          pickId: createPickId(target),
          pickPriority: CONSTRUCTION_PICK_PRIORITY,
          target,
          topology: null,
          semanticClass: 'construction',
        },
        geometry: {
          kind: 'mesh',
          vertexPositions: points,
          vertexNormals: [normal, normal, normal, normal],
          triangleIndices: [
            [0, 1, 2],
            [0, 2, 3],
          ],
        },
      } satisfies RenderableEntityRecord,
      {
        id: `${createRenderableId(target)}_outline` as RenderableId,
        label: `${construction.label} outline`,
        ownerBodyId: null,
        ownerFeatureId: construction.ownerFeatureId,
        binding: {
          pickId: `${createPickId(target)}_outline` as PickId,
          pickPriority: CONSTRUCTION_PICK_PRIORITY,
          target,
          topology: null,
          semanticClass: 'construction',
        },
        geometry: {
          kind: 'polyline',
          points,
          isClosed: true,
        },
      } satisfies RenderableEntityRecord,
    ]
  })
}

function buildMeshGeometryFromFace(
  state: OccAuthoringState,
  face: InstanceType<OccAuthoringState['oc']['TopoDS_Face']>,
) {
  const location = new state.oc.TopLoc_Location_1()
  const triangulationHandle = state.oc.BRep_Tool.Triangulation(face, location, 0 as never)

  if (triangulationHandle.IsNull()) {
    return null
  }

  const triangulation = triangulationHandle.get()
  const nodeCount = triangulation.NbNodes()
  const triangleCount = triangulation.NbTriangles()
  const hasNormals = triangulation.HasNormals()
  const isReversed = getFaceOrientationIsReversed(state, face)
  const vertexPositions = new Array<RenderPoint3D>(nodeCount)
  const vertexNormals = hasNormals ? new Array<RenderPoint3D>(nodeCount) : null
  const triangleIndices = new Array<readonly [number, number, number]>(triangleCount)

  for (let index = 1; index <= nodeCount; index += 1) {
    vertexPositions[index - 1] = applyLocationToPoint(triangulation.Node(index), location)

    if (vertexNormals) {
      const transformedNormal = triangulation.Normal_1(index).Transformed(location.Transformation())
      const baseNormal: RenderPoint3D = [
        transformedNormal.X(),
        transformedNormal.Y(),
        transformedNormal.Z(),
      ]

      vertexNormals[index - 1] = isReversed
        ? [-baseNormal[0], -baseNormal[1], -baseNormal[2]]
        : baseNormal
    }
  }

  for (let index = 1; index <= triangleCount; index += 1) {
    const triangle = triangulation.Triangle(index)
    const first = triangle.Value(1) - 1
    const second = triangle.Value(2) - 1
    const third = triangle.Value(3) - 1

    triangleIndices[index - 1] =
      isReversed
        ? [first, third, second]
        : [first, second, third]
  }

  return {
    vertexPositions,
    vertexNormals,
    triangleIndices,
  }
}

function applyLocationToPoint(
  point: { Transformed(theT: InstanceType<OccAuthoringState['oc']['gp_Trsf']>): { X(): number; Y(): number; Z(): number } },
  location: InstanceType<OccAuthoringState['oc']['TopLoc_Location']>,
) {
  return toRenderPoint(point.Transformed(location.Transformation()))
}

function getFaceOrientationIsReversed(
  state: OccAuthoringState,
  face: InstanceType<OccAuthoringState['oc']['TopoDS_Face']>,
) {
  return (face.Orientation_1() as { value?: number }).value
    === (state.oc.TopAbs_Orientation.TopAbs_REVERSED as { value?: number }).value
}

function buildFaceRenderRecord(
  state: OccAuthoringState,
  body: OccTrackedBody,
  faceId: FaceId,
  face: InstanceType<OccAuthoringState['oc']['TopoDS_Face']>,
  faceSemanticClasses: ReadonlyMap<string, FaceSemanticClasses>,
): RenderableEntityRecord | null {
  const geometry = buildMeshGeometryFromFace(state, face)

  if (!geometry) {
    return null
  }

  const target: FaceRef = createFaceTarget(body.bodyId, faceId)
  const semantics = faceSemanticClasses.get(getOccDurableRefKey(target)) ?? getFaceSemanticClasses(state, face)

  return {
    id: createRenderableId(target),
    label: `${body.label} ${faceId}`,
    ownerBodyId: body.bodyId,
    ownerFeatureId: body.ownerFeatureId,
    binding: {
      pickId: createPickId(target),
      pickPriority: FACE_PICK_PRIORITY,
      target,
      topology: 'face',
      semanticClass: semantics.render,
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: geometry.vertexPositions,
      vertexNormals: geometry.vertexNormals,
      triangleIndices: geometry.triangleIndices,
    },
  }
}

function buildRegionRenderRecords(state: OccAuthoringState) {
  const records: RenderableEntityRecord[] = []

  for (const sketch of state.sketches) {
    for (const region of sketch.sketch.regions) {
      let profileFace: ReturnType<typeof buildRegionProfileFace> | null = null

      try {
        profileFace = buildRegionProfileFace(state.oc, { plane: sketch.plane, sketch: sketch.sketch }, region)
      } catch (error) {
        console.warn(
          `[occ-snapshot] Skipping region render ${region.regionId}: failed to build profile face.`,
          error,
        )
        continue
      }

      try {
        const mesher = new state.oc.BRepMesh_IncrementalMesh_2(
          profileFace.face,
          Math.max(state.modelingTolerance * 10, DEFAULT_LINEAR_DEFLECTION),
          false,
          DEFAULT_ANGULAR_DEFLECTION,
          false,
        )
        deleteOccObject(mesher)

        const geometry = buildMeshGeometryFromFace(state, profileFace.face)

        if (!geometry) {
          console.warn(`[occ-snapshot] Skipping region render ${region.regionId}: profile face produced no mesh geometry.`)
          continue
        }

        const target = region.target as RegionRef
        records.push({
          id: createRenderableId(target),
          label: region.label,
          ownerBodyId: region.ownerBodyId,
          ownerFeatureId: region.ownerFeatureId,
          binding: {
            pickId: createPickId(target),
            pickPriority: REGION_PICK_PRIORITY,
            target,
            topology: null,
            semanticClass: 'region',
          },
          geometry: {
            kind: 'mesh',
            vertexPositions: geometry.vertexPositions,
            vertexNormals: geometry.vertexNormals,
            triangleIndices: geometry.triangleIndices,
          },
        })
      } finally {
        deleteOccObject(profileFace.face)
      }
    }
  }

  return records
}

function sampleCurveByParameters(
  state: OccAuthoringState,
  edge: InstanceType<OccAuthoringState['oc']['TopoDS_Edge']>,
  sampleCount: number,
) {
  const curve = new state.oc.BRepAdaptor_Curve_2(edge)
  const first = curve.FirstParameter()
  const last = curve.LastParameter()
  const points: RenderPoint3D[] = []

  if (!Number.isFinite(first) || !Number.isFinite(last) || sampleCount < 2) {
    return null
  }

  for (let index = 0; index < sampleCount; index += 1) {
    const parameter = first + ((last - first) * index) / (sampleCount - 1)
    points.push(toRenderPoint(curve.Value(parameter)))
  }

  const isClosed = curve.GetType() === state.oc.GeomAbs_CurveType.GeomAbs_Circle
    && points.length > 2
    && points[0] !== undefined
    && points[points.length - 1] !== undefined
    && Math.abs(points[0][0] - points[points.length - 1]![0]) < state.modelingTolerance
    && Math.abs(points[0][1] - points[points.length - 1]![1]) < state.modelingTolerance
    && Math.abs(points[0][2] - points[points.length - 1]![2]) < state.modelingTolerance

  return {
    points,
    isClosed,
  }
}

function countDistinctRenderPoints(points: readonly RenderPoint3D[]) {
  return new Set(points.map((point) => `${point[0]}:${point[1]}:${point[2]}`)).size
}

function buildEdgePolylineFromTriangulation(
  state: OccAuthoringState,
  edge: InstanceType<OccAuthoringState['oc']['TopoDS_Edge']>,
  faces: Iterable<InstanceType<OccAuthoringState['oc']['TopoDS_Face']>>,
) {
  for (const face of faces) {
    const triangulationLocation = new state.oc.TopLoc_Location_1()
    const triangulationHandle = state.oc.BRep_Tool.Triangulation(face, triangulationLocation, 0 as never)

    if (triangulationHandle.IsNull()) {
      continue
    }

    const polygonLocation = new state.oc.TopLoc_Location_1()
    const polygonHandle = state.oc.BRep_Tool.PolygonOnTriangulation_1(
      edge,
      triangulationHandle,
      polygonLocation,
    )

    if (polygonHandle.IsNull()) {
      continue
    }

    const triangulation = triangulationHandle.get()
    const polygon = polygonHandle.get()
    const points: RenderPoint3D[] = []

    for (let index = 1; index <= polygon.NbNodes(); index += 1) {
      const nodeIndex = polygon.Node(index)
      points.push(applyLocationToPoint(triangulation.Node(nodeIndex), polygonLocation))
    }

    const isClosed = state.oc.BRep_Tool.IsClosed_4(edge, triangulationHandle, polygonLocation)

    if (points.length >= 2 && (!isClosed || countDistinctRenderPoints(points) >= 3)) {
      return {
        points,
        isClosed,
      }
    }
  }

  return null
}

function buildEdgePolylineFromPolygon3D(
  state: OccAuthoringState,
  edge: InstanceType<OccAuthoringState['oc']['TopoDS_Edge']>,
) {
  const location = new state.oc.TopLoc_Location_1()
  const polygonHandle = state.oc.BRep_Tool.Polygon3D(edge, location)

  if (polygonHandle.IsNull()) {
    return null
  }

  const polygon = polygonHandle.get()
  const nodes = polygon.Nodes()
  const points: RenderPoint3D[] = []

  for (let index = 1; index <= polygon.NbNodes(); index += 1) {
    points.push(applyLocationToPoint(nodes.Value(index), location))
  }

  if (points.length < 2) {
    return null
  }

  return {
    points,
    isClosed: false,
  }
}

function buildEdgeRenderRecord(
  state: OccAuthoringState,
  body: OccTrackedBody,
  edgeId: EdgeId,
  edge: InstanceType<OccAuthoringState['oc']['TopoDS_Edge']>,
): RenderableEntityRecord | null {
  const polyline = buildEdgePolylineFromTriangulation(state, edge, body.facesById.values())
    ?? buildEdgePolylineFromPolygon3D(state, edge)
    ?? sampleCurveByParameters(state, edge, DEFAULT_EDGE_SAMPLE_COUNT)

  if (!polyline || polyline.points.length < 2) {
    return null
  }

  const target: EdgeRef = createEdgeTarget(body.bodyId, edgeId)

  return {
    id: createRenderableId(target),
    label: `${body.label} ${edgeId}`,
    ownerBodyId: body.bodyId,
    ownerFeatureId: body.ownerFeatureId,
    binding: {
      pickId: createPickId(target),
      pickPriority: EDGE_PICK_PRIORITY,
      target,
      topology: 'edge',
      semanticClass: 'featureEdge',
    },
    geometry: {
      kind: 'polyline',
      points: polyline.points,
      isClosed: polyline.isClosed,
    },
  }
}

function buildVertexRenderRecord(
  state: OccAuthoringState,
  body: OccTrackedBody,
  vertexId: VertexId,
  vertex: InstanceType<OccAuthoringState['oc']['TopoDS_Vertex']>,
): RenderableEntityRecord {
  const target: VertexRef = createVertexTarget(body.bodyId, vertexId)

  return {
    id: createRenderableId(target),
    label: `${body.label} ${vertexId}`,
    ownerBodyId: body.bodyId,
    ownerFeatureId: body.ownerFeatureId,
    binding: {
      pickId: createPickId(target),
      pickPriority: VERTEX_PICK_PRIORITY,
      target,
      topology: 'vertex',
      semanticClass: 'featureVertex',
    },
    geometry: {
      kind: 'marker',
      position: toRenderPoint(state.oc.BRep_Tool.Pnt(vertex)),
      displayRadius: DEFAULT_POINT_DISPLAY_RADIUS,
    },
  }
}

function buildBodyRenderRecords(
  state: OccAuthoringState,
  body: OccTrackedBody,
  faceSemanticClasses: ReadonlyMap<string, FaceSemanticClasses>,
) {
  const records: RenderableEntityRecord[] = []

  new state.oc.BRepMesh_IncrementalMesh_2(
    body.shape,
    Math.max(state.modelingTolerance * 10, DEFAULT_LINEAR_DEFLECTION),
    false,
    DEFAULT_ANGULAR_DEFLECTION,
    false,
  )

  for (const faceId of body.topology.faceIds) {
    const face = body.facesById.get(faceId)

    if (!face) {
      continue
    }

    const record = buildFaceRenderRecord(state, body, faceId, face, faceSemanticClasses)
    if (record) {
      records.push(record)
    }
  }

  for (const edgeId of body.topology.edgeIds) {
    const edge = body.edgesById.get(edgeId)

    if (!edge) {
      continue
    }

    const record = buildEdgeRenderRecord(state, body, edgeId, edge)
    if (record) {
      records.push(record)
    }
  }

  for (const vertexId of body.topology.vertexIds) {
    const vertex = body.verticesById.get(vertexId)

    if (!vertex) {
      continue
    }

    records.push(buildVertexRenderRecord(state, body, vertexId, vertex))
  }

  return records
}

function sampleCirclePoints(
  center: readonly [number, number],
  radius: number,
  sampleCount: number,
) {
  const points: Array<readonly [number, number]> = []

  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (Math.PI * 2 * index) / sampleCount
    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ])
  }

  return points
}

function sampleEllipsePoints(
  center: readonly [number, number],
  majorAxisEndpoint: readonly [number, number],
  minorRadius: number,
  sampleCount: number,
) {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const
  const majorRadius = Math.hypot(majorVector[0], majorVector[1])
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return []
  }

  const majorUnit = [majorVector[0] / majorRadius, majorVector[1] / majorRadius] as const
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const

  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount
    return [
      center[0] + Math.cos(angle) * majorRadius * majorUnit[0] + Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] + Math.cos(angle) * majorRadius * majorUnit[1] + Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const
  })
}

function sampleEllipticalArcPoints(
  center: readonly [number, number],
  majorAxisEndpoint: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
  minorRadius: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
  sampleCount: number,
) {
  const majorVector = [
    majorAxisEndpoint[0] - center[0],
    majorAxisEndpoint[1] - center[1],
  ] as const
  const majorRadius = Math.hypot(majorVector[0], majorVector[1])
  if (majorRadius <= Number.EPSILON || minorRadius <= 0) {
    return []
  }

  const majorUnit = [majorVector[0] / majorRadius, majorVector[1] / majorRadius] as const
  const minorUnit = [-majorUnit[1], majorUnit[0]] as const
  const ellipseAngle = (point: readonly [number, number]) => {
    const delta = [point[0] - center[0], point[1] - center[1]] as const
    return Math.atan2(
      (delta[0] * minorUnit[0] + delta[1] * minorUnit[1]) / minorRadius,
      (delta[0] * majorUnit[0] + delta[1] * majorUnit[1]) / majorRadius,
    )
  }
  const startAngle = ellipseAngle(start)
  const endAngle = ellipseAngle(end)
  const sweep = computeArcSweep(startAngle, endAngle, sweepDirection)

  return Array.from({ length: sampleCount }, (_, index) => {
    const alpha = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const angle = sweepDirection === 'counterClockwise'
      ? startAngle + sweep * alpha
      : startAngle - sweep * alpha
    return [
      center[0] + Math.cos(angle) * majorRadius * majorUnit[0] + Math.sin(angle) * minorRadius * minorUnit[0],
      center[1] + Math.cos(angle) * majorRadius * majorUnit[1] + Math.sin(angle) * minorRadius * minorUnit[1],
    ] as const
  })
}

function sampleConicPoints(
  start: readonly [number, number],
  control: readonly [number, number],
  end: readonly [number, number],
  rho: number,
  sampleCount: number,
) {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const oneMinusT = 1 - t
    const startWeight = oneMinusT * oneMinusT
    const controlWeight = 2 * rho * oneMinusT * t
    const endWeight = t * t
    const weight = startWeight + controlWeight + endWeight
    return [
      (startWeight * start[0] + controlWeight * control[0] + endWeight * end[0]) / weight,
      (startWeight * start[1] + controlWeight * control[1] + endWeight * end[1]) / weight,
    ] as const
  })
}

function sampleBezierPoints(
  controlPoints: readonly (readonly [number, number])[],
  sampleCount: number,
) {
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const oneMinusT = 1 - t
    if (controlPoints.length === 3) {
      const [p0, p1, p2] = controlPoints
      return [
        oneMinusT * oneMinusT * p0![0] + 2 * oneMinusT * t * p1![0] + t * t * p2![0],
        oneMinusT * oneMinusT * p0![1] + 2 * oneMinusT * t * p1![1] + t * t * p2![1],
      ] as const
    }

    const [p0, p1, p2, p3] = controlPoints
    return [
      oneMinusT ** 3 * p0![0] + 3 * oneMinusT * oneMinusT * t * p1![0] + 3 * oneMinusT * t * t * p2![0] + t ** 3 * p3![0],
      oneMinusT ** 3 * p0![1] + 3 * oneMinusT * oneMinusT * t * p1![1] + 3 * oneMinusT * t * t * p2![1] + t ** 3 * p3![1],
    ] as const
  })
}

function sampleProfileTextOutlinePoints(entity: Extract<SolvedSketchEntityGeometryRecord, { kind: 'profileText' }>) {
  const width = Math.max(entity.height * PROFILE_TEXT_WIDTH_FACTOR, entity.text.trim().length * entity.height * PROFILE_TEXT_WIDTH_FACTOR)
  const x = entity.horizontalAlign === 'center'
    ? -width / 2
    : entity.horizontalAlign === 'right'
      ? -width
      : 0
  const y = entity.verticalAlign === 'middle'
    ? -entity.height / 2
    : entity.verticalAlign === 'top'
      ? -entity.height
      : entity.verticalAlign === 'baseline'
        ? -entity.height * 0.2
        : 0
  const cos = Math.cos(entity.rotationRadians)
  const sin = Math.sin(entity.rotationRadians)

  return [
    [x, y],
    [x + width, y],
    [x + width, y + entity.height],
    [x, y + entity.height],
  ].map((point) => [
    entity.anchorPosition[0] + point[0]! * cos - point[1]! * sin,
    entity.anchorPosition[1] + point[0]! * sin + point[1]! * cos,
  ] as const)
}

function normalizeAngle(angle: number) {
  while (angle < 0) {
    angle += Math.PI * 2
  }

  while (angle >= Math.PI * 2) {
    angle -= Math.PI * 2
  }

  return angle
}

function computeArcSweep(
  startAngle: number,
  endAngle: number,
  sweepDirection: 'clockwise' | 'counterClockwise',
) {
  const normalizedStart = normalizeAngle(startAngle)
  const normalizedEnd = normalizeAngle(endAngle)

  if (sweepDirection === 'counterClockwise') {
    return normalizedEnd >= normalizedStart
      ? normalizedEnd - normalizedStart
      : normalizedEnd + Math.PI * 2 - normalizedStart
  }

  return normalizedEnd <= normalizedStart
    ? normalizedStart - normalizedEnd
    : normalizedStart + Math.PI * 2 - normalizedEnd
}

function sampleArcPoints(
  center: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
  sweepDirection: 'clockwise' | 'counterClockwise',
  sampleCount: number,
) {
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const sweep = computeArcSweep(startAngle, endAngle, sweepDirection)
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1])
  const points: Array<readonly [number, number]> = []

  for (let index = 0; index < sampleCount; index += 1) {
    const alpha = sampleCount === 1 ? 0 : index / (sampleCount - 1)
    const offset = sweep * alpha
    const angle = sweepDirection === 'counterClockwise'
      ? startAngle + offset
      : startAngle - offset

    points.push([
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ])
  }

  return points
}

function buildSketchCurveRenderRecords(
  _state: OccAuthoringState,
  sketch: SketchSnapshotRecord,
) {
  const authoredEntityMap = new Map(
    sketch.sketch.definition.entities.map((entity) => [entity.entityId, entity] as const),
  )

  return sketch.sketch.solvedSnapshot.solvedEntities.flatMap((entity) => {
    if (authoredEntityMap.get(entity.entityId)?.isConstruction) {
      return []
    }

    const target: SketchEntityRef = {
      kind: 'sketchEntity',
      sketchId: sketch.sketchId,
      entityId: entity.entityId,
    }

    if (entity.kind === 'point') {
      return []
    }

    let points2D: ReadonlyArray<readonly [number, number]>
    let isClosed = false

    switch (entity.kind) {
      case 'lineSegment':
        points2D = [entity.startPosition, entity.endPosition]
        break
      case 'circle':
        points2D = sampleCirclePoints(entity.centerPosition, entity.solvedRadius, DEFAULT_CIRCLE_SAMPLE_COUNT)
        isClosed = true
        break
      case 'arc':
        points2D = sampleArcPoints(
          entity.centerPosition,
          entity.startPosition,
          entity.endPosition,
          entity.sweepDirection,
          DEFAULT_ARC_SAMPLE_COUNT,
        )
        break
      case 'spline':
        points2D = entity.fitPoints
        break
      case 'ellipse':
        points2D = sampleEllipsePoints(
          entity.centerPosition,
          entity.majorAxisEndpointPosition,
          entity.minorRadius,
          DEFAULT_ADVANCED_CURVE_SAMPLE_COUNT,
        )
        isClosed = true
        break
      case 'ellipticalArc':
        points2D = sampleEllipticalArcPoints(
          entity.centerPosition,
          entity.majorAxisEndpointPosition,
          entity.startPosition,
          entity.endPosition,
          entity.minorRadius,
          entity.sweepDirection,
          DEFAULT_ADVANCED_CURVE_SAMPLE_COUNT,
        )
        break
      case 'conic':
        points2D = sampleConicPoints(
          entity.startPosition,
          entity.controlPosition,
          entity.endPosition,
          entity.rho,
          DEFAULT_ADVANCED_CURVE_SAMPLE_COUNT,
        )
        break
      case 'bezierCurve':
        points2D = sampleBezierPoints(entity.controlPoints, DEFAULT_ADVANCED_CURVE_SAMPLE_COUNT)
        break
      case 'profileText':
        points2D = sampleProfileTextOutlinePoints(entity)
        isClosed = true
        break
    }

    return [{
      id: createRenderableId(target),
      label: `${sketch.label} ${entity.entityId}`,
      ownerBodyId: null,
      ownerFeatureId: sketch.ownerFeatureId,
      binding: {
        pickId: createPickId(target),
        pickPriority: SKETCH_CURVE_PICK_PRIORITY,
        target,
        topology: null,
        semanticClass: 'sketchCurve',
      },
      geometry: {
        kind: 'polyline',
        points: points2D.map((point) => mapSketchPointToWorld(sketch.plane, point)),
        isClosed,
      },
    } satisfies RenderableEntityRecord]
  })
}

function buildSketchPointRenderRecords(
  _state: OccAuthoringState,
  sketch: SketchSnapshotRecord,
) {
  const solvedPointById = new Map(
    sketch.sketch.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition] as const),
  )

  return sketch.sketch.definition.points.flatMap((point) => {
    if (point.isConstruction) {
      return []
    }

    const target: SketchPointRef = {
      kind: 'sketchPoint',
      sketchId: sketch.sketchId,
      pointId: point.pointId,
    }
    const position = solvedPointById.get(point.pointId) ?? point.position

    return [{
      id: createRenderableId(target),
      label: `${sketch.label} ${point.pointId}`,
      ownerBodyId: null,
      ownerFeatureId: sketch.ownerFeatureId,
      binding: {
        pickId: createPickId(target),
        pickPriority: SKETCH_POINT_PICK_PRIORITY,
        target,
        topology: null,
        semanticClass: 'sketchPoint',
      },
      geometry: {
        kind: 'marker',
        position: mapSketchPointToWorld(sketch.plane, position),
        displayRadius: DEFAULT_POINT_DISPLAY_RADIUS,
      },
    } satisfies RenderableEntityRecord]
  })
}

function buildSketchRenderRecords(state: OccAuthoringState) {
  return [
    ...buildRegionRenderRecords(state),
    ...state.sketches.flatMap((sketch) => [
      ...buildSketchCurveRenderRecords(state, sketch),
      ...buildSketchPointRenderRecords(state, sketch),
    ]),
  ]
}

export function buildOccRenderExport(
  state: OccAuthoringState,
  faceSemanticClasses: ReadonlyMap<string, FaceSemanticClasses> = createFaceSemanticClassMap(state),
) {
  const records: RenderableEntityRecord[] = [
    ...buildConstructionRenderRecords(state),
    ...buildSketchRenderRecords(state),
    ...state.bodies.flatMap((body) => buildBodyRenderRecords(state, body, faceSemanticClasses)),
  ]

  return {
    schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
    records,
  }
}

export function buildOccKernelDocumentSnapshot(
  state: OccAuthoringState,
  extraDiagnostics: readonly ModelingDiagnostic[] = [],
): KernelDocumentSnapshot {
  const producedTargetsByFeatureId = createProducedTargetsByFeatureId(state.features)
  const consumerMap = createFeatureConsumerMap(state)
  const faceSemanticClasses = createFaceSemanticClassMap(state)
  const { features, featureTree, objects } = buildSnapshotPresentationRecords(state, producedTargetsByFeatureId)
  const entities = buildSnapshotEntities(state, consumerMap, faceSemanticClasses)
  const references = buildReferenceRecords(state)
  const diagnostics = buildOccSnapshotDiagnostics(state, extraDiagnostics)

  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    documentId: state.documentId,
    revisionId: state.revisionId,
    settings: {
      linearUnit: OCC_KERNEL_SETTINGS.linearUnit,
      modelingTolerance: state.modelingTolerance,
      angularToleranceRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
    },
    capabilities: OCC_KERNEL_CAPABILITIES,
    featureTree,
    objects,
    features,
    cursor: state.cursor,
    sketches: [...state.sketches],
    bodies: [...state.referenceState.bodySnapshots] as BodySnapshotRecord[],
    constructions: [...state.constructions],
    variables: [...state.variables],
    entities,
    references,
    diagnostics,
    render: buildOccRenderExport(state, faceSemanticClasses),
  }
}

export function buildOccWorkspaceSnapshot(
  state: OccAuthoringState,
  extraDiagnostics: readonly ModelingDiagnostic[] = [],
): WorkspaceSnapshot {
  const document = buildOccKernelDocumentSnapshot(state, extraDiagnostics)
  const presentation: DocumentPresentationSnapshot = {
    featureTree: document.featureTree,
    objects: document.objects,
    documentHistory: createDocumentHistoryItems({
      featureTree: document.featureTree,
      features: document.features,
      sketches: document.sketches,
      historyOrder: state.historyOrder,
    }),
    entities: document.entities,
  }

  return {
    document,
    presentation,
    provenance: null,
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
    variables: document.variables,
    entities: presentation.entities,
    references: document.references,
    diagnostics: document.diagnostics,
    render: document.render,
  }
}
