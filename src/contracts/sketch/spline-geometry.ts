/** Sole neutral reconstruction seam. No kernel, topology or persistence authority.
 * Differentials are analytic directional derivatives: seed a canonical coordinate
 * or authored handle component with 1 to obtain a Jacobian column. */
import type { SolvedSketchEntityGeometryRecord } from "@/contracts/sketch/schema";
export type SplineVector = readonly [number, number];
export type SplinePoles = readonly [
  SplineVector,
  SplineVector,
  SplineVector,
  SplineVector,
];
export type SplineTangent =
  | { readonly kind: "automatic" }
  | { readonly kind: "authored"; readonly vector: SplineVector };
export type SplineClosure = "open" | "positional" | "smooth";
export type SplineInterpolationPolicy = "centripetal-mean-arm-v1";
export interface SplinePointOccurrence<TPointId extends string = string> {
  /** Stable identity for this ordered use, distinct from its canonical point identity. */
  readonly occurrenceId: string;
  readonly pointId: TPointId;
  readonly tangent: SplineTangent;
}
export interface AuthoredSplineAggregate<TPointId extends string = string> {
  readonly entityId: string;
  readonly pointOccurrenceIds: readonly string[];
  readonly pointOccurrences: readonly SplinePointOccurrence<TPointId>[];
  readonly closure: SplineClosure;
  readonly interpolationPolicy: SplineInterpolationPolicy;
}
export function orderedSplineOccurrences<TPointId extends string>(
  aggregate: Pick<
    AuthoredSplineAggregate<TPointId>,
    "pointOccurrenceIds" | "pointOccurrences"
  >,
): readonly SplinePointOccurrence<TPointId>[] | null {
  const byId = new Map(
    aggregate.pointOccurrences.map((occurrence) => [
      occurrence.occurrenceId,
      occurrence,
    ]),
  );
  if (
    byId.size !== aggregate.pointOccurrences.length ||
    aggregate.pointOccurrenceIds.length !== aggregate.pointOccurrences.length ||
    new Set(aggregate.pointOccurrenceIds).size !==
      aggregate.pointOccurrenceIds.length
  )
    return null;
  const ordered = aggregate.pointOccurrenceIds.map((id) => byId.get(id));
  return ordered.every(
    (occurrence): occurrence is SplinePointOccurrence<TPointId> => !!occurrence,
  )
    ? ordered
    : null;
}

export function orderedSplinePointIds<TPointId extends string>(
  aggregate: Pick<
    AuthoredSplineAggregate<TPointId>,
    "pointOccurrenceIds" | "pointOccurrences"
  >,
): readonly TPointId[] {
  return (
    orderedSplineOccurrences(aggregate)?.map(({ pointId }) => pointId) ?? []
  );
}

export interface ResolvedSplineInput {
  readonly id: string;
  readonly policy: SplineInterpolationPolicy;
  readonly closure: SplineClosure;
  readonly points: readonly {
    readonly occurrenceId: string;
    readonly id: string;
    readonly position: SplineVector;
    readonly tangent: SplineTangent;
  }[];
}
export interface SplineVariation {
  /** Shared canonical IDs move together, including positional endpoint aliases. */
  readonly points?: Readonly<Record<string, SplineVector>>;
  /** Tangent intent belongs to an ordered occurrence, not the shared point record. */
  readonly tangents?: Readonly<Record<number, SplineVector>>;
}
export interface SplineSpan {
  /**
   * Reconstruction provenance. Invariant of `reconstructSpline`: occurrence IDs
   * are unique within one spline, and consecutive spans `i`/`i + 1` of one
   * `splineId` (plus the last/first pair of a smooth closure) share one
   * occurrence, one bitwise knot position and one source derivative at that
   * knot. Positional closure ends on a distinct occurrence and is a C0 corner.
   * The shared derivative is authored smoothness intent; rounded binary64 poles
   * make the one-sided pole tangents only approximately parallel.
   */
  readonly source: {
    readonly splineId: string;
    readonly spanIndex: number;
    readonly startPointId: string;
    readonly endPointId: string;
    readonly startOccurrenceId: string;
    readonly endOccurrenceId: string;
  };
  readonly orientation: "forward";
  /** t = interval[0] + u * (interval[1] - interval[0]). */
  readonly interval: readonly [number, number];
  readonly poles: SplinePoles;
  readonly validity: "valid";
  readonly differential: {
    readonly interval: readonly [number, number];
    readonly poles: SplinePoles;
  };
}
export interface SplineDiagnostic {
  readonly code:
    | "too-few-points"
    | "unsupported-policy"
    | "non-finite"
    | "inconsistent-point"
    | "coincident-points"
    | "positional-gap"
    | "invalid-occurrence-order"
    | "missing-point";
  readonly pointIndex?: number;
  readonly spanIndex?: number;
}
export type SplineGeometry =
  | {
      readonly validity: "invalid";
      readonly diagnostics: readonly SplineDiagnostic[];
      readonly spans: readonly [];
    }
  | {
      readonly validity: "valid";
      readonly diagnostics: readonly [];
      readonly spans: readonly SplineSpan[];
      readonly handles: readonly SplineVector[];
      readonly handleDifferentials: readonly SplineVector[];
    };

