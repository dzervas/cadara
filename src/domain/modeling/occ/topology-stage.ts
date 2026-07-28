import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  AuthoredFeatureTopologyLineage,
  AuthoredTopologyLineageTarget,
} from "@/contracts/modeling/authored-document";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";
import type { BodyId, EdgeId, FaceId, VertexId } from "@/contracts/shared/ids";
import { getOccDurableRefKey } from "@/domain/modeling/occ/topology";

export type OccTopologySourceKey = string;
export type OccTopologyOutputSlot = OccTrackedBody["bodyId"];

export interface OccTopologyStageOutput {
  outputSlot: OccTopologyOutputSlot;
  body: OccTrackedBody;
  sourceTargets: ReadonlyMap<OccTopologySourceKey, readonly DurableRef[]>;
  unsupportedSourceKeys: ReadonlySet<OccTopologySourceKey>;
}

export interface OccFeatureTopologyStage {
  featureId: FeatureId;
  outputs: ReadonlyMap<OccTopologyOutputSlot, OccTopologyStageOutput>;
}

export type OccFeatureTopologyStageMap = ReadonlyMap<
  FeatureId,
  OccFeatureTopologyStage
>;

export type OccFeatureTopologyLineageMap = ReadonlyMap<
  FeatureId,
  AuthoredFeatureTopologyLineage
>;

function isOutputSubtopologyTarget(
  target: DurableRef,
  bodyId: BodyId,
): target is AuthoredTopologyLineageTarget {
  return (
    (target.kind === "face" ||
      target.kind === "edge" ||
      target.kind === "vertex") &&
    target.bodyId === bodyId
  );
}

export function createOccFeatureTopologyLineageMap(
  records: readonly AuthoredFeatureTopologyLineage[] | undefined,
): OccFeatureTopologyLineageMap {
  return new Map((records ?? []).map((record) => [record.featureId, record]));
}

export function mergeOccFeatureTopologyStageMaps(
  ...maps: readonly OccFeatureTopologyStageMap[]
): OccFeatureTopologyStageMap {
  return new Map(maps.flatMap((map) => [...map]));
}

export function serializeOccFeatureTopologyLineage(
  stages: OccFeatureTopologyStageMap,
  retained: OccFeatureTopologyLineageMap,
  activeFeatureIds: ReadonlySet<FeatureId>,
): AuthoredFeatureTopologyLineage[] {
  const records = new Map(
    [...retained].filter(([featureId]) => activeFeatureIds.has(featureId)),
  );

  for (const [featureId, stage] of stages) {
    if (!activeFeatureIds.has(featureId)) {
      continue;
    }
    records.set(featureId, {
      featureId,
      outputs: [...stage.outputs].map(([outputSlot, output]) => ({
        outputSlot,
        topologyToken: output.body.topologyToken,
        topology: {
          faceIds: [...output.body.topology.faceIds],
          edgeIds: [...output.body.topology.edgeIds],
          vertexIds: [...output.body.topology.vertexIds],
        },
        sourceTargets: [...output.sourceTargets].map(([sourceKey, targets]) => ({
          sourceKey,
          targets: targets.filter((target) =>
            isOutputSubtopologyTarget(target, outputSlot),
          ),
        })),
        unsupportedSourceKeys: [...output.unsupportedSourceKeys],
      })),
    });
  }

  return [...records.values()];
}

type ExactSuccessorSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

function exactSuccessorSourceId(target: ExactSuccessorSubtopologyRef) {
  if (target.kind === "face") {
    return target.faceId;
  }
  if (target.kind === "edge") {
    return target.edgeId;
  }
  return target.vertexId;
}

