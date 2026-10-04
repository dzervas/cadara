import type { SketchEntityId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

/**
 * Shared offset diagnostics and the closed-form 2D offset helpers of the
 * sketch layer.
 *
 * The certified offset route (`offset-chain-topology.ts`,
 * `offset-derivation-frame.ts`) owns every derived offset chain ([TECH] D3);
 * it reuses the diagnostic codes, the failure shape and the line/arc helpers
 * below, as do the static projected line/arc offsets and the line/arc Slots
 * (`operations.ts`). This module must stay free of domain/application
 * imports.
 */

export const OFFSET_DIAGNOSTIC_CODES = {
  arcCollapse: "derived-offset-arc-collapse",
  splineFitFailure: "derived-offset-spline-fit-failure",
  disconnectedChain: "derived-offset-disconnected-chain",
  unsupportedSeed: "derived-offset-unsupported-seed",
  unresolvedDistance: "derived-offset-unresolved-distance",
  jointUnsatisfied: "derived-offset-joint-unsatisfied",
  derivativeUnavailable: "derived-offset-derivative-unavailable",
  topologyUncertain: "derived-offset-topology-uncertain",
  topologyChanged: "derived-offset-topology-changed",
  /** Temporary: fallback-arc and tangent-continuous joints with a spline side. */
  splineJointUnsupported: "derived-offset-spline-joint-unsupported",
  /** Certified error tubes overlap: true-offset separation is not proved (never "unstable"). */
  topologyClearanceUnproven: "derived-offset-topology-clearance-unproven",
  /** A declared join's true-offset endpoints are not proved exactly identical. */
  knotIncidenceUnproven: "derived-offset-knot-incidence-unproven",
  /** Chains or joins outside the tube-stability certificate's supported scope. */
  topologyStabilityUnsupported: "derived-offset-topology-stability-unsupported",
  /** T10i (C5): a line output is shorter than the modeling tolerance τ. */
  outputDegenerate: "derived-offset-output-degenerate",
  /** T10i (A-1): a seed is a non-accepted offset output (offset of a non-certified offset). */
  seedNotCertified: "derived-offset-seed-not-certified",
} as const;

export type OffsetDiagnosticCode =
  (typeof OFFSET_DIAGNOSTIC_CODES)[keyof typeof OFFSET_DIAGNOSTIC_CODES];

export interface OffsetChainFailure {
  ok: false;
  code: OffsetDiagnosticCode;
  message: string;
  seedEntityId: SketchEntityId | null;
}

/** Directions no longer than this are degenerate (no unit normal). */
const EPSILON = 1e-6;

function add(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

function subtract(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function scale(vector: SketchPoint2D, scalar: number): SketchPoint2D {
  return [vector[0] * scalar, vector[1] * scalar];
}

function normalize(vector: SketchPoint2D): SketchPoint2D | null {
  const length = Math.hypot(vector[0], vector[1]);
  return length <= EPSILON ? null : [vector[0] / length, vector[1] / length];
}

function leftNormal(vector: SketchPoint2D): SketchPoint2D | null {
  const unit = normalize(vector);
  return unit ? [-unit[1], unit[0]] : null;
}

/** Offsets both endpoints of a line to the left of start->end by `distance`. */
export function offsetLinePoints(
  start: SketchPoint2D,
  end: SketchPoint2D,
  distance: number,
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  const normal = leftNormal(subtract(end, start));
  if (!normal) {
    return null;
  }

  const offset = scale(normal, distance);
  return { start: add(start, offset), end: add(end, offset) };
}

/** Repositions `point` on the ray from `center` through `point` at `radius`. */
export function scalePointFromCenter(
  center: SketchPoint2D,
  point: SketchPoint2D,
  radius: number,
): SketchPoint2D | null {
  const direction = normalize(subtract(point, center));
  return direction ? add(center, scale(direction, radius)) : null;
}
