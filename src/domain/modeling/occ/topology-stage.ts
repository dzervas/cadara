import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
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

type RigidTransformSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

function rigidTransformSourceId(target: RigidTransformSubtopologyRef) {
  if (target.kind === "face") {
    return target.faceId;
  }
  if (target.kind === "edge") {
    return target.edgeId;
  }
  return target.vertexId;
}

function getRigidTransformSourceTargets(body: OccTrackedBody) {
  return [
    ...body.topology.faceIds.map(
      (faceId): RigidTransformSubtopologyRef => ({
        kind: "face",
        bodyId: body.bodyId,
        faceId,
      }),
    ),
    ...body.topology.edgeIds.map(
      (edgeId): RigidTransformSubtopologyRef => ({
        kind: "edge",
        bodyId: body.bodyId,
        edgeId,
      }),
    ),
    ...body.topology.vertexIds.map(
      (vertexId): RigidTransformSubtopologyRef => ({
        kind: "vertex",
        bodyId: body.bodyId,
        vertexId,
      }),
    ),
  ];
}

function sameRigidTransformKind(
  source: RigidTransformSubtopologyRef,
  successor: DurableRef,
): successor is RigidTransformSubtopologyRef {
  return source.kind === successor.kind;
}

export function formatRigidTransformTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  kind: "face" | "edge" | "vertex";
  sourcePublicId: FaceId | EdgeId | VertexId;
}) {
  return `rigid-transform:${input.featureId}:${input.bodyId}:${input.kind}:${input.sourcePublicId}`;
}

export function createRigidTransformTopologyStage(input: {
  featureId: FeatureId;
  sourceBody: OccTrackedBody;
  outputBody: OccTrackedBody;
  successorsBySourceKey: ReadonlyMap<string, DurableRef>;
}): OccFeatureTopologyStage {
  const sourceTargets = new Map<OccTopologySourceKey, DurableRef[]>();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const claimedTargetKeys = new Map<string, OccTopologySourceKey>();

  for (const source of getRigidTransformSourceTargets(input.sourceBody)) {
    const sourceKey = formatRigidTransformTopologySourceKey({
      featureId: input.featureId,
      bodyId: input.sourceBody.bodyId,
      kind: source.kind,
      sourcePublicId: rigidTransformSourceId(source),
    });
    const successor = input.successorsBySourceKey.get(getOccDurableRefKey(source));

    if (
      !successor ||
      !sameRigidTransformKind(source, successor) ||
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
