import type { ShellFeatureParameters } from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { OccReferenceInvalidationRecord } from "@/domain/modeling/occ/topology";
import {
  advanceTopologyToken,
  extractSolidShapes,
  trackDerivedSolidBody,
  trackReplacementSolidBody,
} from "@/domain/modeling/occ/topology";
import {
  requireBody,
  requireFace,
  resolveNativeTopologyTargetId,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  applyBooleanPolicy,
  validateNativeFeatureTransaction,
} from "@/domain/modeling/occ/features/boolean-operations";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import { createUnsupportedProducerTopologyStage } from "@/domain/modeling/occ/topology-stage";

function serializeNativeFaceTargets(
  body: ReturnType<typeof requireBody>,
  targets: readonly { bodyId: BodyId; faceId: `face_${string}` }[],
) {
  return targets
    .map((target) =>
      resolveNativeTopologyTargetId(body, {
        kind: "face",
        bodyId: target.bodyId,
        faceId: target.faceId,
      }),
    )
    .join(",");
}

function isOffsetAllFacesShell(parameters: ShellFeatureParameters) {
  return parameters.mode === "offsetAllFaces";
}

function getShellSignedThickness(parameters: ShellFeatureParameters) {
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  return parameters.direction === "outside" ? resolvedThickness : -resolvedThickness;
}

function assertValidSolidOffsetShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
) {
  const analyzer = new context.oc.BRepCheck_Analyzer(shape, true, false);
  try {
    if (!analyzer.IsValid_2()) {
      throw new Error("OCC shell offsetAllFaces produced invalid topology.");
    }
  } finally {
    analyzer.delete();
  }

  const solids = extractSolidShapes(context.oc, shape);
  if (solids.length !== 1) {
    throw new Error(
      `OCC shell offsetAllFaces must produce exactly one solid, received ${solids.length}.`,
    );
  }

  return solids[0]!;
}

function buildOffsetAllFacesShellShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (!isOffsetAllFacesShell(parameters)) {
    throw new Error("Shell offsetAllFaces builder received open-face parameters.");
  }
  if (parameters.faceTargets.length !== 0) {
    throw new Error("Shell offsetAllFaces mode cannot include removable faces.");
  }

  const sourceBody = requireBody(context, parameters.bodyTarget.bodyId);
  const shell = new context.oc.BRepOffsetAPI_MakeOffsetShape();
  shell.PerformByJoin(
    sourceBody.shape,
    getShellSignedThickness(parameters),
    context.modelingTolerance,
    context.oc.BRepOffset_Mode.BRepOffset_Skin as never,
    false,
    false,
    context.oc.GeomAbs_JoinType.GeomAbs_Arc as never,
    false,
    new context.oc.Message_ProgressRange_1(),
  );
  shell.Build(new context.oc.Message_ProgressRange_1());

  if (!shell.IsDone()) {
    throw new Error("OCC shell offsetAllFaces build failed.");
  }

  return {
    sourceBody,
    shape: assertValidSolidOffsetShape(context, shell.Shape()),
  };
}

function buildShellFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (isOffsetAllFacesShell(parameters)) {
    throw new Error("Open-face shell builder received offsetAllFaces parameters.");
  }
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error("Shell requires at least one removable face.");
  }

  const sourceBody = requireBody(context, parameters.bodyTarget.bodyId);
  const closingFaces = new context.oc.TopTools_ListOfShape_1();

  for (const target of parameters.faceTargets) {
    if (target.bodyId !== parameters.bodyTarget.bodyId) {
      throw new Error(
        "Shell removable faces must belong to the selected source body.",
      );
    }

    closingFaces.Append_1(requireFace(context, sourceBody, target.faceId));
  }

  const signedThickness =
    parameters.direction === "outside"
      ? resolvedThickness
      : -resolvedThickness;
  const shell = new context.oc.BRepOffsetAPI_MakeThickSolid();
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
  );
  shell.Build(new context.oc.Message_ProgressRange_1());

  if (!shell.IsDone()) {
    throw new Error("OCC shell build failed.");
  }

  return {
    sourceBody,
    builder: shell,
    shape: shell.Shape(),
  };
}

function buildNativeShellFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (isOffsetAllFacesShell(parameters)) {
    throw new Error("Native open-face shell builder received offsetAllFaces parameters.");
  }
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error("Shell requires at least one removable face.");
  }

  const sourceBody = requireBody(context, parameters.bodyTarget.bodyId);

  for (const target of parameters.faceTargets) {
    if (target.bodyId !== parameters.bodyTarget.bodyId) {
      throw new Error(
        "Shell removable faces must belong to the selected source body.",
      );
    }
  }

  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const builder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildShellCommittedShapeTransactionWithHistory;

  if (!builder) {
    return null;
  }

  const signedThickness =
    parameters.direction === "outside"
      ? resolvedThickness
      : -resolvedThickness;
  const transaction = builder(
    sourceBody.shape,
    serializeNativeFaceTargets(sourceBody, parameters.faceTargets),
    signedThickness,
    sourceBody.bodyId,
    sourceBody.topologyToken,
    advanceTopologyToken(sourceBody.topologyToken),
    context.modelingTolerance,
    0.5,
  );

  validateNativeFeatureTransaction(transaction, "shell");

  return {
    sourceBody,
    shape: transaction.Shape() as InstanceType<
      OccFeatureExecutionContext["oc"]["TopoDS_Shape"]
    >,
  };
}

function executeOffsetAllFacesShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  const shellResult = buildOffsetAllFacesShellShape(context, parameters);
  const replacement = trackReplacementSolidBody(context.oc, {
    previous: shellResult.sourceBody,
    ownerFeatureId,
    shape: shellResult.shape,
  });
  const bodies = context.bodies.map((body) =>
    body.bodyId === shellResult.sourceBody.bodyId ? replacement : body,
  );
  const producedTargets = [{ kind: "body" as const, bodyId: replacement.bodyId }];

  return {
    bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    topologyStage: createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies,
      producedTargets,
    }),
  };
}

export function executeShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  if (isOffsetAllFacesShell(parameters)) {
    return executeOffsetAllFacesShellFeature(context, ownerFeatureId, parameters);
  }
  const resolvedOperation = getAuthoredLiteralValue(parameters.operation);
  if (!resolvedOperation) {
    throw new Error("Shell operation must be a resolved literal value.");
  }
  if (resolvedOperation !== "newBody") {
    const shellResult =
      buildNativeShellFeatureShape(context, parameters) ??
      buildShellFeatureShape(context, parameters);
    const result = applyBooleanPolicy(
      context,
      ownerFeatureId,
      resolvedOperation,
      parameters.booleanScope,
      shellResult.shape,
    );

    return {
      bodies: result.bodies,
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: result.producedTargets,
      entities: [],
      renderRecords: [],
      historyInvalidations: result.historyInvalidations,
    };
  }

  const shellResult = buildShellFeatureShape(context, parameters);

  const newBody = trackDerivedSolidBody(context.oc, {
    previous: shellResult.sourceBody,
    bodyId: `body_${ownerFeatureId}` as BodyId,
    label: ownerFeatureId,
    ownerFeatureId,
    shape: shellResult.shape,
    historySources: [shellResult.builder],
  });

  return {
    bodies: [...context.bodies, newBody],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [{ kind: "body", bodyId: newBody.bodyId }],
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  };
}
