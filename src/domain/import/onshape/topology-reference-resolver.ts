import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type {
  OnshapeGeometricSignature,
  OnshapeResolvedQueryReference,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";
import type { ImportDeferredTopologyRef } from "@/contracts/import/actions";
import type { DurableRef } from "@/contracts/shared/references";
import type { RollbackTopologySnapshot, RollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import {
  matchSignature,
  type MatchCandidate,
  type MatchRejection,
  type TopologyMatchTolerance,
} from "@/domain/import/onshape/signature-matcher";
import { normalizeOnshapeTopologySignature } from "@/domain/import/onshape/topology-signature-normalizer";
import {
  reframeSignature,
  type RigidTransform,
} from "@/domain/import/onshape/capture-frame";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import type {
  OnshapeTopologyQueryRef,
  TopologyQueryReadDiagnostic,
  TopologyQuerySlot,
} from "@/domain/import/onshape/topology-query-reader";

export type TopologyResolutionReason =
  | "topology-query-unreadable"
  | "topology-history-evidence-missing"
  | "topology-source-query-unresolved"
  | "topology-source-kind-mismatch"
  | "topology-reference-no-match"
  | "topology-reference-ambiguous"
  | "topology-durable-naming-unavailable";

export type { ImportDeferredTopologyRef } from "@/contracts/import/actions";

export interface TopologyResolutionBinding {
  query: OnshapeTopologyQueryRef;
  reviewReference: DurableRef;
  deferred: ImportDeferredTopologyRef;
  score: number;
  evidence: readonly string[];
  sourceEvidence: "historyPoint" | "queryHistoryPoint" | "rollback" | "corroboratedFinalState" | "uniquePrefixBody";
}

export interface TopologyResolutionFailureDetail {
  query?: OnshapeTopologyQueryRef;
  message: string;
  rejected?: readonly MatchRejection[];
  candidates?: readonly MatchCandidate[];
}

export type TopologyResolutionResult =
  | { kind: "resolved"; bindings: readonly TopologyResolutionBinding[] }
  | {
      kind: "degraded";
      reason: TopologyResolutionReason;
      details: readonly TopologyResolutionFailureDetail[];
    };

export interface ResolveTopologyReferencesInput {
  consumerFeatureId: string;
  queries: readonly OnshapeTopologyQueryRef[];
  queryDiagnostics?: readonly TopologyQueryReadDiagnostic[];
  capturedReferences: readonly OnshapeResolvedReference[];
  capturedQueryReferences?: readonly OnshapeResolvedQueryReference[];
  rollback: RollbackTopologyTimeline;
  cadaraSignatures: readonly HistoryProbeTopologySignature[];
  tolerance: TopologyMatchTolerance;
  durableNamingAvailable: boolean;
  /**
   * Maps non-consumer/rollback/final captured-frame signatures into the frame
   * Cadara's parametric probe rebuilds. Current-consumer historyPoint evidence
   * is already authored in the consuming feature's live frame and must not be
   * transformed again.
   */
  captureFrameToWorld?: RigidTransform;
}

type SourceEvidence = {
  signature: OnshapeGeometricSignature;
  source: TopologyResolutionBinding["sourceEvidence"];
};

type SourceFailure = {
  reason: TopologyResolutionReason;
  message: string;
};

function pointsForFace(face: RollbackTopologySnapshot["bodies"][number]["faces"][number]) {
  return face.facets.flatMap((facet) => facet.vertices);
}

function signatureFromPoints(
  entityClass: "body" | "face",
  points: readonly (readonly [number, number, number])[],
): OnshapeGeometricSignature | null {
  if (points.length === 0) return null;
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (const axis of [0, 1, 2] as const) {
      low[axis] = Math.min(low[axis], point[axis]);
      high[axis] = Math.max(high[axis], point[axis]);
    }
  }
  return {
    entityClass,
    geometryType: "unknown",
    boundingBox: { low, high },
    centroid: [
      (low[0] + high[0]) / 2,
      (low[1] + high[1]) / 2,
      (low[2] + high[2]) / 2,
    ],
    tessellationSample: points.slice(0, 32).flatMap((point) => point),
  };
}

function rollbackEvidence(
  snapshot: RollbackTopologySnapshot,
  deterministicId: string,
): OnshapeGeometricSignature | null {
  for (const body of snapshot.bodies) {
    if (body.id === deterministicId) {
      return signatureFromPoints("body", body.faces.flatMap(pointsForFace));
    }
    const face = body.faces.find((candidate) => candidate.id === deterministicId);
    if (face) return signatureFromPoints("face", pointsForFace(face));
  }
  return null;
}

function sameBox(
  left: OnshapeGeometricSignature,
  right: OnshapeGeometricSignature,
  tolerance: TopologyMatchTolerance,
): boolean {
  if (!left.boundingBox || !right.boundingBox) return false;
  for (const corner of ["low", "high"] as const) {
    for (const axis of [0, 1, 2] as const) {
      if (Math.abs(left.boundingBox[corner][axis] - right.boundingBox[corner][axis]) > tolerance.linear) {
        return false;
      }
    }
  }
  return true;
}

function toWorldFrame(
  input: ResolveTopologyReferencesInput,
  signature: OnshapeGeometricSignature,
  options: { reframe: boolean } = { reframe: true },
): OnshapeGeometricSignature {
  // Default datum planes are frame-invariant world references (Cadara rebuilds
  // them at the origin regardless of downstream transforms), so they are never
  // reframed even when a baked transform precedes the consumer.
  return options.reframe && input.captureFrameToWorld && signature.isDefaultPlane !== true
    ? reframeSignature(signature, input.captureFrameToWorld)
    : signature;
}

function selectSourceEvidence(
  input: ResolveTopologyReferencesInput,
  query: OnshapeTopologyQueryRef,
): SourceEvidence | SourceFailure {
  if (query.queryEvidenceIndex !== undefined) {
    const captured = input.capturedQueryReferences?.find(
      (reference) =>
        reference.consumingFeatureId === input.consumerFeatureId &&
        reference.parameterId === query.parameterId &&
        reference.queryIndex === query.queryIndex &&
        ("entityIndex" in reference
          ? reference.entityIndex === query.queryEvidenceIndex
          : true),
    );
    if (!captured) {
      return {
        reason: "topology-history-evidence-missing",
        message: `No captured history-point evidence exists for query ${query.parameterId}[${query.queryIndex}].`,
      };
    }
    if ("unresolved" in captured) {
      return {
        reason: "topology-source-query-unresolved",
        message: captured.unresolved.reason,
      };
    }
    return {
      signature: toWorldFrame(
        input,
        normalizeOnshapeTopologySignature(captured.signature),
        { reframe: false },
      ),
      source: "queryHistoryPoint",
    };
  }

  const history = input.capturedReferences.find(
    (reference) =>
      reference.deterministicId === query.deterministicId &&
      reference.evaluatedAt === "historyPoint" &&
      reference.consumingFeatureId === input.consumerFeatureId,
  );
  if (history) {
    if ("unresolved" in history) {
      return {
        reason: "topology-source-query-unresolved",
        message: history.unresolved.reason,
      };
    }
    return {
      signature: toWorldFrame(input, normalizeOnshapeTopologySignature(history.signature), { reframe: false }),
      source: "historyPoint",
    };
  }

  const snapshot = input.rollback.snapshotBeforeFeature(input.consumerFeatureId);
  const rollbackSignature = snapshot
    ? rollbackEvidence(snapshot, query.deterministicId)
    : null;
  if (rollbackSignature) {
    const normalizedRollback = normalizeOnshapeTopologySignature(rollbackSignature);
    const final = input.capturedReferences.find(
      (reference) =>
        reference.deterministicId === query.deterministicId &&
        reference.evaluatedAt === "finalState" &&
        "signature" in reference,
    );
    if (final && "signature" in final) {
      const normalizedFinal = normalizeOnshapeTopologySignature(final.signature);
      if (
        normalizedFinal.entityClass === normalizedRollback.entityClass &&
        sameBox(normalizedFinal, normalizedRollback, input.tolerance)
      ) {
        return { signature: toWorldFrame(input, normalizedFinal), source: "corroboratedFinalState" };
      }
    }
    return { signature: toWorldFrame(input, normalizedRollback), source: "rollback" };
  }

  const canonicalDatum = input.capturedReferences.find(
    (reference) =>
      reference.deterministicId === query.deterministicId &&
      reference.evaluatedAt === "finalState" &&
      "signature" in reference &&
      reference.signature.isDefaultPlane === true,
  );
  if (canonicalDatum && "signature" in canonicalDatum) {
    return {
      signature: normalizeOnshapeTopologySignature(canonicalDatum.signature),
      source: "corroboratedFinalState",
    };
  }

  return {
    reason: "topology-history-evidence-missing",
    message: `No safe pre-consumer evidence exists for ${query.deterministicId}.`,
  };
}

function expectedKindFor(signature: OnshapeGeometricSignature): ImportDeferredTopologyRef["expectedKind"] {
  return signature.entityClass;
}

export function isUniquePrefixBodyQuery(
  feature: OnshapeFeatureNode,
  slots: readonly TopologyQuerySlot[],
): boolean {
  if (slots.length !== 1) return false;
  const slot = slots[0]!;
  if (
    slot.expectedKinds.length !== 1 ||
    slot.expectedKinds[0] !== "body" ||
    slot.cardinality.min !== 1 ||
    slot.cardinality.max !== 1
  ) {
    return false;
  }
  const parameter = (feature.parameters ?? []).find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === slot.parameterId,
  ) as { queries?: unknown } | undefined;
  if (!parameter || !Array.isArray(parameter.queries) || parameter.queries.length !== 1) {
    return false;
  }
  const query = parameter.queries[0] as { deterministicIds?: unknown };
  return Array.isArray(query?.deterministicIds) && query.deterministicIds.length === 0;
}