const zero: SplineVector = [0, 0];
const add = (a: SplineVector, b: SplineVector): SplineVector => [
  a[0] + b[0],
  a[1] + b[1],
];
const sub = (a: SplineVector, b: SplineVector): SplineVector => [
  a[0] - b[0],
  a[1] - b[1],
];
const scale = (a: SplineVector, b: number): SplineVector => [
  a[0] * b,
  a[1] * b,
];
const finite = (v: SplineVector) => v.every(Number.isFinite);

/** Resolve the complete authored aggregate exactly once before reconstruction. */
export function reconstructSplineAggregate<TPointId extends string>(
  aggregate: AuthoredSplineAggregate<TPointId>,
  positions: Readonly<Record<TPointId, SplineVector>>,
  variation: SplineVariation = {},
): SplineGeometry {
  const ordered = orderedSplineOccurrences(aggregate);
  if (!ordered) {
    return {
      validity: "invalid",
      diagnostics: [{ code: "invalid-occurrence-order" }],
      spans: [],
    };
  }
  const points: Array<ResolvedSplineInput["points"][number]> = [];
  for (let index = 0; index < ordered.length; index++) {
    const occurrence = ordered[index]!;
    const position = positions[occurrence.pointId];
    if (!position) {
      return {
        validity: "invalid",
        diagnostics: [{ code: "missing-point", pointIndex: index }],
        spans: [],
      };
    }
    points.push({
      occurrenceId: occurrence.occurrenceId,
      id: occurrence.pointId,
      position,
      tangent: occurrence.tangent,
    });
  }
  return reconstructSpline(
    {
      id: aggregate.entityId,
      policy: aggregate.interpolationPolicy,
      closure: aggregate.closure,
      points,
    },
    variation,
  );
}

/** Positive intervals only; exact coincident points are retained and diagnosed.
 * 'valid' means reconstruction is defined, NOT regularity or profile validity.
 * Positional closure requires coincident endpoints, but never wraps tangents.
 * No near-degenerate modeling threshold or automatic repair is introduced. */
