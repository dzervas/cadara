import type { BaseDocumentRequest } from "@/contracts/modeling/schema";
import type { ContractVersion } from "@/contracts/shared/versioning";
import type { RevisionId } from "@/contracts/shared/ids";
import type { BodyRef, EdgeRef, FaceRef } from "@/contracts/shared/references";

/**
 * Exact, kernel-computed measurements of body topology (cadara-h026.5). They
 * are asked for on demand, for the measured targets only: the workspace
 * snapshot carries meshes, never these.
 */
export type TopologyMeasureTarget = BodyRef | FaceRef | EdgeRef;

export type TopologyMeasureVec3 = [number, number, number];

export interface TopologyMeasureAxis {
  origin: TopologyMeasureVec3;
  /** Unit direction. */
  direction: TopologyMeasureVec3;
}

/** An edge's analytic curve type and its defining parameters. */
export type EdgeCurveMeasure =
  | { kind: "line"; direction: TopologyMeasureVec3 }
  | {
      kind: "circle";
      center: TopologyMeasureVec3;
      radius: number;
      /** Unit normal of the circle's plane. */
      axis: TopologyMeasureVec3;
      /** The edge spans the whole circle (otherwise an arc). */
      isFull: boolean;
    }
  | { kind: "ellipse" }
  | { kind: "bspline" }
  | { kind: "other" };

/** A face's analytic surface type and its defining parameters. */
export type FaceSurfaceMeasure =
  | {
      kind: "plane";
      /** Unit outward normal of the face (its orientation applied). */
      normal: TopologyMeasureVec3;
      /** Exact length of the face's boundary edges. */
      perimeter: number;
      /** Every boundary edge is straight, so its mesh is exact. */
      polygonal: boolean;
    }
  | { kind: "cylinder"; radius: number; axis: TopologyMeasureAxis }
  | {
      kind: "cone";
      apex: TopologyMeasureVec3;
      semiAngleRadians: number;
      axis: TopologyMeasureAxis;
    }
  | { kind: "sphere"; center: TopologyMeasureVec3; radius: number }
  | {
      kind: "torus";
      majorRadius: number;
      minorRadius: number;
      axis: TopologyMeasureAxis;
    }
  | { kind: "bspline" }
  | { kind: "other" };

export type TopologyMeasure =
  | { target: EdgeRef; length: number; curve: EdgeCurveMeasure }
  | { target: FaceRef; area: number; surface: FaceSurfaceMeasure }
  | {
      target: BodyRef;
      surfaceArea: number;
      /** Null for a sheet (surface) body. */
      volume: number | null;
    };

export interface MeasureTopologyRequest extends BaseDocumentRequest {
  targets: TopologyMeasureTarget[];
}

export interface MeasureTopologyResponse {
  contractVersion: ContractVersion;
  /** The revision measured; a measure of another revision is stale. */
  revisionId: RevisionId;
  /** One per requested target that resolves to live topology. */
  measures: TopologyMeasure[];
}
