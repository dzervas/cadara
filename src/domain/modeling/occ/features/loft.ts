import type { FeatureBooleanOperation, FeatureBooleanScope } from '@/contracts/modeling/schema'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import type { FeatureId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getAuthoredLiteralValue, type MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import { getAdvancedParticipant } from '@/contracts/modeling/advanced-solid'
import type { Vec3 } from '@/domain/modeling/occ/math'
import {
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
} from '@/domain/modeling/occ/sketch-profile'
import { scale, toGpVec } from '@/domain/modeling/occ/geometry'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  requireSketchSnapshot,
  requireRegion,
  requireBody,
  requireFace,
  requireEdge,
  requireVertex,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features/shared'
import { applyBooleanPolicy } from '@/domain/modeling/occ/features/boolean-operations'
import { getSweepLinearPathData } from '@/domain/modeling/occ/features/sweep'

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

function getLoftOptionLiteral(value: unknown) {
  return getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
}

function getLoftPathSectionCount(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const pathOptions = definition.parameters.options?.path
  const sectionCount = typeof pathOptions === 'object' && pathOptions !== null && !Array.isArray(pathOptions)
    ? getLoftOptionLiteral((pathOptions as { sectionCount?: unknown }).sectionCount)
    : getLoftOptionLiteral(definition.parameters.options?.sectionCount)

  if (sectionCount === undefined || sectionCount === null) {
    return 5
  }

  if (typeof sectionCount === 'number' && Number.isInteger(sectionCount) && sectionCount > 0) {
    return sectionCount
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft path section count must be a positive integer.')
}

function getLoftGuideContinuity(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  return getLoftOptionLiteral(definition.parameters.options?.guideContinuity) ?? 'none'
}

function getLoftProfileConditions(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const value = definition.parameters.options?.profileConditions
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function assertSupportedLoftProfileConditions(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const profileConditions = getLoftProfileConditions(definition)
  const startCondition = getLoftOptionLiteral(profileConditions.startCondition) ?? 'none'
  const endCondition = getLoftOptionLiteral(profileConditions.endCondition) ?? 'none'
  const supportedConditions = ['none', 'normal', 'tangent']

  if (!supportedConditions.includes(String(startCondition)) || !supportedConditions.includes(String(endCondition))) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft profile condition option is invalid.')
  }

  for (const [key, value] of [
    ['startMagnitude', profileConditions.startMagnitude],
    ['endMagnitude', profileConditions.endMagnitude],
  ] as const) {
    const literal = getLoftOptionLiteral(value)
    if (literal !== undefined && literal !== null && (typeof literal !== 'number' || !Number.isFinite(literal) || literal <= 0)) {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC loft ${key} must be a positive number.`)
    }
  }
}

function assertLoftGuideTargetsResolve(
  context: OccFeatureExecutionContext,
  guideCurveTargets: readonly DurableRef[],
) {
  for (const target of guideCurveTargets) {
    if (target.kind === 'edge') {
      requireEdge(requireBody(context, target.bodyId), target.edgeId)
      continue
    }

    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft guide curves must be durable edge targets.')
  }
}

function assertSupportedLoftConnections(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
  profileTargets: readonly DurableRef[],
) {
  const connections = definition.parameters.options?.matchConnections
  if (connections === undefined) {
    return
  }

  if (!Array.isArray(connections)) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft match connections must be a connection list.')
  }

  if (connections.length === 0) {
    return
  }

  if (connections.length !== 1 || profileTargets.length !== 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft currently supports one match connection across two ordered profiles.')
  }

  const [connection] = connections as readonly { from?: DurableRef; to?: DurableRef }[]
  for (const endpoint of [connection?.from, connection?.to]) {
    if (endpoint?.kind === 'edge') {
      requireEdge(requireBody(context, endpoint.bodyId), endpoint.edgeId)
    } else if (endpoint?.kind === 'vertex') {
      requireVertex(requireBody(context, endpoint.bodyId), endpoint.vertexId)
    } else {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC loft match connections require durable edge or vertex endpoints.')
    }
  }
}

function transformLoftSectionWire(input: {
  context: OccFeatureExecutionContext
  wire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  translation: Vec3
}) {
  const transform = new input.context.oc.gp_Trsf_1()
  transform.SetTranslation_1(toGpVec(input.context.oc, input.translation))
  const builder = new input.context.oc.BRepBuilderAPI_Transform_2(input.wire, transform, true)
  builder.Build(new input.context.oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft path section transform failed.')
  }

  return input.context.oc.TopoDS.Wire_1(builder.Shape())
}

function addPathDrivenLoftSections(input: {
  context: OccFeatureExecutionContext
  loftBuilder: InstanceType<OpenCascadeInstance['BRepOffsetAPI_ThruSections']>
  startWire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  pathTarget: DurableRef
  sectionCount: number
}) {
  const path = getSweepLinearPathData(input.context, input.pathTarget)

  for (let index = 1; index <= input.sectionCount; index += 1) {
    input.loftBuilder.AddWire(transformLoftSectionWire({
      context: input.context,
      wire: input.startWire,
      translation: scale(path.delta, index / (input.sectionCount + 1)),
    }))
  }
}

function buildLoftFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
) {
  const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
  const pathTargets = getAdvancedParticipant(definition, 'path')?.targets ?? []
  const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []

  if (profileTargets.length < 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft requires at least two ordered profile targets.')
  }

  if (pathTargets.length > 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft supports at most one path target.')
  }

  if (pathTargets.length > 0 && guideCurveTargets.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support combining path and guide curves yet.')
  }

  const guideContinuity = getLoftGuideContinuity(definition)
  if (guideCurveTargets.length > 0) {
    assertLoftGuideTargetsResolve(context, guideCurveTargets)
    if (guideContinuity !== 'none' && guideContinuity !== 'normalToGuide') {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC loft does not support ${String(guideContinuity)} guide continuity yet.`)
    }
  } else if (guideContinuity !== 'none') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft guide continuity requires guide curves.')
  }

  assertSupportedLoftProfileConditions(definition)
  assertSupportedLoftConnections(context, definition, profileTargets)

  if (pathTargets.length > 0 && profileTargets.length !== 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC path loft currently supports exactly two ordered profile targets.')
  }

  const loftBuilder = new context.oc.BRepOffsetAPI_ThruSections(true, false, context.modelingTolerance)
  loftBuilder.CheckCompatibility(true)

  if (pathTargets.length > 0) {
    const startWire = buildLoftSectionWire(context, profileTargets[0]!)
    loftBuilder.AddWire(startWire)
    addPathDrivenLoftSections({
      context,
      loftBuilder,
      startWire,
      pathTarget: pathTargets[0]!,
      sectionCount: getLoftPathSectionCount(definition),
    })
    loftBuilder.AddWire(buildLoftSectionWire(context, profileTargets[1]!))
  } else {
    for (const profile of profileTargets) {
      loftBuilder.AddWire(buildLoftSectionWire(context, profile))
    }
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

export function executeLoftFeature(
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