export function reconstructSpline(
  input: ResolvedSplineInput,
  variation: SplineVariation = {},
): SplineGeometry {
  const { points } = input;
  const n = points.length;
  const diagnostics: SplineDiagnostic[] = [];
  if (input.policy !== "centripetal-mean-arm-v1")
    diagnostics.push({ code: "unsupported-policy" });
  if (n < 2) diagnostics.push({ code: "too-few-points" });
  const canonical = new Map<string, SplineVector>();
  const occurrences = new Set<string>();
  points.forEach((p, i) => {
    if (occurrences.has(p.occurrenceId))
      diagnostics.push({ code: "invalid-occurrence-order", pointIndex: i });
    occurrences.add(p.occurrenceId);
    if (
      !finite(p.position) ||
      (p.tangent.kind === "authored" && !finite(p.tangent.vector)) ||
      !finite(variation.points?.[p.id] ?? zero) ||
      !finite(variation.tangents?.[i] ?? zero)
    )
      diagnostics.push({ code: "non-finite", pointIndex: i });
    const prior = canonical.get(p.id);
    if (prior && (prior[0] !== p.position[0] || prior[1] !== p.position[1]))
      diagnostics.push({ code: "inconsistent-point", pointIndex: i });
    canonical.set(p.id, p.position);
  });
  if (
    input.closure === "positional" &&
    n >= 2 &&
    points[0].position.some((v, axis) => v !== points[n - 1].position[axis])
  )
    diagnostics.push({ code: "positional-gap" });
  const invalid = (): SplineGeometry => ({
    validity: "invalid",
    diagnostics,
    spans: [],
  });
  if (diagnostics.length) return invalid();
  const wrapped = input.closure === "smooth";
  const count = wrapped ? n : n - 1;
  const dp = points.map((p) => variation.points?.[p.id] ?? zero);
  const h: number[] = [],
    dh: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const r = sub(points[j].position, points[i].position);
    const dr = sub(dp[j], dp[i]);
    const length = Math.hypot(...r);
    h[i] = Math.sqrt(length);
    // dh = (r dot dr)/(2 |r|^(3/2)); normalized r avoids needless overflow.
    dh[i] =
      length === 0
        ? 0
        : ((r[0] / length) * dr[0] + (r[1] / length) * dr[1]) / (2 * h[i]);
    if (length === 0)
      diagnostics.push({ code: "coincident-points", spanIndex: i });
    else if (!Number.isFinite(h[i]) || !Number.isFinite(dh[i]))
      diagnostics.push({ code: "non-finite", spanIndex: i });
  }
  if (diagnostics.length) return invalid();
  const derivatives: SplineVector[] = [],
    dDerivatives: SplineVector[] = [];
  const handles: SplineVector[] = [],
    handleDifferentials: SplineVector[] = [];
  points.forEach((p, i) => {
    let w: number, dw: number, auto: SplineVector, dAuto: SplineVector;
    if (!wrapped && (i === 0 || i === n - 1)) {
      const k = i === 0 ? 0 : n - 2;
      w = h[k];
      dw = dh[k];
      auto = scale(sub(points[k + 1].position, points[k].position), 1 / w);
      dAuto = scale(sub(sub(dp[k + 1], dp[k]), scale(auto, dw)), 1 / w);
    } else {
      const previous = (i + n - 1) % n,
        next = (i + 1) % n;
      const a = h[previous],
        b = h[i],
        da = dh[previous],
        db = dh[i];
      w = (a + b) / 2;
      dw = (da + db) / 2;
      const v = scale(sub(p.position, points[previous].position), 1 / a);
      const z = scale(sub(points[next].position, p.position), 1 / b);
      const dv = scale(sub(sub(dp[i], dp[previous]), scale(v, da)), 1 / a);
      const dz = scale(sub(sub(dp[next], dp[i]), scale(z, db)), 1 / b);
      auto = scale(add(scale(v, b), scale(z, a)), 1 / (a + b));
      const dNumerator = add(
        add(scale(v, db), scale(dv, b)),
        add(scale(z, da), scale(dz, a)),
      );
      dAuto = scale(sub(dNumerator, scale(auto, da + db)), 1 / (a + b));
    }
    if (p.tangent.kind === "authored") {
      const handle = p.tangent.vector,
        dHandle = variation.tangents?.[i] ?? zero;
      handles[i] = handle;
      handleDifferentials[i] = dHandle;
      derivatives[i] = scale(handle, 3 / w);
      dDerivatives[i] = scale(
        sub(scale(dHandle, 3), scale(derivatives[i], dw)),
        1 / w,
      );
    } else {
      derivatives[i] = auto;
      dDerivatives[i] = dAuto;
      handles[i] = scale(auto, w / 3);
      handleDifferentials[i] = scale(
        add(scale(dAuto, w), scale(auto, dw)),
        1 / 3,
      );
    }
  });
  let t = 0,
    dt = 0;
  const spans: SplineSpan[] = h.map((length, i) => {
    const j = (i + 1) % n;
    const poles: SplinePoles = [
      points[i].position,
      add(points[i].position, scale(derivatives[i], length / 3)),
      sub(points[j].position, scale(derivatives[j], length / 3)),
      points[j].position,
    ];
    const differentialPoles: SplinePoles = [
      dp[i],
      add(
        dp[i],
        scale(
          add(scale(dDerivatives[i], length), scale(derivatives[i], dh[i])),
          1 / 3,
        ),
      ),
      sub(
        dp[j],
        scale(
          add(scale(dDerivatives[j], length), scale(derivatives[j], dh[i])),
          1 / 3,
        ),
      ),
      dp[j],
    ];
    const span: SplineSpan = {
      source: {
        splineId: input.id,
        spanIndex: i,
        startPointId: points[i].id,
        endPointId: points[j].id,
        startOccurrenceId: points[i].occurrenceId,
        endOccurrenceId: points[j].occurrenceId,
      },
      orientation: "forward",
      validity: "valid",
      interval: [t, t + length],
      poles,
      differential: { interval: [dt, dt + dh[i]], poles: differentialPoles },
    };
    t += length;
    dt += dh[i];
    if (
      !poles.every(finite) ||
      !differentialPoles.every(finite) ||
      !Number.isFinite(t) ||
      !Number.isFinite(dt) ||
      span.interval[1] <= span.interval[0]
    )
      diagnostics.push({ code: "non-finite", spanIndex: i });
    return span;
  });
  return diagnostics.length
    ? invalid()
    : {
        validity: "valid",
        diagnostics: [],
        spans,
        handles,
        handleDifferentials,
      };
}

