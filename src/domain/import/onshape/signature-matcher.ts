/**
 * Signature matcher (probe-present path).
 *
 * Ranks a captured Onshape geometric signature against the per-step topology
 * signatures returned by the sandboxed history probe. This path is inert while
 * the probe is absent (v1 ships probe-less), but it is implemented and tested
 * against a mock probe so `add-kernel-topology-signatures` activates reference
 * resolution without provider changes.
 *
 * Policy: entity class + geometry type must match; among survivors, rank by
 * centroid and bounding-box proximity. A unique in-tolerance winner resolves;
 * multiple in-tolerance candidates are ambiguous; none is a miss. Never guess.
 */
import type {
  HistoryProbeTopologySignature,
} from "@/contracts/import/capabilities";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import type { DurableRef } from "@/contracts/shared/references";

export interface SignatureMatchTolerance {
  /** Max centroid distance (document units) to consider a candidate. */
  centroid: number;
  /** Max per-axis bounding-box corner distance (document units). */
  boundingBox: number;
}

export const DEFAULT_MATCH_TOLERANCE: SignatureMatchTolerance = {
  centroid: 1e-4,
  boundingBox: 1e-4,
};

export type SignatureMatchOutcome =
  | { kind: "unique"; reference: DurableRef; score: number }
  | {
      kind: "ambiguous";
      candidates: readonly { reference: DurableRef; score: number }[];
    }
  | { kind: "noMatch" };

function classForGeometry(
  entityClass: OnshapeGeometricSignature["entityClass"],
): HistoryProbeTopologySignature["entityClass"] {
  return entityClass;
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function boundingBoxDistance(
  a: { low: [number, number, number]; high: [number, number, number] },
  b: { low: [number, number, number]; high: [number, number, number] },
): number {
  return Math.max(distance(a.low, b.low), distance(a.high, b.high));
}

/**
 * Match one captured signature against a set of probe signatures. Deterministic:
 * candidates are ranked by combined centroid + bbox score; ties within
 * tolerance are ambiguous rather than arbitrarily resolved.
 */
export function matchSignature(
  captured: OnshapeGeometricSignature,
  probeSignatures: readonly HistoryProbeTopologySignature[],
  tolerance: SignatureMatchTolerance = DEFAULT_MATCH_TOLERANCE,
): SignatureMatchOutcome {
  const targetClass = classForGeometry(captured.entityClass);
  const targetType = captured.geometryType.toUpperCase();

  const candidates: { reference: DurableRef; score: number }[] = [];

  for (const probe of probeSignatures) {
    if (probe.entityClass !== targetClass) {
      continue;
    }
    if (probe.geometryType.toUpperCase() !== targetType) {
      continue;
    }

    let score = 0;
    let withinTolerance = true;

    if (captured.centroid && probe.centroid) {
      const centroidDistance = distance(captured.centroid, probe.centroid);
      if (centroidDistance > tolerance.centroid) {
        withinTolerance = false;
      }
      score += centroidDistance;
    }

    if (captured.boundingBox && probe.boundingBox) {
      const bboxDistance = boundingBoxDistance(
        captured.boundingBox,
        probe.boundingBox,
      );
      if (bboxDistance > tolerance.boundingBox) {
        withinTolerance = false;
      }
      score += bboxDistance;
    }

    if (withinTolerance) {
      candidates.push({ reference: probe.reference, score });
    }
  }

  if (candidates.length === 0) {
    return { kind: "noMatch" };
  }

  candidates.sort((a, b) => a.score - b.score);

  // A clear unique winner requires the runner-up to be outside tolerance
  // margin; otherwise symmetric/dense geometry is genuinely ambiguous.
  if (candidates.length === 1) {
    return { kind: "unique", reference: candidates[0]!.reference, score: candidates[0]!.score };
  }

  const [best, second] = candidates;
  const margin = tolerance.centroid + tolerance.boundingBox;
  if (best && second && second.score - best.score > margin) {
    return { kind: "unique", reference: best.reference, score: best.score };
  }

  return { kind: "ambiguous", candidates };
}
