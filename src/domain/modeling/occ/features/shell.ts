import type { ShellFeatureParameters } from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import {
  getShapeVertexPoints,
  listOccShapes,
} from "@/domain/modeling/occ/features/extrude";
import type { BodyId, FaceId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { OccReferenceInvalidationRecord } from "@/domain/modeling/occ/topology";
import {
  advanceTopologyToken,
  extractSolidShapes,
  trackDerivedSolidBody,
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
  mapFeatureSourceTargets,
  resolveReplacementBodies,
  validateNativeFeatureTransaction,
} from "@/domain/modeling/occ/features/boolean-operations";
import { collectLocalOperationTopologyStages } from "@/domain/modeling/occ/features/fillet-chamfer";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import type { OccTopologyHistorySource } from "@/domain/modeling/occ/topology-naming";
import {
  formatGeneratedProducerTopologySourceKey,
  type OccFeatureTopologyStage,
} from "@/domain/modeling/occ/topology-stage";

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

  return parameters.direction === "outside"
    ? resolvedThickness
    : -resolvedThickness;
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
        for (
          let nodeIndex = 1;
          nodeIndex <= triangulation.NbNodes();
          nodeIndex += 1
        ) {
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
    throw new Error(
      "OCC closedHollow could not verify the source outer envelope.",
    );
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

type OccShape = InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
type ClosedHollowOffsetRelationRole = "modified" | "generated";

interface ClosedHollowOffsetCandidate {
  shape: OccShape;
  roles: Set<ClosedHollowOffsetRelationRole>;
}

function appendExactOffsetCandidate(
  candidates: ClosedHollowOffsetCandidate[],
  shape: OccShape,
  role: ClosedHollowOffsetRelationRole,
) {
  const existing = candidates.find((candidate) => candidate.shape.IsSame(shape));
  if (existing) {
    existing.roles.add(role);
    return;
  }
  candidates.push({ shape, roles: new Set([role]) });
}

function appendUniqueExactShape(shapes: OccShape[], shape: OccShape) {
  if (!shapes.some((candidate) => candidate.IsSame(shape))) {
    shapes.push(shape);
  }
}

/**
 * Compose the only exact history path for an inside closed hollow:
 * source face → offset face → cut-result inner face. The relation roles are
 * retained while both builders are alive; only a one-to-one source/result path
 * survives to public topology mapping.
 */
function collectClosedHollowInnerOffsetFaceShapes(input: {
  context: OccFeatureExecutionContext;
  sourceBody: ReturnType<typeof requireSolidBody>;
  cavityOffset: {
    Modified(source: never): InstanceType<
      OccFeatureExecutionContext["oc"]["TopTools_ListOfShape"]
    >;
    Generated(source: never): InstanceType<
      OccFeatureExecutionContext["oc"]["TopTools_ListOfShape"]
    >;
  };
  cut: {
    Modified(source: never): InstanceType<
      OccFeatureExecutionContext["oc"]["TopTools_ListOfShape"]
    >;
    Generated(source: never): InstanceType<
      OccFeatureExecutionContext["oc"]["TopTools_ListOfShape"]
    >;
  };
  finalShell: OccShape;
}) {
  const finalFaces = new input.context.oc.TopTools_IndexedMapOfShape_1();
  const sourceCandidates = new Map<FaceId, OccShape[]>();
  try {
    input.context.oc.TopExp.MapShapes_1(
      input.finalShell,
      input.context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      finalFaces,
    );
    const finalFaceShapes = Array.from({ length: finalFaces.Size() }, (_, index) =>
      input.context.oc.TopoDS.Face_1(finalFaces.FindKey(index + 1)),
    );

    for (const [sourceFaceId, sourceFace] of input.sourceBody.facesById) {
      const offsetCandidates: ClosedHollowOffsetCandidate[] = [];
      for (const shape of listOccShapes(
        input.context.oc,
        input.cavityOffset.Modified(sourceFace as never),
      )) {
        appendExactOffsetCandidate(offsetCandidates, shape, "modified");
      }
      for (const shape of listOccShapes(
        input.context.oc,
        input.cavityOffset.Generated(sourceFace as never),
      )) {
        appendExactOffsetCandidate(offsetCandidates, shape, "generated");
      }

      const resultCandidates: OccShape[] = [];
      for (const offsetCandidate of offsetCandidates) {
        const cutCandidates = [
          ...listOccShapes(
            input.context.oc,
            input.cut.Modified(offsetCandidate.shape as never),
          ),
          ...listOccShapes(
            input.context.oc,
            input.cut.Generated(offsetCandidate.shape as never),
          ),
          // Some OCC cuts retain the offset face unchanged and report no
          // Modified/Generated entry. Exact final-shell membership is history
          // only when it is the same native shape.
          ...finalFaceShapes.filter((face) => face.IsSame(offsetCandidate.shape)),
        ];
        for (const cutCandidate of cutCandidates) {
          for (const finalFace of finalFaceShapes) {
            if (finalFace.IsSame(cutCandidate)) {
              appendUniqueExactShape(resultCandidates, finalFace);
            }
          }
        }
      }
      sourceCandidates.set(sourceFaceId, resultCandidates);
    }
  } finally {
    finalFaces.delete();
  }

  const uniqueRelations = new Map<FaceId, OccShape[]>();
  for (const [sourceFaceId, resultCandidates] of sourceCandidates) {
    if (resultCandidates.length !== 1) continue;
    const [result] = resultCandidates;
    const inverseCount = [...sourceCandidates.values()].filter((candidates) =>
      candidates.some((candidate) => candidate.IsSame(result!)),
    ).length;
    if (inverseCount === 1) {
      uniqueRelations.set(sourceFaceId, [result!]);
    }
  }
  return uniqueRelations;
}

/**
 * Convert pre-deletion exact composed history into stable public claims only
 * after replacement topology has been tracked. Missing, many, and conflicting
 * source/result relations deliberately remain unnamed.
 */
export function createClosedHollowInnerOffsetFaceClaims(input: {
  featureId: FeatureId;
  sourceBody: ReturnType<typeof requireSolidBody>;
  outputBody: ReturnType<typeof requireSolidBody>;
  targetsBySourceFaceId: ReadonlyMap<FaceId, readonly DurableRef[]>;
}) {
  const targetsBySourceFaceId = new Map<
    FaceId,
    Extract<DurableRef, { kind: "face" }>
  >();
  const sourceFaceIdsByTargetKey = new Map<string, FaceId[]>();
  for (const [sourceFaceId, targets] of input.targetsBySourceFaceId) {
    if (!input.sourceBody.facesById.has(sourceFaceId)) continue;
    const faces = targets.filter(
      (target): target is Extract<DurableRef, { kind: "face" }> =>
        target.kind === "face" && target.bodyId === input.outputBody.bodyId,
    );
    if (faces.length !== 1) continue;
    const target = faces[0]!;
    targetsBySourceFaceId.set(sourceFaceId, target);
    const targetKey = `${target.bodyId}:${target.faceId}`;
    sourceFaceIdsByTargetKey.set(targetKey, [
      ...(sourceFaceIdsByTargetKey.get(targetKey) ?? []),
      sourceFaceId,
    ]);
  }

  const claims = new Map<string, DurableRef>();
  for (const [sourceFaceId, target] of targetsBySourceFaceId) {
    if (sourceFaceIdsByTargetKey.get(`${target.bodyId}:${target.faceId}`)?.length !== 1) {
      continue;
    }
    claims.set(
      formatGeneratedProducerTopologySourceKey({
        featureId: input.featureId,
        bodyId: input.sourceBody.bodyId,
        sourceKind: "face",
        sourcePublicId: sourceFaceId,
        role: "shell-inner-offset-face-of",
      }),
      target,
    );
  }
  return claims;
}

function buildOffsetAllFacesShellShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (!isOffsetAllFacesShell(parameters)) {
    throw new Error(
      "Shell offsetAllFaces builder received open-face parameters.",
    );
  }
  if (parameters.faceTargets.length !== 0) {
    throw new Error(
      "Shell offsetAllFaces mode cannot include removable faces.",
    );
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
    // `BRepOffsetAPI_MakeOffsetShape` answers `Modified` for every offset face,
    // which is the only exact identity this mode has; the builder therefore
    // outlives the call so the caller can reconcile instead of re-minting ids.
    builder: shell,
    topologyHistory: "includeGenerated" as const,
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
    throw new Error(
      "Closed-hollow shell builder received non-closed-hollow parameters.",
    );
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
        // The cut builder is the closed-hollow shell's only exact history: it
        // maps every outer face of the source solid onto its survivor. It must
        // outlive this function so the caller can reconcile identities instead
        // of minting a fresh positional id for the whole body on every rebuild.
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
              builder: cut,
              // A cut can prove each surviving outer source face exactly, but
              // cannot attribute an inner cavity face to it without composing
              // offset history with the cut. Publish successors only.
              topologyHistory: "exactSuccessorsOnly" as const,
              shape: assertClosedHollowSemantics(
                context,
                sourceBody.shape,
                cutShape,
              ),
              innerOffsetFaceShapesBySourceFaceId:
                collectClosedHollowInnerOffsetFaceShapes({
                  context,
                  sourceBody,
                  cavityOffset,
                  cut,
                  finalShell: cutShape,
                }),
            };
          } finally {
            cutShape.delete();
          }
        } catch (error) {
          cut.delete();
          throw error;
        } finally {
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
    throw new Error(
      "Open-face shell builder received non-open-face parameters.",
    );
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
    parameters.direction === "outside" ? resolvedThickness : -resolvedThickness;
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
    throw new Error(
      "Native open-face shell builder received non-open-face parameters.",
    );
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
    parameters.direction === "outside" ? resolvedThickness : -resolvedThickness;
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

/**
 * Replace one solid with a whole-body shell result, carrying the builder's own
 * exact history.
 *
 * Both whole-body modes rebuild the source solid from scratch, so without a
 * history source every face of the result is a fresh positional id. The ids
 * then change on every rebuild (the topology token advances each replay), which
 * silently renames the whole body and invalidates every downstream claim keyed
 * on those ids. The builder answers `Modified` for each surviving outer face,
 * so identity is exact and reproducible; anything it cannot name stays honestly
 * unclaimed.
 */
function executeWholeBodyShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  shellResult: {
    sourceBody: ReturnType<typeof requireSolidBody>;
    builder: OccTopologyHistorySource;
    topologyHistory: "includeGenerated" | "exactSuccessorsOnly";
    shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
    innerOffsetFaceShapesBySourceFaceId?: ReadonlyMap<FaceId, readonly OccShape[]>;
  },
): OccFeatureExecutionResult {
  const replacementResult = resolveReplacementBodies(
    context,
    shellResult.sourceBody.bodyId,
    shellResult.shape,
    ownerFeatureId,
    { allowEmpty: false, historySource: shellResult.builder },
  );
  const bodies = context.bodies.flatMap((body) =>
    body.bodyId === shellResult.sourceBody.bodyId
      ? replacementResult.replacements
      : [body],
  );
  const producedTargets = replacementResult.replacements.map((replacement) => ({
    kind: "body" as const,
    bodyId: replacement.bodyId,
  }));
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>(
    replacementResult.historyInvalidations,
  );
  const topologyStages: OccFeatureTopologyStage[] = [];
  const supplementalProducerTargetsByOutputBodyId = new Map(
    replacementResult.replacements.map((replacement) => {
      const targetsBySourceFaceId = mapFeatureSourceTargets(
        [replacement],
        new Map(
          [...(shellResult.innerOffsetFaceShapesBySourceFaceId ?? [])].map(
            ([sourceFaceId, shapes]) => [sourceFaceId, shapes],
          ),
        ),
      );
      return [
        replacement.bodyId,
        createClosedHollowInnerOffsetFaceClaims({
          featureId: ownerFeatureId,
          sourceBody: shellResult.sourceBody,
          outputBody: replacement,
          targetsBySourceFaceId: new Map(
            [...(targetsBySourceFaceId ?? new Map())].map(([sourceFaceId, targets]) => [
              sourceFaceId as FaceId,
              targets,
            ]),
          ),
        }),
      ] as const;
    }),
  );
  collectLocalOperationTopologyStages({
    oc: context.oc,
    topologyStages,
    ownerFeatureId,
    sourceBody: shellResult.sourceBody,
    historyInvalidations,
    replacementResult,
    hasNativeHistory: false,
    generatedHistorySource: shellResult.builder as unknown as {
      Generated(source: never): never;
    },
    exactSuccessorHistorySource:
      shellResult.topologyHistory === "exactSuccessorsOnly"
        ? (shellResult.builder as unknown as { Modified(source: never): never })
        : null,
    includeGeneratedTopology:
      shellResult.topologyHistory === "includeGenerated",
    supplementalProducerTargetsByOutputBodyId,
  });

  return {
    bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
    topologyStage: {
      featureId: ownerFeatureId,
      outputs: new Map(topologyStages.flatMap((stage) => [...stage.outputs])),
    },
  };
}

export function executeShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  if (isOffsetAllFacesShell(parameters)) {
    return executeWholeBodyShellFeature(
      context,
      ownerFeatureId,
      buildOffsetAllFacesShellShape(context, parameters),
    );
  }
  if (isClosedHollowShell(parameters)) {
    return executeWholeBodyShellFeature(
      context,
      ownerFeatureId,
      buildClosedHollowShellShape(context, parameters),
    );
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
