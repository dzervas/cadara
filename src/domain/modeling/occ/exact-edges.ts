import type { SketchPoint2D } from "@/contracts/sketch/schema";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import type { CanonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  cross,
  mapSketchPointToWorld,
  toGpDir,
  toGpPnt,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import { deleteOccObject } from "@/domain/modeling/occ/memory";

type OccEdge = InstanceType<OpenCascadeInstance["TopoDS_Edge"]>;
type OccVertex = InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>;

/**
 * World circle carrying an arc edge: `C(θ) = center + r(cos θ·xAxis + sin θ·(normal × xAxis))`,
 * which is exactly OCC's `gp_Circ` on `gp_Ax2(center, normal, xAxis)`.
 */
export interface OccCircleSupport {
  center: Vec3;
  normal: Vec3;
  xAxis: Vec3;
  radius: number;
}

const TAU = 2 * Math.PI;

/**
 * Counter-clockwise source interval of a point-defined arc, as the region
 * arrangement's `arcDraft` derives it (centre + `atan2` of the solved start and
 * end; a clockwise arc is the reversed traversal of [end, start]). Never a refit.
 */
export function arcSourceInterval(
  support: Pick<
    CanonicalArcSupport,
    "center" | "start" | "end" | "sweepDirection"
  >,
): readonly [number, number] {
  const angle = (point: SketchPoint2D) =>
    Math.atan2(point[1] - support.center[1], point[0] - support.center[0]);
  const counterClockwise = support.sweepDirection === "counterClockwise";
  const lo = angle(counterClockwise ? support.start : support.end);
  let hi = angle(counterClockwise ? support.end : support.start);
  if (hi <= lo) hi += TAU;
  return [lo, hi];
}

/** The sketch circle (centre, radius) in world space, angles from the plane's x axis. */
export function sketchCircleSupport(
  plane: SketchPlaneDefinition,
  center: SketchPoint2D,
  radius: number,
): OccCircleSupport {
  return {
    center: mapSketchPointToWorld(plane, center),
    normal: plane.frame.normal,
    xAxis: plane.frame.xAxis,
    radius,
  };
}

/** Coordinate scale of a circle's points, for `curveEvaluationRoundingBound`. */
export function circleEvaluationScale(support: OccCircleSupport) {
  return Math.max(...support.center.map(Math.abs)) + support.radius;
}

export function evaluateOccCircle(
  support: OccCircleSupport,
  angle: number,
): Vec3 {
  const yAxis = cross(support.normal, support.xAxis);
  const cos = support.radius * Math.cos(angle);
  const sin = support.radius * Math.sin(angle);
  return [
    support.center[0] + cos * support.xAxis[0] + sin * yAxis[0],
    support.center[1] + cos * support.xAxis[1] + sin * yAxis[1],
    support.center[2] + cos * support.xAxis[2] + sin * yAxis[2],
  ];
}

/**
 * Exact arc edge over the source interval [θ0, θ1] (T10 R4, route P6): the
 * `Geom_Circle` handle of a full `gp_Circ` edge (`BRep_Tool.Curve_2`; the
 * shipped build binds no `Handle_Geom_Circle`/`Handle_Geom_TrimmedCurve`),
 * trimmed by `BRepBuilderAPI_MakeEdge_29/25` at the source angles. OCC may
 * shift θ0 < 0 by 2π (R3), so callers never read the edge parameters back for
 * identity. With vertices, each must already admit its curve end
 * (`admitCurveEndAtVertex`).
 */
export function buildExactArcEdge(
  oc: OpenCascadeInstance,
  support: OccCircleSupport,
  interval: readonly [number, number],
  label: string,
  vertices?: { low: OccVertex; high: OccVertex },
): OccEdge {
  const [low, high] = interval;
  if (!(support.radius > 0) || !Number.isFinite(support.radius))
    throw new Error(`OCC arc for ${label} has a non-positive radius.`);
  if (!(low < high) || !(high - low < TAU))
    throw new Error(`OCC arc for ${label} has an empty or full-turn interval.`);

  const center = toGpPnt(oc, support.center);
  const normal = toGpDir(oc, support.normal);
  const xAxis = toGpDir(oc, support.xAxis);
  const axis = new oc.gp_Ax2_2(center, normal, xAxis);
  const circle = new oc.gp_Circ_2(axis, support.radius);
  const fullBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circle);
  let fullEdge: OccEdge | null = null;
  let curve: InstanceType<OpenCascadeInstance["Handle_Geom_Curve"]> | null =
    null;
  let builder: InstanceType<
    OpenCascadeInstance["BRepBuilderAPI_MakeEdge"]
  > | null = null;
  try {
    fullEdge = fullBuilder.Edge();
    curve = oc.BRep_Tool.Curve_2(fullEdge, 0, 0);
    builder = vertices
      ? new oc.BRepBuilderAPI_MakeEdge_29(
          curve,
          vertices.low,
          vertices.high,
          low,
          high,
        )
      : new oc.BRepBuilderAPI_MakeEdge_25(curve, low, high);
    if (!builder.IsDone())
      throw new Error(`Failed to build OCC arc for ${label}.`);
    return builder.Edge();
  } finally {
    deleteOccObject(builder);
    deleteOccObject(curve);
    deleteOccObject(fullEdge);
    deleteOccObject(fullBuilder);
    deleteOccObject(circle);
    deleteOccObject(axis);
    deleteOccObject(xAxis);
    deleteOccObject(normal);
    deleteOccObject(center);
  }
}

