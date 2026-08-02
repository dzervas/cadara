import type { FeatureBooleanOperation } from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { BodyId, FaceId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import {
  advanceTopologyToken,
  buildNativeTopologyIdAliasesForTrackedBody,
  extractSolidShapes,
  trackNewSolidBody,
  type OccReferenceInvalidationRecord,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  requireBody,
  requireSolidBody,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  runBoolean,
  runSheetSplit,
  resolveNativeFeatureTransactionReplacement,
  resolveReplacementBodies,
  requireUniqueTargetBodies,
  createDeletedBodyInvalidations,
  collectTopologyHistoryInvalidations,
  trackBodiesFromShape,
  mergeHistoryInvalidations,
  markSplitAmbiguousInvalidations,
  collectNativeFeatureHistoryInvalidations,
  validateNativeFeatureTransaction,
} from "@/domain/modeling/occ/features/boolean-operations";
import {
  parseNativeSheetSplitToolHistoryJson,
  parseNativeShimPayloadJson,
  type OccNativeSheetSplitToolHistoryPayload,
  type OccNativeShimPayload,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  formatGeneratedProducerTopologySourceKey,
  OccTopologyProvenanceMissingError,
  type OccCanonicalTopologyProvenanceId,
  type OccFeatureTopologyStage,
  type OccTopologyStageOutput,
} from "@/domain/modeling/occ/topology-stage";

function getCombineBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "combine" },
  role: "targetBody" | "toolBody",
) {
  const targets = getAdvancedParticipant(definition, role)?.targets ?? [];

  if (targets.length === 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC combine requires at least one ${role} participant.`,
    );
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      throw new Error(
        `advanced-feature-unsupported-kernel-case: OCC combine ${role} participants must be durable body targets.`,
      );
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getCombineBooleanOperation(
  definition: AdvancedSolidFeatureDefinition & { kind: "combine" },
): Exclude<FeatureBooleanOperation, "newBody"> {
  const intent = getAuthoredLiteralValue(definition.parameters.operationIntent);

  switch (intent) {
    case "add":
      return "join";
    case "subtract":
      return "cut";
    case "intersect":
      return "intersect";
    default:
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC combine requires add, subtract, or intersect operation intent.",
      );
  }
}

function resolveNativeCombineReplacement(input: {
  context: OccFeatureExecutionContext;
  targetBodyId: BodyId;
  toolBodyId: BodyId;
  operation: Exclude<FeatureBooleanOperation, "newBody">;
  ownerFeatureId: FeatureId;
}) {
  const targetBody = requireSolidBody(input.context, input.targetBodyId, "combine");
  const toolBody = requireSolidBody(input.context, input.toolBodyId, "combine");
  const nativeHost = input.context
    .oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildBooleanCommittedShapeTransactionWithHistory;

  if (!nativeBuilder) {
    return null;
  }

  const transaction = nativeBuilder(
    targetBody.shape,
    toolBody.shape,
    input.operation,
    targetBody.bodyId,
    targetBody.topologyToken,
    advanceTopologyToken(targetBody.topologyToken),
    input.context.modelingTolerance,
    0.5,
  );
  try {
    return resolveNativeFeatureTransactionReplacement(
      input.context,
      targetBody,
      transaction,
      `combine-${input.operation}`,
      input.ownerFeatureId,
    );
  } finally {
    transaction.delete();
  }
}

export function executeCombineFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "combine" },
): OccFeatureExecutionResult {
  const targetBodies = getCombineBodyTargets(definition, "targetBody");
  const toolBodies = getCombineBodyTargets(definition, "toolBody");
  const operation = getCombineBooleanOperation(definition);
  const keepTools = definition.parameters.options?.keepTools === true;
  const targetBodyIds = targetBodies.map((target) => target.bodyId);
  const toolBodyIds = toolBodies.map((target) => target.bodyId);
  requireUniqueTargetBodies(targetBodyIds);
  requireUniqueTargetBodies(toolBodyIds);

  if (targetBodyIds.some((bodyId) => toolBodyIds.includes(bodyId))) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC combine target and tool bodies must be distinct.",
    );
  }

  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();
  const nextBodies = [...context.bodies];
  const producedTargets: DurableRef[] = [];

  if (operation === "join") {
    const [firstTargetBodyId, ...remainingTargetBodyIds] = targetBodyIds;
    const firstTargetBody = requireSolidBody(context, firstTargetBodyId!, "combine");
    const replacementResult =
      remainingTargetBodyIds.length === 0 && toolBodyIds.length === 1
        ? (resolveNativeCombineReplacement({
            context,
            targetBodyId: firstTargetBodyId!,
            toolBodyId: toolBodyIds[0]!,
            operation,
            ownerFeatureId,
          }) ??
          (() => {
            const toolBody = requireSolidBody(context, toolBodyIds[0]!, "combine");
            const result = runBoolean(
              context.oc,
              "join",
              firstTargetBody.shape,
              toolBody.shape,
            );
            return resolveReplacementBodies(
              context,
              firstTargetBodyId!,
              result.shape,
              ownerFeatureId,
              {
                allowEmpty: true,
                historySources: result.historySources,
              },
            );
          })())
        : (() => {
            let currentShape = firstTargetBody.shape;
            const firstTargetHistorySources: import("@/domain/modeling/occ/topology-naming").OccTopologyHistorySource[] =
              [];

            for (const bodyId of [...remainingTargetBodyIds, ...toolBodyIds]) {
              const body = requireSolidBody(context, bodyId, "combine");
              const result = runBoolean(
                context.oc,
                "join",
                currentShape,
                body.shape,
              );
              currentShape = result.shape;
              firstTargetHistorySources.push(...result.historySources);
            }

            return resolveReplacementBodies(
              context,
              firstTargetBodyId!,
              currentShape,
              ownerFeatureId,
              {
                allowEmpty: true,
                historySources: firstTargetHistorySources,
              },
            );
          })();
    const firstIndex = nextBodies.findIndex(
      (entry) => entry.bodyId === firstTargetBodyId,
    );
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements);
    mergeHistoryInvalidations(
      historyInvalidations,
      replacementResult.historyInvalidations,
    );

    for (const bodyId of [
      ...remainingTargetBodyIds,
      ...(keepTools ? [] : toolBodyIds),
    ]) {
      const body = requireSolidBody(context, bodyId, "combine");
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId);
      if (index >= 0) nextBodies.splice(index, 1);
      mergeHistoryInvalidations(historyInvalidations, createDeletedBodyInvalidations(body));
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
    }
  } else {
    for (const targetBodyId of targetBodyIds) {
      const targetBody = requireSolidBody(context, targetBodyId, "combine");
      const replacementResult =
        toolBodyIds.length === 1
          ? (resolveNativeCombineReplacement({
              context,
              targetBodyId,
              toolBodyId: toolBodyIds[0]!,
              operation,
              ownerFeatureId,
            }) ??
            (() => {
              const toolBody = requireSolidBody(context, toolBodyIds[0]!, "combine");
              const result = runBoolean(
                context.oc,
                operation,
                targetBody.shape,
                toolBody.shape,
              );
              return resolveReplacementBodies(
                context,
                targetBodyId,
                result.shape,
                ownerFeatureId,
                {
                  allowEmpty: true,
                  historySources: result.historySources,
                },
              );
            })())
          : (() => {
              let currentShape = targetBody.shape;
              const targetHistorySources: import("@/domain/modeling/occ/topology-naming").OccTopologyHistorySource[] =
                [];

              for (const toolBodyId of toolBodyIds) {
                const toolBody = requireSolidBody(context, toolBodyId, "combine");
                const result = runBoolean(
                  context.oc,
                  operation,
                  currentShape,
                  toolBody.shape,
                );
                currentShape = result.shape;
                targetHistorySources.push(...result.historySources);
              }

              return resolveReplacementBodies(
                context,
                targetBodyId,
                currentShape,
                ownerFeatureId,
                {
                  allowEmpty: true,
                  historySources: targetHistorySources,
                },
              );
            })();
      const targetIndex = nextBodies.findIndex(
        (entry) => entry.bodyId === targetBodyId,
      );
      nextBodies.splice(targetIndex, 1, ...replacementResult.replacements);
      mergeHistoryInvalidations(
        historyInvalidations,
        replacementResult.historyInvalidations,
      );

      for (const replacement of replacementResult.replacements) {
        producedTargets.push({ kind: "body", bodyId: replacement.bodyId });
      }
    }

    if (!keepTools) {
      for (const toolBodyId of toolBodyIds) {
        const toolBody = requireSolidBody(context, toolBodyId, "combine");
        const index = nextBodies.findIndex((entry) => entry.bodyId === toolBodyId);
        if (index >= 0) nextBodies.splice(index, 1);
        mergeHistoryInvalidations(
          historyInvalidations,
          createDeletedBodyInvalidations(toolBody),
        );
      }
    }
  }

  if (producedTargets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC combine produced no solid result bodies.",
    );
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

function getSplitTargetBody(
  definition: AdvancedSolidFeatureDefinition & { kind: "split" },
) {
  const targets =
    getAdvancedParticipant(definition, "targetBody")?.targets ?? [];

  if (targets.length !== 1 || targets[0]?.kind !== "body") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC split requires exactly one targetBody participant.",
    );
  }

  return targets[0];
}

function getSplitToolBody(
  definition: AdvancedSolidFeatureDefinition & { kind: "split" },
) {
  const toolBodies =
    getAdvancedParticipant(definition, "toolBody")?.targets ?? [];
  const planes = getAdvancedParticipant(definition, "plane")?.targets ?? [];

  if (planes.length > 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC split does not support plane split tools yet.",
    );
  }

  if (toolBodies.length !== 1 || toolBodies[0]?.kind !== "body") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC split requires exactly one toolBody participant in the initial implementation.",
    );
  }

  return toolBodies[0];
}

type SheetSplitSemanticHistory = {
  outputs: readonly {
    nativeOutputSlotKey: string;
    outputSlotKey: string;
    sourceTargetProvenanceIds: readonly OccCanonicalTopologyProvenanceId[];
    finalFaceNativeIds: readonly string[];
  }[];
  toolFaceRelations: readonly {
    sourceToolFaceProvenanceId: OccCanonicalTopologyProvenanceId;
    cardinality: "zero" | "one" | "many";
    finalFaces: readonly {
      nativeFaceId: string;
      outputSlotKeys: readonly string[];
    }[];
  }[];
};

type SheetSplitTrackedOutput = {
  outputSlotKey: string;
  body: OccTrackedBody;
  finalFacesByNativeId: ReadonlyMap<string, FaceId>;
};

function sheetSplitOutputBodyId(
  ownerFeatureId: FeatureId,
  outputSlotKey: string,
): BodyId {
  return `body_${ownerFeatureId}_sheet_split_${encodeURIComponent(outputSlotKey)}` as BodyId;
}

function translateExactNativeFaceId(input: {
  aliases: ReadonlyMap<FaceId, FaceId>;
  nativeFaceId: string;
  bodyId: BodyId;
  role: "target output membership" | "tool producer";
}) {
  const matches = [...input.aliases].filter(
    ([nativeFaceId]) => nativeFaceId === input.nativeFaceId,
  );
  if (matches.length !== 1) {
    throw new Error(
      `occ-native-sheet-split-history-${input.role.replaceAll(" ", "-")}-alias-${matches.length === 0 ? "missing" : "ambiguous"}: native face ${input.nativeFaceId} on body ${input.bodyId} must resolve through exactly one tracked public FaceId.`,
    );
  }

  const publicFaceId = matches[0]![1];
  const nativeAliasesForPublicFace = [...input.aliases].filter(
    ([, candidate]) => candidate === publicFaceId,
  );
  if (nativeAliasesForPublicFace.length !== 1) {
    throw new Error(
      `occ-native-sheet-split-history-${input.role.replaceAll(" ", "-")}-alias-ambiguous: public face ${publicFaceId} on body ${input.bodyId} has ${nativeAliasesForPublicFace.length} native aliases.`,
    );
  }

  return publicFaceId;
}

function formatSheetSplitSemanticOutputSlot(input: {
  targetBodyId: BodyId;
  sourceTargetProvenanceIds: readonly OccCanonicalTopologyProvenanceId[];
}) {
  return `sheet-split-output:target:${input.targetBodyId}:target-face-provenance:${input.sourceTargetProvenanceIds.map(encodeURIComponent).join(",")}`;
}

/**
 * Native output membership is exact. A source target face that belongs to one
 * output distinguishes that output's semantic slot on its own; a slot whose
 * every member face is shared (the tool split all of them across outputs)
 * still has an exact identity in its FULL membership set, which must differ
 * from every other slot's set or the semantic-slot collision check rejects
 * the history outright.
 */
function getExclusiveSheetSplitWitnessNativeFaceIds(
  history: OccNativeSheetSplitToolHistoryPayload,
) {
  const outputSlotsBySourceFace = new Map<string, Set<string>>();
  for (const output of history.outputs) {
    for (const nativeFaceId of output.sourceTargetFaceNativeIds) {
      const outputSlots = outputSlotsBySourceFace.get(nativeFaceId) ?? new Set<string>();
      outputSlots.add(output.outputSlotKey);
      outputSlotsBySourceFace.set(nativeFaceId, outputSlots);
    }
  }

  return new Map(
    history.outputs.map((output) => [
      output.outputSlotKey,
      output.sourceTargetFaceNativeIds.filter(
        (nativeFaceId) => outputSlotsBySourceFace.get(nativeFaceId)?.size === 1,
      ),
    ]),
  );
}

function resolveExclusiveSheetSplitWitnessProvenance(input: {
  topologyProvenanceIndex: OccFeatureExecutionContext["topologyProvenanceIndex"];
  targetBodyId: BodyId;
  faceId: FaceId;
}) {
  try {
    const provenanceId = input.topologyProvenanceIndex.resolveFace({
      kind: "face",
      bodyId: input.targetBodyId,
      faceId: input.faceId,
    });
    return provenanceId;
  } catch (error) {
    // A genuinely unclaimed source face provides no durable witness. Every
    // malformed, ambiguous, cyclic, or future-stage resolution remains fatal.
    if (error instanceof OccTopologyProvenanceMissingError) {
      return null;
    }
    throw error;
  }
}

function isSheetSplitToolHistoryDegradationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith(
      "occ-native-sheet-split-history-exclusive-witnesses-missing:",
    ) ||
      error.message.startsWith(
        "occ-native-sheet-split-history-exclusive-witness-provenance-",
      ))
  );
}

export function translateSheetSplitToolHistoryToSemanticIds(input: {
  history: OccNativeSheetSplitToolHistoryPayload;
  targetFaceIdsByNativeId: ReadonlyMap<FaceId, FaceId>;
  toolFaceIdsByNativeId: ReadonlyMap<FaceId, FaceId>;
  topologyProvenanceIndex: OccFeatureExecutionContext["topologyProvenanceIndex"];
}): SheetSplitSemanticHistory {
  const semanticOutputSlotByNativeSlot = new Map<string, string>();
  const semanticSlotOwners = new Map<string, string>();
  const exclusiveWitnessNativeFaceIdsByOutput =
    getExclusiveSheetSplitWitnessNativeFaceIds(input.history);
  const outputs = input.history.outputs.map((output) => {
    const exclusiveWitnessNativeFaceIds =
      exclusiveWitnessNativeFaceIdsByOutput.get(output.outputSlotKey);
    if (!exclusiveWitnessNativeFaceIds) {
      throw new Error(
        `occ-native-sheet-split-history-exclusive-witnesses-missing: output slot ${output.outputSlotKey} has no exact membership incidence.`,
      );
    }
    // A slot with no exclusive member falls back to its full exact membership
    // set; distinctness across slots is enforced by the collision check below.
    const witnessNativeFaceIds =
      exclusiveWitnessNativeFaceIds.length > 0
        ? exclusiveWitnessNativeFaceIds
        : output.sourceTargetFaceNativeIds;
    const sourceTargetFaceIds = witnessNativeFaceIds.map((nativeFaceId) =>
      translateExactNativeFaceId({
        aliases: input.targetFaceIdsByNativeId,
        nativeFaceId,
        bodyId: input.history.targetBodyId,
        role: "target output membership",
      }),
    );
    if (new Set(sourceTargetFaceIds).size !== sourceTargetFaceIds.length) {
      throw new Error(
        `occ-native-sheet-split-history-exclusive-witness-alias-ambiguous: output slot ${output.outputSlotKey} resolves multiple exact source target faces to one public FaceId.`,
      );
    }
    const sourceTargetProvenanceIds = sourceTargetFaceIds
      .map((faceId) =>
        resolveExclusiveSheetSplitWitnessProvenance({
          topologyProvenanceIndex: input.topologyProvenanceIndex,
          targetBodyId: input.history.targetBodyId,
          faceId,
        }),
      )
      .filter(
        (provenanceId): provenanceId is OccCanonicalTopologyProvenanceId =>
          provenanceId !== null,
      )
      .sort();
    if (sourceTargetProvenanceIds.length === 0) {
      throw new Error(
        `occ-native-sheet-split-history-exclusive-witnesses-missing: output slot ${output.outputSlotKey} has no resolved canonical target-face witnesses.`,
      );
    }
    if (
      new Set(sourceTargetProvenanceIds).size !==
      sourceTargetProvenanceIds.length
    ) {
      throw new Error(
        `occ-native-sheet-split-history-exclusive-witness-provenance-ambiguous: output slot ${output.outputSlotKey} resolves distinct exact source target faces to one canonical provenance id.`,
      );
    }

    const outputSlotKey = formatSheetSplitSemanticOutputSlot({
      targetBodyId: input.history.targetBodyId,
      sourceTargetProvenanceIds,
    });
    const previousOwner = semanticSlotOwners.get(outputSlotKey);
    if (previousOwner !== undefined) {
      throw new Error(
        `occ-native-sheet-split-history-semantic-output-slot-collision: native output slots ${previousOwner} and ${output.outputSlotKey} resolve to ${outputSlotKey}.`,
      );
    }
    semanticSlotOwners.set(outputSlotKey, output.outputSlotKey);
    semanticOutputSlotByNativeSlot.set(output.outputSlotKey, outputSlotKey);

    return {
      nativeOutputSlotKey: output.outputSlotKey,
      outputSlotKey,
      sourceTargetProvenanceIds,
      finalFaceNativeIds: output.finalFaceNativeIds,
    };
  });

  const sourceToolFaceIds = new Set<FaceId>();
  const sourceToolFaceProvenanceIds =
    new Set<OccCanonicalTopologyProvenanceId>();
  const toolFaceRelations = input.history.toolFaceRelations.map((relation) => {
    const sourceToolFaceId = translateExactNativeFaceId({
      aliases: input.toolFaceIdsByNativeId,
      nativeFaceId: relation.sourceToolFace.nativeFaceId,
      bodyId: input.history.toolBodyId,
      role: "tool producer",
    });
    if (sourceToolFaceIds.has(sourceToolFaceId)) {
      throw new Error(
        `occ-native-sheet-split-history-tool-producer-alias-ambiguous: multiple native tool faces resolve to public face ${sourceToolFaceId}.`,
      );
    }
    sourceToolFaceIds.add(sourceToolFaceId);
    const sourceToolFaceProvenanceId =
      input.topologyProvenanceIndex.resolveFace({
        kind: "face",
        bodyId: input.history.toolBodyId,
        faceId: sourceToolFaceId,
      });
    if (sourceToolFaceProvenanceIds.has(sourceToolFaceProvenanceId)) {
      throw new Error(
        `occ-native-sheet-split-history-tool-producer-provenance-ambiguous: multiple tool faces resolve to canonical provenance ${sourceToolFaceProvenanceId}.`,
      );
    }
    sourceToolFaceProvenanceIds.add(sourceToolFaceProvenanceId);

    return {
      sourceToolFaceProvenanceId,
      cardinality: relation.cardinality,
      finalFaces: relation.finalFaces.map((finalFace) => ({
        nativeFaceId: finalFace.nativeFaceId,
        outputSlotKeys: finalFace.outputSlotKeys.map((nativeOutputSlotKey) => {
          const outputSlotKey = semanticOutputSlotByNativeSlot.get(
            nativeOutputSlotKey,
          );
          if (!outputSlotKey) {
            throw new Error(
              `occ-native-sheet-split-history-output-slot-membership-missing: final face ${finalFace.nativeFaceId} names unknown native output slot ${nativeOutputSlotKey}.`,
            );
          }
          return outputSlotKey;
        }),
      })),
    };
  });

  return { outputs, toolFaceRelations };
}

function buildSheetSplitSourceFaceAliases(input: {
  context: OccFeatureExecutionContext;
  body: OccTrackedBody;
}) {
  const existingAliases = input.body.nativeTopologyIdAliases?.faceIdsByNativeId;
  if (existingAliases) {
    return existingAliases;
  }

  const nativeHost = input.context
    .oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const payloadJson = nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson?.(
    input.body.shape,
    input.body.bodyId,
    input.body.topologyToken,
    input.context.modelingTolerance,
    0.5,
  );
  if (typeof payloadJson !== "string") {
    throw new Error(
      `occ-native-sheet-split-history-missing-source-alias-abi: CadaraBuildNativeTopologyPayload.BuildJson is required to translate source body ${input.body.bodyId} into durable public FaceIds.`,
    );
  }

  return buildNativeTopologyIdAliasesForTrackedBody(
    input.context.oc,
    input.body,
    parseNativeShimPayloadJson(payloadJson),
  ).faceIdsByNativeId;
}

function getNativeResultFacesById(input: {
  context: OccFeatureExecutionContext;
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
  nativePayload: OccNativeShimPayload;
  targetBodyId: BodyId;
}) {
  const faceMap = new input.context.oc.TopTools_IndexedMapOfShape_1();
  input.context.oc.TopExp.MapShapes_1(
    input.shape,
    input.context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    faceMap,
  );
  try {
    const faceRecords = input.nativePayload.topology.filter(
      (record) => record.kind === "face" && record.bodyId === input.targetBodyId,
    );
    if (faceRecords.length !== faceMap.Size()) {
      throw new Error(
        "occ-native-sheet-split-history-missing-output-shape-membership: transaction PayloadJson must expose every final face of the committed transaction Shape.",
      );
    }

    const facesByNativeId = new Map<
      string,
      InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Face"]>
    >();
    try {
      for (const record of faceRecords) {
        if (record.index < 1 || record.index > faceMap.Size()) {
          throw new Error(
            `occ-native-sheet-split-history-missing-output-shape-membership: PayloadJson face ${record.id} has no matching transaction Shape face.`,
          );
        }
        if (facesByNativeId.has(record.id)) {
          throw new Error(
            `occ-native-sheet-split-history-missing-output-shape-membership: PayloadJson duplicates final face ${record.id}.`,
          );
        }
        facesByNativeId.set(
          record.id,
          input.context.oc.TopoDS.Face_1(faceMap.FindKey(record.index)),
        );
      }
      return facesByNativeId;
    } catch (error) {
      for (const face of facesByNativeId.values()) {
        face.delete();
      }
      throw error;
    }
  } finally {
    faceMap.delete();
  }
}

function disposeNativeResultFaces(
  facesByNativeId: ReadonlyMap<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Face"]>
  >,
) {
  for (const face of facesByNativeId.values()) {
    face.delete();
  }
}

function getNativeFaceIdsInShape(input: {
  context: OccFeatureExecutionContext;
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
  facesByNativeId: ReadonlyMap<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Face"]>
  >;
}) {
  const faceMap = new input.context.oc.TopTools_IndexedMapOfShape_1();
  input.context.oc.TopExp.MapShapes_1(
    input.shape,
    input.context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    faceMap,
  );
  try {
    const nativeIds = new Set<string>();
    for (let index = 1; index <= faceMap.Size(); index += 1) {
      const face = input.context.oc.TopoDS.Face_1(faceMap.FindKey(index));
      try {
        for (const [nativeFaceId, finalFace] of input.facesByNativeId) {
          if (face.IsSame(finalFace)) {
            nativeIds.add(nativeFaceId);
            break;
          }
        }
      } finally {
        face.delete();
      }
    }
    if (nativeIds.size !== faceMap.Size()) {
      throw new Error(
        "occ-native-sheet-split-history-missing-output-shape-membership: transaction PayloadJson does not provide exact native face membership for every split output solid.",
      );
    }
    return nativeIds;
  } finally {
    faceMap.delete();
  }
}

function sameStringSet(left: ReadonlySet<string>, right: readonly string[]) {
  return left.size === right.length && right.every((value) => left.has(value));
}

function resolveSheetSplitOutputShapes(input: {
  context: OccFeatureExecutionContext;
  shape: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>;
  nativePayload: OccNativeShimPayload;
  history: OccNativeSheetSplitToolHistoryPayload;
}) {
  const facesByNativeId = getNativeResultFacesById({
    context: input.context,
    shape: input.shape,
    nativePayload: input.nativePayload,
    targetBodyId: input.history.targetBodyId,
  });
  try {
    const solids = extractSolidShapes(input.context.oc, input.shape);
    if (solids.length !== input.history.outputs.length) {
      throw new Error(
        "occ-native-sheet-split-history-missing-output-shape-membership: tool-history output slots do not cover exactly the committed split solids.",
      );
    }

    const shapeByOutputSlot = new Map<
      string,
      InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>
    >();
    const assignedSolids = new Set<number>();
    for (const output of input.history.outputs) {
      const matches = solids
        .map((solid, index) => ({
          index,
          solid,
          nativeFaceIds: getNativeFaceIdsInShape({
            context: input.context,
            shape: solid,
            facesByNativeId,
          }),
        }))
        .filter((candidate) =>
          sameStringSet(candidate.nativeFaceIds, output.finalFaceNativeIds),
        );
      if (matches.length !== 1 || assignedSolids.has(matches[0]?.index ?? -1)) {
        throw new Error(
          `occ-native-sheet-split-history-missing-output-shape-membership: output slot ${output.outputSlotKey} cannot be associated with exactly one committed split solid.`,
        );
      }
      assignedSolids.add(matches[0]!.index);
      shapeByOutputSlot.set(output.outputSlotKey, matches[0]!.solid);
    }

    return { facesByNativeId, shapeByOutputSlot };
  } catch (error) {
    disposeNativeResultFaces(facesByNativeId);
    throw error;
  }
}

function trackSheetSplitOutputs(input: {
  context: OccFeatureExecutionContext;
  ownerFeatureId: FeatureId;
  history: SheetSplitSemanticHistory;
  facesByNativeId: ReadonlyMap<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Face"]>
  >;
  shapeByOutputSlot: ReadonlyMap<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]>
  >;
}) {
  const outputs: SheetSplitTrackedOutput[] = [];
  for (const output of input.history.outputs) {
    const shape = input.shapeByOutputSlot.get(output.nativeOutputSlotKey);
    if (!shape) {
      throw new Error(
        `occ-native-sheet-split-history-missing-output-shape-membership: no committed solid exists for semantic output slot ${output.outputSlotKey}.`,
      );
    }
    const body = trackNewSolidBody(input.context.oc, {
      bodyId: sheetSplitOutputBodyId(input.ownerFeatureId, output.outputSlotKey),
      label: `${input.ownerFeatureId}_split`,
      ownerFeatureId: input.ownerFeatureId,
      shape,
    });
    const finalFacesByNativeId = new Map<string, FaceId>();
    for (const nativeFaceId of output.finalFaceNativeIds) {
      const finalFace = input.facesByNativeId.get(nativeFaceId);
      const publicMatches = [...body.facesById].filter(([, face]) =>
        face.IsSame(finalFace!),
      );
      if (publicMatches.length !== 1) {
        throw new Error(
          `occ-native-sheet-split-history-missing-output-shape-membership: final face ${nativeFaceId} has no exact public face on output slot ${output.outputSlotKey}.`,
        );
      }
      finalFacesByNativeId.set(nativeFaceId, publicMatches[0]![0]);
    }
    outputs.push({
      outputSlotKey: output.outputSlotKey,
      body,
      finalFacesByNativeId,
    });
  }
  return outputs;
}

/** Build only exact one-to-one tool-face producer claims; zero/many stay unsupported. */
export function createSheetSplitToolHistoryTopologyStage(input: {
  ownerFeatureId: FeatureId;
  toolBodyId: BodyId;
  history: SheetSplitSemanticHistory;
  outputs: readonly SheetSplitTrackedOutput[];
}): OccFeatureTopologyStage {
  const stageOutputs = new Map(
    input.outputs.map(
      (output) =>
        [
          output.body.bodyId,
          {
            outputSlot: output.body.bodyId,
            body: output.body,
            sourceTargets: new Map<string, DurableRef[]>(),
            unsupportedSourceKeys: new Set<string>(),
          } satisfies OccTopologyStageOutput,
        ] as const,
    ),
  );

  for (const relation of input.history.toolFaceRelations) {
    for (const output of input.outputs) {
      const sourceKey = formatGeneratedProducerTopologySourceKey({
        featureId: input.ownerFeatureId,
        bodyId: input.toolBodyId,
        sourceKind: "face",
        sourcePublicId: encodeURIComponent(
          relation.sourceToolFaceProvenanceId,
        ) as FaceId,
        role: `sheet-split-interface-face:output-slot:${encodeURIComponent(output.outputSlotKey)}`,
      });
      const finalFaces = relation.finalFaces.filter((finalFace) =>
        finalFace.outputSlotKeys.includes(output.outputSlotKey),
      );
      const stageOutput = stageOutputs.get(output.body.bodyId);
      if (!stageOutput) {
        throw new Error(
          `occ-native-sheet-split-history-missing-output-shape-membership: no topology stage exists for output slot ${output.outputSlotKey}.`,
        );
      }
      if (finalFaces.length !== 1) {
        stageOutput.unsupportedSourceKeys.add(sourceKey);
        continue;
      }

      const publicFaceId = output.finalFacesByNativeId.get(
        finalFaces[0]!.nativeFaceId,
      );
      if (!publicFaceId) {
        throw new Error(
          `occ-native-sheet-split-history-missing-output-shape-membership: exact tool-face relation ${relation.sourceToolFaceProvenanceId} cannot resolve its declared output face on slot ${output.outputSlotKey}.`,
        );
      }
      stageOutput.sourceTargets.set(sourceKey, [
        { kind: "face", bodyId: output.body.bodyId, faceId: publicFaceId },
      ]);
    }
  }

  return {
    featureId: input.ownerFeatureId,
    outputs: new Map(stageOutputs),
  };
}

export function executeSplitFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "split" },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC split does not support operation intents.",
    );
  }

  const targetBodyRef = getSplitTargetBody(definition);
  const toolBodyRef = getSplitToolBody(definition);
  const keepTool = definition.parameters.options?.keepTools !== false;

  if (targetBodyRef.bodyId === toolBodyRef.bodyId) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC split requires distinct target and tool bodies.",
    );
  }

  const targetBody = requireSolidBody(context, targetBodyRef.bodyId, "split");
  // A split tool may be a solid or a sheet body; the target must stay solid.
  const toolBody = requireBody(context, toolBodyRef.bodyId);
  const nativeHost =
    context.oc as unknown as OpenCascadeNativeTopologyKernelHost;
  const nativeBuilder =
    nativeHost.CadaraExecuteNativeFeatureTransaction
      ?.BuildSplitCommittedShapeTransactionWithHistory;
  const nativeSheetSplitBuilder =
    toolBody.bodyKind === "sheet"
      ? nativeHost.CadaraExecuteNativeFeatureTransaction
          ?.BuildSheetSplitCommittedShapeTransactionWithToolHistory
      : undefined;
  let toolHistoryDegradationDiagnostic:
    | NonNullable<OccFeatureExecutionResult["diagnostics"]>[number]
    | undefined;

  if (nativeSheetSplitBuilder) {
    const nextTopologyToken = advanceTopologyToken(targetBody.topologyToken);
    const transaction = nativeSheetSplitBuilder(
      targetBody.shape,
      toolBody.shape,
      targetBody.bodyId,
      toolBody.bodyId,
      targetBody.topologyToken,
      nextTopologyToken,
      context.modelingTolerance,
      0.5,
    );
    let transactionShape: InstanceType<
      OccFeatureExecutionContext["oc"]["TopoDS_Shape"]
    > | null = null;
    try {
      const { payload: nativePayload, history: nativeHistory } =
        validateNativeFeatureTransaction(transaction, "sheet split");
      const splitToolHistoryJson = transaction.SplitToolHistoryJson?.();
      if (typeof splitToolHistoryJson !== "string") {
        throw new Error(
          "occ-native-sheet-split-history-missing-abi: BuildSheetSplitCommittedShapeTransactionWithToolHistory requires CadaraNativeFeatureTransactionResult.SplitToolHistoryJson().",
        );
      }
      const splitToolHistory = parseNativeSheetSplitToolHistoryJson(
        splitToolHistoryJson,
      );
      if (
        splitToolHistory.targetBodyId !== targetBody.bodyId ||
        splitToolHistory.toolBodyId !== toolBody.bodyId ||
        splitToolHistory.previousTopologyToken !== targetBody.topologyToken ||
        splitToolHistory.topologyToken !== nextTopologyToken
      ) {
        throw new Error(
          "occ-native-sheet-split-history-body-mismatch: sheet-split tool history does not describe the committed target/tool bodies and topology tokens.",
        );
      }

      let semanticHistory: SheetSplitSemanticHistory | null = null;
      if (splitToolHistory.status === "available") {
        try {
          semanticHistory = translateSheetSplitToolHistoryToSemanticIds({
            history: splitToolHistory,
            targetFaceIdsByNativeId: buildSheetSplitSourceFaceAliases({
              context,
              body: targetBody,
            }),
            toolFaceIdsByNativeId: buildSheetSplitSourceFaceAliases({
              context,
              body: toolBody,
            }),
            topologyProvenanceIndex: context.topologyProvenanceIndex,
          });
        } catch (error) {
          if (!isSheetSplitToolHistoryDegradationError(error)) throw error;
          toolHistoryDegradationDiagnostic = {
            code: "occ-native-sheet-split-tool-history-degraded",
            severity: "warning",
            message: `OCC sheet-split tool history could not name durable output slots; using generic split history. ${error.message}`,
            featureId: ownerFeatureId,
            target: { kind: "body", bodyId: targetBody.bodyId },
            detail: null,
          };
        }
      }
      if (semanticHistory || !toolHistoryDegradationDiagnostic) {
        transactionShape = transaction.Shape() as InstanceType<
          OccFeatureExecutionContext["oc"]["TopoDS_Shape"]
        >;
        const trackedOutputs = semanticHistory
          ? (() => {
              const resolved = resolveSheetSplitOutputShapes({
                context,
                shape: transactionShape,
                nativePayload,
                history: splitToolHistory,
              });
              try {
                return trackSheetSplitOutputs({
                  context,
                  ownerFeatureId,
                  history: semanticHistory,
                  ...resolved,
                });
              } finally {
                disposeNativeResultFaces(resolved.facesByNativeId);
              }
            })()
          : null;
        const splitBodies = trackedOutputs?.map((output) => output.body) ??
          trackBodiesFromShape(
            context,
            ownerFeatureId,
            "Split result",
            transactionShape,
            "split",
          );
        const nextBodies = context.bodies
          .filter(
            (body) =>
              body.bodyId !== targetBody.bodyId &&
              (keepTool || body.bodyId !== toolBody.bodyId),
          )
          .concat(splitBodies);
        const historyInvalidations = createDeletedBodyInvalidations(targetBody);
        mergeHistoryInvalidations(
          historyInvalidations,
          collectNativeFeatureHistoryInvalidations(targetBody, nativeHistory),
        );

        return {
          bodies: nextBodies,
          constructions: [...context.constructions],
          constructionPlanes: new Map(context.constructionPlanes),
          producedTargets: splitBodies.map((body) => ({
            kind: "body" as const,
            bodyId: body.bodyId,
          })),
          entities: [],
          renderRecords: [],
          historyInvalidations,
          ...(trackedOutputs
            ? {
                topologyStage: createSheetSplitToolHistoryTopologyStage({
                  ownerFeatureId,
                  toolBodyId: toolBody.bodyId,
                  history: semanticHistory!,
                  outputs: trackedOutputs,
                }),
              }
            : {}),
        };
      }
    } finally {
      transactionShape?.delete();
      transaction.delete();
    }
  }

  if (nativeBuilder) {
    const transaction = nativeBuilder(
      targetBody.shape,
      toolBody.shape,
      targetBody.bodyId,
      targetBody.topologyToken,
      advanceTopologyToken(targetBody.topologyToken),
      context.modelingTolerance,
      0.5,
    );

    const { history: nativeHistory } = validateNativeFeatureTransaction(
      transaction,
      "split",
    );

    const splitBodies = trackBodiesFromShape(
      context,
      ownerFeatureId,
      "Split result",
      transaction.Shape() as Parameters<typeof trackBodiesFromShape>[3],
      "split",
    );
    const nextBodies = context.bodies
      .filter(
        (body) =>
          body.bodyId !== targetBody.bodyId &&
          (keepTool || body.bodyId !== toolBody.bodyId),
      )
      .concat(splitBodies);
    const historyInvalidations = createDeletedBodyInvalidations(targetBody);
    mergeHistoryInvalidations(
      historyInvalidations,
      collectNativeFeatureHistoryInvalidations(targetBody, nativeHistory),
    );

    return {
      bodies: nextBodies,
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: splitBodies.map((body) => ({
        kind: "body" as const,
        bodyId: body.bodyId,
      })),
      entities: [],
      renderRecords: [],
      historyInvalidations,
      ...(toolHistoryDegradationDiagnostic
        ? { diagnostics: [toolHistoryDegradationDiagnostic] }
        : {}),
    };
  }

  if (toolBody.bodyKind === "sheet") {
    const splitResult = runSheetSplit(
      context.oc,
      targetBody.shape,
      toolBody.shape,
    );
    try {
      const splitBodies = trackBodiesFromShape(
        context,
        ownerFeatureId,
        "Split result",
        splitResult.shape,
        "split",
      );
      const nextBodies = context.bodies
        .filter(
          (body) =>
            body.bodyId !== targetBody.bodyId &&
            (keepTool || body.bodyId !== toolBody.bodyId),
        )
        .concat(splitBodies);
      const historyInvalidations = createDeletedBodyInvalidations(targetBody);

      for (const [key, value] of markSplitAmbiguousInvalidations(
        collectTopologyHistoryInvalidations(targetBody, splitResult.builder),
      )) {
        historyInvalidations.set(key, value);
      }

      return {
        bodies: nextBodies,
        constructions: [...context.constructions],
        constructionPlanes: new Map(context.constructionPlanes),
        producedTargets: splitBodies.map((body) => ({
          kind: "body" as const,
          bodyId: body.bodyId,
        })),
        entities: [],
        renderRecords: [],
        historyInvalidations,
        ...(toolHistoryDegradationDiagnostic
          ? { diagnostics: [toolHistoryDegradationDiagnostic] }
          : {}),
      };
    } finally {
      splitResult.dispose();
    }
  }

  const cutResult = runBoolean(
    context.oc,
    "cut",
    targetBody.shape,
    toolBody.shape,
  );
  const intersectResult = runBoolean(
    context.oc,
    "intersect",
    targetBody.shape,
    toolBody.shape,
  );
  const remainderBodies = trackBodiesFromShape(
    context,
    ownerFeatureId,
    "Split remainder",
    cutResult.shape,
    "remainder",
  );
  const toolSideBodies = trackBodiesFromShape(
    context,
    ownerFeatureId,
    "Split tool-side result",
    intersectResult.shape,
    "tool-side",
  );
  const nextBodies = context.bodies
    .filter(
      (body) =>
        body.bodyId !== targetBody.bodyId &&
        (keepTool || body.bodyId !== toolBody.bodyId),
    )
    .concat([...remainderBodies, ...toolSideBodies]);
  const historyInvalidations = createDeletedBodyInvalidations(targetBody);

  for (const [key, value] of markSplitAmbiguousInvalidations(
    collectTopologyHistoryInvalidations(targetBody, cutResult.builder),
  )) {
    historyInvalidations.set(key, value);
  }
  for (const [key, value] of markSplitAmbiguousInvalidations(
    collectTopologyHistoryInvalidations(targetBody, intersectResult.builder),
  )) {
    historyInvalidations.set(key, value);
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [...remainderBodies, ...toolSideBodies].map((body) => ({
      kind: "body" as const,
      bodyId: body.bodyId,
    })),
    entities: [],
    renderRecords: [],
    historyInvalidations,
  };
}

function getDeleteSolidBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: "deleteSolid" },
) {
  const bodyTargets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (bodyTargets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC delete-solid requires at least one body participant.",
    );
  }

  for (const target of bodyTargets) {
    if (target.kind !== "body") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC delete-solid body participants must be durable body targets.",
      );
    }
  }

  return bodyTargets as readonly Extract<DurableRef, { kind: "body" }>[];
}

export function executeDeleteSolidFeature(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: "deleteSolid" },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC delete-solid does not support operation intents.",
    );
  }

  const bodyTargets = getDeleteSolidBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));

  const historyInvalidations = new Map<
    string,
    OccReferenceInvalidationRecord
  >();
  for (const target of bodyTargets) {
    const body = requireSolidBody(context, target.bodyId, "deleteSolid");
    for (const [key, value] of createDeletedBodyInvalidations(body)) {
      historyInvalidations.set(key, value);
    }
  }

  return {
    bodies: context.bodies.filter(
      (body) => !bodyTargets.some((target) => target.bodyId === body.bodyId),
    ),
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations,
  };
}
