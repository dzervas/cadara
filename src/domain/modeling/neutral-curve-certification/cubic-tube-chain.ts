import type {
  CertifiedCubicTubeChain,
  CubicTubeChainJoin,
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralCubicTube,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  SplinePoles,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  crossExact,
  exactSqrtInterval,
  restrictCubicBernstein,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  divideExact,
  exact,
  exactFromNumber,
  multiplyExact,
  negateExact,
  outwardExactNumber,
  subtractExact,
  type ExactFraction,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

/**
 * C6-S1′ tube-stability certificate of one emitted cubic chain (design review
 * §2/§6), extended by J2′ at declared non-parallel smooth source knots. All
 * checks are exact on binary64 inputs under ONE proof budget per request;
 * nothing is sampled, rounded into identity or tolerance-compared beyond the
 * owner's own ε ≤ τ acceptance. Square roots use the existing verified
 * `exactSqrtInterval` bounds only.
 *
 * - J0 admission: finite data, ordered boxes and leaves, 0 ≤ ε ≤ τ, bitwise
 *   emitted joins, present owner metadata, one bitwise owner distance d.
 * - J1 exact true-offset endpoint identity at every declared join: the same
 *   source span and bitwise split parameter (same-leaf), or a source knot with
 *   a bitwise shared source point whose one-sided source tangents have exactly
 *   zero cross and positive dot (parallel-knot). No window, no exemption.
 *   A J2′ candidate has the same knot structure plus consecutive span indices
 *   (or the closing wrap, last → span 0), dot > 0 and exactly nonzero cross X.
 *   It needs d ≠ 0 and, when closed, n ≥ 5; there is no angular threshold, so
 *   C0 (distinct-occurrence) corners and other structure stay unproven.
 * - K1 cone at every join (single open span: on itself): the emitted hodograph
 *   and the owner's O′ box are strictly positive along one candidate e.
 * - J2′ local certificate with the join's e: e·u₁, e·u₂ and the exactly
 *   restricted source leaf hodograph hull are e-positive. With the owner's
 *   left normal, O′ = λS′ and λ = 1 − dκ; λ = e·O′/e·S′ > 0 follows from K1(O)
 *   and that source cone. The enclosure used for division is κ-only and must
 *   have a positive lower bound, else uncertain. Side: sign Δ = sign(d)·sign(X)
 *   exactly; convex iff negative.
 *   - Concave: Δ = sign(α)·d·(α²U₂ − β²U₁)/(√(U₁U₂)(|α|√U₂ + |β|√U₁)) when
 *     α = cross(u₁, e) and β = cross(u₂, e) share a nonzero sign, else the
 *     direct difference; Δ > 0 and Δ < m on both leaves (m = λ_lo·min e·R′,
 *     leaf-wide min dx/dτ); h′ = (s₁ − s₂) − Δ·hull(c) excludes 0 with
 *     c = |e|²·cross(R′, R″)/((e·R′)³λ); h at both window ends is nonzero with
 *     opposite signs. So the one-sided offsets cross exactly once, transversally;
 *     the crossing X* is RETAINED. Trim fraction ≤ t = Δ/m and removed-tail
 *     displacement ≤ M·t with M = λ_hi·|R′|_hi (leaf-wide max |dO/dτ|).
 *   - Convex: the pieces are disjoint by e-monotonicity; the reference inserts
 *     the short arc of radius |d| about the knot from A to B, and every arc
 *     point is within δ⁺ ≥ √(2d²X²/(U₁U₂)) ≥ |A − B| of A and of B (dot > 0).
 * - Composition per leaf (sums, both ends): retained trims t_s + t_e < 1;
 *   ε* = ε + c_s + c_e ≤ τ, strictly < τ when either end is convex; K3 radius
 *   r = ε + δ⁺ of each convex end, inflating BOTH leaves of a convex knot.
 * - K3 clearance of every non-join pair: exact control-polygon boxes farther
 *   apart than r_i + r_j, by exact dyadic de Casteljau subdivision.
 *
 * The corrected reference O* concatenates the retained one-sided offsets
 * (between the ACTUAL unique crossing parameters τ_s* ≤ t_s, 1 − τ_e* ≤ t_e,
 * never the computed bounds) and assigns each convex arc wholly to the end
 * of its incoming leaf (the wrap arc to the last leaf). ε is a same-parameter
 * bound, so E_k ↦ O_k(σ(τ_s* + u(τ_e* − τ_s*))) moves points by ≤ ε*; a
 * convex END additionally maps [1 − η, 1] onto the arc, moving points by at
 * most ε* + M·η/(1 − η), which some η > 0 keeps ≤ τ because ε* < τ. η,
 * and M solely for this convex-end η reserve, are never computed; the local M
 * required for concave tails is computed above. Existence suffices, so `displacementBound` is exactly τ
 * on convex-END leaves and ε* elsewhere. Continuity holds at every join (X*,
 * A → arc → B, or bitwise identity), injectivity from e-monotone adjacent
 * pieces and K3 with r (arcs lie in both adjacent inflated tubes; closed
 * chains need n ≥ 4, gated at 5), so E → O* is a homeomorphism. Every point
 * of O* is S + dN on retained parameters or K + d·n on the knot's short
 * normal arc: a signed-normal construction, not a nearest-distance claim.
 * A failed check is uncertain, never a claim that the true geometry changed
 * topology or that curves actually touch.
 */

type ExactPoint = readonly [ExactFraction, ExactFraction];
type ExactCubic = readonly [ExactPoint, ExactPoint, ExactPoint, ExactPoint];
type ExactScalarCubic = readonly [
  ExactFraction,
  ExactFraction,
  ExactFraction,
  ExactFraction,
];
/** A closed exact interval [lower, upper]. */
type ExactRange = readonly [ExactFraction, ExactFraction];
type Failure = Exclude<CubicTubeChainResult, { kind: "verified" }>;
type LowerProofLimits = ConstructorParameters<typeof ExactProofBudget>[0];

const EXHAUSTED: Failure = {
  kind: "uncertain",
  code: "exact-query-proof-budget-exhausted",
  message: "The deterministic exact-query arithmetic budget was exhausted.",
};

const KNOT_UNPROVEN = "cubic-tube-knot-incidence-unproven";
const J2_MESSAGES = {
  cone: "The source tangents and leaf hodographs are not proved inside the join cone.",
  root: "A verified square-root bound is not finite and positive.",
  lambda:
    "The curvature enclosure does not prove the offset speed factor 1 − dκ positive.",
  window:
    "The concave overlap window is not proved positive inside both leaves.",
  unique: "The concave one-sided offsets are not proved to cross only once.",
  exists: "The concave one-sided offsets are not proved to cross.",
} as const;

function uncertain(
  code: string,
  message: string,
  first?: number,
  second?: number,
): Failure {
  return {
    kind: "uncertain",
    code,
    message,
    ...(first === undefined ? {} : { first }),
    ...(second === undefined ? {} : { second }),
  };
}

const finitePoles = (poles: SplinePoles | undefined) =>
  Array.isArray(poles) &&
  poles.length === 4 &&
  poles.every(
    (pole) =>
      Array.isArray(pole) &&
      Number.isFinite(pole[0]) &&
      Number.isFinite(pole[1]),
  );

const orderedFinite = (interval: readonly [number, number] | undefined) =>
  Array.isArray(interval) &&
  Number.isFinite(interval[0]) &&
  Number.isFinite(interval[1]) &&
  interval[0] <= interval[1];

const samePoint = (first: SplineVector, second: SplineVector) =>
  Object.is(first[0], second[0]) && Object.is(first[1], second[1]);

/** J0 structural admission of one tube; null when admitted. */
function admissionDefect(
  tube: NeutralCubicTube,
  modelingTolerance: number,
): string | null {
  // Persisted, projected and fabricated spans may lack owner metadata at runtime.
  const reference = tube.reference as NeutralCubicTube["reference"] | undefined;
  const source = tube.source as NeutralCubicTube["source"] | undefined;
  if (!reference || !source) return "missing owner proof metadata";
  if (!finitePoles(tube.poles)) return "non-finite emitted poles";
  if (!finitePoles(reference.sourcePoles)) return "non-finite source poles";
  if (!Number.isFinite(reference.distance))
    return "missing or non-finite owner offset distance";
  const derivative = reference.derivative as
    | NeutralCubicTube["reference"]["derivative"]
    | undefined;
  if (
    !Array.isArray(derivative) ||
    !orderedFinite(derivative[0]) ||
    !orderedFinite(derivative[1])
  )
    return "non-finite or reversed derivative enclosure";
  const leaf = tube.sourceLocalInterval as
    | NeutralCubicTube["sourceLocalInterval"]
    | undefined;
  if (!Array.isArray(leaf)) return "invalid source-local leaf";
  const [a, b] = leaf;
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    !(a >= 0) ||
    !(b <= 1) ||
    !(a < b)
  )
    return "invalid source-local leaf";
  if (
    !Number.isFinite(tube.certifiedError) ||
    !(tube.certifiedError >= 0) ||
    !(tube.certifiedError <= modelingTolerance)
  )
    return "certified error outside [0, modelingTolerance]";
  if (
    typeof source.splineId !== "string" ||
    !Number.isSafeInteger(source.spanIndex) ||
    typeof source.startOccurrenceId !== "string" ||
    typeof source.endOccurrenceId !== "string"
  )
    return "invalid source provenance";
  return null;
}

