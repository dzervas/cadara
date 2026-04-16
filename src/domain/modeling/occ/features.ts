import type {
  ConstructionSnapshotRecord,
  ExtrudeFeatureParameters,
  FeatureBooleanOperation,
  FeatureBooleanScope,
  FeatureDefinition,
  FilletFeatureParameters,
  PlaneFeatureParameters,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
} from '@/contracts/modeling/schema'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { RegionRecord } from '@/contracts/sketch/schema'
import type {
  BodyId,
  ConstructionId,
  FeatureId,
  PickId,
  RenderableId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getAdvancedParticipant } from '@/contracts/modeling/advanced-solid'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import { RENDER_EXPORT_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  getConstructionBackedRevolveAxisRejectionReason,
  OCC_CONTRACT_GAP_CODES,
  getMultiBodyBooleanPolicy,
} from '@/domain/modeling/occ/implementation-policy'
import type { Vec3 } from '@/domain/modeling/occ/math'
import {
  buildAxisFromLineEdge,
  buildConstructionPlaneFromPlanarFace,
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
  getExtrusionNormalForSketchProfile,
} from '@/domain/modeling/occ/sketch-profile'
import { normalize, scale, toGpDir, toGpPnt, toGpVec } from '@/domain/modeling/occ/geometry'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  extractSolidShapes,
  getOccDurableRefKey,
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  trackReplacementSolidBody,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
} from '@/domain/modeling/occ/topology'

export interface OccFeatureExecutionContext {
  oc: OpenCascadeInstance
  documentId: `doc_${string}`
  revisionId: `rev_${string}`
  modelingTolerance: number
  sketches: readonly SketchSnapshotRecord[]
  constructions: readonly ConstructionSnapshotRecord[]
  constructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>
  bodies: readonly OccTrackedBody[]
}

export interface OccFeatureExecutionResult {
  bodies: OccTrackedBody[]
  constructions: ConstructionSnapshotRecord[]
  constructionPlanes: Map<ConstructionId, SketchPlaneDefinition>
  producedTargets: DurableRef[]
  entities: SnapshotEntityRecord[]
  renderRecords: RenderableEntityRecord[]
  historyInvalidations: Map<string, OccReferenceInvalidationRecord>
}

export interface OccFeaturePresentationArtifacts {
  entities: SnapshotEntityRecord[]
  renderRecords: RenderableEntityRecord[]
}

function requireSketchSnapshot(
  context: OccFeatureExecutionContext,
  sketchId: SketchSnapshotRecord['sketchId'],
) {
  const sketch = context.sketches.find((entry) => entry.sketchId === sketchId)

  if (!sketch) {
    throw new Error(`Sketch ${sketchId} does not resolve in the current OCC authoring state.`)
  }

  return sketch
}

function requireRegion(
  sketch: SketchSnapshotRecord,
  regionId: RegionRecord['regionId'],
) {
  const region = sketch.sketch.regions.find((entry) => entry.regionId === regionId)

  if (!region) {
    throw new Error(`Sketch region ${regionId} does not resolve on sketch ${sketch.sketchId}.`)
  }

  return region
}

function requireBody(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
) {
  const body = context.bodies.find((entry) => entry.bodyId === bodyId)

  if (!body) {
    throw new Error(`Body ${bodyId} does not resolve in the current OCC authoring state.`)
  }

  return body
}

function requireFace(
  body: OccTrackedBody,
  faceId: `face_${string}`,
) {
  const face = body.facesById.get(faceId)

  if (!face) {
    throw new Error(`Face ${faceId} does not resolve on body ${body.bodyId}.`)
  }

  return face
}

function requireEdge(
  body: OccTrackedBody,
  edgeId: `edge_${string}`,
) {
  const edge = body.edgesById.get(edgeId)

  if (!edge) {
    throw new Error(`Edge ${edgeId} does not resolve on body ${body.bodyId}.`)
  }

  return edge
}

function requireConstructionPlaneDefinition(
  context: OccFeatureExecutionContext,
  constructionId: ConstructionId,
) {
  const plane = context.constructionPlanes.get(constructionId)

  if (!plane) {
    throw new Error(
      `${OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable}: Construction plane ${constructionId} does not expose internal plane geometry.`,
    )
  }

  return plane
}

function createBooleanBuilder(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const progress = new oc.Message_ProgressRange_1()

  switch (operation) {
    case 'join':
      return new oc.BRepAlgoAPI_Fuse_3(left, right, progress)
    case 'cut':
      return new oc.BRepAlgoAPI_Cut_3(left, right, progress)
    case 'intersect':
      return new oc.BRepAlgoAPI_Common_3(left, right, progress)
  }
}

function refineBooleanResultShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(shape, true, true, true)
  unifier.AllowInternalEdges(false)
  unifier.SetSafeInputMode(true)
  unifier.SetLinearTolerance(0.001)
  unifier.SetAngularTolerance(0.001)
  unifier.Build()
  return unifier.Shape()
}

function runBoolean(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const builder = createBooleanBuilder(oc, operation, left, right)
  builder.SetToFillHistory(true)
  builder.Build(new oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error(`OCC boolean ${operation} failed to build.`)
  }

  builder.SimplifyResult(true, true, 1e-7)

  return {
    shape: refineBooleanResultShape(oc, builder.Shape()),
    builder,
  }
}

function createHistoryTargetForShape(
  target: DurableRef,
  ownerBodyId: BodyId,
) {
  switch (target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return {
        target,
        sourceTarget: { kind: 'body', bodyId: ownerBodyId } as DurableRef,
      }
    default:
      return null
  }
}

function collectTopologyHistoryInvalidations(
  current: OccTrackedBody,
  historySource: {
    Modified(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): { Size(): number }
    Generated(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): { Size(): number }
    IsDeleted(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): boolean
  },
) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (
    target: DurableRef,
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ) => {
    const relation = createHistoryTargetForShape(target, current.bodyId)

    if (!relation) {
      return
    }

    let reason: OccReferenceInvalidationRecord['reason'] = OCC_REFERENCE_INVALIDATION_REASONS.missing

    if (historySource.IsDeleted(shape)) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted
    } else if (
      historySource.Modified(shape).Size() > 0
      || historySource.Generated(shape).Size() > 0
    ) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
    }

    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason,
      sourceTarget: relation.sourceTarget,
    })
  }

  for (const [faceId, face] of current.facesById.entries()) {
    register({ kind: 'face', bodyId: current.bodyId, faceId }, face)
  }

  for (const [edgeId, edge] of current.edgesById.entries()) {
    register({ kind: 'edge', bodyId: current.bodyId, edgeId }, edge)
  }

  for (const [vertexId, vertex] of current.verticesById.entries()) {
    register({ kind: 'vertex', bodyId: current.bodyId, vertexId }, vertex)
  }

  return invalidations
}

function resolveReplacementBodies(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ownerFeatureId: FeatureId,
  options: {
    allowEmpty: boolean
    historySource?: {
      Modified(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): { Size(): number }
      Generated(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): { Size(): number }
      IsDeleted(shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>): boolean
    }
  },
) {
  const current = requireBody(context, bodyId)
  const solids = extractSolidShapes(context.oc, shape)
  const historyInvalidations = options.historySource
    ? collectTopologyHistoryInvalidations(current, options.historySource)
    : new Map<string, OccReferenceInvalidationRecord>()

  if (solids.length === 0) {
    if (options.allowEmpty) {
      return {
        replacements: [] as OccTrackedBody[],
        historyInvalidations,
      }
    }

    throw new Error(
      `Feature ${ownerFeatureId} removed every solid while replacing body ${bodyId}; Phase 4 expected one solid result.`,
    )
  }

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids while replacing body ${bodyId}; single-body replacement is required in Phase 4.`,
    )
  }

  return {
    replacements: [trackReplacementSolidBody(context.oc, {
      previous: current,
      ownerFeatureId,
      shape: solids[0]!,
    })],
    historyInvalidations,
  }
}

function allocateBodyId(featureId: FeatureId) {
  return `body_${featureId}` as BodyId
}

function trackSingleResultBody(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids; Phase 4 only accepts single-solid body results.`,
    )
  }

  const bodyId = allocateBodyId(ownerFeatureId)
  return trackNewSolidBody(context.oc, {
    bodyId,
    label,
    ownerFeatureId,
    shape: solids[0]!,
  })
}

function assertBooleanScopeCompatible(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
) {
  if (operation === 'newBody' && booleanScope.kind !== 'standalone') {
    throw new Error('Boolean operation newBody requires standalone scope.')
  }

  if (operation !== 'newBody' && booleanScope.kind === 'standalone') {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }
}

function requireUniqueTargetBodies(targetBodyIds: readonly BodyId[]) {
  const seen = new Set<BodyId>()

  for (const bodyId of targetBodyIds) {
    if (seen.has(bodyId)) {
      throw new Error(`Boolean target body ${bodyId} is duplicated in the explicit participant scope.`)
    }

    seen.add(bodyId)
  }
}