export function sampleSplineSpans(
  spans: readonly SplineSpan[],
  samplesPerSpan = 16,
): readonly SplineVector[] {
  if (!Number.isInteger(samplesPerSpan) || samplesPerSpan < 1) return [];
  return spans.flatMap((span, spanIndex) =>
    Array.from(
      { length: samplesPerSpan + (spanIndex === 0 ? 1 : 0) },
      (_, index) =>
        evaluateSplineSpan(span, {
          kind: "local",
          value: (index + (spanIndex === 0 ? 0 : 1)) / samplesPerSpan,
        }).position,
    ),
  );
}

export function sampleSplineGeometry(
  geometry: SplineGeometry,
  samplesPerSpan = 16,
): readonly SplineVector[] {
  return geometry.validity === "valid"
    ? sampleSplineSpans(geometry.spans, samplesPerSpan)
    : [];
}

export interface ClosestSplineSpanLocation {
  readonly spanIndex: number;
  readonly u: number;
  readonly distanceSquared: number;
}

function evaluatePolynomial(coefficients: readonly number[], value: number) {
  let result = 0;
  for (let index = coefficients.length - 1; index >= 0; index -= 1)
    result = result * value + coefficients[index]!;
  return result;
}

/**
 * Produces floating-point root candidates in [0, 1]. Recursive derivative
 * isolation partitions the polynomial into monotone intervals, so this does
 * not depend on sampling density or Newton seeds. Isolation stops only when
 * the bracket endpoints are adjacent floating-point values and preserves both
 * representatives. This is a numerical candidate set, not symbolic proof.
 */
function unitIntervalPolynomialRoots(coefficients: readonly number[]) {
  const scale = Math.max(...coefficients.map(Math.abs), 0);
  if (scale === 0) return [];
  const normalized = coefficients.map((coefficient) => coefficient / scale);
  while (normalized.length > 1 && normalized.at(-1) === 0) normalized.pop();
  if (normalized.length === 1) return [];
  if (normalized.length === 2) {
    const root = -normalized[0]! / normalized[1]!;
    return root >= 0 && root <= 1 ? [root] : [];
  }

  const derivative = normalized
    .slice(1)
    .map((value, index) => value * (index + 1));
  const critical = unitIntervalPolynomialRoots(derivative).filter(
    (root) => root > 0 && root < 1,
  );
  const boundaries = [0, ...critical, 1];
  const roots: number[] = [];
  const addRoot = (root: number) => {
    const clamped = Math.max(0, Math.min(1, root));
    if (!roots.includes(clamped)) roots.push(clamped);
  };

  for (const boundary of boundaries) {
    if (evaluatePolynomial(normalized, boundary) === 0) addRoot(boundary);
  }
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    let lo = boundaries[index]!;
    let hi = boundaries[index + 1]!;
    let loValue = evaluatePolynomial(normalized, lo);
    const hiValue = evaluatePolynomial(normalized, hi);
    if (
      loValue === 0 ||
      hiValue === 0 ||
      Math.sign(loValue) === Math.sign(hiValue)
    )
      continue;
    for (;;) {
      const mid = lo + (hi - lo) / 2;
      if (mid === lo || mid === hi) break;
      const midValue = evaluatePolynomial(normalized, mid);
      if (midValue === 0) {
        lo = mid;
        hi = mid;
        break;
      }
      if (Math.sign(midValue) === Math.sign(loValue)) {
        lo = mid;
        loValue = midValue;
      } else {
        hi = mid;
      }
    }
    // Preserve both adjacent floating-point representatives of the isolated
    // root. The geometric owner decides between them; averaging can round
    // away from an exactly representable contact.
    addRoot(lo);
    addRoot(hi);
  }
  return roots.sort((left, right) => left - right);
}

