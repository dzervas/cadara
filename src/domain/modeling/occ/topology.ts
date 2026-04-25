import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  RevisionId,
  SketchEntityId,
  SketchPointId,
  VertexId,
} from '@/contracts/shared/ids'
import type {
  BodySnapshotRecord,
  ConstructionSnapshotRecord,
  FeatureDefinition,
  ModelingDiagnostic,
  ResolvedReferenceRecord,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { DocumentId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  reconcileReplacementTopology,
  seedOccTopologyNaming,
  type OccTopologyHistorySource,
  type OccTopologyNamingBodyState,
} from '@/domain/modeling/occ/topology-naming'

function solidShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_SOLID as unknown as number
}

function faceShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_FACE as unknown as number
}

function edgeShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_EDGE as unknown as number
}

function vertexShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_VERTEX as unknown as number
}

function anyShapeType(oc: OpenCascadeInstance) {
  return oc.TopAbs_ShapeEnum.TopAbs_SHAPE as unknown as number
}

export interface OccTrackedBody {
  bodyId: BodyId
  label: string
  ownerFeatureId: FeatureId | null
  topologyToken: string
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
  meshExportFallback?: Array<readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ]>
  topology: {
    faceIds: FaceId[]
    edgeIds: EdgeId[]
    vertexIds: VertexId[]
  }
  facesById: Map<FaceId, InstanceType<OpenCascadeInstance['TopoDS_Face']>>
  edgesById: Map<EdgeId, InstanceType<OpenCascadeInstance['TopoDS_Edge']>>
  verticesById: Map<VertexId, InstanceType<OpenCascadeInstance['TopoDS_Vertex']>>
  naming?: OccTopologyNamingBodyState
}

export interface OccAuthoringFeatureRecordLike {
  featureId: FeatureId
  definition: FeatureDefinition
}

export interface OccReferenceState {
  bodySnapshots: BodySnapshotRecord[]
  liveReferencesByKey: Map<string, ResolvedReferenceRecord>
  invalidatedReferencesByKey: Map<string, ResolvedReferenceRecord>
}

export interface OccReferenceInvalidationRecord {
  target: DurableRef
  reason: string
  sourceTarget: DurableRef | null
}

export const OCC_REFERENCE_INVALIDATION_REASONS = {
  missing: 'occ-missing-reference',
  topologyDeleted: 'occ-topology-deleted',
  topologyModified: 'occ-topology-modified',
  topologyAmbiguous: 'occ-topology-ambiguous',
} as const satisfies Record<string, string>

const OCC_INVALID_REFERENCE_DIAGNOSTIC_CODE = 'occ-invalid-reference'
const INITIAL_TOPOLOGY_TOKEN_NUMBER = 1

function formatTopologyToken(value: number) {
  return `t${String(value).padStart(4, '0')}`
}

function parseTopologyToken(token: string) {
  const match = /^t(\d+)$/.exec(token)

  if (!match) {
    throw new Error(`Unsupported OCC topology token ${token}.`)
  }

  return Number.parseInt(match[1]!, 10)
}

export function getOccDurableRefKey(target: DurableRef) {
  switch (target.kind) {
    case 'body':
      return `body:${target.bodyId}`
    case 'face':
      return `face:${target.bodyId}:${target.faceId}`
    case 'edge':
      return `edge:${target.bodyId}:${target.edgeId}`
    case 'vertex':
      return `vertex:${target.bodyId}:${target.vertexId}`
    case 'loop':
      return `loop:${target.bodyId}:${target.loopId}`
    case 'sketch':
      return `sketch:${target.sketchId}`
    case 'sketchEntity':
      return `sketchEntity:${target.sketchId}:${target.entityId}`
    case 'sketchPoint':
      return `sketchPoint:${target.sketchId}:${target.pointId}`
    case 'constraint':
      return `constraint:${target.sketchId}:${target.constraintId}`
    case 'dimension':
      return `dimension:${target.sketchId}:${target.dimensionId}`
    case 'feature':
      return `feature:${target.featureId}`
    case 'construction':
      return `construction:${target.constructionId}`
    case 'region':
      return `region:${target.sketchId}:${target.regionId}`
  }
}

