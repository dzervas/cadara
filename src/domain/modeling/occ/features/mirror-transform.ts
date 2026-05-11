import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { ConstructionId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import {
  normalize,
  scale,
  toGpDir,
  toGpPnt,
  toGpVec,
} from "@/domain/modeling/occ/geometry";
import { buildConstructionPlaneFromPlanarFace } from "@/domain/modeling/occ/sketch-profile";
import type {
  OccReferenceInvalidationRecord,
  OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import { advanceTopologyToken } from "@/domain/modeling/occ/topology";
import {
  requireBody,
  requireFace,
  requireConstructionPlaneDefinition,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
  requireUniqueTargetBodies,
  trackBodiesFromShape,
  validateNativeFeatureTransaction,
} from "@/domain/modeling/occ/features/boolean-operations";
import type {
  OpenCascadeNativeFeatureTransactionResult,
  OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";

function resolvePlanarReferencePlane(
  context: OccFeatureExecutionContext,
  target: DurableRef,
  supportConstructionId: ConstructionId,
) {
  if (target.kind === "construction") {
    const plane = requireConstructionPlaneDefinition(
      context,
      target.constructionId,
    );
    return {
      support: {
        kind: "construction" as const,
        constructionId: supportConstructionId,
      },
      frame: plane.frame,
      key: null,
    } satisfies SketchPlaneDefinition;
  }

  if (target.kind === "face") {
    return buildConstructionPlaneFromPlanarFace(
      context.oc,
      requireFace(requireBody(context, target.bodyId), target.faceId),
      target.faceId,
      { kind: "construction", constructionId: supportConstructionId },
    );
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC transform-family references must be planar face or construction targets.",
  );
}

function buildMirrorAxisPlane(
  context: OccFeatureExecutionContext,
  plane: SketchPlaneDefinition,
) {
  return new context.oc.gp_Ax2_2(
    toGpPnt(context.oc, plane.frame.origin),
    toGpDir(context.oc, plane.frame.normal),
    toGpDir(context.oc, plane.frame.xAxis),
  );
}

function buildNativeTransformTransaction(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  transform: InstanceType<OccFeatureExecutionContext["oc"]["gp_Trsf_1"]>,
  operation: string,
): OpenCascadeNativeFeatureTransactionResult | null {
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildTransformCommittedShapeTransactionWithHistory;

  if (!nativeBuilder) {
    return null;
  }

  const transaction = nativeBuilder(
    body.shape,
    transform,
    true,
    body.bodyId,
    body.topologyToken,
    advanceTopologyToken(body.topologyToken),
    context.modelingTolerance,
    0.5,
  );

  validateNativeFeatureTransaction(transaction, operation);

  return transaction;
}

function getMirrorBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const targets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (targets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror requires at least one body participant.",
    );
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC mirror body participants must be durable body targets.",
      );
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getMirrorPlaneTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  const targets = getAdvancedParticipant(definition, "plane")?.targets ?? [];

  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror requires exactly one plane participant.",
    );
  }

  const [planeTarget] = targets;
  if (
    !planeTarget ||
    (planeTarget.kind !== "construction" && planeTarget.kind !== "face")
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror plane participants must be planar face or construction targets.",
    );
  }

  return planeTarget;
}

function getMirrorCopyOption(
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
) {
  if (definition.parameters.options?.copy !== true) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror currently supports copy=true only.",
    );
  }

  return true;
}