/** J1(a): both leaves split one source span at one bitwise parameter. */
function sameLeaf(first: NeutralCubicTube, second: NeutralCubicTube) {
  return (
    first.source.splineId === second.source.splineId &&
    first.source.spanIndex === second.source.spanIndex &&
    first.reference.sourcePoles.every((pole, index) =>
      samePoint(pole, second.reference.sourcePoles[index]!),
    ) &&
    Object.is(first.sourceLocalInterval[1], second.sourceLocalInterval[0])
  );
}

interface KnotCandidate {
  readonly join: number;
  readonly first: number;
  readonly second: number;
  readonly incoming: ExactPoint;
  readonly outgoing: ExactPoint;
  readonly cross: ExactFraction;
}

type J2Report =
  | {
      readonly side: "concave";
      readonly tail: ExactRange;
      readonly trim: ExactRange;
    }
  | { readonly side: "convex"; readonly arcDeviation: ExactFraction };

function certifyChain(
  request: CubicTubeChainRequest,
  budget: ExactProofBudget,
): CubicTubeChainResult {
  const { tubes, closed, modelingTolerance } = request;
  const count = tubes.length;
  // Admission and preallocation guard: charged before any per-tube work.
  budget.operation(64 + 16 * count);
  if (count === 0)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-empty",
      message: "A cubic tube chain needs at least one emitted cubic.",
    };
  if (closed && count < 3)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-closed-too-short",
      message: "A closed cubic tube chain needs at least three cubics.",
    };
  if (!Number.isFinite(modelingTolerance) || !(modelingTolerance > 0))
    return uncertain(
      "invalid-cubic-tube-chain",
      "The modeling tolerance must be finite and positive.",
    );
  for (const [index, tube] of tubes.entries()) {
    const defect = admissionDefect(tube, modelingTolerance);
    if (defect)
      return uncertain(
        "invalid-cubic-tube-chain",
        `Tube ${index}: ${defect}.`,
        index,
      );
  }
  // One owner call has one signed distance: bitwise, so −0 differs from 0.
  budget.operation(count);
  const distanceValue = tubes[0]!.reference.distance;
  for (let index = 1; index < count; index += 1)
    if (!Object.is(tubes[index]!.reference.distance, distanceValue))
      return uncertain(
        "invalid-cubic-tube-chain",
        "The tubes do not carry one bitwise owner offset distance.",
        0,
        index,
      );

  const joins: (readonly [number, number])[] = [];
  for (let index = 0; index + 1 < count; index += 1)
    joins.push([index, index + 1]);
  if (closed) joins.push([count - 1, 0]);
  for (const [first, second] of joins) {
    if (!samePoint(tubes[first]!.poles[3], tubes[second]!.poles[0]))
      return uncertain(
        "cubic-tube-chain-join-not-bitwise",
        "A declared join does not share one bitwise emitted pole.",
        first,
        second,
      );
  }

  // Every binary64 input is converted exactly once per request.
  const zero = exact(0n, 1n, budget);
  const exactPoint = (point: SplineVector): ExactPoint => [
    exactFromNumber(point[0], budget),
    exactFromNumber(point[1], budget),
  ];
  const difference = (to: ExactPoint, from: ExactPoint): ExactPoint => [
    subtractExact(to[0], from[0], budget),
    subtractExact(to[1], from[1], budget),
  ];
  const dot = (left: ExactPoint, right: ExactPoint) =>
    addExact(
      multiplyExact(left[0], right[0], budget),
      multiplyExact(left[1], right[1], budget),
      budget,
    );
  const positive = (value: ExactFraction) =>
    compareExact(value, zero, budget) > 0;
  const poles: ExactCubic[] = tubes.map(
    (tube) => tube.poles.map(exactPoint) as unknown as ExactCubic,
  );
  const hodographs = poles.map((cubic) =>
    [0, 1, 2].map((index) => difference(cubic[index + 1]!, cubic[index]!)),
  );
  const derivatives = tubes.map((tube) =>
    tube.reference.derivative.map((axis) => [
      exactFromNumber(axis[0], budget),
      exactFromNumber(axis[1], budget),
    ]),
  );
  const errors = tubes.map((tube) =>
    exactFromNumber(tube.certifiedError, budget),
  );
  const distance = exactFromNumber(distanceValue, budget);
  const tolerance = exactFromNumber(modelingTolerance, budget);

  // J1: exact true-offset endpoint identity, or a structural J2′ candidate.
  const kinds: CubicTubeChainJoin["kind"][] = [];
  const candidates: KnotCandidate[] = [];
  for (const [join, [first, second]] of joins.entries()) {
    const left = tubes[first]!;
    const right = tubes[second]!;
    if (sameLeaf(left, right)) {
      kinds.push("same-leaf");
      continue;
    }
    const unproven = () =>
      uncertain(
        KNOT_UNPROVEN,
        "The true offset endpoints of a declared join are not proved identical.",
        first,
        second,
      );
    const p = left.reference.sourcePoles;
    const q = right.reference.sourcePoles;
    const knot =
      left.source.splineId === right.source.splineId &&
      left.source.endOccurrenceId === right.source.startOccurrenceId &&
      left.sourceLocalInterval[1] === 1 &&
      right.sourceLocalInterval[0] === 0 &&
      samePoint(p[3], q[0]);
    const incoming = knot && difference(exactPoint(p[3]), exactPoint(p[2]));
    const outgoing = knot && difference(exactPoint(q[1]), exactPoint(q[0]));
    if (!incoming || !outgoing) return unproven();
    const cross = crossExact(incoming, outgoing, budget);
    const parallel = compareExact(cross, zero, budget) === 0;
    if (!positive(dot(incoming, outgoing))) return unproven();
    if (parallel) {
      kinds.push("parallel-knot");
      continue;
    }
    // Declared smooth structure only: consecutive spans or the closing wrap.
    const consecutive =
      right.source.spanIndex === left.source.spanIndex + 1 ||
      (closed &&
        second === 0 &&
        right.source.spanIndex === 0 &&
        left.source.spanIndex > 0);
    if (!consecutive) return unproven();
    if (distanceValue === 0)
      return uncertain(
        KNOT_UNPROVEN,
        "Zero offset distance at a non-parallel knot: J2′ not attempted (no side).",
        first,
        second,
      );
    if (closed && count < 5)
      return uncertain(
        KNOT_UNPROVEN,
        "A closed chain with a non-parallel knot needs at least five cubics: J2′ not attempted.",
        first,
        second,
      );
    kinds.push("nonparallel-knot");
    candidates.push({ join, first, second, incoming, outgoing, cross });
  }

  // K1: strict cone of the emitted hodographs and the owner O′ boxes.
  const coneDirection = (indices: readonly number[]) => {
    const direction: [number, number] = [0, 0];
    for (const index of indices) {
      const cubic = tubes[index]!.poles;
      for (let pole = 0; pole < 3; pole += 1) {
        direction[0] += cubic[pole + 1]![0] - cubic[pole]![0];
        direction[1] += cubic[pole + 1]![1] - cubic[pole]![1];
      }
    }
    if (!direction.every(Number.isFinite)) return null;
    const e = exactPoint(direction);
    for (const index of indices) {
      if (!hodographs[index]!.every((step) => positive(dot(e, step))))
        return null;
      // min over the box of e·v is attained at the e-signed corner.
      const box = derivatives[index]!;
      const corner: ExactPoint = [
        box[0]![direction[0] >= 0 ? 0 : 1]!,
        box[1]![direction[1] >= 0 ? 0 : 1]!,
      ];
      if (!positive(dot(e, corner))) return null;
    }
    return { direction: direction as SplineVector, e };
  };
  const directions: SplineVector[] = [];
  const cones: ExactPoint[] = [];
  for (const [first, second] of joins) {
    const cone = coneDirection([first, second]);
    if (!cone)
      return uncertain(
        "cubic-tube-cone-unproven",
        "The emitted and true offset derivatives are not proved inside one open half-plane.",
        first,
        second,
      );
    directions.push(cone.direction);
    cones.push(cone.e);
  }
  let isolatedSpanDirection: SplineVector | undefined;
  if (count === 1) {
    const cone = coneDirection([0]);
    if (!cone)
      return uncertain(
        "cubic-tube-cone-unproven",
        "The emitted and true offset derivatives are not proved inside one open half-plane.",
        0,
      );
    isolatedSpanDirection = cone.direction;
  }

  const half = exact(1n, 2n, budget);
  const one = exact(1n, 1n, budget);
  const minimum = (values: readonly ExactFraction[]) =>
    values.reduce((low, value) =>
      compareExact(value, low, budget) < 0 ? value : low,
    );
  const maximum = (values: readonly ExactFraction[]) =>
    values.reduce((high, value) =>
      compareExact(value, high, budget) > 0 ? value : high,
    );
  const restrict = (
    cubic: ExactCubic,
    lower: ExactFraction,
    upper: ExactFraction,
  ): ExactCubic => {
    const axis = (index: 0 | 1) =>
      restrictCubicBernstein(
        cubic.map((point) => point[index]) as unknown as ExactScalarCubic,
        lower,
        upper,
        budget,
      );
    const x = axis(0);
    const y = axis(1);
    return x.map((value, index) => [value, y[index]!]) as unknown as ExactCubic;
  };

  // J2′: local certificate of every candidate knot, same meter.
  budget.operation(16 * candidates.length + 8 * count);
  const two = exact(2n, 1n, budget);
  const three = exact(3n, 1n, budget);
  const negative = (value: ExactFraction) =>
    compareExact(value, zero, budget) < 0;
  const point = (value: ExactFraction): ExactRange => [value, value];
  const hull = (values: readonly ExactFraction[]): ExactRange => [
    minimum(values),
    maximum(values),
  ];
  const rangeAdd = (left: ExactRange, right: ExactRange): ExactRange => [
    addExact(left[0], right[0], budget),
    addExact(left[1], right[1], budget),
  ];
  const rangeNegate = (value: ExactRange): ExactRange => [
    negateExact(value[1], budget),
    negateExact(value[0], budget),
  ];
  const rangeSubtract = (left: ExactRange, right: ExactRange) =>
    rangeAdd(left, rangeNegate(right));
  const rangeMultiply = (left: ExactRange, right: ExactRange) =>
    hull([
      multiplyExact(left[0], right[0], budget),
      multiplyExact(left[0], right[1], budget),
      multiplyExact(left[1], right[0], budget),
      multiplyExact(left[1], right[1], budget),
    ]);
  const rangeSquare = (value: ExactRange): ExactRange => {
    const square = rangeMultiply(value, value);
    return !positive(value[0]) && !negative(value[1])
      ? [zero, square[1]]
      : square;
  };
  /** Division only by a range proved strictly positive; null otherwise. */
  const rangeDividePositive = (
    numerator: ExactRange,
    denominator: ExactRange,
  ): ExactRange | null =>
    positive(denominator[0])
      ? rangeMultiply(numerator, [
          divideExact(one, denominator[1], budget),
          divideExact(one, denominator[0], budget),
        ])
      : null;
  const excludesZero = (value: ExactRange) =>
    positive(value[0]) || negative(value[1]);
  /** Existing verified √ bounds; the lower bound must be finite and > 0. */
  const squareRoot = (value: ExactFraction): ExactRange | null => {
    const root = exactSqrtInterval(value, budget);
    budget.operation(3);
    if (
      !root ||
      !Number.isFinite(root.lower) ||
      !Number.isFinite(root.upper) ||
      !(root.lower > 0)
    )
      return null;
    return [
      exactFromNumber(root.lower, budget),
      exactFromNumber(root.upper, budget),
    ];
  };

  // Exactly restricted source leaf R: hodograph R′ and R″ control points in
  // leaf τ-units, then (concave only) the e-independent κ-only λ enclosure.
  const shapes = new Map<
    number,
    { first: ExactPoint[]; second: ExactPoint[] }
  >();
  const leafShape = (index: number) => {
    const cached = shapes.get(index);
    if (cached) return cached;
    const tube = tubes[index]!;
    const restricted = restrict(
      tube.reference.sourcePoles.map(exactPoint) as unknown as ExactCubic,
      exactFromNumber(tube.sourceLocalInterval[0], budget),
      exactFromNumber(tube.sourceLocalInterval[1], budget),
    );
    const scaled = (vector: ExactPoint, factor: ExactFraction): ExactPoint => [
      multiplyExact(vector[0], factor, budget),
      multiplyExact(vector[1], factor, budget),
    ];
    const first = [0, 1, 2].map((pole) =>
      scaled(difference(restricted[pole + 1]!, restricted[pole]!), three),
    );
    const second = [0, 1].map((pole) =>
      scaled(difference(first[pole + 1]!, first[pole]!), two),
    );
    const shape = { first, second };
    shapes.set(index, shape);
    return shape;
  };
  type LeafCurvature =
    | { cross: ExactRange; speed: ExactRange; lambda: ExactRange }
    | "root"
    | "lambda";
  const curvatures = new Map<number, LeafCurvature>();
  const leafCurvature = (index: number): LeafCurvature => {
    const cached = curvatures.get(index);
    if (cached) return cached;
    const shape = leafShape(index);
    const axisHull = (vectors: readonly ExactPoint[], axis: 0 | 1) =>
      hull(vectors.map((vector) => vector[axis]));
    const firstX = axisHull(shape.first, 0);
    const firstY = axisHull(shape.first, 1);
    const cross = rangeSubtract(
      rangeMultiply(firstX, axisHull(shape.second, 1)),
      rangeMultiply(firstY, axisHull(shape.second, 0)),
    );
    const speedSquared = rangeAdd(rangeSquare(firstX), rangeSquare(firstY));
    const low = squareRoot(speedSquared[0]);
    const high = low && squareRoot(speedSquared[1]);
    let result: LeafCurvature;
    if (!low || !high) result = "root";
    else {
      const speed: ExactRange = [low[0], high[1]];
      const kappa = rangeDividePositive(
        cross,
        rangeMultiply(rangeMultiply(speed, speed), speed),
      );
      const lambda =
        kappa &&
        rangeSubtract(point(one), rangeMultiply(point(distance), kappa));
      result =
        lambda && positive(lambda[0]) ? { cross, speed, lambda } : "lambda";
    }
    curvatures.set(index, result);
    return result;
  };

  const correctionStart: (ExactFraction | undefined)[] = [];
  const correctionEnd: (ExactFraction | undefined)[] = [];
  const trimStart: (ExactFraction | undefined)[] = [];
  const trimEnd: (ExactFraction | undefined)[] = [];
  const arcStart: (ExactFraction | undefined)[] = [];
  const arcEnd: (ExactFraction | undefined)[] = [];
  const reports = new Map<number, J2Report>();
  for (const { join, first, second, incoming, outgoing, cross } of candidates) {
    const fail = (reason: keyof typeof J2_MESSAGES) =>
      uncertain(KNOT_UNPROVEN, J2_MESSAGES[reason], first, second);
    const e = cones[join]!;
    const alongIncoming = dot(e, incoming);
    const alongOutgoing = dot(e, outgoing);
    if (!positive(alongIncoming) || !positive(alongOutgoing))
      return fail("cone");
    const sourceCone = (index: number) =>
      hull(leafShape(index).first.map((vector) => dot(e, vector)));
    const coneFirst = sourceCone(first);
    const coneSecond = sourceCone(second);
    if (!positive(coneFirst[0]) || !positive(coneSecond[0]))
      return fail("cone");
    const incomingSquared = dot(incoming, incoming);
    const outgoingSquared = dot(outgoing, outgoing);
    if (positive(distance) !== positive(cross)) {
      // Convex: |A − B|² = 2d²(1 − cos φ) ≤ 2d²sin²φ as cos φ > 0; U₁U₂ > 0
      // because dot(u₁, u₂) > 0.
      const chordSquared = divideExact(
        multiplyExact(
          multiplyExact(two, multiplyExact(distance, distance, budget), budget),
          multiplyExact(cross, cross, budget),
          budget,
        ),
        multiplyExact(incomingSquared, outgoingSquared, budget),
        budget,
      );
      const chord = squareRoot(chordSquared);
      if (!chord) return fail("root");
      correctionEnd[first] = chord[1];
      correctionStart[second] = chord[1];
      arcEnd[first] = chord[1];
      arcStart[second] = chord[1];
      reports.set(join, { side: "convex", arcDeviation: chord[1] });
      continue;
    }

    // Concave: correlated leaf-wide curvature certificate.
    const eSquared = dot(e, e);
    const concaveLeaf = (index: number, cone: ExactRange) => {
      const curvature = leafCurvature(index);
      if (typeof curvature === "string") return curvature;
      const slopeRate = rangeDividePositive(
        rangeMultiply(point(eSquared), curvature.cross),
        rangeMultiply(
          rangeMultiply(rangeMultiply(cone, cone), cone),
          curvature.lambda,
        ),
      );
      if (!slopeRate) return "lambda" as const;
      return {
        rate: slopeRate,
        // Leaf-wide min dx/dτ and max |dO/dτ|, both in leaf τ-units.
        minimumAdvance: multiplyExact(cone[0], curvature.lambda[0], budget),
        maximumSpeed: multiplyExact(
          curvature.speed[1],
          curvature.lambda[1],
          budget,
        ),
      };
    };
    const leafFirst = concaveLeaf(first, coneFirst);
    if (typeof leafFirst === "string") return fail(leafFirst);
    const leafSecond = concaveLeaf(second, coneSecond);
    if (typeof leafSecond === "string") return fail(leafSecond);
    const alpha = crossExact(incoming, e, budget);
    const beta = crossExact(outgoing, e, budget);
    const rootIncoming = squareRoot(incomingSquared);
    const rootOutgoing = rootIncoming && squareRoot(outgoingSquared);
    if (!rootIncoming || !rootOutgoing) return fail("root");
    const alphaPositive = positive(alpha);
    const alphaNegative = !alphaPositive && negative(alpha);
    const sameSign =
      (alphaPositive && positive(beta)) || (alphaNegative && negative(beta));
    let unitGap: ExactRange | null;
    if (sameSign) {
      // Rationalised, cancellation-free; sign(α) is mandatory.
      const rootProduct = squareRoot(
        multiplyExact(incomingSquared, outgoingSquared, budget),
      );
      if (!rootProduct) return fail("root");
      const absolute = (value: ExactFraction) =>
        alphaPositive ? value : negateExact(value, budget);
      const quotient = rangeDividePositive(
        point(
          subtractExact(
            multiplyExact(
              multiplyExact(alpha, alpha, budget),
              outgoingSquared,
              budget,
            ),
            multiplyExact(
              multiplyExact(beta, beta, budget),
              incomingSquared,
              budget,
            ),
            budget,
          ),
        ),
        rangeMultiply(
          rootProduct,
          rangeAdd(
            rangeMultiply(point(absolute(alpha)), rootOutgoing),
            rangeMultiply(point(absolute(beta)), rootIncoming),
          ),
        ),
      );
      unitGap = quotient && (alphaPositive ? quotient : rangeNegate(quotient));
    } else {
      const normalIncoming = rangeDividePositive(point(alpha), rootIncoming);
      const normalOutgoing = rangeDividePositive(point(beta), rootOutgoing);
      unitGap =
        normalIncoming &&
        normalOutgoing &&
        rangeSubtract(normalIncoming, normalOutgoing);
    }
    if (!unitGap) return fail("root");
    const overlap = rangeMultiply(point(distance), unitGap);
    if (
      !positive(overlap[0]) ||
      compareExact(overlap[1], leafFirst.minimumAdvance, budget) >= 0 ||
      compareExact(overlap[1], leafSecond.minimumAdvance, budget) >= 0
    )
      return fail("window");
    const slope = (vector: ExactPoint, along: ExactFraction) =>
      divideExact(crossExact(e, vector, budget), along, budget);
    const slopeGap = subtractExact(
      slope(incoming, alongIncoming),
      slope(outgoing, alongOutgoing),
      budget,
    );
    const ratio = squareRoot(
      divideExact(outgoingSquared, incomingSquared, budget),
    );
    const inverseRatio =
      ratio &&
      squareRoot(divideExact(incomingSquared, outgoingSquared, budget));
    if (!ratio || !inverseRatio) return fail("root");
    const scaledCross = point(multiplyExact(eSquared, cross, budget));
    const chordFromIncoming = rangeDividePositive(
      scaledCross,
      rangeMultiply(
        point(alongIncoming),
        rangeAdd(
          rangeMultiply(ratio, point(alongIncoming)),
          point(alongOutgoing),
        ),
      ),
    );
    const chordToOutgoing = rangeDividePositive(
      scaledCross,
      rangeMultiply(
        point(alongOutgoing),
        rangeAdd(
          point(alongIncoming),
          rangeMultiply(inverseRatio, point(alongOutgoing)),
        ),
      ),
    );
    if (!chordFromIncoming || !chordToOutgoing) return fail("root");
    const rateHull: ExactRange = [
      minimum([leafFirst.rate[0], leafSecond.rate[0]]),
      maximum([leafFirst.rate[1], leafSecond.rate[1]]),
    ];
    if (
      !excludesZero(
        rangeSubtract(point(slopeGap), rangeMultiply(overlap, rateHull)),
      )
    )
      return fail("unique");
    const halfOverlap = rangeMultiply(overlap, point(half));
    const atB = rangeAdd(
      chordFromIncoming,
      rangeMultiply(halfOverlap, leafFirst.rate),
    );
    const atA = rangeSubtract(
      rangeNegate(chordToOutgoing),
      rangeMultiply(halfOverlap, leafSecond.rate),
    );
    if (
      !excludesZero(atB) ||
      !excludesZero(atA) ||
      positive(atB[0]) === positive(atA[0])
    )
      return fail("exists");
    const trim: ExactRange = [
      divideExact(overlap[1], leafFirst.minimumAdvance, budget),
      divideExact(overlap[1], leafSecond.minimumAdvance, budget),
    ];
    const tail: ExactRange = [
      multiplyExact(leafFirst.maximumSpeed, trim[0], budget),
      multiplyExact(leafSecond.maximumSpeed, trim[1], budget),
    ];
    correctionEnd[first] = tail[0];
    correctionStart[second] = tail[1];
    trimEnd[first] = trim[0];
    trimStart[second] = trim[1];
    reports.set(join, { side: "concave", tail, trim });
  }

  // Per-leaf composition (sums of both ends) and the K3 radii.
  budget.operation(4 * count);
  const stars: ExactFraction[] = [];
  const radii: ExactFraction[] = [];
  for (let index = 0; index < count; index += 1) {
    const leafFailure = (reason: string) =>
      uncertain(KNOT_UNPROVEN, `Leaf ${index}: ${reason}.`, index);
    const startTrim = trimStart[index];
    const endTrim = trimEnd[index];
    if (
      (startTrim || endTrim) &&
      compareExact(
        addExact(startTrim ?? zero, endTrim ?? zero, budget),
        one,
        budget,
      ) >= 0
    )
      return leafFailure("retained domain not proved nonempty");
    let star = errors[index]!;
    for (const correction of [correctionStart[index], correctionEnd[index]])
      if (correction) star = addExact(star, correction, budget);
    const convex = arcStart[index] !== undefined || arcEnd[index] !== undefined;
    const comparison = compareExact(star, tolerance, budget);
    if (convex ? comparison >= 0 : comparison > 0)
      return leafFailure(
        convex
          ? "corrected base error is not below the modeling tolerance at a convex end"
          : "corrected base error exceeds the modeling tolerance",
      );
    let radius = errors[index]!;
    for (const arc of [arcStart[index], arcEnd[index]])
      if (arc) radius = addExact(radius, arc, budget);
    stars.push(star);
    radii.push(radius);
  }

  // K3: exact hull clearance of every non-join pair.
  const isJoin = (first: number, second: number) =>
    second === first + 1 || (closed && first === 0 && second === count - 1);
  const box = (cubic: ExactCubic) =>
    ([0, 1] as const).map((axis) => {
      const values = cubic.map((point) => point[axis]);
      return [minimum(values), maximum(values)] as const;
    });
  const squaredLength = (vector: ExactPoint) => dot(vector, vector);
  const clearedPairs: (readonly [number, number])[] = [];
  let maxSplits = 0;
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      if (isJoin(first, second)) continue;
      const radius = addExact(radii[first]!, radii[second]!, budget);
      const radiusSquared = multiplyExact(radius, radius, budget);
      const stack: (readonly [ExactCubic, ExactCubic])[] = [
        [poles[first]!, poles[second]!],
      ];
      let splits = 0;
      while (stack.length > 0) {
        const [left, right] = stack.pop()!;
        const leftBox = box(left);
        const rightBox = box(right);
        const gap = (axis: 0 | 1) => {
          const above = subtractExact(
            rightBox[axis]![0],
            leftBox[axis]![1],
            budget,
          );
          const below = subtractExact(
            leftBox[axis]![0],
            rightBox[axis]![1],
            budget,
          );
          const larger = compareExact(above, below, budget) > 0 ? above : below;
          return positive(larger) ? larger : zero;
        };
        if (
          compareExact(squaredLength([gap(0), gap(1)]), radiusSquared, budget) >
          0
        )
          continue;
        // Diagnostic and cost shortcut only: exact on-curve endpoints within
        // r_i + r_j cannot be separated by this certificate. Soundness never
        // depends on it; without it the loop fails closed on the budget.
        for (const u of [left[0], left[3]])
          for (const v of [right[0], right[3]])
            if (
              compareExact(
                squaredLength(difference(u, v)),
                radiusSquared,
                budget,
              ) <= 0
            )
              return uncertain(
                "cubic-tube-clearance-unproven",
                "Certified error tubes overlap; true-offset separation not proved.",
                first,
                second,
              );
        budget.refinementStep();
        splits += 1;
        const width = (bounds: typeof leftBox) => {
          const x = subtractExact(bounds[0]![1], bounds[0]![0], budget);
          const y = subtractExact(bounds[1]![1], bounds[1]![0], budget);
          return compareExact(x, y, budget) > 0 ? x : y;
        };
        if (compareExact(width(leftBox), width(rightBox), budget) >= 0)
          stack.push(
            [restrict(left, zero, half), right],
            [restrict(left, half, one), right],
          );
        else
          stack.push(
            [left, restrict(right, zero, half)],
            [left, restrict(right, half, one)],
          );
      }
      maxSplits = Math.max(maxSplits, splits);
      clearedPairs.push([first, second]);
    }
  }

  // Output, charged before it is built: every bound outward (up) binary64,
  // finite because each is dominated by the finite tolerance.
  budget.operation(
    8 + joins.length + clearedPairs.length + 3 * count + 4 * reports.size,
  );
  const up = (value: ExactFraction) => outwardExactNumber(value, "up", budget);
  const leaves = tubes.map((tube, index) => {
    const unchanged = (value: ExactFraction) =>
      value === errors[index] ? tube.certifiedError : up(value);
    const baseErrorStar = unchanged(stars[index]!);
    return {
      baseErrorStar,
      displacementBound:
        arcEnd[index] === undefined ? baseErrorStar : modelingTolerance,
      clearanceRadius: unchanged(radii[index]!),
    };
  });
  const certifiedJoins = joins.map(
    ([first, second], index): CubicTubeChainJoin => {
      const direction = directions[index]!;
      const report = reports.get(index);
      if (!report)
        return {
          first,
          second,
          kind: kinds[index] as "same-leaf" | "parallel-knot",
          direction,
        };
      return report.side === "convex"
        ? {
            first,
            second,
            kind: "nonparallel-knot",
            direction,
            side: "convex",
            arcDeviation: up(report.arcDeviation),
          }
        : {
            first,
            second,
            kind: "nonparallel-knot",
            direction,
            side: "concave",
            retainedCrossing: true,
            tail: [up(report.tail[0]), up(report.tail[1])],
            trim: [up(report.trim[0]), up(report.trim[1])],
          };
    },
  );
  return {
    kind: "verified",
    certificate: {
      joins: certifiedJoins,
      ...(isolatedSpanDirection ? { isolatedSpanDirection } : {}),
      leaves,
      clearedPairs,
      maxSplits,
    },
  };
}

function createCertifier(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain {
  return {
    certifyChain(request) {
      // One budget for the whole request: admission, conversion, every join,
      // knot, leaf, pair, split and the certificate. Never reset or replaced.
      const budget = new ExactProofBudget(lowerLimits);
      try {
        return certifyChain(request, budget);
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) return EXHAUSTED;
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },
  };
}

/** Production certifier under the unchanged exact-proof ceilings. */
export function createCertifiedCubicTubeChain(): CertifiedCubicTubeChain {
  return createCertifier();
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createCertifiedCubicTubeChainWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedCubicTubeChain {
  return createCertifier(lowerLimits);
}

/** Test-only whole-request meter observation under production ceilings. */
export function createCertifiedCubicTubeChainWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain {
  return createCertifier(undefined, observeBudget);
}