export interface ResolveUniquePrefixBodyInput {
  consumerFeatureId: string;
  feature: OnshapeFeatureNode;
  slots: readonly TopologyQuerySlot[];
  cadaraSignatures: readonly HistoryProbeTopologySignature[];
  tolerance: TopologyMatchTolerance;
}

function queryParameter(
  feature: OnshapeFeatureNode,
  parameterId: string,
): { queries?: unknown } | undefined {
  return (feature.parameters ?? []).find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === parameterId,
  ) as { queries?: unknown } | undefined;
}

/**
 * Recover a body-only query when Onshape omits geometry IDs but the rebuilt
 * prefix contains exactly one live body. This is identity by cardinality, not
 * geometric matching: every non-body, multi-slot, malformed, or multi-body
 * case remains unreadable.
 */
export function resolveUniquePrefixBody(
  input: ResolveUniquePrefixBodyInput,
): TopologyResolutionResult | null {
  if (!isUniquePrefixBodyQuery(input.feature, input.slots)) return null;
  const slot = input.slots[0]!;
  const parameter = (input.feature.parameters ?? []).find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === slot.parameterId,
  ) as { queries: Array<{ deterministicIds?: unknown; queryString?: unknown }> };
  const queries = parameter.queries;

  const bodySignatures = new Map<
    string,
    HistoryProbeTopologySignature & { reference: Extract<DurableRef, { kind: "body" }> }
  >();
  for (const signature of input.cadaraSignatures) {
    if (signature.entityClass !== "body" || signature.reference.kind !== "body") continue;
    bodySignatures.set(
      signature.reference.bodyId,
      signature as HistoryProbeTopologySignature & {
        reference: Extract<DurableRef, { kind: "body" }>;
      },
    );
  }
  if (bodySignatures.size !== 1) return null;

  const signature = [...bodySignatures.values()][0]!;
  const capturedSignature: OnshapeGeometricSignature = {
    entityClass: "body",
    geometryType: signature.geometryType,
    ...(signature.definingData ? { definingData: signature.definingData } : {}),
    ...(signature.centroid ? { centroid: signature.centroid } : {}),
    ...(signature.boundingBox ? { boundingBox: signature.boundingBox } : {}),
  };
  const deterministicId = `unique-prefix-body:${signature.reference.bodyId}`;
  const query: OnshapeTopologyQueryRef = {
    consumerFeatureId: input.consumerFeatureId,
    slotKey: slot.key,
    parameterId: slot.parameterId,
    queryIndex: 0,
    deterministicId,
    queryString:
      typeof queries[0]?.queryString === "string" ? queries[0].queryString : null,
    expectedKinds: slot.expectedKinds,
  };
  return {
    kind: "resolved",
    bindings: [{
      query,
      reviewReference: signature.reference,
      deferred: {
        kind: "topologyOf",
        expectedKind: "body",
        capturedSignature,
        tolerance: input.tolerance,
        source: {
          consumerFeatureId: input.consumerFeatureId,
          parameterId: slot.parameterId,
          deterministicId,
        },
      },
      score: 0,
      evidence: ["unique-prefix-body"],
      sourceEvidence: "uniquePrefixBody",
    }],
  };
}

