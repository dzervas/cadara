import type {
  ImportDeferredHistoricalTopologyRef,
  ImportTopologySelectorSource,
} from "@/contracts/import/actions";
import type {
  HistoryProbeExactTopologyEvidence,
  HistoryProbeTopologySignature,
} from "@/contracts/import/capabilities";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import type { DurableRef } from "@/contracts/shared/references";
import {
  DEFAULT_MATCH_TOLERANCE,
  matchSignature,
} from "@/domain/import/onshape/signature-matcher";

export const LIVE_TOPOLOGY_MATCH_TOLERANCE = {
  ...DEFAULT_MATCH_TOLERANCE,
  linear: Math.max(DEFAULT_MATCH_TOLERANCE.linear, 0.01),
};

export interface HistoricalTopologySignatureStep {
  orderedActionIndex: number;
  /** Source feature that emitted this exact probe action, when uniquely known. */
  sourceFeatureId?: string;
  signatures: readonly HistoryProbeTopologySignature[];
  exactTopologyEvidence?: HistoryProbeExactTopologyEvidence;
}

/** Review-only provenance. Preparation replaces these source identities with its own indexes. */
export interface HistoricalTopologyPlanSelector extends ImportDeferredHistoricalTopologyRef {
  witnessSourceFeatureId: string;
  successorSourceFeatureIds: readonly string[];
}

export type HistoricalTopologyResolution =
  | {
      kind: "unique";
      reference: DurableRef;
      selector: HistoricalTopologyPlanSelector;
    }
  | { kind: "noMatch" | "ambiguous" | "conflict"; detail: string };

export function durableTopologyReferenceKey(reference: DurableRef): string {
  switch (reference.kind) {
    case "body":
      return `body:${reference.bodyId}`;
    case "face":
      return `face:${reference.bodyId}:${reference.faceId}`;
    case "edge":
      return `edge:${reference.bodyId}:${reference.edgeId}`;
    case "vertex":
      return `vertex:${reference.bodyId}:${reference.vertexId}`;
    default:
      return JSON.stringify(reference);
  }
}

function exactSuccessorSourceKey(featureId: string, reference: DurableRef) {
  if (
    reference.kind !== "face" &&
    reference.kind !== "edge" &&
    reference.kind !== "vertex"
  ) return null;
  const publicId = reference.kind === "face"
    ? reference.faceId
    : reference.kind === "edge"
      ? reference.edgeId
      : reference.vertexId;
  return `exact-successor:${featureId}:${reference.bodyId}:${reference.kind}:${publicId}`;
}

/** Follow one exact Modified relation published by the action's own topology stage. */
export function followExactTopologySuccessor(input: {
  actionIndex: number;
  evidence: HistoryProbeExactTopologyEvidence | undefined;
  reference: DurableRef;
}): { kind: "unique"; reference: DurableRef } | { kind: "none" | "many"; detail: string } {
  const featureIds = new Set(
    input.evidence?.actionOutputs
      .filter((output) => output.actionIndex === input.actionIndex)
      .flatMap((output) => (output.featureId ? [output.featureId] : [])) ?? [],
  );
  if (featureIds.size === 0) {
    return {
      kind: "none",
      detail: `Action ${input.actionIndex} publishes no feature outputs.`,
    };
  }
  const sourceKeys = new Set(
    [...featureIds]
      .map((featureId) => exactSuccessorSourceKey(featureId, input.reference))
      .filter((key): key is string => key !== null),
  );
  if (sourceKeys.size === 0) {
    return { kind: "none", detail: "Exact successor lineage does not support body references." };
  }
  const targets = input.evidence?.topologyLineage
    .flatMap((lineage) => lineage.outputs.flatMap((output) =>
      output.sourceTargets
        .filter((entry) => sourceKeys.has(entry.sourceKey))
        .flatMap((entry) => entry.targets),
    ))
    .filter((target) => target.kind === input.reference.kind) ?? [];
  const unique = new Map(targets.map((target) => [durableTopologyReferenceKey(target), target]));
  if (unique.size !== 1) {
    return {
      kind: unique.size === 0 ? "none" : "many",
      detail: `Action ${input.actionIndex} has ${unique.size} exact ${input.reference.kind} successors for ${durableTopologyReferenceKey(input.reference)}.`,
    };
  }
  return { kind: "unique", reference: unique.values().next().value! };
}

/**
 * Establish identity from a unique geometric witness, then inspect only public-id
 * continuity and exact OCC Modified lineage through the consumer prefix.
 */
