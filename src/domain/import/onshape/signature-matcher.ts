import type { HistoryProbeTopologySignature } from "@/contracts/import/capabilities";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import type { DurableRef } from "@/contracts/shared/references";

export interface TopologyMatchTolerance {
  linear: number;
  angularRadians: number;
  relative: number;
  ambiguityMargin: number;
}

/** @deprecated Use TopologyMatchTolerance. */
export type SignatureMatchTolerance = TopologyMatchTolerance;

export const DEFAULT_MATCH_TOLERANCE: TopologyMatchTolerance = {
  linear: 1e-4,
  angularRadians: 1e-6,
  relative: 1e-6,
  ambiguityMargin: 1e-6,
};

export interface MatchCandidate {
  reference: DurableRef;
  score: number;
  evidence: readonly string[];
}

export interface MatchRejection {
  reference: DurableRef;
  reasons: readonly string[];
}

export type TopologyMatchOutcome =
  | { kind: "unique"; reference: DurableRef; score: number; evidence: readonly string[] }
  | { kind: "ambiguous"; candidates: readonly MatchCandidate[] }
  | { kind: "noMatch"; rejected: readonly MatchRejection[] };

/** @deprecated Use TopologyMatchOutcome. */
export type SignatureMatchOutcome = TopologyMatchOutcome;

type Point = readonly [number, number, number];

function point(value: unknown): Point | null {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number")
    ? (value as unknown as Point)
    : null;
}