function applyBooleanPolicy(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
  featureShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  assertBooleanScopeCompatible(operation, booleanScope)

  if (operation === 'newBody') {
    const body = trackSingleResultBody(context, ownerFeatureId, ownerFeatureId, featureShape)
    return {
      bodies: [
        ...context.bodies,
        body,
      ],
      producedTargets: [{ kind: 'body', bodyId: body.bodyId }] as DurableRef[],
      historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    }
  }

  let targetBodyIds: BodyId[]

  if (booleanScope.kind === 'targetBody') {
    targetBodyIds = [booleanScope.bodyId]
  } else if (booleanScope.kind === 'targetBodies') {
    targetBodyIds = [...booleanScope.bodyIds]
  } else {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }

  if (targetBodyIds.length === 0) {
    throw new Error(`Boolean operation ${operation} requires at least one target body.`)
  }

  requireUniqueTargetBodies(targetBodyIds)

  const policy = getMultiBodyBooleanPolicy(operation, booleanScope)
  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []

  if (!policy) {
    const bodyId = targetBodyIds[0]!
    const targetBody = requireBody(context, bodyId)
    const result = runBoolean(context.oc, operation, targetBody.shape, featureShape)
    const replacementResult = resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
      allowEmpty: true,
      historySource: result.builder,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: replacementResult.historyInvalidations,
    }
  }

  if (policy.application === 'sequential') {
    const [firstBodyId, ...restBodyIds] = targetBodyIds
    let currentResult = runBoolean(
      context.oc,
      policy.operation,
      requireBody(context, firstBodyId!).shape,
      featureShape,
    )
    const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
    const firstBody = requireBody(context, firstBodyId!)
    for (const [key, value] of collectTopologyHistoryInvalidations(firstBody, currentResult.builder)) {
      combinedHistoryInvalidations.set(key, value)
    }

    for (const bodyId of restBodyIds) {
      const body = requireBody(context, bodyId)
      currentResult = runBoolean(context.oc, policy.operation, currentResult.shape, body.shape)
      for (const [key, value] of collectTopologyHistoryInvalidations(body, currentResult.builder)) {
        combinedHistoryInvalidations.set(key, value)
      }
    }

    const replacementResult = resolveReplacementBodies(context, firstBodyId!, currentResult.shape, ownerFeatureId, {
      allowEmpty: true,
      historySource: currentResult.builder,
    })
    const firstIndex = nextBodies.findIndex((entry) => entry.bodyId === firstBodyId)
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements)

    for (const bodyId of targetBodyIds.slice(1)) {
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: combinedHistoryInvalidations,
    }
  }

  const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const bodyId of targetBodyIds) {
    const targetBody = requireBody(context, bodyId)
    const result = runBoolean(context.oc, policy.operation, targetBody.shape, featureShape)
    const replacementResult = resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
      allowEmpty: true,
      historySource: result.builder,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    producedTargets,
    historyInvalidations: combinedHistoryInvalidations,
  }
}

function createDeletedBodyInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (target: DurableRef, sourceTarget: DurableRef | null) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
      sourceTarget,
    })
  }

  register({ kind: 'body', bodyId: body.bodyId }, null)

  for (const faceId of body.facesById.keys()) {
    register({ kind: 'face', bodyId: body.bodyId, faceId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const edgeId of body.edgesById.keys()) {
    register({ kind: 'edge', bodyId: body.bodyId, edgeId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const vertexId of body.verticesById.keys()) {
    register({ kind: 'vertex', bodyId: body.bodyId, vertexId }, { kind: 'body', bodyId: body.bodyId })
  }

  return invalidations
}

function trackBodiesFromShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  suffix: string,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length === 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: ${label} for ${ownerFeatureId} produced no solid result bodies.`,
    )
  }

  return solids.map((solid, index) => trackNewSolidBody(context.oc, {
    bodyId: `body_${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}` as BodyId,
    label: `${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}`,
    ownerFeatureId,
    shape: solid,
  }))
}

function buildExtrudeFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ExtrudeFeatureParameters,
) {
  if (parameters.startExtent.kind !== 'profilePlane') {
    throw new Error('Extrude startExtent.kind must be profilePlane.')
  }

  if (parameters.endExtent.distance <= 0) {
    throw new Error('Extrude endExtent.distance must be positive.')
  }

  if (parameters.profiles.length > 1) {
    throw new Error('unsupported-profile-group: OCC extrude does not support multi-profile groups yet.')
  }

  const profile = parameters.profiles[0]
  let profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
  let extrusionNormal: Vec3

  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    const profileFace = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region)
    profileShape = profileFace.face
    extrusionNormal = getExtrusionNormalForSketchProfile(profileFace.plane, parameters.endExtent.direction)
  } else {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    profileShape = face
    extrusionNormal = getExtrusionNormalForPlanarFace(context.oc, face, parameters.endExtent.direction)
  }

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(normalize(extrusionNormal), parameters.endExtent.distance)),
    false,
    true,
  )

  prism.Build(new context.oc.Message_ProgressRange_1())

  if (!prism.IsDone()) {
    throw new Error('OCC extrude prism build failed.')
  }

  return prism.Shape()
}

function buildRevolveFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: RevolveFeatureParameters,
) {
  if (parameters.axis.kind === 'construction') {
    throw new Error(`${OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported}: ${getConstructionBackedRevolveAxisRejectionReason()}`)
  }

  if (parameters.extent.kind !== 'angle') {
    throw new Error('Revolve extent.kind must be angle.')
  }

  if (parameters.extent.radians <= 0) {
    throw new Error('Revolve extent.radians must be positive.')
  }

  if (parameters.profiles.length > 1) {
    throw new Error('unsupported-profile-group: OCC revolve does not support multi-profile groups yet.')
  }

  const profile = parameters.profiles[0]
  let profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>

  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    profileShape = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
  } else {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    profileShape = face
  }

  const axisBody = requireBody(context, parameters.axis.bodyId)
  const axisEdge = requireEdge(axisBody, parameters.axis.edgeId)
  const axis = buildAxisFromLineEdge(context.oc, axisEdge)

  const signedExtent = parameters.extent.direction === 'counterClockwise'
    ? parameters.extent.radians
    : -parameters.extent.radians

  if (parameters.startAngle !== 0) {
    const rotation = new context.oc.gp_Trsf_1()
    rotation.SetRotation_1(axis, parameters.startAngle)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(profileShape, rotation, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('OCC revolve pre-rotation transform failed.')
    }

    profileShape = transform.Shape()
  }

  const revol = new context.oc.BRepPrimAPI_MakeRevol_1(
    profileShape,
    axis,
    signedExtent,
    false,
  )
  revol.Build(new context.oc.Message_ProgressRange_1())

  if (!revol.IsDone()) {
    throw new Error('OCC revolve build failed.')
  }

  return revol.Shape()
}

function buildSweepProfileShape(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    return buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
  }

  if (profile.kind === 'face') {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    return face
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep profiles must be region or planar face targets.')
}

function buildLoftSectionWire(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)

    if (region.loops.some((loop) => loop.role === 'inner')) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support profiles with inner loops yet.')
    }

    const face = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
    return context.oc.BRepTools.OuterWire(face)
  }

  if (profile.kind === 'face') {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    return context.oc.BRepTools.OuterWire(face)
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft profiles must be region or planar face targets.')
}

function buildSweepPathWire(
  context: OccFeatureExecutionContext,
  path: DurableRef,
) {
  if (path.kind === 'sketchEntity') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support sketch-entity paths yet.')
  }

  if (path.kind !== 'edge') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep path must be a durable edge target.')
  }

  const body = requireBody(context, path.bodyId)
  const edge = requireEdge(body, path.edgeId)
  const wireBuilder = new context.oc.BRepBuilderAPI_MakeWire_1()
  wireBuilder.Add_1(edge)

  if (!wireBuilder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep failed to build a path wire from the selected edge.')
  }

  return wireBuilder.Wire()
}

function buildSweepFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
) {
  const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
  const pathTargets = getAdvancedParticipant(definition, 'path')?.targets ?? []
  const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []

  if (profileTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one profile target in the initial implementation.')
  }

  if (pathTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one path target.')
  }

  if (guideCurveTargets.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support guide curves yet.')
  }

  const profileShape = buildSweepProfileShape(context, profileTargets[0]!)
  const pathWire = buildSweepPathWire(context, pathTargets[0]!)
  const pipe = new context.oc.BRepOffsetAPI_MakePipe_1(pathWire, profileShape)
  pipe.Build(new context.oc.Message_ProgressRange_1())

  if (!pipe.IsDone()) {
    throw new Error('OCC sweep pipe build failed.')
  }

  return pipe.Shape()
}

function getSweepBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support boolean composition yet.')
}

function buildLoftFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
) {
  const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
  const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []

  if (profileTargets.length < 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft requires at least two ordered profile targets.')
  }

  if (guideCurveTargets.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support guide curves yet.')
  }

  const loftBuilder = new context.oc.BRepOffsetAPI_ThruSections(true, false, context.modelingTolerance)
  loftBuilder.CheckCompatibility(true)

  for (const profile of profileTargets) {
    loftBuilder.AddWire(buildLoftSectionWire(context, profile))
  }

  loftBuilder.Build(new context.oc.Message_ProgressRange_1())

  if (!loftBuilder.IsDone()) {
    throw new Error('OCC loft build failed.')
  }

  return loftBuilder.Shape()
}

function getLoftBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support boolean composition yet.')
}

function executeLoftFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
): OccFeatureExecutionResult {
  const featureShape = buildLoftFeatureShape(context, definition)
  const policy = getLoftBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeSweepFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
): OccFeatureExecutionResult {
  const featureShape = buildSweepFeatureShape(context, definition)
  const policy = getSweepBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executePlaneFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: PlaneFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.mode !== 'coplanar') {
    throw new Error('Plane feature mode must be coplanar.')
  }

  if (parameters.reference.target.kind === 'construction') {
    const sourceConstructionId = parameters.reference.target.constructionId
    const sourceConstruction = context.constructions.find(
      (entry) => entry.constructionId === sourceConstructionId,
    )

    if (!sourceConstruction) {
      throw new Error(`Construction plane ${sourceConstructionId} does not resolve in the current OCC authoring state.`)
    }
  }

  const constructionId = `construction_${ownerFeatureId}` as ConstructionId
  const plane: SketchPlaneDefinition = parameters.reference.target.kind === 'construction'
    ? {
        support: { kind: 'construction', constructionId },
        frame: requireConstructionPlaneDefinition(context, parameters.reference.target.constructionId).frame,
        key: null,
      }
    : buildConstructionPlaneFromPlanarFace(
        context.oc,
        requireFace(requireBody(context, parameters.reference.target.bodyId), parameters.reference.target.faceId),
        parameters.reference.target.faceId,
        { kind: 'construction', constructionId },
      )

  const construction = {
    ownerDocumentId: context.documentId,
    ownerRevisionId: context.revisionId,
    ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: null,
    constructionId,
    label: ownerFeatureId,
    constructionType: 'plane',
    plane,
    target: { kind: 'construction', constructionId },
  } satisfies ConstructionSnapshotRecord

  const constructionPlanes = new Map(context.constructionPlanes)
  constructionPlanes.set(constructionId, plane)
  const artifacts = createConstructionPresentationArtifacts(context, construction, plane)

  return {
    bodies: [...context.bodies],
    constructions: [...context.constructions, construction],
    constructionPlanes,
    producedTargets: [{ kind: 'construction', constructionId }],
    entities: artifacts.entities,
    renderRecords: artifacts.renderRecords,
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  }
}

function executeExtrudeFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ExtrudeFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildExtrudeFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeRevolveFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: RevolveFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildRevolveFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeFilletFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: FilletFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.radius <= 0) {
    throw new Error('Fillet radius must be positive.')
  }

  if (parameters.edgeTargets.length === 0) {
    throw new Error('Fillet requires at least one target edge.')
  }

  const targetsByBody = new Map<BodyId, FilletFeatureParameters['edgeTargets']>()

  for (const target of parameters.edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? []
    targetsByBody.set(target.bodyId, [...list, target])
  }

  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId)
    const fillet = new context.oc.BRepFilletAPI_MakeFillet(
      body.shape,
      context.oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    )

    for (const target of targets) {
      fillet.Add_2(parameters.radius, requireEdge(body, target.edgeId))
    }

    fillet.Build(new context.oc.Message_ProgressRange_1())

    if (!fillet.IsDone()) {
      throw new Error(`OCC fillet build failed for body ${bodyId}.`)
    }

    const replacementResult = resolveReplacementBodies(context, bodyId, fillet.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: fillet,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getChamferDistance(definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' }) {
  const distance = definition.parameters.options?.distance

  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer requires a positive constant distance option.')
  }

  return distance
}

function getChamferEdgeTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' }) {
  const edgeTargets = getAdvancedParticipant(definition, 'edge')?.targets ?? []

  if (edgeTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer requires at least one edge target.')
  }

  for (const target of edgeTargets) {
    if (target.kind !== 'edge') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer edge participants must be durable edge targets.')
    }
  }

  return edgeTargets as readonly Extract<DurableRef, { kind: 'edge' }>[]
}

function requireAdjacentFaceForChamfer(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
  edgeId: `edge_${string}`,
) {
  const edgeFaceMap = new context.oc.TopTools_IndexedDataMapOfShapeListOfShape_1()
  context.oc.TopExp.MapShapesAndAncestors(
    body.shape,
    context.oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    edgeFaceMap,
  )

  const index = edgeFaceMap.FindIndex(edge)
  if (index <= 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer could not find adjacent faces for edge ${edgeId}.`)
  }

  const faces = edgeFaceMap.FindFromIndex(index)
  if (faces.Size() <= 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer edge ${edgeId} has no adjacent faces.`)
  }

  return context.oc.TopoDS.Face_1(faces.First_1())
}

function executeChamferFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer does not support boolean operation intents.')
  }

  const distance = getChamferDistance(definition)
  const edgeTargets = getChamferEdgeTargets(definition)
  const targetsByBody = new Map<BodyId, typeof edgeTargets>()

  for (const target of edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? []
    targetsByBody.set(target.bodyId, [...list, target])
  }

  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId)
    const chamfer = new context.oc.BRepFilletAPI_MakeChamfer(body.shape)

    for (const target of targets) {
      const edge = requireEdge(body, target.edgeId)
      chamfer.Add_3(distance, distance, edge, requireAdjacentFaceForChamfer(context, body, edge, target.edgeId))
    }

    chamfer.Build(new context.oc.Message_ProgressRange_1())

    if (!chamfer.IsDone()) {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer build failed for body ${bodyId}.`)
    }

    const replacementResult = resolveReplacementBodies(context, bodyId, chamfer.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: chamfer,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getThickenThickness(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const thickness = definition.parameters.options?.thickness

  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a positive thickness option.')
  }

  return thickness
}

