import type { ShellFeatureParameters } from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
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
  requireSolidBody,
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

function isClosedHollowShell(parameters: ShellFeatureParameters) {
  return parameters.mode === "closedHollow";
}

function getShellSignedThickness(parameters: ShellFeatureParameters) {
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  return parameters.direction === "outside" ? resolvedThickness : -resolvedThickness;
}

function assertValidSingleSolidShellShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
  mode: "closedHollow" | "offsetAllFaces",
) {
  const analyzer = new context.oc.BRepCheck_Analyzer(shape, true, false);
  try {
    if (!analyzer.IsValid_2()) {
      throw new Error(`OCC shell ${mode} produced invalid topology.`);
    }
  } finally {
    analyzer.delete();
  }

  const solids = extractSolidShapes(context.oc, shape);
  if (solids.length !== 1) {
    for (const solid of solids) solid.delete();
    throw new Error(
      `OCC shell ${mode} must produce exactly one solid, received ${solids.length}.`,
    );
  }

  return solids[0]!;
}

function getShapeBounds(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
) {
  const points = getShapeVertexPoints(context.oc, shape);
  const mesher = new context.oc.BRepMesh_IncrementalMesh_2(
    shape,
    Math.max(context.modelingTolerance * 10, 0.01),
    false,
    0.5,
    false,
  );
  const faces = new context.oc.TopTools_IndexedMapOfShape_1();
  try {
    context.oc.TopExp.MapShapes_1(
      shape,
      context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      faces,
    );
    for (let index = 1; index <= faces.Size(); index += 1) {
      const face = context.oc.TopoDS.Face_1(faces.FindKey(index));
      const location = new context.oc.TopLoc_Location_1();
      try {
        const triangulationHandle = context.oc.BRep_Tool.Triangulation(
          face,
          location,
          0 as never,
        );
        if (triangulationHandle.IsNull()) continue;
        const triangulation = triangulationHandle.get();
        for (let nodeIndex = 1; nodeIndex <= triangulation.NbNodes(); nodeIndex += 1) {
          const point = triangulation
            .Node(nodeIndex)
            .Transformed(location.Transformation());
          points.push([point.X(), point.Y(), point.Z()]);
        }
      } finally {
        location.delete();
      }
    }
  } finally {
    faces.delete();
    mesher.delete();
  }

  if (points.length === 0) {
    throw new Error("OCC closedHollow could not verify the source outer envelope.");
  }

  return [
    Math.min(...points.map(([x]) => x)),
    Math.max(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([, y]) => y)),
    Math.min(...points.map(([, , z]) => z)),
    Math.max(...points.map(([, , z]) => z)),
  ] as const;
}

function getShapeVolume(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
) {
  const properties = new context.oc.GProp_GProps_1();
  try {
    context.oc.BRepGProp.VolumeProperties_1(
      shape,
      properties,
      false,
      false,
      false,
    );
    return properties.Mass();
  } finally {
    properties.delete();
  }
}

function assertClosedHollowSemantics(
  context: OccFeatureExecutionContext,
  sourceShape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
  resultShape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>,
) {
  const solid = assertValidSingleSolidShellShape(
    context,
    resultShape,
    "closedHollow",
  );
  const sourceBounds = getShapeBounds(context, sourceShape);
  const resultBounds = getShapeBounds(context, solid);
  const tolerance = context.modelingTolerance * 10;
  if (
    sourceBounds.some(
      (value, index) => Math.abs(value - resultBounds[index]!) > tolerance,
    )
  ) {
    throw new Error(
      `OCC closedHollow changed the source outer envelope (${sourceBounds.join(", ")} -> ${resultBounds.join(", ")}).`,
    );
  }

  const sourceVolume = getShapeVolume(context, sourceShape);
  const resultVolume = getShapeVolume(context, solid);
  const minimumCavityVolume = Math.max(
    context.modelingTolerance ** 3,
    Math.abs(sourceVolume) * 1e-10,
  );
  if (
    sourceVolume <= minimumCavityVolume ||
    resultVolume <= 0 ||
    resultVolume >= sourceVolume - minimumCavityVolume
  ) {
    throw new Error("OCC closedHollow did not produce a valid inner cavity.");
  }

  return solid;
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

  const sourceBody = requireSolidBody(
    context,
    parameters.bodyTarget.bodyId,
    "shell",
  );
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
    shape: assertValidSingleSolidShellShape(
      context,
      shell.Shape(),
      "offsetAllFaces",
    ),
  };
}

function buildClosedHollowShellShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (!isClosedHollowShell(parameters)) {
    throw new Error("Closed-hollow shell builder received non-closed-hollow parameters.");
  }
  if (parameters.faceTargets.length !== 0) {
    throw new Error("Shell closedHollow mode cannot include removable faces.");
  }
  if (parameters.direction !== "inside") {
    throw new Error("Shell closedHollow mode requires an inside direction.");
  }

  const sourceBody = requireSolidBody(
    context,
    parameters.bodyTarget.bodyId,
    "shell",
  );
  const cavityOffset = new context.oc.BRepOffsetAPI_MakeOffsetShape();
  const offsetProgress = new context.oc.Message_ProgressRange_1();
  const offsetBuildProgress = new context.oc.Message_ProgressRange_1();
  try {
    cavityOffset.PerformByJoin(
      sourceBody.shape,
      getShellSignedThickness(parameters),
      context.modelingTolerance,
      context.oc.BRepOffset_Mode.BRepOffset_Skin as never,
      false,
      false,
      context.oc.GeomAbs_JoinType.GeomAbs_Arc as never,
      false,
      offsetProgress,
    );
    cavityOffset.Build(offsetBuildProgress);
    if (!cavityOffset.IsDone()) {
      throw new Error("OCC shell closedHollow cavity offset failed.");
    }

    const offsetShape = cavityOffset.Shape();
    try {
      const cavity = assertValidSingleSolidShellShape(
        context,
        offsetShape,
        "closedHollow",
      );
      try {
        const cutProgress = new context.oc.Message_ProgressRange_1();
        const cutBuildProgress = new context.oc.Message_ProgressRange_1();
        const cut = new context.oc.BRepAlgoAPI_Cut_3(
          sourceBody.shape,
          cavity,
          cutProgress,
        );
        try {
          cut.Build(cutBuildProgress);
          if (!cut.IsDone()) {
            throw new Error("OCC shell closedHollow cavity cut failed.");
          }

          const cutShape = cut.Shape();
          try {
            return {
              sourceBody,
              shape: assertClosedHollowSemantics(
                context,
                sourceBody.shape,
                cutShape,
              ),
            };
          } finally {
            cutShape.delete();
          }
        } finally {
          cut.delete();
          cutBuildProgress.delete();
          cutProgress.delete();
        }
      } finally {
        cavity.delete();
      }
    } finally {
      offsetShape.delete();
    }
  } finally {
    offsetBuildProgress.delete();
    offsetProgress.delete();
    cavityOffset.delete();
  }
}

function buildShellFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (isOffsetAllFacesShell(parameters) || isClosedHollowShell(parameters)) {
    throw new Error("Open-face shell builder received non-open-face parameters.");
  }
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error("Shell requires at least one removable face.");
  }

  const sourceBody = requireSolidBody(
    context,
    parameters.bodyTarget.bodyId,
    "shell",
  );
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
  if (isOffsetAllFacesShell(parameters) || isClosedHollowShell(parameters)) {
    throw new Error("Native open-face shell builder received non-open-face parameters.");
  }
  const resolvedThickness = getAuthoredLiteralValue(parameters.thickness);
  if (resolvedThickness === null || resolvedThickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error("Shell requires at least one removable face.");
  }

  const sourceBody = requireSolidBody(
    context,
    parameters.bodyTarget.bodyId,
    "shell",
  );

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

function executeClosedHollowShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  const shellResult = buildClosedHollowShellShape(context, parameters);
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
  if (isClosedHollowShell(parameters)) {
    return executeClosedHollowShellFeature(context, ownerFeatureId, parameters);
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