/**
 * Rounding bound for two binary64 evaluations (ours and OCC's) of one curve
 * point whose coordinates and radius are at most `scale` in magnitude: a few
 * dozen ulps, absolute, so it holds at any coordinate size (review A1). It is a
 * numeric safeguard, never a semantic tolerance: the cap stays the bound.
 */
export function curveEvaluationRoundingBound(scale: number) {
  return 64 * Number.EPSILON * Math.max(scale, Number.MIN_VALUE);
}

/**
 * Vertex handoff (T10 T-3, R6, A1). The edge end's exact curve value
 * `curveEnd` may differ from the shared vertex's position (a join
 * representative, an intersection witness position, a solver residual). The
 * measured gap is compared with `cap` BEFORE any widening, so a gap above the
 * cap fails closed with `profile-vertex-gap-exceeds-join`. Otherwise the
 * vertex tolerance becomes the gap plus the rounding bound, clamped at the cap
 * (`BRep_Builder.UpdateVertex_1` only ever raises a tolerance). A gap within
 * OCC's default vertex tolerance leaves the vertex untouched. No ShapeFix,
 * sewing or SameParameter widening.
 */
export function admitCurveEndAtVertex(
  oc: OpenCascadeInstance,
  vertex: OccVertex,
  curveEnd: Vec3,
  cap: number,
  scale: number,
  label: string,
) {
  const point = oc.BRep_Tool.Pnt(vertex);
  try {
    const gap = Math.hypot(
      curveEnd[0] - point.X(),
      curveEnd[1] - point.Y(),
      curveEnd[2] - point.Z(),
    );
    if (!(gap <= cap))
      throw new Error(
        `profile-vertex-gap-exceeds-join: The end of ${label} lies ${gap} from its boundary vertex, beyond the vertex's admitted ${cap}.`,
      );
    const tolerance = Math.min(gap + curveEvaluationRoundingBound(scale), cap);
    if (tolerance <= oc.BRep_Tool.Tolerance_3(vertex)) return;
    const builder = new oc.BRep_Builder();
    try {
      builder.UpdateVertex_1(vertex, point, tolerance);
    } finally {
      deleteOccObject(builder);
    }
  } finally {
    deleteOccObject(point);
  }
}

export function reverseOccEdge(
  oc: OpenCascadeInstance,
  edge: OccEdge,
): OccEdge {
  const reversed = edge.Reversed();
  try {
    return oc.TopoDS.Edge_1(reversed);
  } finally {
    deleteOccObject(reversed);
  }
}

/**
 * Edge of a point-defined sketch arc (an authored arc's solved support, E7),
 * oriented from its start to its end. With shared `ends`, each vertex admits
 * its curve end under `cap` first.
 */
export function buildSketchArcEdge(
  oc: OpenCascadeInstance,
  plane: SketchPlaneDefinition,
  arc: CanonicalArcSupport,
  label: string,
  ends?: { start: OccVertex; end: OccVertex; cap: number },
): OccEdge {
  const support = sketchCircleSupport(plane, arc.center, arc.radius);
  const interval = arcSourceInterval(arc);
  const counterClockwise = arc.sweepDirection === "counterClockwise";
  let vertices: { low: OccVertex; high: OccVertex } | undefined;
  if (ends) {
    vertices = counterClockwise
      ? { low: ends.start, high: ends.end }
      : { low: ends.end, high: ends.start };
    const scale = circleEvaluationScale(support);
    admitCurveEndAtVertex(
      oc,
      vertices.low,
      evaluateOccCircle(support, interval[0]),
      ends.cap,
      scale,
      label,
    );
    admitCurveEndAtVertex(
      oc,
      vertices.high,
      evaluateOccCircle(support, interval[1]),
      ends.cap,
      scale,
      label,
    );
  }
  const edge = buildExactArcEdge(oc, support, interval, label, vertices);
  if (counterClockwise) return edge;
  try {
    return reverseOccEdge(oc, edge);
  } finally {
    deleteOccObject(edge);
  }
}
