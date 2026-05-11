import type { FilletFeatureParameters } from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import {
  advanceTopologyToken,
  type OccReferenceInvalidationRecord,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  requireBody,
  requireEdge,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
} from "@/domain/modeling/occ/features/boolean-operations";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";

function serializeNativeEdgeTargets(
  targets: readonly { edgeId: `edge_${string}` }[],
) {
  return targets.map((target) => target.edgeId).join(",");
}

function resolveNativeFilletReplacement(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  targets: FilletFeatureParameters["edgeTargets"],
  radius: number,
  ownerFeatureId: FeatureId,
) {
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const builder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildFilletCommittedShapeTransactionWithHistory;

  if (!builder) {
    return null;
  }

  const transaction = builder(
    body.shape,
    serializeNativeEdgeTargets(targets),
    radius,
    body.bodyId,
    body.topologyToken,
    advanceTopologyToken(body.topologyToken),
    context.modelingTolerance,
    0.5,
  );

  return resolveNativeFeatureTransactionReplacement(
    context,
    body,
    transaction,
    "fillet",
    ownerFeatureId,
  );
}

function resolveNativeChamferReplacement(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  targets: readonly Extract<DurableRef, { kind: "edge" }>[],
  distance: number,
  ownerFeatureId: FeatureId,
) {
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const builder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildChamferCommittedShapeTransactionWithHistory;

  if (!builder) {
    return null;
  }

  const transaction = builder(
    body.shape,
    serializeNativeEdgeTargets(targets),
    distance,
    body.bodyId,
    body.topologyToken,
    advanceTopologyToken(body.topologyToken),
    context.modelingTolerance,
    0.5,
  );

  return resolveNativeFeatureTransactionReplacement(
    context,
    body,
    transaction,
    "chamfer",
    ownerFeatureId,
  );
}

export function executeFilletFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: FilletFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.radius <= 0) {
    throw new Error("Fillet radius must be positive.");
  }

  if (parameters.edgeTargets.length === 0) {
    throw new Error("Fillet requires at least one target edge.");
  }

  const targetsByBody = new Map<
    BodyId,
    FilletFeatureParameters["edgeTargets"]
  >();

  for (const target of parameters.edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? [];
    targetsByBody.set(target.bodyId, [...list, target]);
  }

  const nextBodies = [...context.bodies];
  const producedTargets: DurableRef[] = [];
  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId);
    const replacementResult =
      resolveNativeFilletReplacement(
        context,
        body,
        targets,
        parameters.radius,
        ownerFeatureId,
      ) ??
      (() => {
        const fillet = new context.oc.BRepFilletAPI_MakeFillet(
          body.shape,
          context.oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
        );

        for (const target of targets) {
          fillet.Add_2(parameters.radius, requireEdge(body, target.edgeId));
        }

        fillet.Build(new context.oc.Message_ProgressRange_1());

        if (!fillet.IsDone()) {
          throw new Error(`OCC fillet build failed for body ${bodyId}.`);
        }

        return resolveReplacementBodies(
          context,
          bodyId,
          fillet.Shape(),
          ownerFeatureId,
          {
            allowEmpty: false,
            historySource: fillet,
          },
        );
      })();
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
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

function getChamferDistance(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
) {
  const distance = definition.parameters.options?.distance;

  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC chamfer requires a positive constant distance option.",
    );
  }

  return distance;
}

function getChamferEdgeTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
) {
  const edgeTargets = getAdvancedParticipant(definition, "edge")?.targets ?? [];

  if (edgeTargets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC chamfer requires at least one edge target.",
    );
  }

  for (const target of edgeTargets) {
    if (target.kind !== "edge") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC chamfer edge participants must be durable edge targets.",
      );
    }
  }

  return edgeTargets as readonly Extract<DurableRef, { kind: "edge" }>[];
}

function requireAdjacentFaceForChamfer(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  edge: InstanceType<
    import("@/domain/modeling/occ/runtime").OpenCascadeInstance["TopoDS_Edge"]
  >,
  edgeId: `edge_${string}`,
) {
  const edgeFaceMap =
    new context.oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
  context.oc.TopExp.MapShapesAndAncestors(
    body.shape,
    context.oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    edgeFaceMap,
  );

  const index = edgeFaceMap.FindIndex(edge);
  if (index <= 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC chamfer could not find adjacent faces for edge ${edgeId}.`,
    );
  }

  const faces = edgeFaceMap.FindFromIndex(index);
  if (faces.Size() <= 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC chamfer edge ${edgeId} has no adjacent faces.`,
    );
  }

  return context.oc.TopoDS.Face_1(faces.First_1());
}

export function executeChamferFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
): OccFeatureExecutionResult {
  if (
    definition.parameters.operationIntent !== undefined &&
    definition.parameters.operationIntent !== "create"
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC chamfer does not support boolean operation intents.",
    );
  }

  const distance = getChamferDistance(definition);
  const edgeTargets = getChamferEdgeTargets(definition);
  const targetsByBody = new Map<BodyId, typeof edgeTargets>();

  for (const target of edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? [];
    targetsByBody.set(target.bodyId, [...list, target]);
  }

  const nextBodies = [...context.bodies];
  const producedTargets: DurableRef[] = [];
  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId);
    const replacementResult =
      resolveNativeChamferReplacement(
        context,
        body,
        targets,
        distance,
        ownerFeatureId,
      ) ??
      (() => {
        const chamfer = new context.oc.BRepFilletAPI_MakeChamfer(body.shape);

        for (const target of targets) {
          const edge = requireEdge(body, target.edgeId);
          chamfer.Add_3(
            distance,
            distance,
            edge,
            requireAdjacentFaceForChamfer(context, body, edge, target.edgeId),
          );
        }

        chamfer.Build(new context.oc.Message_ProgressRange_1());

        if (!chamfer.IsDone()) {
          throw new Error(
            `advanced-feature-unsupported-kernel-case: OCC chamfer build failed for body ${bodyId}.`,
          );
        }

        return resolveReplacementBodies(
          context,
          bodyId,
          chamfer.Shape(),
          ownerFeatureId,
          {
            allowEmpty: false,
            historySource: chamfer,
          },
        );
      })();
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
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