function getDurableRefLabel(target: DurableRef) {
  switch (target.kind) {
    case 'body':
      return target.bodyId
    case 'face':
      return `${target.bodyId}.${target.faceId}`
    case 'edge':
      return `${target.bodyId}.${target.edgeId}`
    case 'vertex':
      return `${target.bodyId}.${target.vertexId}`
    case 'loop':
      return `${target.bodyId}.${target.loopId}`
    case 'sketch':
      return target.sketchId
    case 'sketchEntity':
      return `${target.sketchId}.${target.entityId}`
    case 'sketchPoint':
      return `${target.sketchId}.${target.pointId}`
    case 'constraint':
      return `${target.sketchId}.${target.constraintId}`
    case 'dimension':
      return `${target.sketchId}.${target.dimensionId}`
    case 'feature':
      return target.featureId
    case 'construction':
      return target.constructionId
    case 'region':
      return `${target.sketchId}.${target.regionId}`
  }
}

function createInvalidationSourceTarget(
  resolution: Omit<ResolvedReferenceRecord, 'invalidation'>,
): DurableRef | null {
  switch (resolution.target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return resolution.ownerBodyId
        ? { kind: 'body', bodyId: resolution.ownerBodyId }
        : null
    case 'region':
    case 'sketchEntity':
    case 'sketchPoint':
      return resolution.ownerSketchId
        ? { kind: 'sketch', sketchId: resolution.ownerSketchId }
        : null
    default:
      return null
  }
}

function createResolvedReferenceRecord(
  input: Omit<ResolvedReferenceRecord, 'invalidation'>,
): ResolvedReferenceRecord {
  return {
    ...input,
    invalidation: null,
  }
}

function createInvalidatedReferenceRecord(
  resolution: Omit<ResolvedReferenceRecord, 'invalidation'>,
  revisionId: RevisionId,
  invalidation: OccReferenceInvalidationRecord,
): ResolvedReferenceRecord {
  return {
    ...resolution,
    ownerRevisionId: revisionId,
    invalidation: {
      reason: invalidation.reason,
      target: resolution.target,
      ownerFeatureId: resolution.ownerFeatureId,
      ownerSketchId: resolution.ownerSketchId,
      sourceTarget: invalidation.sourceTarget ?? createInvalidationSourceTarget(resolution),
    },
  }
}

function createMissingReferenceDiagnostic(
  resolution: ResolvedReferenceRecord,
): ModelingDiagnostic {
  return {
    code: OCC_INVALID_REFERENCE_DIAGNOSTIC_CODE,
    severity: 'error',
    message: 'Requested durable reference does not resolve in the current OCC authoring state.',
    target: resolution.target,
    detail: resolution.invalidation === null
      ? null
      : {
          kind: 'invalidReference',
          reference: resolution.invalidation,
        },
  }
}

export function extractSolidShapes(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const solids: InstanceType<OpenCascadeInstance['TopoDS_Solid']>[] = []

  if ((shape.ShapeType() as unknown as number) === solidShapeType(oc)) {
    solids.push(oc.TopoDS.Solid_1(shape))
    return solids
  }

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    solidShapeType(oc) as never,
    anyShapeType(oc) as never,
  )

  while (explorer.More()) {
    solids.push(oc.TopoDS.Solid_1(explorer.Current()))
    explorer.Next()
  }

  return solids
}

function enumerateFaces(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const faceIds: FaceId[] = []
  const facesById = new Map<FaceId, InstanceType<OpenCascadeInstance['TopoDS_Face']>>()
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, faceShapeType(oc) as never, faceMap)

  for (let index = 1; index <= faceMap.Size(); index += 1) {
    const faceId = `face_${bodyId}_${topologyToken}_${index}` as FaceId
    faceIds.push(faceId)
    facesById.set(faceId, oc.TopoDS.Face_1(faceMap.FindKey(index)))
  }

  faceMap.delete()
  return { faceIds, facesById }
}