function getExactSuccessor(
  sourceBody: OccTrackedBody,
  source: ExactSuccessorSubtopologyRef,
  successorsBySourceKey: ReadonlyMap<string, DurableRef>,
) {
  const direct = successorsBySourceKey.get(getOccDurableRefKey(source));
  if (direct) {
    return direct;
  }

  const aliases =
    source.kind === "face"
      ? sourceBody.nativeTopologyIdAliases?.faceIdsByNativeId
      : source.kind === "edge"
        ? sourceBody.nativeTopologyIdAliases?.edgeIdsByNativeId
        : sourceBody.nativeTopologyIdAliases?.vertexIdsByNativeId;
  const publicId = exactSuccessorSourceId(source);
  for (const [nativeId, aliasedPublicId] of aliases ?? []) {
    if (aliasedPublicId !== publicId) {
      continue;
    }
    const nativeTarget =
      source.kind === "face"
        ? { ...source, faceId: nativeId as FaceId }
        : source.kind === "edge"
          ? { ...source, edgeId: nativeId as EdgeId }
          : { ...source, vertexId: nativeId as VertexId };
    const successor = successorsBySourceKey.get(
      getOccDurableRefKey(nativeTarget),
    );
    if (successor) {
      return successor;
    }
  }
  return undefined;
}

function getExactSuccessorSourceTargets(body: OccTrackedBody) {
  return [
    ...body.topology.faceIds.map(
      (faceId): ExactSuccessorSubtopologyRef => ({
        kind: "face",
        bodyId: body.bodyId,
        faceId,
      }),
    ),
    ...body.topology.edgeIds.map(
      (edgeId): ExactSuccessorSubtopologyRef => ({
        kind: "edge",
        bodyId: body.bodyId,
        edgeId,
      }),
    ),
    ...body.topology.vertexIds.map(
      (vertexId): ExactSuccessorSubtopologyRef => ({
        kind: "vertex",
        bodyId: body.bodyId,
        vertexId,
      }),
    ),
  ];
}

function sameExactSuccessorKind(
  source: ExactSuccessorSubtopologyRef,
  successor: DurableRef,
): successor is ExactSuccessorSubtopologyRef {
  return source.kind === successor.kind;
}

export function formatExactSuccessorTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  kind: "face" | "edge" | "vertex";
  sourcePublicId: FaceId | EdgeId | VertexId;
}) {
  return `exact-successor:${input.featureId}:${input.bodyId}:${input.kind}:${input.sourcePublicId}`;
}

/**
 * Producer-identity key for a subtopology a local operation CREATED.
 *
 * A generated entity has no prior subtopology to be a successor of, so it can
 * only be named after the feature that produced it plus the exact source the
 * kernel's own `Generated` history attributes it to. Both halves come from the
 * builder, never from geometry, so two executions of the same feature over the
 * same source keys reproduce the same key.
 */
export function formatGeneratedProducerTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  sourceKind: "face" | "edge" | "vertex";
  sourcePublicId: FaceId | EdgeId | VertexId;
  role: string;
}) {
  return `generated-from:${input.featureId}:${input.bodyId}:${input.sourceKind}:${input.sourcePublicId}:${input.role}`;
}

/**
 * Build stage lineage from a feature's own exact kernel history successors.
 *
 * Applies to any feature that replaces one body and reports, per prior
 * subtopology, at most one successor claimed exactly once (rigid transforms,
 * and local operations like fillet/chamfer whose `BRepFilletAPI` history maps
 * untouched faces/edges/vertices one-to-one). Anything the kernel left
 * ambiguous, deleted, or unclaimed becomes an unsupported source key, so a
 * later rebuild invalidates it instead of guessing.
 *
 * `generatedTargetsBySourceKey` carries the complementary half: subtopology the
 * operation CREATED, which is a successor of nothing and would otherwise reach
 * rebuild with no source key at all. Those keys claim the producing feature's
 * identity via `formatGeneratedProducerTopologySourceKey`, and the caller must
 * derive them from builder history only.
 */