export function executeMirrorFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "mirror" },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC mirror does not support operation intents.",
    );
  }

  getMirrorCopyOption(definition);
  const bodyTargets = getMirrorBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const planeTarget = getMirrorPlaneTarget(definition);
  const plane = resolvePlanarReferencePlane(
    context,
    planeTarget,
    `construction_${ownerFeatureId}_mirror` as ConstructionId,
  );
  const mirror = new context.oc.gp_Trsf_1();
  mirror.SetMirror_3(buildMirrorAxisPlane(context, plane));

  const mirroredBodies: OccTrackedBody[] = [];
  for (const [index, bodyTarget] of bodyTargets.entries()) {
    const body = requireBody(context, bodyTarget.bodyId);
    const transformedShape = (() => {
      const nativeTransaction = buildNativeTransformTransaction(
        context,
        body,
        mirror,
        "mirror",
      );
      if (nativeTransaction) {
        return nativeTransaction.Shape() as InstanceType<
          OccFeatureExecutionContext["oc"]["TopoDS_Shape"]
        >;
      }

      const transform = new context.oc.BRepBuilderAPI_Transform_2(
        body.shape,
        mirror,
        true,
      );
      transform.Build(new context.oc.Message_ProgressRange_1());

      if (!transform.IsDone()) {
        throw new Error(
          "advanced-feature-unsupported-kernel-case: OCC mirror transform build failed.",
        );
      }

      return transform.Shape();
    })();

    mirroredBodies.push(
      ...trackBodiesFromShape(
        context,
        ownerFeatureId,
        "Mirror result",
        transformedShape,
        `mirror_${index + 1}`,
      ),
    );
  }

  return {
    bodies: [...context.bodies, ...mirroredBodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: mirroredBodies.map((body) => ({
      kind: "body" as const,
      bodyId: body.bodyId,
    })),
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  };
}

function getTransformBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const targets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (targets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires at least one body participant.",
    );
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC transform body participants must be durable body targets.",
      );
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getTransformReferenceTarget(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const targets =
    getAdvancedParticipant(definition, "transformReference")?.targets ?? [];

  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires exactly one transformReference participant.",
    );
  }

  const [referenceTarget] = targets;
  if (
    !referenceTarget ||
    (referenceTarget.kind !== "construction" && referenceTarget.kind !== "face")
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform references must be planar face or construction targets.",
    );
  }

  return referenceTarget;
}

function getTransformDistance(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const distance = definition.parameters.options?.distance;

  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform requires a positive distance option.",
    );
  }

  return distance;
}

function getTransformDirection(
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
) {
  const direction = definition.parameters.options?.direction;

  if (direction === undefined || direction === "positive") {
    return "positive";
  }

  if (direction === "negative") {
    return "negative";
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC transform direction must be positive or negative.",
  );
}

export function executeTransformFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "transform" },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC transform does not support operation intents.",
    );
  }

  const bodyTargets = getTransformBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const referenceTarget = getTransformReferenceTarget(definition);
  const distance = getTransformDistance(definition);
  const direction = getTransformDirection(definition);
  const plane = resolvePlanarReferencePlane(
    context,
    referenceTarget,
    `construction_${ownerFeatureId}_transform` as ConstructionId,
  );
  const signedDistance = direction === "positive" ? distance : -distance;
  const translation = new context.oc.gp_Trsf_1();
  translation.SetTranslation_1(
    toGpVec(context.oc, scale(normalize(plane.frame.normal), signedDistance)),
  );

  const nextBodies = [...context.bodies];
  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();
  const producedTargets: DurableRef[] = [];

  for (const bodyTarget of bodyTargets) {
    const body = requireBody(context, bodyTarget.bodyId);
    const nativeTransaction = buildNativeTransformTransaction(
      context,
      body,
      translation,
      "transform",
    );
    const replacementResult = nativeTransaction
      ? resolveNativeFeatureTransactionReplacement(
          context,
          body,
          nativeTransaction,
          "transform",
          ownerFeatureId,
        )
      : (() => {
          const transform = new context.oc.BRepBuilderAPI_Transform_2(
            body.shape,
            translation,
            true,
          );
          transform.Build(new context.oc.Message_ProgressRange_1());

          if (!transform.IsDone()) {
            throw new Error(
              "advanced-feature-unsupported-kernel-case: OCC transform build failed.",
            );
          }

          return resolveReplacementBodies(
            context,
            body.bodyId,
            transform.Shape(),
            ownerFeatureId,
            {
              allowEmpty: false,
              historySource: transform,
            },
          );
        })();
    const index = nextBodies.findIndex((entry) => entry.bodyId === body.bodyId);
    nextBodies.splice(index, 1, ...replacementResult.replacements);
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value);
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
  };
}