/**
 * Recover Onshape UNION's omitted default target only after every explicit tool
 * resolves to a distinct live prefix body and exactly one other live body
 * remains. This is set subtraction over exact lineage, never a first-body pick.
 */
export function resolveImplicitUnionTarget(input: ResolveTopologyReferencesInput & {
  feature: OnshapeFeatureNode;
  slots: readonly TopologyQuerySlot[];
}): TopologyResolutionResult | null {
  const targetSlot = input.slots.find((slot) => slot.key === "targetBodies");
  const toolSlot = input.slots.find((slot) => slot.key === "toolBodies");
  const targetParameter = targetSlot
    ? queryParameter(input.feature, targetSlot.parameterId)
    : undefined;
  const targets = targetParameter?.queries;
  if (
    !targetSlot ||
    !toolSlot ||
    (targetParameter !== undefined && (!Array.isArray(targets) || targets.length !== 0))
  ) return null;

  const toolQueries = input.queries.filter((query) => query.slotKey === toolSlot.key);
  if (toolQueries.length === 0 || input.queries.length !== toolQueries.length) {
    return {
      kind: "degraded",
      reason: "topology-query-unreadable",
      details: [{ message: "An implicit UNION target requires one or more explicit tool-body queries." }],
    };
  }
  const toolResolution = resolveTopologyReferences({
    ...input,
    queries: toolQueries,
    queryDiagnostics: input.queryDiagnostics?.filter(
      (diagnostic) => diagnostic.slotKey === toolSlot.key,
    ),
  });
  if (toolResolution.kind === "degraded") return toolResolution;

  const tools = new Set(
    toolResolution.bindings.map((binding) =>
      binding.reviewReference.kind === "body" ? binding.reviewReference.bodyId : null,
    ),
  );
  if (tools.has(null)) {
    return {
      kind: "degraded",
      reason: "topology-source-kind-mismatch",
      details: [{ message: "An implicit UNION target requires body-only tool lineage." }],
    };
  }
  const bodies = new Map<string, HistoryProbeTopologySignature & {
    reference: Extract<DurableRef, { kind: "body" }>;
  }>();
  for (const signature of input.cadaraSignatures) {
    if (signature.entityClass === "body" && signature.reference.kind === "body") {
      bodies.set(signature.reference.bodyId, signature as HistoryProbeTopologySignature & {
        reference: Extract<DurableRef, { kind: "body" }>;
      });
    }
  }
  const targetsInPrefix = [...bodies.values()].filter(
    (signature) => !tools.has(signature.reference.bodyId),
  );
  if (targetsInPrefix.length !== 1) {
    return {
      kind: "degraded",
      reason: targetsInPrefix.length === 0
        ? "topology-reference-no-match"
        : "topology-reference-ambiguous",
      details: [{
        message: targetsInPrefix.length === 0
          ? "No live prefix body remains after resolving UNION tools."
          : "More than one live prefix body remains after resolving UNION tools.",
      }],
    };
  }
  const target = targetsInPrefix[0]!;
  const capturedSignature: OnshapeGeometricSignature = {
    entityClass: "body",
    geometryType: target.geometryType,
    ...(target.definingData ? { definingData: target.definingData } : {}),
    ...(target.centroid ? { centroid: target.centroid } : {}),
    ...(target.boundingBox ? { boundingBox: target.boundingBox } : {}),
  };
  const deterministicId = `implicit-union-target:${target.reference.bodyId}`;
  return {
    kind: "resolved",
    bindings: [{
      query: {
        consumerFeatureId: input.consumerFeatureId,
        slotKey: targetSlot.key,
        parameterId: targetSlot.parameterId,
        queryIndex: 0,
        deterministicId,
        queryString: null,
        expectedKinds: targetSlot.expectedKinds,
      },
      reviewReference: target.reference,
      deferred: {
        kind: "topologyOf",
        expectedKind: "body",
        capturedSignature,
        tolerance: input.tolerance,
        source: {
          consumerFeatureId: input.consumerFeatureId,
          parameterId: targetSlot.parameterId,
          deterministicId,
        },
      },
      score: 0,
      evidence: ["implicit-union-target", "exact-prefix-body-lineage"],
      sourceEvidence: "uniquePrefixBody",
    }, ...toolResolution.bindings],
  };
}

