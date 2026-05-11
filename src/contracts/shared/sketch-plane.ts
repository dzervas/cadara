import type { ConstructionRef, FaceRef } from "@/contracts/shared/references";

/**
 * Canonical orientation key for standard datum planes when one exists.
 * Null means the plane is valid but not one of the named primary datums.
 */
export type SketchPlaneKey = "xy" | "yz" | "xz";

/**
 * Sketch-plane coordinate frame shared by solver and modeling contracts.
 * The producer must provide a fully-defined right-handed frame in document units.
 */
export interface SketchPlaneFrame {
  /** World-space origin of the sketch plane expressed in document modeling units. */
  origin: readonly [number, number, number];
  /** Unit vector for the sketch-space positive X axis expressed in world space. */
  xAxis: readonly [number, number, number];
  /** Unit vector for the sketch-space positive Y axis expressed in world space. */
  yAxis: readonly [number, number, number];
  /** Unit vector normal to the sketch plane following the declared handedness. */
  normal: readonly [number, number, number];
  /** World-space unit convention for all coordinates and tolerances in this request. */
  linearUnit: "documentLength";
  /** Declares the orientation convention of `xAxis`, `yAxis`, and `normal`. */
  handedness: "rightHanded";
}

/**
 * Planar support accepted by sketch commits and snapshots.
 * The target must resolve to one explicit planar construction or face.
 */
export type SketchPlaneSupportRef = ConstructionRef | FaceRef;

/**
 * Full sketch placement contract shared by commit requests and snapshots.
 * Kernel implementers must be able to embed sketch-space coordinates from this
 * record alone without consulting editor-only conventions.
 */
export interface SketchPlaneDefinition {
  /** Explicit planar support that owns the sketch placement. */
  support: SketchPlaneSupportRef;
  /** Full world-space embedding of the sketch plane. */
  frame: SketchPlaneFrame;
  /** Optional named primary-datum key used only for presentation helpers. */
  key: SketchPlaneKey | null;
}