function enumerateEdges(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const edgeIds: EdgeId[] = []
  const edgesById = new Map<EdgeId, InstanceType<OpenCascadeInstance['TopoDS_Edge']>>()
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, edgeShapeType(oc) as never, edgeMap)

  for (let index = 1; index <= edgeMap.Size(); index += 1) {
    const edgeId = `edge_${bodyId}_${topologyToken}_${index}` as EdgeId
    edgeIds.push(edgeId)
    edgesById.set(edgeId, oc.TopoDS.Edge_1(edgeMap.FindKey(index)))
  }

  edgeMap.delete()
  return { edgeIds, edgesById }
}

function enumerateVertices(
  oc: OpenCascadeInstance,
  bodyId: BodyId,
  topologyToken: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const vertexIds: VertexId[] = []
  const verticesById = new Map<VertexId, InstanceType<OpenCascadeInstance['TopoDS_Vertex']>>()
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, vertexShapeType(oc) as never, vertexMap)

  for (let index = 1; index <= vertexMap.Size(); index += 1) {
    const vertexId = `vertex_${bodyId}_${topologyToken}_${index}` as VertexId
    vertexIds.push(vertexId)
    verticesById.set(vertexId, oc.TopoDS.Vertex_1(vertexMap.FindKey(index)))
  }

  vertexMap.delete()
  return { vertexIds, verticesById }
}

function buildTrackedSolidBody(
  oc: OpenCascadeInstance,
  input: {
    bodyId: BodyId
    label: string
    ownerFeatureId: FeatureId | null
    topologyToken: string
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
    naming?: OccTopologyNamingBodyState
    seedNaming?: boolean
    meshExportFallback?: OccTrackedBody['meshExportFallback']
  },
): OccTrackedBody {
  const solids = extractSolidShapes(oc, input.shape)

  if (solids.length !== 1) {
    throw new Error(
      `Body ${input.bodyId} must resolve to exactly one solid shape, received ${solids.length}.`,
    )
  }

  const [solid] = solids
  const topologyToken = input.topologyToken
  const faces = enumerateFaces(oc, input.bodyId, topologyToken, solid)
  const edges = enumerateEdges(oc, input.bodyId, topologyToken, solid)
  const vertices = enumerateVertices(oc, input.bodyId, topologyToken, solid)

  const body = {
    bodyId: input.bodyId,
    label: input.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken,
    shape: solid,
    meshExportFallback: input.meshExportFallback,
    topology: {
      faceIds: faces.faceIds,
      edgeIds: edges.edgeIds,
      vertexIds: vertices.vertexIds,
    },
    facesById: faces.facesById,
    edgesById: edges.edgesById,
    verticesById: vertices.verticesById,
    naming: input.naming,
  } satisfies OccTrackedBody

  return {
    ...body,
    naming: input.naming ?? (input.seedNaming === false ? undefined : seedOccTopologyNaming(oc, body)),
  }
}

export function createInitialTopologyToken() {
  return formatTopologyToken(INITIAL_TOPOLOGY_TOKEN_NUMBER)
}

export function advanceTopologyToken(token: string) {
  return formatTopologyToken(parseTopologyToken(token) + 1)
}

export function trackNewSolidBody(
  oc: OpenCascadeInstance,
  input: {
    bodyId: BodyId
    label: string
    ownerFeatureId: FeatureId | null
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
    seedNaming?: boolean
    meshExportFallback?: OccTrackedBody['meshExportFallback']
  },
) {
  return buildTrackedSolidBody(oc, {
    ...input,
    topologyToken: createInitialTopologyToken(),
  })
}

