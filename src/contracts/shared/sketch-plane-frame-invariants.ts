import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";
import type { ContractValidationIssue } from "@/contracts/shared/validation";

/**
 * Plain-TypeScript orthonormal right-handed frame invariant shared by the
 * modeling contract, the OCC adapter, and the mock adapter. Typia validates the
 * structural shape of a {@link SketchPlaneFrame}; this invariant enforces the
 * geometric contract Typia cannot express: unit-length, mutually orthogonal
 * axes forming a right-handed basis whose cross product matches the declared
 * normal. Degenerate frames are rejected loudly rather than silently
 * re-orthonormalized (see design D1 / risk on frame tolerance).
 */

/** Absolute tolerance for unit-length, orthogonality, and handedness checks. */
export const SKETCH_PLANE_FRAME_TOLERANCE = 1e-6;

type Vec3 = readonly [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export interface SketchPlaneFrameInvariantResult {
  ok: boolean;
  /** Machine-readable reason when `ok` is false. */
  reason: string | null;
}

/**
 * Validate that a frame is orthonormal and right-handed within tolerance.
 * Returns a structured result with a machine-readable reason on failure.
 */
export function validateSketchPlaneFrameInvariants(
  frame: SketchPlaneFrame,
  tolerance = SKETCH_PLANE_FRAME_TOLERANCE,
): SketchPlaneFrameInvariantResult {
  const axes: readonly (readonly [string, Vec3])[] = [
    ["xAxis", frame.xAxis],
    ["yAxis", frame.yAxis],
    ["normal", frame.normal],
  ];

  for (const [name, axis] of axes) {
    if (!axis.every((component) => Number.isFinite(component))) {
      return { ok: false, reason: `frame-axis-non-finite:${name}` };
    }
    if (Math.abs(length(axis) - 1) > tolerance) {
      return { ok: false, reason: `frame-axis-not-unit-length:${name}` };
    }
  }

  if (Math.abs(dot(frame.xAxis, frame.yAxis)) > tolerance) {
    return { ok: false, reason: "frame-axes-not-orthogonal:xAxis-yAxis" };
  }
  if (Math.abs(dot(frame.xAxis, frame.normal)) > tolerance) {
    return { ok: false, reason: "frame-axes-not-orthogonal:xAxis-normal" };
  }
  if (Math.abs(dot(frame.yAxis, frame.normal)) > tolerance) {
    return { ok: false, reason: "frame-axes-not-orthogonal:yAxis-normal" };
  }

  const expectedNormal = cross(frame.xAxis, frame.yAxis);
  const handednessError = Math.hypot(
    expectedNormal[0] - frame.normal[0],
    expectedNormal[1] - frame.normal[1],
    expectedNormal[2] - frame.normal[2],
  );
  if (handednessError > tolerance) {
    return { ok: false, reason: "frame-not-right-handed" };
  }

  return { ok: true, reason: null };
}

/**
 * Contract-validation adapter: returns a `ContractValidationIssue[]` describing
 * a degenerate frame, or an empty array when the frame is orthonormal.
 */
export function validateSketchPlaneFrameContractInvariants(
  frame: SketchPlaneFrame,
  path: string,
): ContractValidationIssue[] {
  const result = validateSketchPlaneFrameInvariants(frame);
  if (result.ok) {
    return [];
  }
  return [
    {
      path,
      expected: "orthonormal right-handed frame",
      value: result.reason,
      message: `Explicit plane frame is degenerate (${result.reason}).`,
    },
  ];
}
