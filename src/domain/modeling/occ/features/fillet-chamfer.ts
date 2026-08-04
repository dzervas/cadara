import type { FilletFeatureParameters } from "@/contracts/modeling/schema";
import {
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  AdvancedSolidFeatureDefinition,
  ChamferWidthForm,
} from "@/contracts/modeling/advanced-solid";
import type {
  BodyId,
  EdgeId,
  FaceId,
  FeatureId,
  VertexId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import {
  advanceTopologyToken,
  getOccDurableRefKey,
  type OccReferenceInvalidationRecord,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  requireSolidBody,
  requireEdge,
  resolveNativeTopologyTargetId,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
} from "@/domain/modeling/occ/features/boolean-operations";
import { listOccShapes } from "@/domain/modeling/occ/features/extrude";
import type { OpenCascadeNativeTopologyKernelHost } from "@/domain/modeling/occ/native-topology-payload";
import {
  createExactSuccessorTopologyStage,
  createUnsupportedProducerTopologyStage,
  formatGeneratedProducerTopologySourceKey,
  type OccFeatureTopologyStage,
  type OccGeneratedAdjacencyEntry,
  type OccGeneratedFaceCompleteBoundaryEntry,
} from "@/domain/modeling/occ/topology-stage";

type OccSubtopologyShape = { IsSame(other: never): boolean };

/**
 * Exact identity successors for one local-operation replacement body.
 *
 * `BRepFilletAPI`'s `IsDeleted` over-reports: for a chamfer/fillet it answers
 * `true` for every prior edge and vertex it did not itself modify, including
 * ones the result still contains as the *identical* `TopoDS` shape. Taking that
 * answer at face value invalidates untouched topology, and a later feature that
 * selects one of those edges is then refused with
 * `occ-topology-unsupported-history`.
 *
 * Shape identity is exact ground truth, not a geometric match: a previous
 * subtopology that is `IsSame` as a subtopology of the result IS that entity.
 * Only a one-to-one identity is claimed; anything shared or absent is left to
 * the kernel's own history classification.
 */
function collectExactIdentitySuccessors(
  sourceBody: OccTrackedBody,
  replacement: OccTrackedBody,
) {
  const successors = new Map<string, DurableRef>();

  const claimKind = <Id extends string>(
    previousShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    currentShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    toRef: (bodyId: BodyId, id: Id) => DurableRef,
  ) => {
    const claimedCurrentIds = new Set<Id>();
    const claims = new Map<Id, Id>();

    for (const [previousId, previousShape] of previousShapesById) {
      const identical = [...currentShapesById].filter(([, currentShape]) =>
        previousShape.IsSame(currentShape as never),
      );
      if (identical.length !== 1) {
        continue;
      }
      const currentId = identical[0]![0];
      if (claimedCurrentIds.has(currentId)) {
        // Two prior entities cannot both be the same result entity.
        for (const [otherPreviousId, otherCurrentId] of claims) {
          if (otherCurrentId === currentId) claims.delete(otherPreviousId);
        }
        continue;
      }
      claimedCurrentIds.add(currentId);
      claims.set(previousId, currentId);
    }

    for (const [previousId, currentId] of claims) {
      successors.set(
        getOccDurableRefKey(toRef(sourceBody.bodyId, previousId)),
        toRef(replacement.bodyId, currentId),
      );
    }
  };

  claimKind(sourceBody.facesById, replacement.facesById, (bodyId, faceId) => ({
    kind: "face",
    bodyId,
    faceId,
  }));
  claimKind(sourceBody.edgesById, replacement.edgesById, (bodyId, edgeId) => ({
    kind: "edge",
    bodyId,
    edgeId,
  }));
  claimKind(
    sourceBody.verticesById,
    replacement.verticesById,
    (bodyId, vertexId) => ({ kind: "vertex", bodyId, vertexId }),
  );

  return successors;
}

/**
 * Exact successors reported directly by the builder's `Modified` relation.
 * This deliberately excludes `Generated`: a modified source entity can retain
 * its identity, whereas a generated result cannot be its successor.
 */
function collectExactModifiedSuccessors(input: {
  oc: OccFeatureExecutionContext["oc"];
  sourceBody: OccTrackedBody;
  replacement: OccTrackedBody;
  builder: { Modified(source: never): never };
}) {
  const successors = new Map<string, DurableRef>();
  const claimKind = <Id extends FaceId | EdgeId | VertexId>(
    previousShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    currentShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    toRef: (bodyId: BodyId, id: Id) => DurableRef,
  ) => {
    for (const [previousId, previousShape] of previousShapesById) {
      const matches = listOccShapes(
        input.oc,
        input.builder.Modified(previousShape as never),
      ).flatMap((modified) =>
        [...currentShapesById].filter(([, currentShape]) =>
          currentShape.IsSame(modified as never),
        ),
      );
      if (matches.length !== 1) continue;
      successors.set(
        getOccDurableRefKey(toRef(input.sourceBody.bodyId, previousId)),
        toRef(input.replacement.bodyId, matches[0]![0]),
      );
    }
  };

  claimKind(
    input.sourceBody.facesById,
    input.replacement.facesById,
    (bodyId, faceId) => ({
      kind: "face",
      bodyId,
      faceId,
    }),
  );
  claimKind(
    input.sourceBody.edgesById,
    input.replacement.edgesById,
    (bodyId, edgeId) => ({
      kind: "edge",
      bodyId,
      edgeId,
    }),
  );
  claimKind(
    input.sourceBody.verticesById,
    input.replacement.verticesById,
    (bodyId, vertexId) => ({
      kind: "vertex",
      bodyId,
      vertexId,
    }),
  );

  return successors;
}

/**
 * Producer-identity claims for subtopology a local operation CREATED.
 *
 * A generated entity is the successor of nothing, so exact-successor lineage
 * cannot name it: a rebuild sees `sourceKeys.length === 0` and invalidates it
 * as `occ-topology-unsupported-history`. That is precisely what refused a
 * second chamfer selecting the first chamfer's own surface.
 *
 * The only exact answer available is the builder's `Generated(source)`: the
 * entity it reports is owned by this feature and attributed to that one source
 * shape, which is identity, not a match. Anything reachable from two sources,
 * or not resolvable to exactly one result entity, is left unclaimed so the
 * rebuild stays honest.
 */
function collectGeneratedProducerTargets(input: {
  oc: OccFeatureExecutionContext["oc"];
  ownerFeatureId: FeatureId;
  sourceBody: OccTrackedBody;
  replacement: OccTrackedBody;
  builder: { Generated(source: never): never };
}) {
  const claims = new Map<string, DurableRef>();
  const claimedSourceKeysByTarget = new Map<string, string>();

  const claimFrom = (
    sourceKind: "face" | "edge" | "vertex",
    sourcePublicId: FaceId | EdgeId | VertexId,
    sourceShape: OccSubtopologyShape,
  ) => {
    for (const shape of listOccShapes(
      input.oc,
      input.builder.Generated(sourceShape as never),
    )) {
      const matches: DurableRef[] = [];
      for (const [faceId, face] of input.replacement.facesById) {
        if ((face as OccSubtopologyShape).IsSame(shape as never)) {
          matches.push({
            kind: "face",
            bodyId: input.replacement.bodyId,
            faceId,
          });
        }
      }
      for (const [edgeId, edge] of input.replacement.edgesById) {
        if ((edge as OccSubtopologyShape).IsSame(shape as never)) {
          matches.push({
            kind: "edge",
            bodyId: input.replacement.bodyId,
            edgeId,
          });
        }
      }
      for (const [vertexId, vertex] of input.replacement.verticesById) {
        if ((vertex as OccSubtopologyShape).IsSame(shape as never)) {
          matches.push({
            kind: "vertex",
            bodyId: input.replacement.bodyId,
            vertexId,
          });
        }
      }

      if (matches.length !== 1) {
        continue;
      }

      const target = matches[0]!;
      const targetKey = getOccDurableRefKey(target);
      const sourceKey = formatGeneratedProducerTopologySourceKey({
        featureId: input.ownerFeatureId,
        bodyId: input.sourceBody.bodyId,
        sourceKind,
        sourcePublicId,
        role: `generated-${target.kind}`,
      });

      const alreadyClaimedBy = claimedSourceKeysByTarget.get(targetKey);
      if (alreadyClaimedBy !== undefined) {
        // Reachable from two sources: many, so nobody may claim it.
        claims.delete(alreadyClaimedBy);
        continue;
      }

      claimedSourceKeysByTarget.set(targetKey, sourceKey);
      claims.set(sourceKey, target);
    }
  };

  for (const [faceId, face] of input.sourceBody.facesById) {
    claimFrom("face", faceId, face as OccSubtopologyShape);
  }
  for (const [edgeId, edge] of input.sourceBody.edgesById) {
    claimFrom("edge", edgeId, edge as OccSubtopologyShape);
  }
  for (const [vertexId, vertex] of input.sourceBody.verticesById) {
    claimFrom("vertex", vertexId, vertex as OccSubtopologyShape);
  }

  return claims;
}

/**
 * Created subtopology of one replacement body, with the faces that bound it.
 *
 * `BRepFilletAPI::Generated` names the chamfer/fillet SURFACE and nothing else,
 * so the boundary edges and corner vertices of that surface reach a rebuild
 * unnamed. This enumerates exactly those entities — the ones that are `IsSame`
 * as no prior subtopology of the same kind, i.e. genuinely new — together with
 * the output body's faces they bound, which is what makes their identity
 * expressible. Nothing here reads coordinates or applies a tolerance.
 */
function collectGeneratedAdjacency(input: {
  oc: OccFeatureExecutionContext["oc"];
  sourceBody: OccTrackedBody;
  replacement: OccTrackedBody;
}): OccGeneratedAdjacencyEntry[] {
  const faceIdsByShape = (shape: OccSubtopologyShape) => {
    const faceIds: FaceId[] = [];
    for (const [faceId, face] of input.replacement.facesById) {
      if ((face as OccSubtopologyShape).IsSame(shape as never)) {
        faceIds.push(faceId);
      }
    }
    return faceIds;
  };

  const collectKind = <Id extends EdgeId | VertexId>(
    kind: "edge" | "vertex",
    previousShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    currentShapesById: ReadonlyMap<Id, OccSubtopologyShape>,
    toRef: (id: Id) => DurableRef,
  ) => {
    const ancestors =
      new input.oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
    input.oc.TopExp.MapShapesAndAncestors(
      input.replacement.shape,
      (kind === "edge"
        ? input.oc.TopAbs_ShapeEnum.TopAbs_EDGE
        : input.oc.TopAbs_ShapeEnum.TopAbs_VERTEX) as never,
      input.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      ancestors,
    );

    const entries: OccGeneratedAdjacencyEntry[] = [];
    for (const [currentId, currentShape] of currentShapesById) {
      const survives = [...previousShapesById.values()].some((previousShape) =>
        previousShape.IsSame(currentShape as never),
      );
      if (survives) {
        continue;
      }

      const index = ancestors.FindIndex(currentShape as never);
      if (index <= 0) {
        continue;
      }
      // The map owns the list it returns, so iterate a copy and leave the
      // original alive for the remaining lookups.
      const faces = new input.oc.TopTools_ListOfShape_3(
        ancestors.FindFromIndex(index),
      );
      const adjacentFaceIds: FaceId[] = [];
      while (faces.Size() > 0) {
        adjacentFaceIds.push(
          ...faceIdsByShape(faces.First_1() as unknown as OccSubtopologyShape),
        );
        faces.RemoveFirst();
      }
      entries.push({ target: toRef(currentId), adjacentFaceIds });
    }
    return entries;
  };

  return [
    ...collectKind(
      "edge",
      input.sourceBody.edgesById,
      input.replacement.edgesById,
      (edgeId) => ({
        kind: "edge",
        bodyId: input.replacement.bodyId,
        edgeId,
      }),
    ),
    ...collectKind(
      "vertex",
      input.sourceBody.verticesById,
      input.replacement.verticesById,
      (vertexId) => ({
        kind: "vertex",
        bodyId: input.replacement.bodyId,
        vertexId,
      }),
    ),
  ];
}


/**
 * Complete face→edge incidence for local-operation output faces. `TopExp_Explorer`
 * traverses every wire; IsSame resolves its exact native edge identity back to
 * the tracked edge id and removes repeated seam/wire occurrences.
 */
function collectGeneratedFaceCompleteBoundaries(input: {
  oc: OccFeatureExecutionContext["oc"];
  replacement: OccTrackedBody;
}): OccGeneratedFaceCompleteBoundaryEntry[] {
  const entries: OccGeneratedFaceCompleteBoundaryEntry[] = [];
  for (const [faceId, face] of input.replacement.facesById) {
    const explorer = new input.oc.TopExp_Explorer_2(
      face,
      input.oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      input.oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    const boundaryEdgeIds = new Set<EdgeId>();
    let complete = true;
    try {
      while (explorer.More()) {
        const edge = explorer.Current() as unknown as OccSubtopologyShape;
        const matches = [...input.replacement.edgesById].filter(([, candidate]) =>
          (candidate as OccSubtopologyShape).IsSame(edge as never),
        );
        if (matches.length !== 1) {
          complete = false;
          break;
        }
        boundaryEdgeIds.add(matches[0]![0]);
        explorer.Next();
      }
    } finally {
      explorer.delete();
    }
    if (!complete || boundaryEdgeIds.size === 0) {
      continue;
    }
    entries.push({
      target: { kind: "face", bodyId: input.replacement.bodyId, faceId },
      boundaryEdgeIds: [...boundaryEdgeIds],
    });
  }
  return entries;
}

/**
 * Record stage lineage for one local operation (fillet/chamfer) on one body.
 *
 * With native history, untouched faces/edges/vertices carry exact one-to-one
 * successors, so a later rebuild can prove them live again instead of leaving
 * them invalidated — which is what previously made a second chamfer refuse the
 * edges its predecessor never touched. Without native history there is no exact
 * claim to make, so the replacement stays conservatively unsupported.
 *
 * Subtopology the operation itself generated is the successor of nothing, so it
 * needs the complementary producer-identity claim from the live builder.
 */
export function collectLocalOperationTopologyStages(input: {
  oc: OccFeatureExecutionContext["oc"];
  topologyStages: OccFeatureTopologyStage[];
  ownerFeatureId: FeatureId;
  sourceBody: OccTrackedBody;
  historyInvalidations: Map<string, OccReferenceInvalidationRecord>;
  replacementResult: {
    replacements: readonly OccTrackedBody[];
    successorTargetsByPreviousKey?: ReadonlyMap<string, DurableRef>;
    generatedTargetsBySourceKey?: ReadonlyMap<string, DurableRef>;
  };
  hasNativeHistory: boolean;
  generatedHistorySource: { Generated(source: never): never } | null;
  exactSuccessorHistorySource?: { Modified(source: never): never } | null;
  includeGeneratedTopology?: boolean;
  supplementalProducerTargetsByOutputBodyId?: ReadonlyMap<
    BodyId,
    ReadonlyMap<string, DurableRef>
  >;
}) {
  // Exact history comes from either the native transaction's successor claims
  // or a live JS builder. With neither there is no exact claim to make, so the
  // replacement stays conservatively unsupported.
  if (!input.hasNativeHistory && !input.generatedHistorySource) {
    input.topologyStages.push(
      createUnsupportedProducerTopologyStage({
        featureId: input.ownerFeatureId,
        bodies: input.replacementResult.replacements,
        producedTargets: input.replacementResult.replacements.map(
          (replacement) => ({
            kind: "body" as const,
            bodyId: replacement.bodyId,
          }),
        ),
      }),
    );
    return;
  }

  for (const replacement of input.replacementResult.replacements) {
    const identitySuccessors = collectExactIdentitySuccessors(input.sourceBody, replacement);
    const successorsBySourceKey = new Map(identitySuccessors);
    const identitySuccessorSourceKeys = new Set(identitySuccessors.keys());
    for (const [key, successor] of input.exactSuccessorHistorySource
      ? collectExactModifiedSuccessors({
          oc: input.oc,
          sourceBody: input.sourceBody,
          replacement,
          builder: input.exactSuccessorHistorySource,
        })
      : []) {
      successorsBySourceKey.set(key, successor);
      identitySuccessorSourceKeys.delete(key);
    }
    // The kernel's own claims win where it made one; identity only fills the
    // gaps its over-eager `IsDeleted` left behind.
    for (const [key, successor] of input.replacementResult
      .successorTargetsByPreviousKey ?? []) {
      successorsBySourceKey.set(key, successor);
      identitySuccessorSourceKeys.delete(key);
    }
    for (const key of successorsBySourceKey.keys()) {
      input.historyInvalidations.delete(key);
    }
    input.topologyStages.push(
      createExactSuccessorTopologyStage({
        featureId: input.ownerFeatureId,
        sourceBody: input.sourceBody,
        outputBody: replacement,
        successorsBySourceKey,
        identitySuccessorSourceKeys,
        // The JS builder is live, so it answers `Generated` for the build that
        // actually ran; on the native path the shim's own generated records
        // carry the same producer identity. Some operations deliberately carry
        // successor-only history because their builder's Generated relation is
        // not provenance for the result's newly created topology.
        generatedTargetsBySourceKey:
          input.includeGeneratedTopology === false
            ? undefined
            : input.generatedHistorySource
          ? collectGeneratedProducerTargets({
              oc: input.oc,
              ownerFeatureId: input.ownerFeatureId,
              sourceBody: input.sourceBody,
              replacement,
              builder: input.generatedHistorySource,
            })
          : input.replacementResult.generatedTargetsBySourceKey,
        // Neither builder history names the boundary of the surface it created,
        // so those entities are identified by the faces they bound.
        generatedAdjacency:
          input.includeGeneratedTopology === false
            ? undefined
            : collectGeneratedAdjacency({
          oc: input.oc,
          sourceBody: input.sourceBody,
          replacement,
        }),
        generatedFaceCompleteBoundaries: collectGeneratedFaceCompleteBoundaries({
          oc: input.oc,
          replacement,
        }),
        supplementalProducerTargetsBySourceKey:
          input.supplementalProducerTargetsByOutputBodyId?.get(replacement.bodyId),
      }),
    );
  }
}

function serializeNativeEdgeTargets(
  body: OccTrackedBody,
  targets: readonly {
    kind?: "edge";
    bodyId: BodyId;
    edgeId: `edge_${string}`;
  }[],
) {
  return targets
    .map((target) =>
      resolveNativeTopologyTargetId(body, {
        kind: "edge",
        bodyId: target.bodyId,
        edgeId: target.edgeId,
      }),
    )
    .join(",");
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
    serializeNativeEdgeTargets(body, targets),
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
    serializeNativeEdgeTargets(body, targets),
    distance,
    body.bodyId,
    body.topologyToken,
    advanceTopologyToken(body.topologyToken),
    context.modelingTolerance,
    0.5,
  );
  if (!transaction.IsDone()) {
    // Older native payload builds used the two-distance overload for equal
    // offsets. Fall back to the symmetric OCC overload when that transaction
    // rejects the edge; fallback failures still surface below.
    return null;
  }

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
  const resolvedRadius = getAuthoredLiteralValue(parameters.radius);
  if (resolvedRadius === null || resolvedRadius <= 0) {
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
  const topologyStages: OccFeatureTopologyStage[] = [];

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireSolidBody(context, bodyId, "fillet");
    for (const target of targets) {
      requireEdge(context, body, target.edgeId);
    }
    const nativeReplacementResult = resolveNativeFilletReplacement(
      context,
      body,
      targets,
      resolvedRadius,
      ownerFeatureId,
    );
    // The native transaction disposes its builder inside the shim, so only the
    // JS builder can answer `Generated` for the build that actually ran.
    let generatedHistorySource: { Generated(source: never): never } | null =
      null;
    const replacementResult =
      nativeReplacementResult ??
      (() => {
        const fillet = new context.oc.BRepFilletAPI_MakeFillet(
          body.shape,
          context.oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
        );

        for (const target of targets) {
          fillet.Add_2(
            resolvedRadius,
            requireEdge(context, body, target.edgeId),
          );
        }

        fillet.Build(new context.oc.Message_ProgressRange_1());

        if (!fillet.IsDone()) {
          throw new Error(`OCC fillet build failed for body ${bodyId}.`);
        }

        generatedHistorySource = fillet as unknown as {
          Generated(source: never): never;
        };

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
    collectLocalOperationTopologyStages({
      oc: context.oc,
      topologyStages,
      ownerFeatureId,
      sourceBody: body,
      historyInvalidations,
      replacementResult,
      hasNativeHistory: nativeReplacementResult !== null,
      generatedHistorySource,
    });
  }

  return {
    bodies: nextBodies,
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

type ChamferExecutionWidth =
  | { widthForm: "equalOffsets"; distance: number }
  | { widthForm: "twoOffsets"; distance1: number; distance2: number }
  | { widthForm: "offsetAngle"; distance: number; angleDegrees: number };

function readLiteralNumberOption(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
  key: string,
) {
  const raw = definition.parameters.options?.[key];
  const value = getAuthoredLiteralValue(raw as MaybeAuthoredValue<unknown>);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readChamferWidthForm(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
): ChamferWidthForm {
  const raw = definition.parameters.options?.widthForm;
  const value = getAuthoredLiteralValue(raw as MaybeAuthoredValue<unknown>);
  if (value === undefined || value === null) {
    return "equalOffsets";
  }
  if (
    value === "equalOffsets" ||
    value === "twoOffsets" ||
    value === "offsetAngle"
  ) {
    return value;
  }
  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC chamfer requires a supported widthForm option.",
  );
}

function requirePositiveChamferDistance(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
  key: string,
) {
  const value = readLiteralNumberOption(definition, key);
  if (value === null || value <= 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC chamfer requires a positive constant ${key} option.`,
    );
  }
  return value;
}

function getChamferExecutionWidth(
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
): ChamferExecutionWidth {
  const widthForm = readChamferWidthForm(definition);
  if (widthForm === "twoOffsets") {
    return {
      widthForm,
      distance1: requirePositiveChamferDistance(definition, "distance1"),
      distance2: requirePositiveChamferDistance(definition, "distance2"),
    };
  }
  if (widthForm === "offsetAngle") {
    const angleDegrees = readLiteralNumberOption(definition, "angle");
    if (angleDegrees === null || angleDegrees <= 0 || angleDegrees >= 90) {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC chamfer distance+angle requires a constant angle greater than 0 and less than 90 degrees.",
      );
    }
    return {
      widthForm,
      distance: requirePositiveChamferDistance(definition, "distance"),
      angleDegrees,
    };
  }
  return {
    widthForm,
    distance: requirePositiveChamferDistance(definition, "distance"),
  };
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

function addChamferWidth(
  chamfer: InstanceType<
    import("@/domain/modeling/occ/runtime").OpenCascadeInstance["BRepFilletAPI_MakeChamfer"]
  >,
  width: ChamferExecutionWidth,
  edge: InstanceType<
    import("@/domain/modeling/occ/runtime").OpenCascadeInstance["TopoDS_Edge"]
  >,
  face: InstanceType<
    import("@/domain/modeling/occ/runtime").OpenCascadeInstance["TopoDS_Face"]
  >,
) {
  if (width.widthForm === "twoOffsets") {
    // OCC applies distance1 on the supplied adjacent face and distance2 on the
    // other adjacent face. Cadara edge targets do not carry an owner-face choice,
    // so requireAdjacentFaceForChamfer provides the stable face ordering.
    chamfer.Add_3(width.distance1, width.distance2, edge, face);
    return;
  }

  if (width.widthForm === "offsetAngle") {
    if (typeof chamfer.AddDA !== "function") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC chamfer binding does not expose distance+angle execution.",
      );
    }
    chamfer.AddDA(
      width.distance,
      (width.angleDegrees * Math.PI) / 180,
      edge,
      face,
    );
    return;
  }

  chamfer.Add_2(width.distance, edge);
}

export function executeChamferFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "chamfer" },
): OccFeatureExecutionResult {
  if (
    definition.parameters.operationIntent !== undefined &&
    getAuthoredLiteralValue(definition.parameters.operationIntent) !== "create"
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC chamfer does not support boolean operation intents.",
    );
  }

  const width = getChamferExecutionWidth(definition);
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
  const topologyStages: OccFeatureTopologyStage[] = [];

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireSolidBody(context, bodyId, "chamfer");
    for (const target of targets) {
      requireEdge(context, body, target.edgeId);
    }
    const nativeReplacementResult =
      width.widthForm === "equalOffsets"
        ? resolveNativeChamferReplacement(
            context,
            body,
            targets,
            width.distance,
            ownerFeatureId,
          )
        : null;
    // The native transaction disposes its builder inside the shim, so only the
    // JS builder can answer `Generated` for the build that actually ran.
    let generatedHistorySource: { Generated(source: never): never } | null =
      null;
    const replacementResult =
      nativeReplacementResult ??
      (() => {
        const chamfer = new context.oc.BRepFilletAPI_MakeChamfer(body.shape);
        for (const target of targets) {
          const edge = requireEdge(context, body, target.edgeId);
          addChamferWidth(
            chamfer,
            width,
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

        generatedHistorySource = chamfer as unknown as {
          Generated(source: never): never;
        };

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
    collectLocalOperationTopologyStages({
      oc: context.oc,
      topologyStages,
      ownerFeatureId,
      sourceBody: body,
      historyInvalidations,
      replacementResult,
      hasNativeHistory: nativeReplacementResult !== null,
      generatedHistorySource,
    });
  }

  return {
    bodies: nextBodies,
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
