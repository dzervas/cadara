import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";

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
