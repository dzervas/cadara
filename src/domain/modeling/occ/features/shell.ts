import type { ShellFeatureParameters } from '@/contracts/modeling/schema'
import type { BodyId, FeatureId } from '@/contracts/shared/ids'
import type { OccReferenceInvalidationRecord } from '@/domain/modeling/occ/topology'
import { advanceTopologyToken, trackDerivedSolidBody } from '@/domain/modeling/occ/topology'
import {
  requireBody,
  requireFace,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from '@/domain/modeling/occ/features/shared'
import {
  applyBooleanPolicy,
  validateNativeFeatureTransaction,
} from '@/domain/modeling/occ/features/boolean-operations'
import type { OpenCascadeNativeTopologyKernelHost } from '@/domain/modeling/occ/native-topology-payload'

function serializeNativeFaceTargets(targets: readonly { faceId: `face_${string}` }[]) {
  return targets.map((target) => target.faceId).join(',')
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

  const signedThickness = parameters.direction === 'outside'
    ? parameters.thickness
    : -parameters.thickness
  const shell = new context.oc.BRepOffsetAPI_MakeThickSolid()
  shell.MakeThickSolidByJoin(
    sourceBody.shape,
    closingFaces,
    signedThickness,
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

  return {
    sourceBody,
    builder: shell,
    shape: shell.Shape(),
  }
}

function buildNativeShellFeatureShape(
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

  for (const target of parameters.faceTargets) {
    if (target.bodyId !== parameters.bodyTarget.bodyId) {
      throw new Error('Shell removable faces must belong to the selected source body.')
    }
  }

  const nativeHost = context.oc as unknown as OpenCascadeNativeTopologyKernelHost
  const builder = nativeHost.CadaraExecuteNativeFeatureTransaction?.BuildShellCommittedShapeTransactionWithHistory

  if (!builder) {
    return null
  }

  const signedThickness = parameters.direction === 'outside'
    ? parameters.thickness
    : -parameters.thickness
  const transaction = builder(
    sourceBody.shape,
    serializeNativeFaceTargets(parameters.faceTargets),
    signedThickness,
    sourceBody.bodyId,
    sourceBody.topologyToken,
    advanceTopologyToken(sourceBody.topologyToken),
    context.modelingTolerance,
    0.5,
  )

  validateNativeFeatureTransaction(transaction, 'shell')

  return {
    sourceBody,
    shape: transaction.Shape() as InstanceType<OccFeatureExecutionContext['oc']['TopoDS_Shape']>,
  }
}

export function executeShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.operation !== 'newBody') {
    const shellResult = buildNativeShellFeatureShape(context, parameters) ?? buildShellFeatureShape(context, parameters)
    const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, shellResult.shape)

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

  const shellResult = buildShellFeatureShape(context, parameters)

  const newBody = trackDerivedSolidBody(context.oc, {
    previous: shellResult.sourceBody,
    bodyId: `body_${ownerFeatureId}` as BodyId,
    label: ownerFeatureId,
    ownerFeatureId,
    shape: shellResult.shape,
    historySources: [shellResult.builder],
  })

  return {
    bodies: [
      ...context.bodies,
      newBody,
    ],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [{ kind: 'body', bodyId: newBody.bodyId }],
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  }
}