function getThickenSide(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const side = definition.parameters.options?.side

  if (side === undefined || side === 'oneSide') {
    return 'oneSide'
  }

  if (side === 'symmetric') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support symmetric side mode yet.')
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken side must be oneSide.')
}

function getThickenFaceTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const faceTargets = getAdvancedParticipant(definition, 'face')?.targets ?? []

  if (faceTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires exactly one face target in the initial implementation.')
  }

  for (const target of faceTargets) {
    if (target.kind !== 'face') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken face participants must be durable face targets.')
    }
  }

  return faceTargets as readonly Extract<DurableRef, { kind: 'face' }>[]
}

function buildThickenFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
) {
  const [faceTarget] = getThickenFaceTargets(definition)
  const thickness = getThickenThickness(definition)
  const side = getThickenSide(definition)
  const body = requireBody(context, faceTarget!.bodyId)
  const face = requireFace(body, faceTarget!.faceId)

  let extrusionNormal: Vec3
  try {
    extrusionNormal = getExtrusionNormalForPlanarFace(
      context.oc,
      face,
      side === 'inside' ? 'negative' : 'positive',
    )
  } catch {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a planar face target.')
  }

  const profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = face

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(normalize(extrusionNormal), thickness)),
    false,
    true,
  )
  prism.Build(new context.oc.Message_ProgressRange_1())

  if (!prism.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken prism build failed.')
  }

  return prism.Shape()
}

function getThickenBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support boolean composition yet.')
}

function executeThickenFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
): OccFeatureExecutionResult {
  const featureShape = buildThickenFeatureShape(context, definition)
  const policy = getThickenBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function getSplitTargetBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const targets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []

  if (targets.length !== 1 || targets[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one targetBody participant.')
  }

  return targets[0]
}

function getSplitToolBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const toolBodies = getAdvancedParticipant(definition, 'toolBody')?.targets ?? []
  const planes = getAdvancedParticipant(definition, 'plane')?.targets ?? []

  if (planes.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support plane split tools yet.')
  }

  if (toolBodies.length !== 1 || toolBodies[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one toolBody participant in the initial implementation.')
  }

  return toolBodies[0]
}

function executeSplitFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'split' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support operation intents.')
  }

  const targetBodyRef = getSplitTargetBody(definition)
  const toolBodyRef = getSplitToolBody(definition)

  if (targetBodyRef.bodyId === toolBodyRef.bodyId) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires distinct target and tool bodies.')
  }

  const targetBody = requireBody(context, targetBodyRef.bodyId)
  const toolBody = requireBody(context, toolBodyRef.bodyId)
  const cutResult = runBoolean(context.oc, 'cut', targetBody.shape, toolBody.shape)
  const intersectResult = runBoolean(context.oc, 'intersect', targetBody.shape, toolBody.shape)
  const remainderBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split remainder', cutResult.shape, 'remainder')
  const toolSideBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split tool-side result', intersectResult.shape, 'tool-side')
  const nextBodies = context.bodies
    .filter((body) => body.bodyId !== targetBody.bodyId)
    .concat([...remainderBodies, ...toolSideBodies])
  const historyInvalidations = createDeletedBodyInvalidations(targetBody)

  for (const [key, value] of collectTopologyHistoryInvalidations(targetBody, cutResult.builder)) {
    historyInvalidations.set(key, value)
  }
  for (const [key, value] of collectTopologyHistoryInvalidations(targetBody, intersectResult.builder)) {
    historyInvalidations.set(key, value)
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [...remainderBodies, ...toolSideBodies].map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getDeleteSolidBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' }) {
  const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (bodyTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid requires at least one body participant.')
  }

  for (const target of bodyTargets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid body participants must be durable body targets.')
    }
  }

  return bodyTargets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function executeDeleteSolidFeature(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid does not support operation intents.')
  }

  const bodyTargets = getDeleteSolidBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))

  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const target of bodyTargets) {
    const body = requireBody(context, target.bodyId)
    for (const [key, value] of createDeletedBodyInvalidations(body)) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: context.bodies.filter((body) => !bodyTargets.some((target) => target.bodyId === body.bodyId)),
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function resolvePlanarReferencePlane(
  context: OccFeatureExecutionContext,
  target: DurableRef,
  supportConstructionId: ConstructionId,
) {
  if (target.kind === 'construction') {
    const plane = requireConstructionPlaneDefinition(context, target.constructionId)
    return {
      support: { kind: 'construction' as const, constructionId: supportConstructionId },
      frame: plane.frame,
      key: null,
    } satisfies SketchPlaneDefinition
  }

  if (target.kind === 'face') {
    return buildConstructionPlaneFromPlanarFace(
      context.oc,
      requireFace(requireBody(context, target.bodyId), target.faceId),
      target.faceId,
      { kind: 'construction', constructionId: supportConstructionId },
    )
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC transform-family references must be planar face or construction targets.')
}

function buildMirrorAxisPlane(
  context: OccFeatureExecutionContext,
  plane: SketchPlaneDefinition,
) {
  return new context.oc.gp_Ax2_2(
    toGpPnt(context.oc, plane.frame.origin),
    toGpDir(context.oc, plane.frame.normal),
    toGpDir(context.oc, plane.frame.xAxis),
  )
}

function getMirrorBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  const targets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (targets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror requires at least one body participant.')
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror body participants must be durable body targets.')
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getMirrorPlaneTarget(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  const targets = getAdvancedParticipant(definition, 'plane')?.targets ?? []

  if (targets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror requires exactly one plane participant.')
  }

  const [planeTarget] = targets
  if (!planeTarget || (planeTarget.kind !== 'construction' && planeTarget.kind !== 'face')) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror plane participants must be planar face or construction targets.')
  }

  return planeTarget
}

function getMirrorCopyOption(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  if (definition.parameters.options?.copy !== true) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror currently supports copy=true only.')
  }

  return true
}

function executeMirrorFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror does not support operation intents.')
  }

  getMirrorCopyOption(definition)
  const bodyTargets = getMirrorBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))
  const planeTarget = getMirrorPlaneTarget(definition)
  const plane = resolvePlanarReferencePlane(context, planeTarget, `construction_${ownerFeatureId}_mirror` as ConstructionId)
  const mirror = new context.oc.gp_Trsf_1()
  mirror.SetMirror_3(buildMirrorAxisPlane(context, plane))

  const mirroredBodies: OccTrackedBody[] = []
  for (const [index, bodyTarget] of bodyTargets.entries()) {
    const body = requireBody(context, bodyTarget.bodyId)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(body.shape, mirror, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror transform build failed.')
    }

    mirroredBodies.push(...trackBodiesFromShape(
      context,
      ownerFeatureId,
      'Mirror result',
      transform.Shape(),
      `mirror_${index + 1}`,
    ))
  }

  return {
    bodies: [...context.bodies, ...mirroredBodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: mirroredBodies.map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  }
}

function getTransformBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const targets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (targets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires at least one body participant.')
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC transform body participants must be durable body targets.')
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getTransformReferenceTarget(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const targets = getAdvancedParticipant(definition, 'transformReference')?.targets ?? []

  if (targets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires exactly one transformReference participant.')
  }

  const [referenceTarget] = targets
  if (!referenceTarget || (referenceTarget.kind !== 'construction' && referenceTarget.kind !== 'face')) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform references must be planar face or construction targets.')
  }

  return referenceTarget
}

function getTransformDistance(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const distance = definition.parameters.options?.distance

  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires a positive distance option.')
  }

  return distance
}

function executeTransformFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'transform' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform does not support operation intents.')
  }

  const bodyTargets = getTransformBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))
  const referenceTarget = getTransformReferenceTarget(definition)
  const distance = getTransformDistance(definition)
  const plane = resolvePlanarReferencePlane(context, referenceTarget, `construction_${ownerFeatureId}_transform` as ConstructionId)
  const translation = new context.oc.gp_Trsf_1()
  translation.SetTranslation_1(toGpVec(context.oc, scale(normalize(plane.frame.normal), distance)))

  const nextBodies = [...context.bodies]
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  const producedTargets: DurableRef[] = []

  for (const bodyTarget of bodyTargets) {
    const body = requireBody(context, bodyTarget.bodyId)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(body.shape, translation, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC transform build failed.')
    }

    const replacementResult = resolveReplacementBodies(context, body.bodyId, transform.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: transform,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === body.bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function buildShellFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (parameters.thickness <= 0) {
    throw new Error('Shell thickness must be positive.')
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error('Shell requires at least one removable face.')
  }

  const sourceBody = requireBody(context, parameters.bodyTarget.bodyId)
  const closingFaces = new context.oc.TopTools_ListOfShape_1()

  for (const target of parameters.faceTargets) {
    if (target.bodyId !== parameters.bodyTarget.bodyId) {
      throw new Error('Shell removable faces must belong to the selected source body.')
    }

    closingFaces.Append_1(requireFace(sourceBody, target.faceId))
  }

  const shell = new context.oc.BRepOffsetAPI_MakeThickSolid()
  shell.MakeThickSolidByJoin(
    sourceBody.shape,
    closingFaces,
    -parameters.thickness,
    context.modelingTolerance,
    context.oc.BRepOffset_Mode.BRepOffset_Skin as never,
    false,
    false,
    context.oc.GeomAbs_JoinType.GeomAbs_Arc as never,
    false,
    new context.oc.Message_ProgressRange_1(),
  )
  shell.Build(new context.oc.Message_ProgressRange_1())

  if (!shell.IsDone()) {
    throw new Error('OCC shell build failed.')
  }

  return shell.Shape()
}

function executeShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildShellFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

export function executeOccFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: FeatureDefinition,
): OccFeatureExecutionResult {
  switch (definition.kind) {
    case 'plane':
      return executePlaneFeature(context, ownerFeatureId, definition.parameters)
    case 'extrude':
      return executeExtrudeFeature(context, ownerFeatureId, definition.parameters)
    case 'revolve':
      return executeRevolveFeature(context, ownerFeatureId, definition.parameters)
    case 'fillet':
      return executeFilletFeature(context, ownerFeatureId, definition.parameters)
    case 'shell':
      return executeShellFeature(context, ownerFeatureId, definition.parameters)
    case 'sweep':
      return executeSweepFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'sweep' })
    case 'loft':
      return executeLoftFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'loft' })
    case 'chamfer':
      return executeChamferFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'chamfer' })
    case 'thicken':
      return executeThickenFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'thicken' })
    case 'split':
      return executeSplitFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'split' })
    case 'deleteSolid':
      return executeDeleteSolidFeature(context, definition as AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' })
    case 'mirror':
      return executeMirrorFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'mirror' })
    case 'transform':
      return executeTransformFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'transform' })
    default:
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC adapter does not implement ${definition.kind} yet.`)
  }
}

function constructionEntityId(constructionId: ConstructionId) {
  return `snapshot_entity_${constructionId}` as SnapshotEntityId
}

function constructionRenderableId(constructionId: ConstructionId) {
  return `renderable_${constructionId}` as RenderableId
}

function constructionPickId(constructionId: ConstructionId) {
  return `pick_${constructionId}` as PickId
}

function buildConstructionOutlinePoints(plane: SketchPlaneDefinition, size = 10) {
  const { origin, xAxis, yAxis } = plane.frame
  const cornerOffsets = [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size],
  ] as const

  return cornerOffsets.map(([x, y]) => [
    origin[0] + xAxis[0] * x + yAxis[0] * y,
    origin[1] + xAxis[1] * x + yAxis[1] * y,
    origin[2] + xAxis[2] * x + yAxis[2] * y,
  ] as const)
}

export function createConstructionPresentationArtifacts(
  context: Pick<OccFeatureExecutionContext, 'documentId' | 'revisionId'>,
  construction: ConstructionSnapshotRecord,
  plane: SketchPlaneDefinition,
): OccFeaturePresentationArtifacts {
  const entity: SnapshotEntityRecord = {
    ownerDocumentId: context.documentId,
    ownerRevisionId: context.revisionId,
    ownerFeatureId: construction.ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: null,
    id: constructionEntityId(construction.constructionId),
    label: construction.label,
    target: { kind: 'construction', constructionId: construction.constructionId },
    relatedTargets: [],
    consumedByFeatureIds: [],
    selectionSemantics: ['constructionPlane', 'planarReference'],
  }

  const renderRecord: RenderableEntityRecord = {
    id: constructionRenderableId(construction.constructionId),
    label: construction.label,
    ownerBodyId: null,
    ownerFeatureId: construction.ownerFeatureId,
    binding: {
      pickId: constructionPickId(construction.constructionId),
      pickPriority: 5,
      target: { kind: 'construction', constructionId: construction.constructionId },
      topology: null,
      semanticClass: 'construction',
    },
    geometry: {
      kind: 'polyline',
      points: buildConstructionOutlinePoints(plane),
      isClosed: true,
    },
  }

  return {
    entities: [entity],
    renderRecords: [renderRecord],
  }
}

export function createEmptyOccRenderExport() {
  return {
    schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
    records: [],
  } as const
}