function scalar(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(value: Point): number {
  return Math.sqrt(dot(value, value));
}

function distance(a: Point, b: Point): number {
  return norm(sub(a, b));
}

function unorientedAngle(a: Point, b: Point): number {
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return Number.POSITIVE_INFINITY;
  return Math.acos(Math.min(1, Math.max(-1, Math.abs(dot(a, b) / denominator))));
}

function allowedLinear(a: number, b: number, tolerance: TopologyMatchTolerance): number {
  return tolerance.linear + tolerance.relative * Math.max(Math.abs(a), Math.abs(b));
}

function geometryCompatible(captured: OnshapeGeometricSignature, probe: HistoryProbeTopologySignature): boolean {
  const left = captured.geometryType.toLowerCase();
  const right = probe.geometryType.toLowerCase();
  if (left === "unknown" || right === "unknown") return true;
  if (captured.entityClass === "body") return left === right || right === "solid";
  return left === right;
}

function boxCenter(box: { low: Point; high: Point }): Point {
  return [(box.low[0] + box.high[0]) / 2, (box.low[1] + box.high[1]) / 2, (box.low[2] + box.high[2]) / 2];
}

function boxExtent(box: { low: Point; high: Point }): Point {
  return sub(box.high, box.low);
}

function addVectorGate(input: {
  name: string;
  captured: Point | null;
  probe: Point | null;
  tolerance: TopologyMatchTolerance;
  evidence: string[];
  reasons: string[];
}): number {
  if (!input.captured || !input.probe) return 0;
  const delta = distance(input.captured, input.probe);
  const limit = input.tolerance.linear + input.tolerance.relative * Math.max(norm(input.captured), norm(input.probe));
  if (delta > limit) input.reasons.push(`${input.name}-out-of-tolerance`);
  else input.evidence.push(input.name);
  return delta;
}

function analyticEvidence(
  captured: OnshapeGeometricSignature,
  probe: HistoryProbeTopologySignature,
  tolerance: TopologyMatchTolerance,
  evidence: string[],
  reasons: string[],
): number {
  const left = captured.definingData ?? {};
  const right = probe.definingData ?? {};
  const type = captured.geometryType.toLowerCase();
  let score = 0;

  const directionKeys = type === "plane" ? ["normal"] : type === "line" ? ["direction"] : ["axisDirection"];
  for (const key of directionKeys) {
    const a = point(left[key]);
    const b = point(right[key]);
    if (a && b) {
      const angle = unorientedAngle(a, b);
      if (angle > tolerance.angularRadians) reasons.push(`${key}-angle-out-of-tolerance`);
      else evidence.push(`${key}-angle`);
      score += angle;
    }
  }

  if (type === "plane") {
    const aOrigin = point(left.origin);
    const bOrigin = point(right.origin);
    const normal = point(left.normal) ?? point(right.normal);
    // Legacy callers scaled bbox/centroid but not definingData. Ignore an internally
    // inconsistent plane origin; normalized resolver inputs always take the hard gate.
    const capturedPlaneCoherent = !aOrigin || !captured.centroid || !normal ||
      Math.abs(dot(sub(aOrigin, captured.centroid), normal) / norm(normal)) <= tolerance.linear;
    if (aOrigin && bOrigin && normal && norm(normal) > 0 && capturedPlaneCoherent) {
      const offset = Math.abs(dot(sub(aOrigin, bOrigin), normal) / norm(normal));
      if (offset > tolerance.linear) reasons.push("plane-offset-out-of-tolerance");
      else evidence.push("plane-offset");
      score += offset;
    }
  } else if (type === "line") {
    const aOrigin = point(left.origin);
    const bOrigin = point(right.origin);
    const direction = point(left.direction) ?? point(right.direction);
    if (aOrigin && bOrigin && direction && norm(direction) > 0) {
      const supportDistance = norm(cross(sub(aOrigin, bOrigin), direction)) / norm(direction);
      if (supportDistance > tolerance.linear) reasons.push("line-support-out-of-tolerance");
      else evidence.push("line-support");
      score += supportDistance;
    }
  } else {
    const centerKey = type === "cylinder" || type === "cone" ? "axisOrigin" : "center";
    score += addVectorGate({
      name: centerKey,
      captured: point(left[centerKey]),
      probe: point(right[centerKey]),
      tolerance,
      evidence,
      reasons,
    });
  }

  const aRadius = scalar(left.radius);
  const bRadius = scalar(right.radius);
  if (aRadius !== null && bRadius !== null) {
    const delta = Math.abs(aRadius - bRadius);
    if (delta > allowedLinear(aRadius, bRadius, tolerance)) reasons.push("radius-out-of-tolerance");
    else evidence.push("radius");
    score += delta;
  }
  if (type === "point") {
    score += addVectorGate({
      name: "point",
      captured: point(left.point) ?? captured.centroid ?? null,
      probe: point(right.point) ?? probe.centroid ?? null,
      tolerance,
      evidence,
      reasons,
    });
  }
  return score;
}

function bboxEvidence(
  captured: OnshapeGeometricSignature,
  probe: HistoryProbeTopologySignature,
  tolerance: TopologyMatchTolerance,
  evidence: string[],
  reasons: string[],
  soft: boolean,
): number {
  if (!captured.boundingBox || !probe.boundingBox) return 0;
  const centerDistance = distance(boxCenter(captured.boundingBox), boxCenter(probe.boundingBox));
  const capturedExtent = boxExtent(captured.boundingBox);
  const probeExtent = boxExtent(probe.boundingBox);
  const extentDistance = distance(capturedExtent, probeExtent);
  const scale = Math.max(norm(capturedExtent), norm(probeExtent));
  const limit = tolerance.linear + tolerance.relative * scale;
  if (!soft && (centerDistance > limit || extentDistance > limit)) reasons.push("bounding-box-out-of-tolerance");
  else evidence.push(soft ? "bounding-box-soft" : "bounding-box");
  return centerDistance + extentDistance;
}

/** Match one normalized captured signature. Every plausible tie remains ambiguous. */
export function matchSignature(
  captured: OnshapeGeometricSignature,
  probeSignatures: readonly HistoryProbeTopologySignature[],
  tolerance: TopologyMatchTolerance = DEFAULT_MATCH_TOLERANCE,
): TopologyMatchOutcome {
  const candidates: MatchCandidate[] = [];
  const rejected: MatchRejection[] = [];

  for (const probe of probeSignatures) {
    const reasons: string[] = [];
    const evidence: string[] = [];
    if (probe.entityClass !== captured.entityClass) reasons.push("entity-class-mismatch");
    if (probe.reference.kind !== captured.entityClass) reasons.push("durable-ref-kind-mismatch");
    if (!geometryCompatible(captured, probe)) reasons.push("geometry-family-mismatch");

    let score = analyticEvidence(captured, probe, tolerance, evidence, reasons);
    const analyticCircle = captured.geometryType.toLowerCase() === "circle" &&
      scalar(captured.definingData?.radius) !== null && scalar(probe.definingData?.radius) !== null;
    score += bboxEvidence(captured, probe, tolerance, evidence, reasons, analyticCircle);
    if (captured.centroid && probe.centroid && !captured.boundingBox) {
      score += addVectorGate({ name: "centroid", captured: captured.centroid, probe: probe.centroid, tolerance, evidence, reasons });
    }
    if (evidence.length === 0) reasons.push("insufficient-geometric-evidence");

    if (reasons.length > 0) rejected.push({ reference: probe.reference, reasons });
    else candidates.push({ reference: probe.reference, score, evidence });
  }

  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length === 0) return { kind: "noMatch", rejected };
  if (candidates.length === 1) {
    const winner = candidates[0]!;
    return { kind: "unique", reference: winner.reference, score: winner.score, evidence: winner.evidence };
  }
  const best = candidates[0]!;
  const second = candidates[1]!;
  if (second.score - best.score > tolerance.ambiguityMargin) {
    return { kind: "unique", reference: best.reference, score: best.score, evidence: best.evidence };
  }
  return { kind: "ambiguous", candidates };
}
