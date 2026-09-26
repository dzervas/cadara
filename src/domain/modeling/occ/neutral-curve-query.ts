import {
  liftNativeCircleParameter,
  validateCircleAngularDomain,
} from "@/contracts/modeling/circle-angular-domain";
import {
  getNeutralCircleUnitXAxis,
  getNeutralCurveActiveSearchBounds,
  neutralCurveParameterInside,
  validateNeutralCurveQueryRequest,
  type EndpointNeutralSegment,
  type NeutralCurve,
  type NeutralCurveQueryCapability,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
  type NeutralCurveSelfIntersectionRequest,
} from "@/contracts/modeling/neutral-curve-query";
import { validateCertifiedCircleAngularDomain } from "@/domain/modeling/neutral-curve-certification/circle-angular-certification";
import { certifyCubicPairExact } from "@/domain/modeling/neutral-curve-certification/cubic-pair-exact";
import {
  certifyCirclePairCandidates,
  certifyCubicSelfIntersection,
  ExactQueryProofBudgetExceeded,
  proveFiniteLinePair,
  verifyCompleteLineCurveRootSet,
  type NativeCirclePairCandidate,
  type NativeLineCurveCandidate,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  certifyConstructiveCircleCubic,
  certifyConstructiveCirclePair,
  certifyConstructiveLineCircle,
  certifyConstructiveLineCubic,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-curve-roots";
import {
  ExactProofBudget,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";
import { parseNativeNeutralCurveQueryPayload } from "@/domain/modeling/occ/native-neutral-curve-query.runtime-schema";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

interface Deletable {
  delete(): void;
}
interface Point2d extends Deletable {
  X(): number;
  Y(): number;
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
/**
 * Endpoint segments are routed to the kernel-free exact owners and never reach
 * OCC. Circles reach OCC only as full-turn circle/circle pairs.
 */
type NativeNeutralCurve = Exclude<NeutralCurve, EndpointNeutralSegment>;
type NativeNeutralCurveQueryRequest = NeutralCurveQueryRequest & {
  readonly first: NativeNeutralCurve;
  readonly second: NativeNeutralCurve;
};

function isNativeNeutralCurve(
  curve: NeutralCurve,
): curve is NativeNeutralCurve {
  return curve.kind !== "line" || curve.form === undefined;
}

/** Native circle candidates cover whole turns; trimmed circle pairs prove kernel-free. */
function hasArcActiveDomain(curve: NeutralCurve) {
  return (
    curve.kind === "circle" &&
    validateCircleAngularDomain(curve.sourceDomain, curve.queryDomain)?.active
      .kind === "arc"
  );
}

type CurveHandle = Deletable;
type CurveAdaptor = Deletable;
type Constructor<T> = new (...args: unknown[]) => T;
interface NativeNeutralCurveQuery {
  QueryJson(
    first: CurveHandle,
    firstStart: number,
    firstEnd: number,
    second: CurveHandle,
    secondStart: number,
    secondEnd: number,
    selfQuery: boolean,
    tolerance: number,
  ): string;
}

type NeutralOccBindings = OpenCascadeInstance & {
  gp_Pnt2d_3?: Constructor<Point2d>;
  gp_Dir2d_4?: Constructor<Deletable>;
  gp_Ax2d_2?: Constructor<Deletable>;
  Geom2d_Circle_2?: Constructor<Deletable>;
  CadaraNativeNeutralCurveQuery?: NativeNeutralCurveQuery &
    Constructor<Deletable>;
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

const NATIVE_SEMANTIC_QUERY_BINDINGS = [
  "gp_Pnt2d_3",
  "Handle_Geom2d_Curve_2",
  "CadaraNativeNeutralCurveQuery",
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

/** Exact additive ABI required from the coordinated production OCC stage. */
export const OCC_NEUTRAL_CURVE_QUERY_REQUIRED_NEW_SYMBOLS = [
  "CadaraNativeNeutralCurveQuery",
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
  if (
    operationFailed &&
    operationError instanceof ExactQueryProofBudgetExceeded &&
    cleanupErrors.length === 0
  ) {
    throw operationError;
  }
  if (operationFailed || cleanupErrors.length > 0) {
    throw new AggregateError(
      operationFailed ? [operationError, ...cleanupErrors] : cleanupErrors,
      "OCC neutral-curve query or cleanup failed.",
    );
  }
  return result as T;
}

function sourceParameter(
  curve: NativeNeutralCurve,
  nativeParameter: number,
): number | null {
  const active = getNeutralCurveActiveSearchBounds(curve);
  if (curve.kind === "circle") {
    const angular = validateCircleAngularDomain(
      curve.sourceDomain,
      curve.queryDomain,
    );
    return angular ? liftNativeCircleParameter(angular, nativeParameter) : null;
  }
  const source =
    curve.kind === "cubicBezier"
      ? curve.sourceDomain[0] +
        nativeParameter * (curve.sourceDomain[1] - curve.sourceDomain[0])
      : nativeParameter / Math.hypot(curve.direction[0], curve.direction[1]);
  return neutralCurveParameterInside(source, active) ? source : null;
}

function transferCurveToHandle(
  geometry: Deletable,
  Handle: Constructor<CurveHandle>,
  own: <V extends Deletable>(value: V) => V,
) {
  try {
    // OCCT Handle(Standard_Transient*) takes intrusive ownership. Deleting the
    // raw Embind wrapper after this succeeds can free the pointee before the
    // owning Handle and double-free it during cleanup.
    return own(new Handle(geometry));
  } catch (error) {
    // Transfer did not occur, so the raw constructor result remains ours.
    try {
      geometry.delete();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "OCC curve-handle transfer and raw-geometry cleanup failed.",
      );
    }
    throw error;
  }
}

function makeNativeCurve(
  oc: NeutralOccBindings,
  curve: NativeNeutralCurve,
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
    return transferCurveToHandle(geometry, Handle, own);
  }
  if (curve.kind === "circle") {
    const xAxis = getNeutralCircleUnitXAxis(curve);
    const axis = own(
      new oc.gp_Ax2d_2!(
        own(new Point(curve.center[0], curve.center[1])),
        own(new Direction(xAxis[0], xAxis[1])),
      ),
    );
    const geometry = new oc.Geom2d_Circle_2!(axis, curve.radius, true);
    return transferCurveToHandle(geometry, Handle, own);
  }
  const poles = own(new oc.TColgp_Array1OfPnt2d_2!(1, 4));
  curve.poles.forEach((pole, index) => {
    poles.SetValue(index + 1, own(new Point(pole[0], pole[1])));
  });
  const geometry = new oc.Geom2d_BezierCurve_1!(poles);
  return transferCurveToHandle(geometry, Handle, own);
}

function nativeParameter(curve: NativeNeutralCurve, sourceParameter: number) {
  if (curve.kind === "cubicBezier") {
    return (
      (sourceParameter - curve.sourceDomain[0]) /
      (curve.sourceDomain[1] - curve.sourceDomain[0])
    );
  }
  if (curve.kind === "line") {
    return sourceParameter * Math.hypot(curve.direction[0], curve.direction[1]);
  }
  return sourceParameter;
}

function runNativeSemanticQuery(
  oc: NeutralOccBindings,
  request: NativeNeutralCurveQueryRequest,
  selfQuery: boolean,
):
  | {
      readonly kind: "ok";
      readonly payload: ReturnType<typeof parseNativeNeutralCurveQueryPayload>;
      readonly candidates: readonly NativeCirclePairCandidate[];
    }
  | NeutralCurveQueryResult {
  return withOwned((own) => {
    const firstHandle = makeNativeCurve(oc, request.first, own);
    const secondHandle = makeNativeCurve(oc, request.second, own);
    const firstActive = getNeutralCurveActiveSearchBounds(request.first);
    const secondActive = getNeutralCurveActiveSearchBounds(request.second);
    const payload = parseNativeNeutralCurveQueryPayload(
      oc.CadaraNativeNeutralCurveQuery!.QueryJson(
        firstHandle,
        nativeParameter(request.first, firstActive[0]),
        nativeParameter(request.first, firstActive[1]),
        secondHandle,
        nativeParameter(request.second, secondActive[0]),
        nativeParameter(request.second, secondActive[1]),
        selfQuery,
        request.modelingTolerance,
      ),
    );
    const candidates: NativeCirclePairCandidate[] = [];
    const mapPoint = (
      point: (typeof payload.points)[number],
      collect: boolean,
    ) => {
      const firstParameter = sourceParameter(request.first, point.u);
      const secondParameter = sourceParameter(request.second, point.v);
      if (firstParameter === null || secondParameter === null) return false;
      if (collect) {
        candidates.push({
          firstParameter,
          secondParameter,
          position: point.reported,
        });
      }
      return true;
    };
    if (!payload.points.every((point) => mapPoint(point, true))) {
      const angular =
        request.first.kind === "circle" || request.second.kind === "circle";
      return uncertain(
        angular
          ? "occ-neutral-curve-circle-active-domain-proof-unavailable"
          : "occ-native-neutral-curve-parameter-outside-active-domain",
        "The native dispatcher returned a parameter outside the mapped active domain.",
      );
    }
    for (const segment of payload.segments) {
      for (const endpoint of [segment.first, segment.last]) {
        if (endpoint && !mapPoint(endpoint, false)) {
          return uncertain(
            "occ-native-neutral-curve-parameter-outside-active-domain",
            "The native dispatcher returned a segment endpoint outside the mapped active domain.",
          );
        }
      }
    }
    return { kind: "ok", payload, candidates };
  });
}

function nativeFailureResult(
  payload: ReturnType<typeof parseNativeNeutralCurveQueryPayload>,
): NeutralCurveQueryResult | null {
  if (payload.status !== "uncertain" && payload.status !== "nativeFailure") {
    return null;
  }
  return uncertain(
    `occ-native-neutral-curve-${payload.status}`,
    payload.reason ??
      `The native neutral-curve query returned ${payload.status}.`,
  );
}

function queryNativeCirclePair(
  oc: NeutralOccBindings,
  request: NeutralCurveQueryRequest & {
    first: Extract<NeutralCurve, { kind: "circle" }>;
    second: Extract<NeutralCurve, { kind: "circle" }>;
  },
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  const native = runNativeSemanticQuery(oc, request, false);
  if (native.kind !== "ok") return native;
  const failure = nativeFailureResult(native.payload);
  if (failure) return failure;
  if (native.payload.backend !== "IntAna2d") {
    return uncertain(
      "occ-native-neutral-curve-unexpected-backend",
      `Circle dispatch used unexpected backend ${native.payload.backend}.`,
    );
  }
  return certifyCirclePairCandidates(request, native.candidates, budget);
}

function queryParametricCurves(
  oc: NeutralOccBindings,
  request: NativeNeutralCurveQueryRequest,
  budget: ExactProofBudget,
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
    const candidates: NativeLineCurveCandidate[] = [];
    for (let index = 1; index <= intersection.NbPoints(); index += 1) {
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
      candidates.push({
        firstParameter,
        secondParameter,
        position: [position.X(), position.Y()],
      });
    }
    return (
      verifyCompleteLineCurveRootSet(request, candidates, budget) ??
      uncertain(
        "occ-neutral-curve-root-proof-unavailable",
        "The parametric pair has no complete line/curve root-set verifier.",
      )
    );
  });
}

type LowerProofLimits = ConstructorParameters<typeof ExactProofBudget>[0];

function createCapability(
  loadOpenCascade: () => Promise<OpenCascadeInstance>,
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): NeutralCurveQueryCapability {
  return {
    async queryNeutralCurves(request) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
        const invalid = validateNeutralCurveQueryRequest(request);
        if (invalid) return invalid;
        for (const curve of [request.first, request.second]) {
          if (
            curve.kind === "circle" &&
            !validateCertifiedCircleAngularDomain(curve, budget)
          ) {
            return uncertain(
              "invalid-neutral-curve-query",
              "Neutral queries require finite geometry, unit directions, positive radii and tolerance, and finite increasing bounded domains.",
            );
          }
        }

        const finiteLineResult = proveFiniteLinePair(request, budget);
        if (finiteLineResult) return finiteLineResult;

        // Kernel-free exact owners. Each routed family has this one verifier
        // and never loads OCC.
        const { first, second } = request;
        const kernelFreeResult =
          certifyConstructiveLineCircle(request, budget) ??
          certifyConstructiveCircleCubic(request, budget) ??
          (hasArcActiveDomain(first) || hasArcActiveDomain(second)
            ? certifyConstructiveCirclePair(request, budget)
            : null);
        if (kernelFreeResult) return kernelFreeResult;
        if (!isNativeNeutralCurve(first) || !isNativeNeutralCurve(second)) {
          // A remaining segment pairs only with a cubic.
          return certifyConstructiveLineCubic(request, budget)!;
        }
        const nativeRequest: NativeNeutralCurveQueryRequest = {
          ...request,
          first,
          second,
        };

        let structural: NeutralCurveQueryResult | null = null;
        if (first.kind === "cubicBezier" && second.kind === "cubicBezier") {
          const cubicPair = certifyCubicPairExact(request, budget)!;
          const needsNativeComponent =
            cubicPair.kind === "verified" &&
            cubicPair.completenessProof.kind ===
              "completeStructuralCorrespondence" &&
            cubicPair.completenessProof.correspondence === "interval";
          if (!needsNativeComponent) return cubicPair;
          structural = cubicPair;
        }

        // Only full-turn circle pairs, positive structural cubic overlaps, and
        // numeric line/cubic pairs reach OCC.
        const circlePair = first.kind === "circle" && second.kind === "circle";
        const oc = (await loadOpenCascade()) as NeutralOccBindings;
        if (circlePair || structural) {
          const required = [
            ...NATIVE_SEMANTIC_QUERY_BINDINGS,
            ...CURVE_CONSTRUCTION_BINDINGS[request.first.kind],
            ...CURVE_CONSTRUCTION_BINDINGS[request.second.kind],
          ];
          const missing = missingBindings(oc, [...new Set(required)]);
          if (missing.length > 0) {
            return unsupported(
              "occ-neutral-curve-query-bindings-unavailable",
              `Production OCC is missing required native semantic-query bindings: ${missing.join(", ")}.`,
            );
          }
          if (circlePair) {
            return queryNativeCirclePair(
              oc,
              { ...request, first, second },
              budget,
            );
          }
          const native = runNativeSemanticQuery(oc, nativeRequest, false);
          if (native.kind !== "ok") return native;
          const failure = nativeFailureResult(native.payload);
          if (failure) return failure;
          if (
            native.payload.backend !== "structuralBezierOverlap" ||
            (native.payload.status !== "verified" &&
              native.payload.status !== "candidate")
          ) {
            return uncertain(
              "occ-native-neutral-curve-unexpected-backend",
              `Structural cubic dispatch returned ${native.payload.status}/${native.payload.backend}.`,
            );
          }
          // Native overlap classification is only a component candidate. The
          // exact TypeScript result remains the completeness, endpoint, and
          // off-diagonal self-pair authority.
          return structural!;
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
        return queryParametricCurves(oc, nativeRequest, budget);
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) {
          return uncertain(
            "exact-query-proof-budget-exhausted",
            "The deterministic exact-query arithmetic budget was exhausted.",
          );
        }
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },

    async queryNeutralCurveSelfIntersections(
      request: NeutralCurveSelfIntersectionRequest,
    ) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
        const invalid = validateNeutralCurveQueryRequest({
          modelingTolerance: request.modelingTolerance,
          first: request.curve,
          second: request.curve,
        });
        if (invalid) return invalid;
        if (request.curve.kind !== "cubicBezier") {
          return unsupported(
            "occ-neutral-curve-self-intersection-unsupported",
            "Only cubic Bézier self-intersection certification is admitted.",
          );
        }
        return certifyCubicSelfIntersection(
          request.curve,
          request.modelingTolerance,
          budget,
        );
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) {
          return uncertain(
            "exact-query-proof-budget-exhausted",
            "The deterministic exact-query arithmetic budget was exhausted.",
          );
        }
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },
  };
}

/** Lazy by construction: adapter creation and standalone solving never initialize OCC. */
export function createOpenCascadeNeutralCurveQueryCapability(
  loadOpenCascade: () => Promise<OpenCascadeInstance>,
): NeutralCurveQueryCapability {
  return createCapability(loadOpenCascade);
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(
  loadOpenCascade: () => Promise<OpenCascadeInstance>,
  lowerLimits: LowerProofLimits,
): NeutralCurveQueryCapability {
  return createCapability(loadOpenCascade, lowerLimits);
}

/** Test-only whole-request meter observation at the production OCC entrypoint. */
export function createOpenCascadeNeutralCurveQueryCapabilityWithBudgetObserverForTest(
  loadOpenCascade: () => Promise<OpenCascadeInstance>,
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): NeutralCurveQueryCapability {
  return createCapability(loadOpenCascade, undefined, observeBudget);
}