/** Physical distance magnitude represented in logarithmic, unsquared form. */
function splineCandidateDistance(
  position: SplineVector,
  poles: SplinePoles,
  u: number,
) {
  const coordinateData = ([0, 1] as const).map((component) => {
    let relative = poles.map((pole) => pole[component] - position[component]);
    let coordinateScale = Math.max(...relative.map(Math.abs), 0);
    if (!Number.isFinite(coordinateScale)) {
      coordinateScale = Math.max(
        Math.abs(position[component]),
        ...poles.map((pole) => Math.abs(pole[component])),
      );
      if (!Number.isFinite(coordinateScale) || coordinateScale === 0)
        return null;
      relative = poles.map(
        (pole) =>
          pole[component] / coordinateScale -
          position[component] / coordinateScale,
      );
    } else if (coordinateScale === 0) {
      coordinateScale = 1;
    } else {
      relative = relative.map((value) => value / coordinateScale);
    }
    return { relative, coordinateScale };
  });
  if (coordinateData.some((value) => value === null)) return null;
  const [xData, yData] = coordinateData as [
    { relative: number[]; coordinateScale: number },
    { relative: number[]; coordinateScale: number },
  ];
  const normalizedPoles = xData.relative.map(
    (x, index) => [x, yData.relative[index]!] as SplineVector,
  ) as unknown as SplinePoles;
  const normalized = evaluateSplineSpan(
    {
      interval: [0, 1],
      poles: normalizedPoles,
      differential: {
        interval: [0, 0],
        poles: [zero, zero, zero, zero],
      },
    },
    { kind: "local", value: u },
  ).position;
  const components = normalized.map((value, component) =>
    value === 0
      ? { log: Number.NEGATIVE_INFINITY, value: 0 }
      : {
          log:
            Math.log(Math.abs(value)) +
            Math.log(coordinateData[component]!.coordinateScale),
          value: value * coordinateData[component]!.coordinateScale,
        },
  );
  const [x, y] = components;
  const largest = Math.max(x!.log, y!.log);
  return {
    logDistance:
      largest === Number.NEGATIVE_INFINITY
        ? largest
        : largest +
          Math.log(
            Math.hypot(Math.exp(x!.log - largest), Math.exp(y!.log - largest)),
          ),
    distance: Math.hypot(x!.value, y!.value),
  };
}

/**
 * Returns the best floating-point candidate over cubic spans by comparing both
 * endpoints and all isolated stationary candidates. Root computation is scaled
 * per span. Candidate comparison re-evaluates each original coordinate with an
 * independent scale, preserving physical gaps that a dominant span or axis
 * would erase. Distances remain unsquared until the public result is formed.
 * Numerical root isolation does not constitute a symbolic global-minimum proof.
 *
 * `domains` (T08b-g2) restricts each span to a local sub-interval [u₀, u₁]
 * of [0, 1] (a derived curve's active query domain): only its ends and the
 * stationary candidates strictly inside are compared, and the refinement is
 * clamped to it; a span whose domain is absent, empty or not finite is
 * skipped. Without `domains` the search is exactly the unrestricted one.
 */
