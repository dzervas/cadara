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
import {
  combineOccCleanupError,
  releaseOccObjects,
  type OccDisposable,
} from "@/domain/modeling/occ/memory";

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
 * OCC's `Precision::Confusion()` (1e-7), its linear resolution. The shipped
 * build binds no `Precision`, so the value is stated here; a curve below it is
 * a kernel-reported limit (R12), never a sketch-side threshold.
 */
export const OCC_PRECISION_CONFUSION = 1e-7;

/** R12: an edge OCC cannot represent (not built, degenerate, radius below `Precision::Confusion`). */
export function edgeBelowKernelResolution(label: string, reason: string) {
  return new Error(
    `profile-edge-below-kernel-resolution: The edge of ${label} ${reason}.`,
  );
}

/**
 * Runs `work` with an `own` registrar for its OCC temporaries and releases
 * them all with one `releaseOccObjects` afterwards (T10c review R-1): a
 * failed release is an `OccCleanupError` (the wrapper is retained for
 * retry), combined with a primary error from `work`; when `work` succeeded,
 * the returned wrapper (if it is one) is released too before the cleanup
 * error is rethrown, so nothing escapes a failed build.
 */
export function withOccTemporaries<T>(
  work: (own: <V extends OccDisposable>(value: V) => V) => T,
): T {
  const owned: OccDisposable[] = [];
  const own = <V extends OccDisposable>(value: V) => {
    owned.push(value);
    return value;
  };
  let result: T;
  try {
    result = work(own);
  } catch (error) {
    try {
      releaseOccObjects(owned);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  try {
    releaseOccObjects(owned);
  } catch (cleanupError) {
    if (typeof result === "object" && result !== null && "delete" in result) {
      try {
        releaseOccObjects([result as OccDisposable]);
      } catch (resultCleanupError) {
        throw combineOccCleanupError(cleanupError, resultCleanupError);
      }
    }
    throw cleanupError;
  }
  return result;
}

/**
 * The edge of a done `BRepBuilderAPI_MakeEdge`, failing closed on what the
 * kernel reports (R12): not done, or `BRep_Tool.Degenerated`. The edge is
 * released on every failing path.
 */
function kernelEdge(
  oc: OpenCascadeInstance,
  builder: InstanceType<OpenCascadeInstance["BRepBuilderAPI_MakeEdge"]>,
  label: string,
): OccEdge {
  if (!builder.IsDone())
    throw edgeBelowKernelResolution(label, "was not built by OCC");
  const edge = builder.Edge();
  try {
    if (oc.BRep_Tool.Degenerated(edge))
      throw edgeBelowKernelResolution(label, "is degenerate in OCC");
  } catch (error) {
    try {
      releaseOccObjects([edge]);
    } catch (cleanupError) {
      throw combineOccCleanupError(error, cleanupError);
    }
    throw error;
  }
  return edge;
}

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
 * (`admitCurveEndAtVertex`). A full turn is an arc only through one shared
 * vertex (`low === high`: a circle touching the boundary at one vertex),
 * `MakeEdge_29(h, V, V, θ, θ + 2π)`. A radius below `Precision::Confusion`,
 * or an edge OCC does not build or builds degenerate, fails closed with
 * `profile-edge-below-kernel-resolution` (R12).
 */
export function buildExactArcEdge(
  oc: OpenCascadeInstance,
  support: OccCircleSupport,
  interval: readonly [number, number],
  label: string,
  vertices?: { low: OccVertex; high: OccVertex },
): OccEdge {
  const [low, high] = interval;
  if (
    !(support.radius >= OCC_PRECISION_CONFUSION) ||
    !Number.isFinite(support.radius)
  )
    throw edgeBelowKernelResolution(
      label,
      `has radius ${support.radius}, below OCC's Precision::Confusion (${OCC_PRECISION_CONFUSION})`,
    );
  const closedThroughOneVertex =
    vertices !== undefined && vertices.low === vertices.high;
  if (
    !(low < high) ||
    !(closedThroughOneVertex ? high - low <= TAU : high - low < TAU)
  )
    // A malformed record interval: a known profile failure (review A-4).
    throw Object.assign(
      new Error(`OCC arc for ${label} has an empty or full-turn interval.`),
      { code: "profile-face-invalid" as const },
    );

  return withOccTemporaries((own) => {
    const axis = own(
      new oc.gp_Ax2_2(
        own(toGpPnt(oc, support.center)),
        own(toGpDir(oc, support.normal)),
        own(toGpDir(oc, support.xAxis)),
      ),
    );
    const circle = own(new oc.gp_Circ_2(axis, support.radius));
    const fullEdge = own(own(new oc.BRepBuilderAPI_MakeEdge_8(circle)).Edge());
    const curve = own(oc.BRep_Tool.Curve_2(fullEdge, 0, 0));
    const builder = own(
      vertices
        ? new oc.BRepBuilderAPI_MakeEdge_29(
            curve,
            vertices.low,
            vertices.high,
            low,
            high,
          )
        : new oc.BRepBuilderAPI_MakeEdge_25(curve, low, high),
    );
    return kernelEdge(oc, builder, label);
  });
}

/** World point of the Bézier curve with `poles` at u ∈ [0, 1] (de Casteljau). */
export function evaluateOccBezier(poles: readonly Vec3[], u: number): Vec3 {
  let level = poles.map((pole) => [...pole] as Vec3);
  while (level.length > 1)
    level = level.slice(1).map((next, index) => {
      const previous = level[index]!;
      return [
        previous[0] + u * (next[0] - previous[0]),
        previous[1] + u * (next[1] - previous[1]),
        previous[2] + u * (next[2] - previous[2]),
      ];
    });
  return level[0]!;
}

/** Coordinate scale of a Bézier curve's points (its pole box), for `curveEvaluationRoundingBound`. */
export function bezierEvaluationScale(poles: readonly Vec3[]) {
  return Math.max(...poles.flatMap((pole) => pole.map(Math.abs)));
}

/**
 * Exact Bézier edge (T10 §2.2, feasibility route): `Geom_BezierCurve_1` on
 * the given world poles, its ownership transferred to a `Handle_Geom_Curve_2`,
 * trimmed by `BRepBuilderAPI_MakeEdge_29(h, V_lo, V_hi, u_lo, u_hi)` at the
 * span-local parameters. No `Segment()` and no `Geom_TrimmedCurve`: the edge
 * range carries the trim, so the poles are never re-computed. Each vertex
 * must already admit its curve end (`admitCurveEndAtVertex`). An edge OCC
 * does not build, or builds degenerate, fails closed with
 * `profile-edge-below-kernel-resolution` (R12).
 */
export function buildExactBezierEdge(
  oc: OpenCascadeInstance,
  poles: readonly Vec3[],
  interval: readonly [number, number],
  label: string,
  vertices: { low: OccVertex; high: OccVertex },
): OccEdge {
  return withOccTemporaries((own) => {
    const array = own(new oc.TColgp_Array1OfPnt_2(1, poles.length));
    poles.forEach((pole, index) =>
      array.SetValue(index + 1, own(toGpPnt(oc, pole))),
    );
    const bezier = new oc.Geom_BezierCurve_1(array);
    let curve: InstanceType<OpenCascadeInstance["Handle_Geom_Curve"]>;
    try {
      // The handle takes intrusive ownership: the raw wrapper is never
      // deleted after a successful transfer (only the handle is).
      curve = own(new oc.Handle_Geom_Curve_2(bezier));
    } catch (error) {
      try {
        releaseOccObjects([bezier]);
      } catch (cleanupError) {
        throw combineOccCleanupError(error, cleanupError);
      }
      throw error;
    }
    const builder = own(
      new oc.BRepBuilderAPI_MakeEdge_29(
        curve,
        vertices.low,
        vertices.high,
        interval[0],
        interval[1],
      ),
    );
    return kernelEdge(oc, builder, label);
  });
}

/**
 * Line edge between two shared vertices (`BRepBuilderAPI_MakeEdge_2`), failing
 * closed with `profile-edge-below-kernel-resolution` when OCC does not build
 * it (R12).
 */
export function buildVertexLineEdge(
  oc: OpenCascadeInstance,
  start: OccVertex,
  end: OccVertex,
  label: string,
): OccEdge {
  return withOccTemporaries((own) =>
    kernelEdge(oc, own(new oc.BRepBuilderAPI_MakeEdge_2(start, end)), label),
  );
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
  // Read on every profile build (snapshot renders included): temporaries are
  // released through `withOccTemporaries`, so a failed release surfaces as an
  // OccCleanupError instead of a plain error a caller would take for a build
  // failure.
  withOccTemporaries((own) => {
    const point = own(oc.BRep_Tool.Pnt(vertex));
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
    if (tolerance > oc.BRep_Tool.Tolerance_3(vertex))
      own(new oc.BRep_Builder()).UpdateVertex_1(vertex, point, tolerance);
  });
}

export function reverseOccEdge(
  oc: OpenCascadeInstance,
  edge: OccEdge,
): OccEdge {
  return withOccTemporaries((own) => oc.TopoDS.Edge_1(own(edge.Reversed())));
}

/** The reversed edge, consuming `edge` (released on every path). */
export function replaceWithReversedEdge(
  oc: OpenCascadeInstance,
  edge: OccEdge,
): OccEdge {
  return withOccTemporaries((own) => reverseOccEdge(oc, own(edge)));
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
  return counterClockwise ? edge : replaceWithReversedEdge(oc, edge);
}
