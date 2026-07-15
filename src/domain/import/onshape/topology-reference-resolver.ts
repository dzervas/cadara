import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type {
  OnshapeGeometricSignature,
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
import type {
  OnshapeTopologyQueryRef,
  TopologyQueryReadDiagnostic,
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
  sourceEvidence: "historyPoint" | "rollback" | "corroboratedFinalState";
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
  rollback: RollbackTopologyTimeline;
  cadaraSignatures: readonly HistoryProbeTopologySignature[];
  tolerance: TopologyMatchTolerance;
  durableNamingAvailable: boolean;
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

function selectSourceEvidence(
  input: ResolveTopologyReferencesInput,
  query: OnshapeTopologyQueryRef,
): SourceEvidence | SourceFailure {
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
    return { signature: normalizeOnshapeTopologySignature(history.signature), source: "historyPoint" };
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
        return { signature: normalizedFinal, source: "corroboratedFinalState" };
      }
    }
    return { signature: normalizedRollback, source: "rollback" };
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
