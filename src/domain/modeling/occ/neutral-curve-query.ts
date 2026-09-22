import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurveInFrame,
  getNeutralCurveActiveDomain,
  getNeutralCurveLocalScale,
  hasExactStructuralCubicActiveOverlap,
  haveExactStructuralCubicBasis,
  neutralCurveParameterInside,
  proveStructuralCubicOverlap,
  validateNeutralCurveQueryRequest,
  type NeutralCurve,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryCapability,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
  type NeutralCurveSelfIntersectionRequest,
} from "@/contracts/modeling/neutral-curve-query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

interface Deletable {
  delete(): void;
}
interface Point2d extends Deletable {
  X(): number;
  Y(): number;
}
interface GeomCircle extends Deletable {
  Circ2d(): Deletable;
}
interface NativeIntersectionPoint extends Deletable {
  ParamOnFirst(): number;
  ParamOnSecond(): number;
  Value(): Point2d;
}
interface NativeIntersection extends Deletable {
  IsDone(): boolean;
  IsEmpty(): boolean;
  IdenticalElements?(): boolean;
  NbPoints(): number;
  Point(index: number): NativeIntersectionPoint;
}
interface ParametricIntersection extends NativeIntersection {
  NbSegments(): number;
}
interface PointArray extends Deletable {
  SetValue(index: number, value: Point2d): void;
}
type CurveHandle = Deletable;
type CurveAdaptor = Deletable;
type Constructor<T> = new (...args: unknown[]) => T;

type NeutralOccBindings = OpenCascadeInstance & {
  gp_Pnt2d_3?: Constructor<Point2d>;
  gp_Dir2d_4?: Constructor<Deletable>;
  gp_Ax2d_2?: Constructor<Deletable>;
  Geom2d_Circle_2?: Constructor<GeomCircle>;
  IntAna2d_AnaIntersection_3?: Constructor<NativeIntersection>;
  IntAna2d_IntPoint?: Constructor<NativeIntersectionPoint>;
  gp_Circ2d?: Constructor<Deletable>;
  Geom2d_Line_3?: Constructor<Deletable>;
  TColgp_Array1OfPnt2d_2?: Constructor<PointArray>;
  Geom2d_BezierCurve_1?: Constructor<Deletable>;
  Handle_Geom2d_Curve_2?: Constructor<CurveHandle>;
  Geom2dAdaptor_Curve_2?: Constructor<CurveAdaptor>;
  Geom2dInt_GInter_4?: Constructor<ParametricIntersection>;
  IntRes2d_Intersection?: Constructor<ParametricIntersection>;
  IntRes2d_IntersectionPoint?: Constructor<NativeIntersectionPoint>;
  IntRes2d_IntersectionSegment?: Constructor<Deletable>;
};

const ANALYTIC_CIRCLE_BINDINGS = [
  "gp_Pnt2d_3",
  "gp_Dir2d_4",
  "gp_Ax2d_2",
  "Geom2d_Circle_2",
  "IntAna2d_AnaIntersection_3",
  "IntAna2d_IntPoint",
  "gp_Circ2d",
] as const;

const PARAMETRIC_QUERY_BINDINGS = [
  "gp_Pnt2d_3",
  "Handle_Geom2d_Curve_2",
  "Geom2dAdaptor_Curve_2",
  "Geom2dInt_GInter_4",
  "IntRes2d_Intersection",
  "IntRes2d_IntersectionPoint",
  "IntRes2d_IntersectionSegment",
] as const;

const CURVE_CONSTRUCTION_BINDINGS = {
  line: ["gp_Dir2d_4", "Geom2d_Line_3"],
  circle: ["gp_Dir2d_4", "gp_Ax2d_2", "Geom2d_Circle_2"],
  cubicBezier: ["TColgp_Array1OfPnt2d_2", "Geom2d_BezierCurve_1"],
} as const;