export function closestSplineSpanLocation(
  position: SplineVector,
  spans: readonly Pick<SplineSpan, "interval" | "poles" | "differential">[],
  domains?: readonly (readonly [number, number] | undefined)[],
): ClosestSplineSpanLocation | null {
  let best: {
    spanIndex: number;
    u: number;
    logDistance: number;
    distance: number;
  } | null = null;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const span = spans[spanIndex]!;
    const domain = domains ? domains[spanIndex] : ([0, 1] as const);
    if (
      !domain ||
      !(domain[0] >= 0 && domain[0] <= domain[1] && domain[1] <= 1)
    )
      continue;
    const [low, high] = domain;
    const relativePoles = span.poles.map(
      (pole) => [pole[0] - position[0], pole[1] - position[1]] as SplineVector,
    ) as unknown as SplinePoles;
    let spanScale = Math.max(
      ...relativePoles.flatMap((pole) => pole.map(Math.abs)),
      0,
    );
    let poles: SplinePoles;
    if (Number.isFinite(spanScale)) {
      if (spanScale === 0) spanScale = 1;
      poles = relativePoles.map(
        (pole) => [pole[0] / spanScale, pole[1] / spanScale] as SplineVector,
      ) as unknown as SplinePoles;
    } else {
      spanScale = Math.max(
        Math.abs(position[0]),
        Math.abs(position[1]),
        ...span.poles.flatMap((pole) => pole.map(Math.abs)),
      );
      if (!Number.isFinite(spanScale) || spanScale === 0) continue;
      poles = span.poles.map(
        (pole) =>
          [
            pole[0] / spanScale - position[0] / spanScale,
            pole[1] / spanScale - position[1] / spanScale,
          ] as SplineVector,
      ) as unknown as SplinePoles;
    }

    const [p0, p1, p2, p3] = poles;
    const components = [0, 1] as const;
    const curve = components.map((component) => [
      p0[component],
      3 * (p1[component] - p0[component]),
      3 * (p0[component] - 2 * p1[component] + p2[component]),
      -p0[component] + 3 * p1[component] - 3 * p2[component] + p3[component],
    ]);
    const stationary = Array.from({ length: 6 }, () => 0);
    for (const coefficients of curve) {
      const derivative = coefficients
        .slice(1)
        .map((value, index) => value * (index + 1));
      coefficients.forEach((left, leftIndex) =>
        derivative.forEach((right, rightIndex) => {
          stationary[leftIndex + rightIndex]! += left * right;
        }),
      );
    }
    const roots = unitIntervalPolynomialRoots(stationary);
    const candidates = domains
      ? [low, ...roots.filter((root) => root > low && root < high), high]
      : [0, ...roots, 1];
    const relativeSpan = {
      ...span,
      poles,
      differential: {
        interval: [0, 0] as const,
        poles: [zero, zero, zero, zero] as SplinePoles,
      },
    };
    for (const isolated of candidates) {
      let u = isolated;
      let evaluated = evaluateSplineSpan(relativeSpan, {
        kind: "local",
        value: u,
      });
      let normalizedDistance = Math.hypot(...evaluated.position);
      for (;;) {
        const slope =
          evaluated.position[0] * evaluated.first[0] +
          evaluated.position[1] * evaluated.first[1];
        const curvature =
          evaluated.first[0] ** 2 +
          evaluated.first[1] ** 2 +
          evaluated.position[0] * evaluated.second[0] +
          evaluated.position[1] * evaluated.second[1];
        if (curvature === 0 || !Number.isFinite(curvature)) break;
        const nextU = Math.max(low, Math.min(high, u - slope / curvature));
        if (nextU === u) break;
        const next = evaluateSplineSpan(relativeSpan, {
          kind: "local",
          value: nextU,
        });
        const nextDistance = Math.hypot(...next.position);
        if (!(nextDistance < normalizedDistance)) break;
        u = nextU;
        evaluated = next;
        normalizedDistance = nextDistance;
      }
      const physical = splineCandidateDistance(position, span.poles, u);
      if (
        physical &&
        Number.isFinite(normalizedDistance) &&
        (!best || physical.logDistance < best.logDistance)
      )
        best = { spanIndex, u, ...physical };
    }
  }
  if (!best) return null;

  if (best.logDistance === Number.NEGATIVE_INFINITY)
    return { spanIndex: best.spanIndex, u: best.u, distanceSquared: 0 };
  // Saturation is explicit when the physical squared distance lies outside
  // Number's range: Infinity above it, MIN_VALUE below it, never a false zero.
  const logDistanceSquared = 2 * best.logDistance;
  const distanceSquared =
    logDistanceSquared > Math.log(Number.MAX_VALUE)
      ? Number.POSITIVE_INFINITY
      : logDistanceSquared < Math.log(Number.MIN_VALUE)
        ? Number.MIN_VALUE
        : best.distance ** 2;
  return { spanIndex: best.spanIndex, u: best.u, distanceSquared };
}