export function resolveHistoricalTopology(input: {
  expectedKind: ImportDeferredHistoricalTopologyRef["expectedKind"];
  capturedSignature: OnshapeGeometricSignature;
  historicalSteps: readonly HistoricalTopologySignatureStep[];
  consumerSignatures: readonly HistoryProbeTopologySignature[];
  source: ImportTopologySelectorSource;
}): HistoricalTopologyResolution {
  const orderedSteps = [...input.historicalSteps].sort(
    (left, right) => left.orderedActionIndex - right.orderedActionIndex,
  );
  let witness: { orderedActionIndex: number; sourceFeatureId: string; reference: DurableRef } | null = null;

  for (const step of orderedSteps) {
    const candidates = step.signatures.filter(
      (signature) =>
        signature.entityClass === input.expectedKind &&
        signature.reference.kind === input.expectedKind,
    );
    const match = matchSignature(input.capturedSignature, candidates, LIVE_TOPOLOGY_MATCH_TOLERANCE);
    if (match.kind === "noMatch") continue;
    if (match.kind === "ambiguous") {
      return {
        kind: "ambiguous",
        detail: `Historical topology witness is ambiguous after ordered action ${step.orderedActionIndex}.`,
      };
    }
    if (!step.sourceFeatureId) {
      return {
        kind: "noMatch",
        detail: `Historical topology witness action ${step.orderedActionIndex} has no unique source feature identity.`,
      };
    }
    witness = {
      orderedActionIndex: step.orderedActionIndex,
      sourceFeatureId: step.sourceFeatureId,
      reference: match.reference,
    };
    break;
  }

  if (!witness) {
    return { kind: "noMatch", detail: "No earlier action has a unique historical topology witness." };
  }

  let current = witness.reference;
  const successorActionIndexes: number[] = [];
  const successorSourceFeatureIds: string[] = [];
  for (const step of orderedSteps) {
    if (step.orderedActionIndex <= witness.orderedActionIndex) continue;
    const successor = followExactTopologySuccessor({
      actionIndex: step.orderedActionIndex,
      evidence: step.exactTopologyEvidence,
      reference: current,
    });
    if (successor.kind === "unique") {
      if (!step.sourceFeatureId) {
        return {
          kind: "noMatch",
          detail: `Historical topology successor action ${step.orderedActionIndex} has no unique source feature identity.`,
        };
      }
      // A Modified relation is an action-local rebinding contract even when the
      // review pass retained its public id. Its consumer must advance through
      // the modifying action before resolving that same id at apply time.
      current = successor.reference;
      successorActionIndexes.push(step.orderedActionIndex);
      successorSourceFeatureIds.push(step.sourceFeatureId);
      continue;
    }
    if (successor.kind === "many") {
      return {
        kind: "ambiguous",
        detail: successor.detail,
      };
    }

    const occurrences = step.signatures.filter(
      (signature) =>
        signature.entityClass === input.expectedKind &&
        signature.reference.kind === input.expectedKind &&
        durableTopologyReferenceKey(signature.reference) === durableTopologyReferenceKey(current),
    );
    if (occurrences.length !== 1) {
      return {
        kind: occurrences.length === 0 ? "noMatch" : "ambiguous",
        detail: `Historical topology lineage ${durableTopologyReferenceKey(current)} occurs ${occurrences.length} times after ordered action ${step.orderedActionIndex}.`,
      };
  }
  }

  const survivors = input.consumerSignatures.filter(
    (signature) =>
      signature.entityClass === input.expectedKind &&
      signature.reference.kind === input.expectedKind &&
      durableTopologyReferenceKey(signature.reference) === durableTopologyReferenceKey(current),
  );
  if (survivors.length !== 1) {
    return {
      kind: survivors.length === 0 ? "noMatch" : "ambiguous",
      detail: `Historical topology lineage ${durableTopologyReferenceKey(current)} occurs ${survivors.length} times at the consumer prefix.`,
    };
  }

  return {
    kind: "unique",
    reference: survivors[0]!.reference,
    selector: {
      kind: "historicalTopologyOf",
      expectedKind: input.expectedKind,
      capturedSignature: input.capturedSignature,
      witnessActionIndex: witness.orderedActionIndex,
      successorActionIndexes,
      witnessSourceFeatureId: witness.sourceFeatureId,
      successorSourceFeatureIds,
      source: input.source,
    },
  };
}