/** Resolve all required members atomically. One failure degrades the whole consumer. */
export function resolveTopologyReferences(
  input: ResolveTopologyReferencesInput,
): TopologyResolutionResult {
  if ((input.queryDiagnostics?.length ?? 0) > 0 || input.queries.length === 0) {
    return {
      kind: "degraded",
      reason: "topology-query-unreadable",
      details: (input.queryDiagnostics?.length ? input.queryDiagnostics : [{ message: "No topology queries were supplied." }]).map(
        (diagnostic) => ({ message: diagnostic.message }),
      ),
    };
  }

  const bindings: TopologyResolutionBinding[] = [];
  for (const query of input.queries) {
    if (query.consumerFeatureId !== input.consumerFeatureId || !query.deterministicId) {
      return {
        kind: "degraded",
        reason: "topology-query-unreadable",
        details: [{ query, message: "The topology query does not belong to this consumer or has no deterministic ID." }],
      };
    }

    const source = selectSourceEvidence(input, query);
    if ("reason" in source) {
      return { kind: "degraded", reason: source.reason, details: [{ query, message: source.message }] };
    }
    if (!query.expectedKinds.includes(source.signature.entityClass)) {
      return {
        kind: "degraded",
        reason: "topology-source-kind-mismatch",
        details: [{ query, message: `Source kind ${source.signature.entityClass} is not allowed for slot ${query.slotKey}.` }],
      };
    }
    if (source.signature.entityClass !== "body" && !input.durableNamingAvailable) {
      return {
        kind: "degraded",
        reason: "topology-durable-naming-unavailable",
        details: [{ query, message: `Durable ${source.signature.entityClass} naming is unavailable.` }],
      };
    }

    const match = matchSignature(source.signature, input.cadaraSignatures, input.tolerance);
    if (match.kind === "noMatch") {
      return {
        kind: "degraded",
        reason: "topology-reference-no-match",
        details: [{ query, message: `No Cadara topology matches ${query.deterministicId}.`, rejected: match.rejected }],
      };
    }
    if (match.kind === "ambiguous") {
      return {
        kind: "degraded",
        reason: "topology-reference-ambiguous",
        details: [{ query, message: `Cadara topology match for ${query.deterministicId} is ambiguous.`, candidates: match.candidates }],
      };
    }

    bindings.push({
      query,
      reviewReference: match.reference,
      score: match.score,
      evidence: match.evidence,
      sourceEvidence: source.source,
      deferred: {
        kind: "topologyOf",
        expectedKind: expectedKindFor(source.signature),
        capturedSignature: source.signature,
        tolerance: input.tolerance,
        source: {
          consumerFeatureId: input.consumerFeatureId,
          parameterId: query.parameterId,
          deterministicId: query.deterministicId,
        },
      },
    });
  }
  return { kind: "resolved", bindings };
}