export interface SplineEvaluation {
  readonly position: SplineVector;
  /** Derivatives in the requested parameter units (local u or source t). */
  readonly first: SplineVector;
  readonly second: SplineVector;
  readonly differential: {
    readonly position: SplineVector;
    readonly first: SplineVector;
    readonly second: SplineVector;
  };
}

/** Evaluate the same cubic, including analytic mixed variable/parameter derivatives.
 * Source-parameter differentiation accounts for moving cumulative knots. The
 * supplied span is held fixed; this API does not choose sides at a moving knot. */
export function evaluateSplineSpan(
  span: Pick<SplineSpan, "interval" | "poles" | "differential">,
  parameter: {
    readonly kind: "local" | "source";
    readonly value: number;
    readonly differential?: number;
  },
): SplineEvaluation {
  const [lo, hi] = span.interval,
    [dlo, dhi] = span.differential.interval;
  const h = hi - lo,
    dh = dhi - dlo;
  const source = parameter.kind === "source";
  const u = source ? (parameter.value - lo) / h : parameter.value;
  const du = source
    ? ((parameter.differential ?? 0) - dlo - u * dh) / h
    : (parameter.differential ?? 0);
  if (!Number.isFinite(u) || !Number.isFinite(du) || u < 0 || u > 1)
    throw new RangeError(
      "Spline parameter must be finite and inside its source span",
    );
  const v = 1 - u;
  const evaluatePoles = (poles: SplinePoles) => {
    const [p0, p1, p2, p3] = poles;
    const d1 = sub(p1, p0);
    const d2 = sub(p2, p1);
    const d3 = sub(p3, p2);
    const position =
      u === 0
        ? p0
        : u === 1
          ? p3
          : add(
              p0,
              add(
                scale(d1, 3 * u),
                add(
                  scale(sub(d2, d1), 3 * u * u),
                  scale(add(sub(d3, scale(d2, 2)), d1), u ** 3),
                ),
              ),
            );
    const first = scale(
      add(add(scale(d1, v * v), scale(d2, 2 * v * u)), scale(d3, u * u)),
      3,
    );
    const second = scale(add(scale(sub(d2, d1), v), scale(sub(d3, d2), u)), 6);
    const third = scale(add(sub(d3, scale(d2, 2)), d1), 6);
    return { position, first, second, third };
  };
  const evaluated = evaluatePoles(span.poles);
  const differential = evaluatePoles(span.differential.poles);
  const { position, first, second, third } = evaluated;
  const dPosition = add(differential.position, scale(first, du));
  const dFirst = add(differential.first, scale(second, du));
  const dSecond = add(differential.second, scale(third, du));
  const unit = source ? h : 1,
    dUnit = source ? dh : 0;
  return {
    position,
    first: scale(first, 1 / unit),
    second: scale(second, 1 / unit ** 2),
    differential: {
      position: dPosition,
      first: scale(sub(dFirst, scale(first, dUnit / unit)), 1 / unit),
      second: scale(
        sub(dSecond, scale(second, (2 * dUnit) / unit)),
        1 / unit ** 2,
      ),
    },
  };
}

/**
 * One solved cubic span as every consumer draws it (T08b slice design §2.8):
 * an ordinary solved spline span (`queryDomain` absent: the whole span) or a
 * derived offset shell sub-span, whose `interval` is its untrimmed
 * `sourceDomain` and whose drawn part is `queryDomain` (C2: trims never
 * repole).
 */
export interface SolvedCubicSpan {
  readonly interval: readonly [number, number];
  readonly poles: SplinePoles;
  readonly queryDomain?: readonly [number, number];
}

/**
 * The accepted cubic spans of a solved spline or derived shell record, the
 * one source display, pick, snap, measure, vector export and the OCC
 * snapshot read (T08b-g5b). A shell's spans are returned whatever its
 * publication; modeling consumers check `publication === "certified"`
 * themselves ([TECH] G7). Any other record (or an invalid spline) has none.
 */