export function createExactSuccessorTopologyStage(input: {
  featureId: FeatureId;
  sourceBody: OccTrackedBody;
  outputBody: OccTrackedBody;
  successorsBySourceKey: ReadonlyMap<string, DurableRef>;
  generatedTargetsBySourceKey?: ReadonlyMap<OccTopologySourceKey, DurableRef>;
}): OccFeatureTopologyStage {
  const sourceTargets = new Map<OccTopologySourceKey, DurableRef[]>();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const claimedTargetKeys = new Map<string, OccTopologySourceKey>();

  for (const source of getExactSuccessorSourceTargets(input.sourceBody)) {
    const sourceKey = formatExactSuccessorTopologySourceKey({
      featureId: input.featureId,
      bodyId: input.sourceBody.bodyId,
      kind: source.kind,
      sourcePublicId: exactSuccessorSourceId(source),
    });
    const successor = getExactSuccessor(
      input.sourceBody,
      source,
      input.successorsBySourceKey,
    );

    if (
      !successor ||
      !sameExactSuccessorKind(source, successor) ||
      successor.bodyId !== input.outputBody.bodyId
    ) {
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }

    const targetKey = getOccDurableRefKey(successor);
    if (claimedTargetKeys.has(targetKey)) {
      unsupportedSourceKeys.add(sourceKey);
      unsupportedSourceKeys.add(claimedTargetKeys.get(targetKey)!);
      sourceTargets.delete(claimedTargetKeys.get(targetKey)!);
      continue;
    }

    claimedTargetKeys.set(targetKey, sourceKey);
    sourceTargets.set(sourceKey, [successor]);
  }

  for (const [sourceKey, target] of input.generatedTargetsBySourceKey ?? []) {
    if (
      !isOutputSubtopologyTarget(target, input.outputBody.bodyId) ||
      sourceTargets.has(sourceKey)
    ) {
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }

    const targetKey = getOccDurableRefKey(target);
    const claimedBy = claimedTargetKeys.get(targetKey);
    if (claimedBy) {
      // A result entity cannot both survive a prior entity and be newly
      // generated, and two producer claims on one entity are ambiguous.
      unsupportedSourceKeys.add(sourceKey);
      unsupportedSourceKeys.add(claimedBy);
      sourceTargets.delete(claimedBy);
      continue;
    }

    claimedTargetKeys.set(targetKey, sourceKey);
    sourceTargets.set(sourceKey, [target]);
  }

  return {
    featureId: input.featureId,
    outputs: new Map([
      [
        input.outputBody.bodyId,
        {
          outputSlot: input.outputBody.bodyId,
          body: input.outputBody,
          sourceTargets,
          unsupportedSourceKeys,
        },
      ],
    ]),
  };
}

export function getPreviousFeatureTopologyStage(
  stages: OccFeatureTopologyStageMap,
  featureId: FeatureId,
): OccFeatureTopologyStage | null {
  return stages.get(featureId) ?? null;
}

export function getPreviousFeatureTopologyLineage(
  lineage: OccFeatureTopologyLineageMap,
  featureId: FeatureId,
): AuthoredFeatureTopologyLineage | null {
  return lineage.get(featureId) ?? null;
}

export function createUnsupportedProducerTopologyStage(input: {
  featureId: FeatureId;
  bodies: readonly OccTrackedBody[];
  producedTargets: readonly DurableRef[];
}): OccFeatureTopologyStage {
  const bodiesById = new Map(input.bodies.map((body) => [body.bodyId, body]));
  const outputs = new Map<OccTopologyOutputSlot, OccTopologyStageOutput>();

  for (const target of input.producedTargets) {
    if (target.kind !== "body") {
      continue;
    }

    const body = bodiesById.get(target.bodyId);
    if (!body) {
      continue;
    }

    outputs.set(body.bodyId, {
      outputSlot: body.bodyId,
      body,
      sourceTargets: new Map(),
      unsupportedSourceKeys: new Set(),
    });
  }

  return { featureId: input.featureId, outputs };
}

export function createFeatureTopologyStage(input: {
  featureId: FeatureId;
  previousBodies: readonly OccTrackedBody[];
  currentBodies: readonly OccTrackedBody[];
  outputs?: ReadonlyMap<OccTopologyOutputSlot, OccTopologyStageOutput>;
}): OccFeatureTopologyStage {
  if (input.outputs) {
    return {
      featureId: input.featureId,
      outputs: new Map(input.outputs),
    };
  }

  const previousById = new Map(
    input.previousBodies.map((body) => [body.bodyId, body]),
  );
  const outputs = new Map<OccTopologyOutputSlot, OccTopologyStageOutput>();

  for (const body of input.currentBodies) {
    const previous = previousById.get(body.bodyId);
    if (previous === body || previous?.topologyToken === body.topologyToken) {
      continue;
    }

    outputs.set(body.bodyId, {
      outputSlot: body.bodyId,
      body,
      sourceTargets: new Map(),
      unsupportedSourceKeys: new Set(),
    });
  }

  return { featureId: input.featureId, outputs };
}