/** Exact additional symbols needed by a future coordinated production stage. */
export const OCC_NEUTRAL_CURVE_QUERY_REQUIRED_NEW_SYMBOLS = [
  "IntAna2d_AnaIntersection",
  "IntAna2d_IntPoint",
  "gp_Circ2d",
] as const;

function unsupported(code: string, message: string): NeutralCurveQueryResult {
  return { kind: "unsupported", code, message };
}

function uncertain(code: string, message: string): NeutralCurveQueryResult {
  return { kind: "uncertain", code, message };
}

function missingBindings(
  oc: NeutralOccBindings,
  names: readonly (keyof NeutralOccBindings)[],
) {
  return names.filter((name) => typeof oc[name] !== "function");
}

function withOwned<T>(
  operation: (own: <V extends Deletable>(value: V) => V) => T,
): T {
  const owned: Deletable[] = [];
  const own = <V extends Deletable>(value: V) => {
    owned.push(value);
    return value;
  };
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = operation(own);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  const cleanupErrors: unknown[] = [];
  for (const value of owned.reverse()) {
    try {
      value.delete();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (operationFailed || cleanupErrors.length > 0) {
    throw new AggregateError(
      operationFailed ? [operationError, ...cleanupErrors] : cleanupErrors,
      "OCC neutral-curve query or cleanup failed.",
    );
  }
  return result as T;
}

function liftCircleParameter(
  parameter: number,
  domain: readonly [number, number],
): number | null {
  const period = Math.PI * 2;
  const minimumTurn = Math.ceil((domain[0] - parameter) / period);
  const maximumTurn = Math.floor((domain[1] - parameter) / period);
  if (minimumTurn > maximumTurn) return null;
  const midpoint = (domain[0] + domain[1]) / 2;
  const turn = Math.max(
    minimumTurn,
    Math.min(maximumTurn, Math.round((midpoint - parameter) / period)),
  );
  return parameter + turn * period;
}

function sourceParameter(
  curve: NeutralCurve,
  nativeParameter: number,
): number | null {
  const active = getNeutralCurveActiveDomain(curve);
  if (curve.kind === "circle") {
    return liftCircleParameter(nativeParameter, active);
  }
  const source =
    curve.kind === "cubicBezier"
      ? curve.sourceDomain[0] +
        nativeParameter * (curve.sourceDomain[1] - curve.sourceDomain[0])
      : nativeParameter;
  return neutralCurveParameterInside(source, active) ? source : null;
}

function checkedPoints(
  request: NeutralCurveQueryRequest,
  points: readonly NeutralCurvePointWitness[],
): NeutralCurveQueryResult {
  for (const point of points) {
    const inconsistency = checkNeutralCurvePointConsistency(request, point);
    if (inconsistency) return inconsistency;
  }
  return { kind: "verified", points, overlaps: [] };
}

function queryAnalyticCircles(
  oc: NeutralOccBindings,
  request: NeutralCurveQueryRequest & {
    first: Extract<NeutralCurve, { kind: "circle" }>;
    second: Extract<NeutralCurve, { kind: "circle" }>;
  },
): NeutralCurveQueryResult {
  return withOwned((own) => {
    const Point = oc.gp_Pnt2d_3!;
    const Direction = oc.gp_Dir2d_4!;
    const Axis = oc.gp_Ax2d_2!;
    const Circle = oc.Geom2d_Circle_2!;
    const Intersection = oc.IntAna2d_AnaIntersection_3!;
    const makeCircle = (curve: Extract<NeutralCurve, { kind: "circle" }>) => {
      const axis = own(
        new Axis(
          own(new Point(curve.center[0], curve.center[1])),
          own(new Direction(curve.xAxis[0], curve.xAxis[1])),
        ),
      );
      const geometry = own(new Circle(axis, curve.radius, true));
      return own(geometry.Circ2d());
    };
    const intersection = own(
      new Intersection(makeCircle(request.first), makeCircle(request.second)),
    );
    if (!intersection.IsDone()) {
      return uncertain(
        "occ-neutral-curve-query-not-done",
        "OCC analytic circle query did not complete.",
      );
    }
    if (intersection.IdenticalElements?.()) {
      return uncertain(
        "occ-neutral-curve-identical-elements",
        "OCC reported identical circles without bounded source-parameter correspondence proof.",
      );
    }
    if (intersection.IsEmpty()) {
      return { kind: "verified", points: [], overlaps: [] };
    }
    const nativeCount = intersection.NbPoints();
    const points: NeutralCurvePointWitness[] = [];
    for (let index = 1; index <= nativeCount; index += 1) {
      const point = own(intersection.Point(index));
      const firstParameter = sourceParameter(
        request.first,
        point.ParamOnFirst(),
      );
      const secondParameter = sourceParameter(
        request.second,
        point.ParamOnSecond(),
      );
      if (firstParameter === null || secondParameter === null) continue;
      const position = own(point.Value());
      points.push({
        classification: nativeCount === 1 ? "tangent" : "crossing",
        firstParameter,
        secondParameter,
        position: [position.X(), position.Y()],
        proof: { kind: "nativeAnalyticCircleIntersection" },
      });
    }
    return checkedPoints(request, points);
  });
}

function makeNativeCurve(
  oc: NeutralOccBindings,
  curve: NeutralCurve,
  own: <V extends Deletable>(value: V) => V,
): CurveHandle {
  const Point = oc.gp_Pnt2d_3!;
  const Direction = oc.gp_Dir2d_4!;
  const Handle = oc.Handle_Geom2d_Curve_2!;
  if (curve.kind === "line") {
    const geometry = new oc.Geom2d_Line_3!(
      own(new Point(curve.origin[0], curve.origin[1])),
      own(new Direction(curve.direction[0], curve.direction[1])),
    );
    return own(new Handle(geometry));
  }
  if (curve.kind === "circle") {
    const axis = own(
      new oc.gp_Ax2d_2!(
        own(new Point(curve.center[0], curve.center[1])),
        own(new Direction(curve.xAxis[0], curve.xAxis[1])),
      ),
    );
    const geometry = new oc.Geom2d_Circle_2!(axis, curve.radius, true);
    return own(new Handle(geometry));
  }
  const poles = own(new oc.TColgp_Array1OfPnt2d_2!(1, 4));
  curve.poles.forEach((pole, index) => {
    poles.SetValue(index + 1, own(new Point(pole[0], pole[1])));
  });
  const geometry = new oc.Geom2d_BezierCurve_1!(poles);
  return own(new Handle(geometry));
}

function lineParameterFromRelativePoint(
  line: Extract<NeutralCurve, { kind: "line" }>,
  point: readonly [number, number],
) {
  return point[0] * line.direction[0] + point[1] * line.direction[1];
}

function lineSideFromRelativePoint(
  line: Extract<NeutralCurve, { kind: "line" }>,
  point: readonly [number, number],
) {
  return line.direction[0] * point[1] - line.direction[1] * point[0];
}

function localizedParameterBounds(
  curve: Exclude<NeutralCurve, { kind: "line" }>,
  parameter: number,
): readonly [number, number] | null {
  const active = getNeutralCurveActiveDomain(curve);
  if (curve.kind === "cubicBezier") {
    const length = curve.sourceDomain[1] - curve.sourceDomain[0];
    const local = (parameter - curve.sourceDomain[0]) / length;
    const localRadius = Number.EPSILON * Math.max(1, Math.abs(local)) * 1_024;
    const mappedLower = curve.sourceDomain[0] + (local - localRadius) * length;
    const mappedUpper = curve.sourceDomain[0] + (local + localRadius) * length;
    const lower = Math.max(active[0], Math.min(parameter, mappedLower));
    const upper = Math.min(active[1], Math.max(parameter, mappedUpper));
    return lower < parameter && parameter < upper ? [lower, upper] : null;
  }
  const radius = Number.EPSILON * Math.max(1, Math.abs(parameter)) * 1_024;
  const lower = Math.max(active[0], parameter - radius);
  const upper = Math.min(active[1], parameter + radius);
  return lower < parameter && parameter < upper ? [lower, upper] : null;
}

/**
 * Conservative projection range over the whole curve. Cubic Bézier geometry
 * lies in its control hull; a circle's projection is center ± radius. Using
 * the whole source curve is intentionally stricter than endpoint projections
 * and therefore also bounds every localized proof bracket.
 */
function lineProjectionBounds(
  line: Extract<NeutralCurve, { kind: "line" }>,
  curve: Exclude<NeutralCurve, { kind: "line" }>,
): readonly [number, number] | null {
  let projections: number[];
  if (curve.kind === "cubicBezier") {
    projections = curve.poles.map((point) =>
      lineParameterFromRelativePoint(line, [
        point[0] - line.origin[0],
        point[1] - line.origin[1],
      ]),
    );
  } else {
    const centerProjection = lineParameterFromRelativePoint(line, [
      curve.center[0] - line.origin[0],
      curve.center[1] - line.origin[1],
    ]);
    projections = [
      centerProjection - curve.radius,
      centerProjection + curve.radius,
    ];
  }
  if (!projections.every(Number.isFinite)) return null;
  const arithmeticBound =
    Number.EPSILON *
    Math.max(
      1,
      Math.abs(line.origin[0]),
      Math.abs(line.origin[1]),
      ...projections.map(Math.abs),
      getNeutralCurveLocalScale(curve),
    ) *
    64;
  return [
    Math.min(...projections) - arithmeticBound,
    Math.max(...projections) + arithmeticBound,
  ];
}

/**
 * Verifies semantic contact without treating native tolerance or residual as
 * proof. It does not search for roots: around an isolated native candidate it
 * proves either exact endpoint incidence or a strict line-side sign change.
 * The latter establishes a transverse incidence inside the recorded bounds by
 * continuity. Interior tangencies and non-line pairs remain unresolved.
 */
function verifyParametricLineIncidence(
  request: NeutralCurveQueryRequest,
  firstParameter: number,
  secondParameter: number,
): Extract<
  NeutralCurvePointWitness["proof"],
  { kind: "nativeParametricCurveIntersection" }
> | null {
  const firstIsLine = request.first.kind === "line";
  let line: Extract<NeutralCurve, { kind: "line" }>;
  let curve: Exclude<NeutralCurve, { kind: "line" }>;
  if (request.first.kind === "line" && request.second.kind !== "line") {
    line = request.first;
    curve = request.second;
  } else if (request.second.kind === "line" && request.first.kind !== "line") {
    line = request.second;
    curve = request.first;
  } else {
    return null;
  }
  const curveParameter = firstIsLine ? secondParameter : firstParameter;
  const curveDomain = getNeutralCurveActiveDomain(curve);
  const lineDomain = getNeutralCurveActiveDomain(line);
  const atBoundary =
    curveParameter === curveDomain[0] || curveParameter === curveDomain[1];
  if (atBoundary) {
    const point = evaluateNeutralCurveInFrame(
      curve,
      curveParameter,
      line.origin,
    );
    const projected = lineParameterFromRelativePoint(line, point);
    const linePoint = neutralCurveParameterInside(projected, lineDomain)
      ? evaluateNeutralCurveInFrame(line, projected, line.origin)
      : null;
    if (linePoint && linePoint[0] === point[0] && linePoint[1] === point[1]) {
      const curveBounds = [curveParameter, curveParameter] as const;
      const lineBounds = [projected, projected] as const;
      return {
        kind: "nativeParametricCurveIntersection",
        verification: "exactEndpointLineIncidence",
        firstParameterBounds: firstIsLine ? lineBounds : curveBounds,
        secondParameterBounds: firstIsLine ? curveBounds : lineBounds,
      };
    }
    return null;
  }

  const localizedBounds = localizedParameterBounds(curve, curveParameter);
  if (!localizedBounds) return null;
  const [lower, upper] = localizedBounds;
  const lowerPoint = evaluateNeutralCurveInFrame(curve, lower, line.origin);
  const upperPoint = evaluateNeutralCurveInFrame(curve, upper, line.origin);
  const lowerSide = lineSideFromRelativePoint(line, lowerPoint);
  const upperSide = lineSideFromRelativePoint(line, upperPoint);
  const signReliabilityBound =
    Number.EPSILON * getNeutralCurveLocalScale(curve) * 128;
  if (
    !Number.isFinite(lowerSide) ||
    !Number.isFinite(upperSide) ||
    Math.abs(lowerSide) <= signReliabilityBound ||
    Math.abs(upperSide) <= signReliabilityBound ||
    Math.sign(lowerSide) === Math.sign(upperSide)
  ) {
    return null;
  }
  const lineBounds = lineProjectionBounds(line, curve);
  if (
    !lineBounds ||
    !neutralCurveParameterInside(lineBounds[0], lineDomain) ||
    !neutralCurveParameterInside(lineBounds[1], lineDomain)
  ) {
    return null;
  }
  const curveBounds = [lower, upper] as const;
  return {
    kind: "nativeParametricCurveIntersection",
    verification: "boundedTransverseLineIncidence",
    firstParameterBounds: firstIsLine ? lineBounds : curveBounds,
    secondParameterBounds: firstIsLine ? curveBounds : lineBounds,
  };
}

function queryParametricCurves(
  oc: NeutralOccBindings,
  request: NeutralCurveQueryRequest,
): NeutralCurveQueryResult {
  return withOwned((own) => {
    const firstHandle = makeNativeCurve(oc, request.first, own);
    const secondHandle = makeNativeCurve(oc, request.second, own);
    const firstAdaptor = own(new oc.Geom2dAdaptor_Curve_2!(firstHandle));
    const secondAdaptor = own(new oc.Geom2dAdaptor_Curve_2!(secondHandle));
    const intersection = own(
      new oc.Geom2dInt_GInter_4!(
        firstAdaptor,
        secondAdaptor,
        request.modelingTolerance,
        request.modelingTolerance,
      ),
    );
    if (!intersection.IsDone()) {
      return uncertain(
        "occ-neutral-curve-query-not-done",
        "OCC parametric curve query did not complete.",
      );
    }
    if (intersection.NbSegments() > 0) {
      return uncertain(
        "occ-neutral-curve-overlap-unproven",
        "OCC returned tolerance-defined segments without complete source-parameter correspondence proof.",
      );
    }
    const nativePointCount = intersection.NbPoints();
    if (nativePointCount === 0) {
      return uncertain(
        "occ-neutral-curve-empty-proof-unavailable",
        "OCC returned no parametric candidates, but this adapter has no independent certificate that the bounded line/curve pair is disjoint.",
      );
    }
    const points: NeutralCurvePointWitness[] = [];
    for (let index = 1; index <= nativePointCount; index += 1) {
      const point = own(intersection.Point(index));
      const firstParameter = sourceParameter(
        request.first,
        point.ParamOnFirst(),
      );
      const secondParameter = sourceParameter(
        request.second,
        point.ParamOnSecond(),
      );
      if (firstParameter === null || secondParameter === null) continue;
      const proof = verifyParametricLineIncidence(
        request,
        firstParameter,
        secondParameter,
      );
      if (!proof) {
        return uncertain(
          "occ-neutral-curve-point-proof-unavailable",
          "An isolated OCC parametric candidate lacked independent bounded incidence proof; native labels and residual proximity are not semantic contact proof.",
        );
      }
      const position = own(point.Value());
      points.push({
        classification:
          proof.verification === "boundedTransverseLineIncidence"
            ? "crossing"
            : "unclassified",
        firstParameter,
        secondParameter,
        position: [position.X(), position.Y()],
        proof,
      });
    }
    if (points.length === 0) {
      return uncertain(
        "occ-neutral-curve-empty-proof-unavailable",
        "OCC returned no in-domain parametric candidates, but this adapter has no independent certificate that the bounded line/curve pair is disjoint.",
      );
    }
    return checkedPoints(request, points);
  });
}

/** Lazy by construction: adapter creation and standalone solving never initialize OCC. */
export function createOpenCascadeNeutralCurveQueryCapability(
  loadOpenCascade: () => Promise<OpenCascadeInstance>,
): NeutralCurveQueryCapability {
  return {
    async queryNeutralCurves(request) {
      const invalid = validateNeutralCurveQueryRequest(request);
      if (invalid) return invalid;

      const structuralOverlap = proveStructuralCubicOverlap(
        request.first,
        request.second,
      );
      if (structuralOverlap) {
        return { kind: "verified", points: [], overlaps: [structuralOverlap] };
      }
      if (haveExactStructuralCubicBasis(request.first, request.second)) {
        if (
          hasExactStructuralCubicActiveOverlap(request.first, request.second)
        ) {
          return uncertain(
            "structural-cubic-overlap-numerically-unrepresentable",
            "The exact cubic active ranges overlap, but their source-parameter correspondence cannot be represented as finite nondegenerate binary64 intervals.",
          );
        }
        return uncertain(
          "structural-cubic-disjoint-parameter-contact-unresolved",
          "Exact cubic bases have no affine active-range overlap, but distinct parameter ranges can still meet at a self-intersection; use the explicit self-intersection operation.",
        );
      }

      const circlePair =
        request.first.kind === "circle" && request.second.kind === "circle";
      const supportedParametricPair =
        (request.first.kind === "line" && request.second.kind !== "line") ||
        (request.second.kind === "line" && request.first.kind !== "line");
      if (!circlePair && !supportedParametricPair) {
        return unsupported(
          "occ-neutral-curve-pair-unsupported",
          "Only analytic circle/circle and independently verified line/circle or line/cubic queries are supported; line/line and non-structural cubic/cubic or circle/cubic pairs have no semantic verifier.",
        );
      }

      const oc = (await loadOpenCascade()) as NeutralOccBindings;
      if (circlePair) {
        const missing = missingBindings(oc, ANALYTIC_CIRCLE_BINDINGS);
        if (missing.length > 0) {
          return unsupported(
            "occ-neutral-curve-query-bindings-unavailable",
            `Production OCC is missing required analytic circle-query bindings: ${missing.join(", ")}.`,
          );
        }
        return queryAnalyticCircles(oc, {
          ...request,
          first: request.first,
          second: request.second,
        });
      }

      const required = [
        ...PARAMETRIC_QUERY_BINDINGS,
        ...CURVE_CONSTRUCTION_BINDINGS[request.first.kind],
        ...CURVE_CONSTRUCTION_BINDINGS[request.second.kind],
      ];
      const missing = missingBindings(oc, [...new Set(required)]);
      if (missing.length > 0) {
        return unsupported(
          "occ-neutral-curve-query-bindings-unavailable",
          `Production OCC is missing required parametric neutral-query bindings: ${missing.join(", ")}.`,
        );
      }
      return queryParametricCurves(oc, request);
    },

    async queryNeutralCurveSelfIntersections(
      request: NeutralCurveSelfIntersectionRequest,
    ) {
      const invalid = validateNeutralCurveQueryRequest({
        modelingTolerance: request.modelingTolerance,
        first: request.curve,
        second: request.curve,
      });
      if (invalid) return invalid;
      return uncertain(
        "occ-neutral-curve-self-intersection-proof-unavailable",
        "The available Geom2dInt_GInter_2 self-query can locate candidates, but no independent semantic verifier yet proves their contact and parameter correspondence.",
      );
    },
  };
}