export function solvedCubicSpans(
  record: SolvedSketchEntityGeometryRecord,
): readonly SolvedCubicSpan[] {
  if (record.kind === "spline")
    return record.reconstruction.validity === "valid"
      ? record.reconstruction.spans.map((span) => ({
          interval: span.interval,
          poles: span.poles,
        }))
      : [];
  if (record.kind === "derivedPiecewiseCubic")
    return record.spans.map((span) => ({
      interval: span.sourceDomain,
      poles: span.poles,
      queryDomain: span.queryDomain,
    }));
  return [];
}

/**
 * The drawn local sub-interval [u₀, u₁] of a solved span, with exact ends
 * kept (an untrimmed end is exactly 0 or 1): the same mapping the shell's
 * `pointOnCurve` residual restricts its closest-point search to.
 */
export function solvedCubicSpanLocalDomain(
  span: SolvedCubicSpan,
): readonly [number, number] {
  if (!span.queryDomain) return [0, 1];
  const [low, high] = span.interval;
  const [from, to] = span.queryDomain;
  const local = (value: number, end: number, exact: 0 | 1) =>
    value === end ? exact : (value - low) / (high - low);
  return [local(from, low, 0), local(to, high, 1)];
}

const ZERO_DIFFERENTIAL = {
  interval: [0, 0] as const,
  poles: [zero, zero, zero, zero] as const,
};

/** The point of a solved span at local parameter `u` (its own poles, never re-poled). */
export function solvedCubicSpanPoint(
  span: SolvedCubicSpan,
  u: number,
): SplineVector {
  return evaluateSplineSpan(
    {
      interval: span.interval,
      poles: span.poles,
      differential: ZERO_DIFFERENTIAL,
    },
    { kind: "local", value: u },
  ).position;
}

/**
 * Display tessellation of solved spans, each clipped to its drawn domain:
 * `samplesPerSpan` steps per span from u₀ to u₁ (both exact), the shared
 * knot of consecutive spans emitted once. Display output only, never
 * geometry.
 */
export function sampleSolvedCubicSpans(
  spans: readonly SolvedCubicSpan[],
  samplesPerSpan = 16,
): readonly SplineVector[] {
  if (!Number.isInteger(samplesPerSpan) || samplesPerSpan < 1) return [];
  return spans.flatMap((span, spanIndex) => {
    const [from, to] = solvedCubicSpanLocalDomain(span);
    return Array.from(
      { length: samplesPerSpan + (spanIndex === 0 ? 1 : 0) },
      (_, index) => {
        const step = index + (spanIndex === 0 ? 0 : 1);
        return solvedCubicSpanPoint(
          span,
          step === samplesPerSpan
            ? to
            : from + ((to - from) * step) / samplesPerSpan,
        );
      },
    );
  });
}

/**
 * The poles of a solved span restricted to its drawn domain (de Casteljau
 * subdivision at u₀ and u₁), for exporters that write cubic commands (SVG).
 * An untrimmed span returns its own poles unchanged.
 */
export function clippedSolvedCubicSpanPoles(
  span: SolvedCubicSpan,
): SplinePoles {
  const [from, to] = solvedCubicSpanLocalDomain(span);
  if (from === 0 && to === 1) return span.poles;
  const lerp = (a: SplineVector, b: SplineVector, t: number): SplineVector => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  // Keep [t, 1] of the given poles.
  const tail = (poles: SplinePoles, t: number): SplinePoles => {
    const [p0, p1, p2, p3] = poles;
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const c = lerp(p2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    return [lerp(d, e, t), e, c, p3];
  };
  // Keep [0, t] of the given poles.
  const head = (poles: SplinePoles, t: number): SplinePoles => {
    const [p0, p1, p2, p3] = poles;
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const c = lerp(p2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    return [p0, a, d, lerp(d, e, t)];
  };
  const kept = from > 0 ? tail(span.poles, from) : span.poles;
  const clipped = to < 1 ? head(kept, (to - from) / (1 - from)) : kept;
  // The drawn ends are the span's own evaluations at u₀ and u₁.
  return [
    solvedCubicSpanPoint(span, from),
    clipped[1],
    clipped[2],
    solvedCubicSpanPoint(span, to),
  ];
}