export function trackReplacementSolidBody(
  oc: OpenCascadeInstance,
  input: {
    previous: Pick<OccTrackedBody, 'bodyId' | 'label' | 'topologyToken'>
    ownerFeatureId: FeatureId | null
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
    meshExportFallback?: OccTrackedBody['meshExportFallback']
  },
) {
  return buildTrackedSolidBody(oc, {
    bodyId: input.previous.bodyId,
    label: input.previous.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: advanceTopologyToken(input.previous.topologyToken),
    shape: input.shape,
  })
}

export function reconcileReplacementSolidBody(
  oc: OpenCascadeInstance,
  input: {
    previous: OccTrackedBody
    ownerFeatureId: FeatureId | null
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
    historySources: readonly OccTopologyHistorySource[]
    meshExportFallback?: OccTrackedBody['meshExportFallback']
  },
) {
  const replacement = buildTrackedSolidBody(oc, {
    bodyId: input.previous.bodyId,
    label: input.previous.label,
    ownerFeatureId: input.ownerFeatureId,
    topologyToken: advanceTopologyToken(input.previous.topologyToken),
    shape: input.shape,
    seedNaming: false,
    meshExportFallback: input.meshExportFallback,
  })
  const reconciliation = reconcileReplacementTopology(oc, {
    previous: input.previous,
    replacement,
    historySources: input.historySources,
  })

  return {
    body: {
      ...replacement,
      topology: reconciliation.topology,
      facesById: reconciliation.facesById,
      edgesById: reconciliation.edgesById,
      verticesById: reconciliation.verticesById,
      naming: reconciliation.naming,
    } satisfies OccTrackedBody,
    historyInvalidations: reconciliation.invalidations,
  }
}

export function createBodySnapshotRecord(
  input: {
    documentId: DocumentId
    revisionId: RevisionId
  },
  body: OccTrackedBody,
): BodySnapshotRecord {
  return {
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: body.ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: body.bodyId,
    bodyId: body.bodyId,
    label: body.label,
    topology: {
      faceIds: [...body.topology.faceIds],
      edgeIds: [...body.topology.edgeIds],
      vertexIds: [...body.topology.vertexIds],
    },
  }
}

function buildLiveReferenceMap(input: {
  documentId: DocumentId
  revisionId: RevisionId
  bodies: readonly OccTrackedBody[]
  constructions: readonly ConstructionSnapshotRecord[]
  sketches: readonly SketchSnapshotRecord[]
  features: readonly OccAuthoringFeatureRecordLike[]
}) {
  const references = new Map<string, ResolvedReferenceRecord>()

  const addReference = (resolution: Omit<ResolvedReferenceRecord, 'invalidation'>) => {
    const record = createResolvedReferenceRecord(resolution)
    references.set(getOccDurableRefKey(record.target), record)
  }

  for (const body of input.bodies) {
    addReference({
      label: body.label,
      target: { kind: 'body', bodyId: body.bodyId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: body.ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: body.bodyId,
    })

    for (const faceId of body.topology.faceIds) {
      addReference({
        label: `${body.label} Face ${faceId}`,
        target: { kind: 'face', bodyId: body.bodyId, faceId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      })
    }

    for (const edgeId of body.topology.edgeIds) {
      addReference({
        label: `${body.label} Edge ${edgeId}`,
        target: { kind: 'edge', bodyId: body.bodyId, edgeId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      })
    }

    for (const vertexId of body.topology.vertexIds) {
      addReference({
        label: `${body.label} Vertex ${vertexId}`,
        target: { kind: 'vertex', bodyId: body.bodyId, vertexId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: body.ownerFeatureId,
        ownerSketchId: null,
        ownerBodyId: body.bodyId,
      })
    }
  }

  for (const construction of input.constructions) {
    if (construction.target.kind !== 'construction') {
      continue
    }

    addReference({
      label: construction.label,
      target: construction.target,
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: construction.ownerFeatureId,
      ownerSketchId: construction.ownerSketchId,
      ownerBodyId: construction.ownerBodyId,
    })
  }

  for (const sketch of input.sketches) {
    addReference({
      label: sketch.label,
      target: { kind: 'sketch', sketchId: sketch.sketchId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: sketch.ownerFeatureId,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: sketch.ownerBodyId,
    })

    for (const point of sketch.sketch.definition.points) {
      addReference({
        label: point.label,
        target: { kind: 'sketchPoint', sketchId: sketch.sketchId, pointId: point.pointId as SketchPointId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: sketch.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: sketch.ownerBodyId,
      })
    }

    for (const entity of sketch.sketch.definition.entities) {
      addReference({
        label: entity.label,
        target: { kind: 'sketchEntity', sketchId: sketch.sketchId, entityId: entity.entityId as SketchEntityId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: sketch.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: sketch.ownerBodyId,
      })
    }

    for (const region of sketch.sketch.regions) {
      addReference({
        label: region.label,
        target: { kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId },
        ownerDocumentId: input.documentId,
        ownerRevisionId: input.revisionId,
        ownerFeatureId: region.ownerFeatureId,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: region.ownerBodyId,
      })
    }
  }

  for (const feature of input.features) {
    addReference({
      label: feature.featureId,
      target: { kind: 'feature', featureId: feature.featureId },
      ownerDocumentId: input.documentId,
      ownerRevisionId: input.revisionId,
      ownerFeatureId: feature.featureId,
      ownerSketchId: null,
      ownerBodyId: null,
    })
  }

  return references
}

export function createOccReferenceState(input: {
  documentId: DocumentId
  revisionId: RevisionId
  bodies: readonly OccTrackedBody[]
  constructions: readonly ConstructionSnapshotRecord[]
  sketches: readonly SketchSnapshotRecord[]
  features: readonly OccAuthoringFeatureRecordLike[]
  previous?: OccReferenceState
  historyInvalidations?: ReadonlyMap<string, OccReferenceInvalidationRecord>
}): OccReferenceState {
  const liveReferencesByKey = buildLiveReferenceMap(input)
  const invalidatedReferencesByKey = new Map(input.previous?.invalidatedReferencesByKey ?? [])

  for (const key of liveReferencesByKey.keys()) {
    invalidatedReferencesByKey.delete(key)
  }

  for (const [key, previousResolution] of input.previous?.liveReferencesByKey ?? []) {
    if (liveReferencesByKey.has(key)) {
      continue
    }

    const invalidation = input.historyInvalidations?.get(key) ?? {
      target: previousResolution.target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.missing,
      sourceTarget: createInvalidationSourceTarget(previousResolution),
    }

    invalidatedReferencesByKey.set(
      key,
      createInvalidatedReferenceRecord(previousResolution, input.revisionId, invalidation),
    )
  }

  return {
    bodySnapshots: input.bodies.map((body) =>
      createBodySnapshotRecord(
        {
          documentId: input.documentId,
          revisionId: input.revisionId,
        },
        body,
      ),
    ),
    liveReferencesByKey,
    invalidatedReferencesByKey,
  }
}

export function resolveOccReference(
  input: {
    documentId: DocumentId
    revisionId: RevisionId
    referenceState: OccReferenceState
  },
  target: DurableRef,
) {
  const key = getOccDurableRefKey(target)
  const live = input.referenceState.liveReferencesByKey.get(key)

  if (live) {
    return {
      resolution: live,
      diagnostics: [] as ModelingDiagnostic[],
    }
  }

  const invalidated = input.referenceState.invalidatedReferencesByKey.get(key)

  if (invalidated) {
    return {
      resolution: invalidated,
      diagnostics: [createMissingReferenceDiagnostic(invalidated)],
    }
  }

  const resolution = createInvalidatedReferenceRecord({
    label: getDurableRefLabel(target),
    target,
    ownerDocumentId: input.documentId,
    ownerRevisionId: input.revisionId,
    ownerFeatureId: null,
    ownerSketchId: null,
    ownerBodyId: null,
  }, input.revisionId, {
    target,
    reason: OCC_REFERENCE_INVALIDATION_REASONS.missing,
    sourceTarget: null,
  })

  return {
    resolution,
    diagnostics: [createMissingReferenceDiagnostic(resolution)],
  }
}
