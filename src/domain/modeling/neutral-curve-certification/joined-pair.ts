import { TWO_PI_OUTWARD_UPPER } from "@/contracts/modeling/circle-angular-domain";
import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  getNeutralCurveJoinParameter,
  neutralCurveParameterInside,
  neutralCurveSourceParameterInside,
  validateNeutralCurveJoinRequest,
  type NeutralCurve,
  type NeutralCurveJoinRequest,
  type NeutralCurveJoinResult,
  type NeutralCurveJoinWitness,
  type NeutralCurveOverlapWitness,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SplineVector } from "@/contracts/sketch/spline-geometry";
import {
  certifySinCos,
  outwardIntervalAdd,
  outwardIntervalMultiply,
  outwardIntervalNegate,
  type CertifiedInterval,
} from "@/domain/modeling/neutral-curve-certification/certified-trig";
import { validateCertifiedCircleAngularDomain } from "@/domain/modeling/neutral-curve-certification/circle-angular-certification";
import {
  admitVerifiedNeutralCurveResult,
  cubicPowerCoefficients,
  exactLineSupport,
  haveExactStructuralCubicBasis,
  normalizedExact,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  addExact,
  compareExact,
  compareFiniteSpanToTwoPiExact,
  exactFromNumber,
  multiplyExact,
  nextBinary64,
  polynomialDerivative,
  polynomialEvaluate,
  type ExactFraction,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

/**
 * Kernel-free declared-join certificate (T09a, design §2.1).
 *
 * Both curves are cut at every declared join into a near piece inside one
 * ball of radius ρ = modelingTolerance / 2 and far pieces. Every piece carries
 * an outward binary64 enclosure: a convex hull of boxes, a sagitta slack, and
 * a box cone of its tangent directions. Near/near contact at each join is
 * resolved by an exact shared point with a half-plane or tangent-cone
 * certificate, by the cone certificate plus subdivision localization, or by
 * the ordinary exact pair owner on the near pieces. Every other piece pair
 * is separated by support-function subdivision; unseparated leftovers go to
 * the ordinary exact pair owner on disjoint parameter boxes. Every reported
 * point must be certified outside every join ball.
 *
 * Exact overlaps are admitted only from the two structural families the
 * ordinary owner already proves on the whole pair (collinear segments and
 * same/reversed cubic pole identity): that owner runs first, and every
 * declared join must lie on its overlap.
 *
 * Full-turn circles (T10g-0). Every join on a full turn is interior, so its
 * near piece is a proper arc [θ − e, θ + e] lifted around the join angle θ
 * (it may cross the source seam). The far pieces cover the rest of the turn
 * from the first near piece's upper end h₁ up to E = ↑(l₁ + 2π), where l₁ is
 * that near piece's lower end: E ≥ l₁ + 2π, so near and far pieces cover the
 * whole circle. They overlap only on the arc [l₁ + 2π, E], and that overlap
 * ⊂ N₁ (mod 2π), checked: E − h₁ < 2π exactly, else `join-ball-crowded` (a
 * near piece narrower than the rounding of E). All pieces are proper arcs shorter than 2π in one
 * real-angle lift, so every enclosure and separation step is unchanged. The
 * ordinary owner runs on a piece through a source-winding `queryDomain` when
 * the piece lies in the winding; otherwise it runs on the whole turn and each
 * reported contact is kept only when its winding bounds lie in the piece
 * modulo 2π (exact comparisons), dropped when disjoint from it (another
 * piece pair reports it), and fails closed when it straddles a piece end.
 * Reported parameters therefore stay in the request's source winding.
 */

type Interval = CertifiedInterval;
type Box = readonly [Interval, Interval];
type Domain = readonly [number, number];
type Side = 0 | 1;
type PairCertifier = (
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
) => NeutralCurveQueryResult;
type Failure = Exclude<NeutralCurveJoinResult, { readonly kind: "verified" }>;
type VerifiedPair = Extract<
  NeutralCurveQueryResult,
  { readonly kind: "verified" }
>;
/** The ordinary owner's result on one piece pair, full-turn filtered. */
type OrdinaryOutcome =
  | Exclude<NeutralCurveQueryResult, { readonly kind: "verified" }>
  | Pick<VerifiedPair, "kind" | "points" | "overlaps">;

interface Enclosure {
  /** The piece lies in conv(boxes) ⊕ disk(slack). */
  readonly boxes: readonly Box[];
  readonly slack: number;
  /** Every tangent direction is a nonnegative combination of these boxes. */
  readonly tangents: readonly Box[];
}

interface Piece {
  readonly side: Side;
  readonly interval: Domain;
  readonly enclosure: Enclosure;
}

/** Subdivision depth for far piece pairs and near/near localization. */
const FAR_DEPTH = 28;
const LOCAL_DEPTH = 24;
/**
 * Work safeguard beside `ExactProofBudget`, not a tolerance: a deterministic
 * whole-request cap on separating-subdivision visits, shared by near/near
 * localization and every far piece pair. Hitting it returns `uncertain
 * join-separation-unresolved`; it never drops an unseparated leaf.
 */
const SUBDIVISION_VISIT_SAFEGUARD = 8_000;
/** Far arc pieces never exceed one radian (sagitta and cone validity). */
const MAX_ARC_PIECE = 1;
/** The binary64 neighbour below 2π; with `TWO_PI_OUTWARD_UPPER` it brackets 2π. */
const TWO_PI_INWARD_LOWER = 6.283185307179586;
const NEAR_HALVINGS = 8;

class JoinUncertain extends Error {
  readonly code: string;
  readonly detail: string;
  readonly kind: Failure["kind"];

  constructor(
    code: string,
    detail: string,
    kind: Failure["kind"] = "uncertain",
  ) {
    super(detail);
    this.code = code;
    this.detail = detail;
    this.kind = kind;
  }
}

function fail(code: string, message: string): never {
  throw new JoinUncertain(code, message);
}

function point(value: number): Interval {
  return { lower: value, upper: value };
}

class OutwardArithmetic {
  readonly budget: ExactProofBudget;

  constructor(budget: ExactProofBudget) {
    this.budget = budget;
  }

  add(first: Interval, second: Interval) {
    return outwardIntervalAdd(first, second, this.budget);
  }

  subtract(first: Interval, second: Interval) {
    return outwardIntervalAdd(
      first,
      outwardIntervalNegate(second),
      this.budget,
    );
  }

  multiply(first: Interval, second: Interval) {
    return outwardIntervalMultiply(first, second, this.budget);
  }

  /** Division by a strictly positive interval. */
  dividePositive(first: Interval, second: Interval): Interval {
    this.budget.operation(4);
    const quotients = [
      first.lower / second.lower,
      first.lower / second.upper,
      first.upper / second.lower,
      first.upper / second.upper,
    ];
    return {
      lower: nextBinary64(Math.min(...quotients), "down", this.budget),
      upper: nextBinary64(Math.max(...quotients), "up", this.budget),
    };
  }

  up(value: number) {
    return nextBinary64(value, "up", this.budget);
  }

  down(value: number) {
    return nextBinary64(value, "down", this.budget);
  }
}

function boxPoint(vector: SplineVector): Box {
  return [point(vector[0]), point(vector[1])];
}

function boxMid(box: Box): SplineVector {
  return [
    box[0].lower + (box[0].upper - box[0].lower) / 2,
    box[1].lower + (box[1].upper - box[1].lower) / 2,
  ];
}

/** Outward enclosures of one whole source curve over binary64 subintervals. */
class CurveModel {
  /** Null for a full-turn circle: its pieces are real-angle arcs in any lift. */
  readonly domain: Domain | null;
  readonly speed: number;
  readonly #arithmetic: OutwardArithmetic;
  readonly #radiusScale: Interval | null;
  readonly #arcSamples = new Map<
    number,
    { readonly position: Box; readonly tangent: Box }
  >();
  readonly curve: NeutralCurve;

  constructor(curve: NeutralCurve, arithmetic: OutwardArithmetic) {
    this.curve = curve;
    this.#arithmetic = arithmetic;
    if (curve.kind === "circle") {
      this.domain =
        curve.sourceDomain.kind === "arc" ? curve.sourceDomain.interval : null;
      this.speed = curve.radius;
      this.#radiusScale = this.#circleRadiusScale(curve);
    } else {
      this.domain = curve.sourceDomain;
      this.#radiusScale = null;
      if (curve.kind === "line") {
        this.speed =
          curve.form === "endpointSegment"
            ? Math.hypot(
                curve.end[0] - curve.start[0],
                curve.end[1] - curve.start[1],
              )
            : 1;
      } else {
        let maximum = 0;
        for (let index = 0; index < 3; index += 1) {
          const from = curve.poles[index]!;
          const to = curve.poles[index + 1]!;
          maximum = Math.max(
            maximum,
            Math.hypot(to[0] - from[0], to[1] - from[1]),
          );
        }
        this.speed =
          (3 * maximum) / (curve.sourceDomain[1] - curve.sourceDomain[0]);
      }
    }
  }

  /** R / |xAxis| with an exactly verified square-root bracket. */
  #circleRadiusScale(curve: Extract<NeutralCurve, { kind: "circle" }>) {
    const budget = this.#arithmetic.budget;
    const x = exactFromNumber(curve.xAxis[0], budget);
    const y = exactFromNumber(curve.xAxis[1], budget);
    const squared = addExact(
      multiplyExact(x, x, budget),
      multiplyExact(y, y, budget),
      budget,
    );
    const estimate = Math.hypot(curve.xAxis[0], curve.xAxis[1]);
    let lower = this.#arithmetic.down(estimate);
    let upper = this.#arithmetic.up(estimate);
    const square = (value: number) => {
      const exactValue = exactFromNumber(value, budget);
      return multiplyExact(exactValue, exactValue, budget);
    };
    for (
      let step = 0;
      compareExact(square(lower), squared, budget) > 0;
      step += 1
    ) {
      if (step >= 8) throw new Error("Square-root bracket failed to close.");
      lower = this.#arithmetic.down(lower);
    }
    for (
      let step = 0;
      compareExact(square(upper), squared, budget) < 0;
      step += 1
    ) {
      if (step >= 8) throw new Error("Square-root bracket failed to close.");
      upper = this.#arithmetic.up(upper);
    }
    return this.#arithmetic.dividePositive(point(curve.radius), {
      lower,
      upper,
    });
  }

  /** Memoized outward point and tangent boxes at one binary64 angle. */
  #arcSample(curve: Extract<NeutralCurve, { kind: "circle" }>, angle: number) {
    const cached = this.#arcSamples.get(angle);
    if (cached) return cached;
    const arithmetic = this.#arithmetic;
    const scale = this.#radiusScale!;
    const axis = curve.xAxis;
    const values = certifySinCos(angle, arithmetic.budget);
    if (!values)
      fail(
        "join-angle-unsupported",
        "The certified sine/cosine range reduction rejected an arc angle.",
      );
    const { sine, cosine } = values;
    // P = C + k(cos·X + sin·Y), T = −sin·X + cos·Y, Y = (−X_y, X_x), k = R/|X|.
    const radialX = arithmetic.subtract(
      arithmetic.multiply(cosine, point(axis[0])),
      arithmetic.multiply(sine, point(axis[1])),
    );
    const radialY = arithmetic.add(
      arithmetic.multiply(cosine, point(axis[1])),
      arithmetic.multiply(sine, point(axis[0])),
    );
    const sample = {
      position: [
        arithmetic.add(
          point(curve.center[0]),
          arithmetic.multiply(scale, radialX),
        ),
        arithmetic.add(
          point(curve.center[1]),
          arithmetic.multiply(scale, radialY),
        ),
      ] as Box,
      tangent: [outwardIntervalNegate(radialY), radialX] as Box,
    };
    this.#arcSamples.set(angle, sample);
    return sample;
  }

  enclose(interval: Domain): Enclosure {
    this.#arithmetic.budget.operation();
    const curve = this.curve;
    const arithmetic = this.#arithmetic;
    const [a, b] = interval;
    if (curve.kind === "line" && curve.form === "endpointSegment") {
      const difference: Box = [
        arithmetic.subtract(point(curve.end[0]), point(curve.start[0])),
        arithmetic.subtract(point(curve.end[1]), point(curve.start[1])),
      ];
      const at = (t: number): Box =>
        t === 0
          ? boxPoint(curve.start)
          : t === 1
            ? boxPoint(curve.end)
            : [
                arithmetic.add(
                  point(curve.start[0]),
                  arithmetic.multiply(point(t), difference[0]),
                ),
                arithmetic.add(
                  point(curve.start[1]),
                  arithmetic.multiply(point(t), difference[1]),
                ),
              ];
      return { boxes: [at(a), at(b)], slack: 0, tangents: [difference] };
    }
    if (curve.kind === "line") {
      const at = (s: number): Box => [
        arithmetic.add(
          point(curve.origin[0]),
          arithmetic.multiply(point(s), point(curve.direction[0])),
        ),
        arithmetic.add(
          point(curve.origin[1]),
          arithmetic.multiply(point(s), point(curve.direction[1])),
        ),
      ];
      return {
        boxes: [at(a), at(b)],
        slack: 0,
        tangents: [boxPoint(curve.direction)],
      };
    }
    if (curve.kind === "circle") {
      const at = (angle: number) => this.#arcSample(curve, angle);
      const lower = at(a);
      const upper = at(b);
      // Sagitta of an arc of angle w ≤ 1: R(1 − cos(w/2)) ≤ R·w²/8.
      const width = arithmetic.up(b - a);
      const slack =
        a === b
          ? 0
          : arithmetic.up(
              arithmetic.up(arithmetic.up(curve.radius * width) * width) / 8,
            );
      return {
        boxes: [lower.position, upper.position],
        slack,
        tangents: [lower.tangent, upper.tangent],
      };
    }
    const [s0, s1] = curve.sourceDomain;
    const length = arithmetic.subtract(point(s1), point(s0));
    const normalized = (s: number) =>
      s === s0
        ? point(0)
        : s === s1
          ? point(1)
          : arithmetic.dividePositive(
              arithmetic.subtract(point(s), point(s0)),
              length,
            );
    const lower = normalized(a);
    const upper = normalized(b);
    const poles = curve.poles.map(boxPoint);
    const blossom = (parameters: readonly Interval[]): Box => {
      let level: Box[] = poles;
      for (const parameter of parameters) {
        const next: Box[] = [];
        for (let index = 0; index + 1 < level.length; index += 1) {
          const from = level[index]!;
          const to = level[index + 1]!;
          next.push([
            arithmetic.add(
              from[0],
              arithmetic.multiply(
                parameter,
                arithmetic.subtract(to[0], from[0]),
              ),
            ),
            arithmetic.add(
              from[1],
              arithmetic.multiply(
                parameter,
                arithmetic.subtract(to[1], from[1]),
              ),
            ),
          ]);
        }
        level = next;
      }
      return level[0]!;
    };
    const end = (s: number, parameter: Interval) =>
      s === s0
        ? poles[0]!
        : s === s1
          ? poles[3]!
          : blossom([parameter, parameter, parameter]);
    const restricted: Box[] = [
      end(a, lower),
      blossom([lower, lower, upper]),
      blossom([lower, upper, upper]),
      end(b, upper),
    ];
    const tangents: Box[] = [];
    for (let index = 0; index < 3; index += 1) {
      tangents.push([
        arithmetic.subtract(restricted[index + 1]![0], restricted[index]![0]),
        arithmetic.subtract(restricted[index + 1]![1], restricted[index]![1]),
      ]);
    }
    return { boxes: restricted, slack: 0, tangents };
  }

  piece(side: Side, interval: Domain): Piece {
    return { side, interval, enclosure: this.enclose(interval) };
  }

  /** Halves at the binary64 midpoint, or null when the interval is atomic. */
  split(piece: Piece): readonly [Piece, Piece] | null {
    const [a, b] = piece.interval;
    const middle = a + (b - a) / 2;
    if (!(a < middle && middle < b)) return null;
    return [
      this.piece(piece.side, [a, middle]),
      this.piece(piece.side, [middle, b]),
    ];
  }

  /** The exact point at a declared parameter, for polynomial curves only. */
  exactPoint(
    parameter: number,
  ): readonly [ExactFraction, ExactFraction] | null {
    const budget = this.#arithmetic.budget;
    const curve = this.curve;
    if (curve.kind === "circle") return null;
    if (curve.kind === "line") {
      const { origin, direction } = exactLineSupport(curve, budget);
      const t = exactFromNumber(parameter, budget);
      return [
        addExact(origin[0], multiplyExact(t, direction[0], budget), budget),
        addExact(origin[1], multiplyExact(t, direction[1], budget), budget),
      ];
    }
    if (
      parameter === curve.sourceDomain[0] ||
      parameter === curve.sourceDomain[1]
    ) {
      const pole = curve.poles[parameter === curve.sourceDomain[0] ? 0 : 3];
      return [
        exactFromNumber(pole[0], budget),
        exactFromNumber(pole[1], budget),
      ];
    }
    const coefficients = cubicPowerCoefficients(curve, budget);
    const tau = normalizedExact(parameter, curve.sourceDomain, budget);
    return [0, 1].map((axis) =>
      polynomialEvaluate(
        coefficients.map((coefficient) => coefficient[axis]!),
        tau,
        budget,
      ),
    ) as [ExactFraction, ExactFraction];
  }

  /** Exact zero test of the cubic derivative at a declared parameter. */
  zeroTangent(parameter: number) {
    const budget = this.#arithmetic.budget;
    const curve = this.curve;
    if (curve.kind !== "cubicBezier") return false;
    const [p0, p1, p2, p3] = curve.poles;
    const same = (first: SplineVector, second: SplineVector) =>
      first[0] === second[0] && first[1] === second[1];
    if (parameter === curve.sourceDomain[0]) return same(p0, p1);
    if (parameter === curve.sourceDomain[1]) return same(p2, p3);
    const coefficients = cubicPowerCoefficients(curve, budget);
    const tau = normalizedExact(parameter, curve.sourceDomain, budget);
    return [0, 1].every(
      (axis) =>
        polynomialEvaluate(
          polynomialDerivative(
            coefficients.map((coefficient) => coefficient[axis]!),
            budget,
          ),
          tau,
          budget,
        ).numerator === 0n,
    );
  }
}

class JoinCertifier {
  readonly #arithmetic: OutwardArithmetic;
  readonly #models: readonly [CurveModel, CurveModel];
  #visits = 0;
  #centers: SplineVector[] = [];
  #radius = 0;
  readonly request: NeutralCurveJoinRequest;
  readonly budget: ExactProofBudget;
  readonly certifyPair: PairCertifier;

  constructor(
    request: NeutralCurveJoinRequest,
    budget: ExactProofBudget,
    certifyPair: PairCertifier,
  ) {
    this.request = request;
    this.budget = budget;
    this.certifyPair = certifyPair;
    this.#arithmetic = new OutwardArithmetic(budget);
    this.#models = [
      new CurveModel(request.first, this.#arithmetic),
      new CurveModel(request.second, this.#arithmetic),
    ];
  }

  /** Outward upper bound of max over the piece of n·x. */
  #supremum(enclosure: Enclosure, direction: SplineVector) {
    const arithmetic = this.#arithmetic;
    const [nx, ny] = direction;
    let best = -Infinity;
    for (const box of enclosure.boxes) {
      const value = arithmetic.up(
        arithmetic.up(nx * (nx >= 0 ? box[0].upper : box[0].lower)) +
          arithmetic.up(ny * (ny >= 0 ? box[1].upper : box[1].lower)),
      );
      best = Math.max(best, value);
    }
    if (enclosure.slack > 0) {
      best = arithmetic.up(
        best +
          arithmetic.up(
            enclosure.slack * arithmetic.up(Math.abs(nx) + Math.abs(ny)),
          ),
      );
    }
    return best;
  }

  #infimum(enclosure: Enclosure, direction: SplineVector) {
    return -this.#supremum(enclosure, [-direction[0], -direction[1]]);
  }

  #center(enclosure: Enclosure): SplineVector {
    const bounds = this.#bounds(enclosure);
    return boxMid(bounds);
  }

  /** Outward axis-aligned bounds of the whole enclosure. */
  #bounds(enclosure: Enclosure): Box {
    let xl = Infinity;
    let xu = -Infinity;
    let yl = Infinity;
    let yu = -Infinity;
    for (const box of enclosure.boxes) {
      xl = Math.min(xl, box[0].lower);
      xu = Math.max(xu, box[0].upper);
      yl = Math.min(yl, box[1].lower);
      yu = Math.max(yu, box[1].upper);
    }
    const slack = enclosure.slack;
    if (slack === 0)
      return [
        { lower: xl, upper: xu },
        { lower: yl, upper: yu },
      ];
    const arithmetic = this.#arithmetic;
    return [
      { lower: arithmetic.down(xl - slack), upper: arithmetic.up(xu + slack) },
      { lower: arithmetic.down(yl - slack), upper: arithmetic.up(yu + slack) },
    ];
  }

  /** A separating direction proves the two closed pieces disjoint. */
  #separated(first: Piece, second: Piece) {
    this.budget.operation();
    const a = first.enclosure;
    const b = second.enclosure;
    const centerA = this.#center(a);
    const centerB = this.#center(b);
    const chord = (enclosure: Enclosure): SplineVector => {
      const from = boxMid(enclosure.boxes[0]!);
      const to = boxMid(enclosure.boxes[enclosure.boxes.length - 1]!);
      return [to[0] - from[0], to[1] - from[1]];
    };
    const chordA = chord(a);
    const chordB = chord(b);
    const candidates: SplineVector[] = [
      [centerB[0] - centerA[0], centerB[1] - centerA[1]],
      [-chordA[1], chordA[0]],
      [-chordB[1], chordB[0]],
      chordA,
      chordB,
    ];
    for (const direction of candidates) {
      if (
        !Number.isFinite(direction[0]) ||
        !Number.isFinite(direction[1]) ||
        (direction[0] === 0 && direction[1] === 0)
      )
        continue;
      if (
        this.#supremum(a, direction) < this.#infimum(b, direction) ||
        this.#supremum(b, direction) < this.#infimum(a, direction)
      )
        return true;
    }
    return false;
  }

  /**
   * All tangent-generator cross products share one strict sign, so the two
   * closed direction cones and their negatives meet only at 0: the pieces
   * meet at most once (every chord between two contacts would lie in both).
   */
  #conesDisjoint(first: Piece, second: Piece) {
    const arithmetic = this.#arithmetic;
    let sign = 0;
    for (const a of first.enclosure.tangents) {
      for (const b of second.enclosure.tangents) {
        const cross = arithmetic.subtract(
          arithmetic.multiply(a[0], b[1]),
          arithmetic.multiply(a[1], b[0]),
        );
        const current = cross.lower > 0 ? 1 : cross.upper < 0 ? -1 : 0;
        if (current === 0 || (sign !== 0 && current !== sign)) return false;
        sign = current;
      }
    }
    return sign !== 0;
  }

  /**
   * Both near pieces end at the exact shared point p. With p the terminal
   * pole of each piece, every other hull box strictly on opposite sides of
   * one line through p keeps every non-p curve point strictly inside its open
   * half-plane, so the pieces meet exactly at p.
   */
  #halfPlaneAtSharedEnd(
    first: Piece,
    firstEndsAtJoin: boolean,
    second: Piece,
    secondEndsAtJoin: boolean,
  ) {
    const arithmetic = this.#arithmetic;
    const terminal = (piece: Piece, endsAtJoin: boolean) => {
      const boxes = piece.enclosure.boxes;
      return endsAtJoin ? boxes[boxes.length - 1]! : boxes[0]!;
    };
    const others = (piece: Piece, endsAtJoin: boolean) => {
      const boxes = piece.enclosure.boxes;
      return endsAtJoin ? boxes.slice(0, -1) : boxes.slice(1);
    };
    const p = terminal(first, firstEndsAtJoin);
    const joinMid = boxMid(p);
    const unit = (box: Box): SplineVector => {
      const mid = boxMid(box);
      const vector: SplineVector = [mid[0] - joinMid[0], mid[1] - joinMid[1]];
      const length = Math.hypot(vector[0], vector[1]);
      return [vector[0] / length, vector[1] / length];
    };
    const firstOthers = others(first, firstEndsAtJoin);
    const secondOthers = others(second, secondEndsAtJoin);
    const firstNeighbor = firstEndsAtJoin
      ? firstOthers[firstOthers.length - 1]!
      : firstOthers[0]!;
    const secondNeighbor = secondEndsAtJoin
      ? secondOthers[secondOthers.length - 1]!
      : secondOthers[0]!;
    // u1 points from the first piece into p, u2 from p into the second piece.
    const away = unit(firstNeighbor);
    const u1: SplineVector = [-away[0], -away[1]];
    const u2 = unit(secondNeighbor);
    const candidates: SplineVector[] = [[u1[0] + u2[0], u1[1] + u2[1]], u1, u2];
    for (const direction of candidates) {
      if (
        !Number.isFinite(direction[0]) ||
        !Number.isFinite(direction[1]) ||
        (direction[0] === 0 && direction[1] === 0)
      )
        continue;
      const pEnclosure: Enclosure = { boxes: [p], slack: 0, tangents: [] };
      const pLower = this.#infimum(pEnclosure, direction);
      const pUpper = this.#supremum(pEnclosure, direction);
      const box = (value: Box): Enclosure => ({
        boxes: [value],
        slack: 0,
        tangents: [],
      });
      if (
        firstOthers.every(
          (value) => this.#supremum(box(value), direction) < pLower,
        ) &&
        secondOthers.every(
          (value) => this.#infimum(box(value), direction) > pUpper,
        )
      ) {
        arithmetic.budget.operation();
        return true;
      }
    }
    return false;
  }

  #containedInBall(enclosure: Enclosure, center: SplineVector, radius: number) {
    const arithmetic = this.#arithmetic;
    const available = arithmetic.down(radius - enclosure.slack);
    if (!(available > 0)) return false;
    const limit = arithmetic.down(available * available);
    return enclosure.boxes.every((box) => {
      const dx = Math.max(
        Math.abs(arithmetic.down(box[0].lower - center[0])),
        Math.abs(arithmetic.up(box[0].upper - center[0])),
      );
      const dy = Math.max(
        Math.abs(arithmetic.down(box[1].lower - center[1])),
        Math.abs(arithmetic.up(box[1].upper - center[1])),
      );
      return (
        arithmetic.up(arithmetic.up(dx * dx) + arithmetic.up(dy * dy)) <= limit
      );
    });
  }

  /** The whole enclosure lies strictly outside the closed ball. */
  #outsideBall(enclosure: Enclosure, center: SplineVector, radius: number) {
    const arithmetic = this.#arithmetic;
    const bounds = this.#bounds(enclosure);
    const gap = (interval: Interval, coordinate: number) =>
      interval.lower > coordinate
        ? arithmetic.down(interval.lower - coordinate)
        : interval.upper < coordinate
          ? arithmetic.down(coordinate - interval.upper)
          : 0;
    const dx = gap(bounds[0], center[0]);
    const dy = gap(bounds[1], center[1]);
    return (
      arithmetic.down(arithmetic.down(dx * dx) + arithmetic.down(dy * dy)) >
      arithmetic.up(radius * radius)
    );
  }

  #visit() {
    this.#visits += 1;
    if (this.#visits > SUBDIVISION_VISIT_SAFEGUARD)
      fail(
        "join-separation-unresolved",
        "Separating subdivision exceeded its whole-request visit cap.",
      );
  }

  /** Unseparated leaf pairs after symmetric subdivision to `depth`. */
  #subdivide(first: Piece, second: Piece, depth: number) {
    const leftovers: (readonly [Piece, Piece])[] = [];
    const stack: (readonly [Piece, Piece, number])[] = [[first, second, 0]];
    while (stack.length > 0) {
      const [a, b, level] = stack.pop()!;
      this.#visit();
      if (this.#separated(a, b)) continue;
      const aChildren = level < depth ? this.#models[a.side].split(a) : null;
      const bChildren = level < depth ? this.#models[b.side].split(b) : null;
      if (!aChildren && !bChildren) {
        leftovers.push([a, b]);
        continue;
      }
      for (const aChild of aChildren ?? [a]) {
        for (const bChild of bChildren ?? [b]) {
          stack.push([aChild, bChild, level + 1]);
        }
      }
    }
    return leftovers;
  }

  /**
   * The ordinary-owner curve for one piece. A full-turn piece outside the
   * source winding runs on the whole turn, filtered by the piece.
   */
  #restricted(
    side: Side,
    interval: Domain,
  ): { readonly curve: NeutralCurve; readonly filter: Domain | null } {
    const curve = this.#models[side].curve;
    if (curve.kind !== "circle")
      return { curve: { ...curve, queryDomain: interval }, filter: null };
    const restricted: Extract<NeutralCurve, { kind: "circle" }> = {
      ...curve,
      queryDomain: { kind: "arc", interval },
    };
    if (
      curve.sourceDomain.kind === "arc" ||
      validateCertifiedCircleAngularDomain(restricted, this.budget)
    )
      return { curve: restricted, filter: null };
    return { curve, filter: interval };
  }

  /** The ordinary exact owner on one closed parameter box, same argument order. */
  #ordinary(firstInterval: Domain, secondInterval: Domain): OrdinaryOutcome {
    const first = this.#restricted(0, firstInterval);
    const second = this.#restricted(1, secondInterval);
    const result = this.certifyPair(
      {
        modelingTolerance: this.request.modelingTolerance,
        first: first.curve,
        second: second.curve,
      },
      this.budget,
    );
    if (result.kind !== "verified" || (!first.filter && !second.filter))
      return result;
    const points = result.points.filter((found) => {
      const inFirst = this.#inPiece(
        found.proof.firstParameterBounds,
        first.filter,
      );
      const inSecond = this.#inPiece(
        found.proof.secondParameterBounds,
        second.filter,
      );
      return inFirst && inSecond;
    });
    return { kind: "verified", points, overlaps: result.overlaps };
  }

  /**
   * Whether a contact's source-winding bounds lie in the real-angle piece
   * modulo 2π: true when some shift t + 2πk holds them in the piece, false
   * when every shift is disjoint from it, and a failure otherwise (a contact
   * on a piece end, or an undecided comparison). Shifts outside the scanned
   * range miss the piece by more than a turn less the binary64 error of the
   * range estimate.
   */
  #inPiece(bounds: readonly [number, number], piece: Domain | null) {
    if (!piece) return true;
    const [t0, t1] = bounds;
    const [a, b] = piece;
    const turn = 2 * Math.PI;
    const lowest = Math.floor((a - t1) / turn) - 1;
    const highest = Math.ceil((b - t0) / turn) + 1;
    let inside = false;
    for (let k = lowest; k <= highest; k += 1) {
      this.budget.operation();
      // a ≤ t0 + 2πk and t1 + 2πk ≤ b.
      const lower = this.#turnSign(a, t0, -k);
      const upper = this.#turnSign(t1, b, k);
      if (lower !== null && lower >= 0 && upper !== null && upper >= 0) {
        inside = true;
        continue;
      }
      // t1 + 2πk < a or t0 + 2πk > b.
      if (this.#turnSign(a, t1, -k) === -1 || this.#turnSign(t0, b, k) === -1)
        continue;
      return fail(
        "join-full-turn-piece-unresolved",
        "A contact on a full-turn circle is not certified inside or outside one certificate piece.",
      );
    }
    return inside;
  }

  /** sign((y − x) − 2πk), exact; null when the outward bracket and the exact one-turn comparison cannot decide. */
  #turnSign(x: number, y: number, k: number): -1 | 0 | 1 | null {
    if (k === 0) return y > x ? 1 : y < x ? -1 : 0;
    const arithmetic = this.#arithmetic;
    const difference = y - x;
    const [turnsLower, turnsUpper] =
      k > 0
        ? [k * TWO_PI_INWARD_LOWER, k * TWO_PI_OUTWARD_UPPER]
        : [k * TWO_PI_OUTWARD_UPPER, k * TWO_PI_INWARD_LOWER];
    if (arithmetic.up(difference) < arithmetic.down(turnsLower)) return -1;
    if (arithmetic.down(difference) > arithmetic.up(turnsUpper)) return 1;
    if (k === 1)
      return y <= x ? -1 : compareFiniteSpanToTwoPiExact(x, y, this.budget);
    if (k === -1) {
      if (x <= y) return 1;
      const sign = compareFiniteSpanToTwoPiExact(y, x, this.budget);
      return sign === null ? null : sign === 1 ? -1 : 1;
    }
    return null;
  }

  /** Closed boxes that touch or overlap are merged until pairwise disjoint. */
  #clusters(leftovers: readonly (readonly [Piece, Piece])[]) {
    let boxes = leftovers.map(
      ([a, b]) => [a.interval, b.interval] as [Domain, Domain],
    );
    let merged = true;
    while (merged) {
      merged = false;
      const next: [Domain, Domain][] = [];
      for (const box of boxes) {
        this.budget.operation();
        const index = next.findIndex((other) => {
          this.budget.operation();
          return (
            box[0][0] <= other[0][1] &&
            other[0][0] <= box[0][1] &&
            box[1][0] <= other[1][1] &&
            other[1][0] <= box[1][1]
          );
        });
        if (index < 0) {
          next.push(box);
          continue;
        }
        const other = next[index]!;
        next[index] = [
          [Math.min(box[0][0], other[0][0]), Math.max(box[0][1], other[0][1])],
          [Math.min(box[1][0], other[1][0]), Math.max(box[1][1], other[1][1])],
        ];
        merged = true;
      }
      boxes = next;
    }
    return boxes;
  }

  #nearInterval(
    side: Side,
    parameter: number,
    location: NeutralCurveJoinRequest["joins"][number]["first"],
    center: SplineVector,
    radius: number,
    distance: number,
  ): Piece {
    const model = this.#models[side];
    // A full turn never clamps: its near piece is lifted around the join.
    const [lower, upper] = model.domain ?? [-Infinity, Infinity];
    let extent = (radius - distance) / model.speed;
    if (model.curve.kind === "circle") extent = Math.min(extent, 0.5);
    if (!Number.isFinite(extent)) extent = upper - lower;
    for (let halving = 0; halving < NEAR_HALVINGS; halving += 1) {
      this.budget.operation();
      const a =
        location === "start" ? lower : Math.max(lower, parameter - extent);
      const b =
        location === "end" ? upper : Math.min(upper, parameter + extent);
      if (a < b) {
        const piece = model.piece(side, [a, b]);
        if (this.#containedInBall(piece.enclosure, center, radius))
          return piece;
      }
      extent /= 2;
    }
    return fail(
      "join-ball-exceeds-tolerance",
      "No near piece fits inside a join ball of radius modelingTolerance / 2.",
    );
  }

  #interpretNear(
    result: OrdinaryOutcome,
    parameters: readonly [number, number],
  ):
    | { readonly kind: "declared"; readonly bounds?: readonly [Domain, Domain] }
    | { readonly kind: "point"; readonly point: NeutralCurvePointWitness } {
    if (result.kind !== "verified")
      throw new JoinUncertain(result.code, result.message, result.kind);
    if (result.overlaps.length > 0 || result.points.length > 1)
      fail(
        "join-ball-crowded",
        "The near pieces of a declared join meet more than once inside its ball.",
      );
    const found = result.points[0];
    if (!found) return { kind: "declared" };
    // A contact whose boxes hold both declared locations is the declared join.
    if (
      neutralCurveParameterInside(
        parameters[0],
        found.proof.firstParameterBounds,
      ) &&
      neutralCurveParameterInside(
        parameters[1],
        found.proof.secondParameterBounds,
      )
    )
      return {
        kind: "declared",
        bounds: [
          found.proof.firstParameterBounds,
          found.proof.secondParameterBounds,
        ],
      };
    return { kind: "point", point: found };
  }

  #join(index: number, near: readonly [Piece, Piece]): NeutralCurveJoinWitness {
    const join = this.request.joins[index]!;
    const arithmetic = this.#arithmetic;
    const parameters = [
      getNeutralCurveJoinParameter(this.request.first, join.first)!,
      getNeutralCurveJoinParameter(this.request.second, join.second)!,
    ] as const;
    const center = this.#centers[index]!;
    const radius = this.#radius;
    const declared = (
      bounds: readonly [Domain, Domain] = [
        [parameters[0], parameters[0]],
        [parameters[1], parameters[1]],
      ],
    ): NeutralCurveJoinWitness => ({
      firstParameter: parameters[0],
      secondParameter: parameters[1],
      firstParameterBounds: bounds[0],
      secondParameterBounds: bounds[1],
      position: center,
      ballRadius: radius,
      realization: "declaredEnds",
    });
    const unique = (
      found: NeutralCurvePointWitness,
    ): NeutralCurveJoinWitness => {
      // |position − c| bounded outward per axis, as in #containedInBall.
      const dx = Math.max(
        Math.abs(arithmetic.down(found.position[0] - center[0])),
        Math.abs(arithmetic.up(found.position[0] - center[0])),
      );
      const dy = Math.max(
        Math.abs(arithmetic.down(found.position[1] - center[1])),
        Math.abs(arithmetic.up(found.position[1] - center[1])),
      );
      const offset = arithmetic.up(
        Math.sqrt(
          arithmetic.up(arithmetic.up(dx * dx) + arithmetic.up(dy * dy)),
        ),
      );
      const ballRadius = arithmetic.up(radius + offset);
      if (!(ballRadius <= this.request.modelingTolerance))
        fail(
          "join-ball-exceeds-tolerance",
          "The ball around the realized contact would exceed modelingTolerance.",
        );
      return {
        firstParameter: found.firstParameter,
        secondParameter: found.secondParameter,
        firstParameterBounds: found.proof.firstParameterBounds,
        secondParameterBounds: found.proof.secondParameterBounds,
        position: found.position,
        ballRadius,
        realization: "uniqueContactInBall",
      };
    };
    const [first, second] = near;
    const kinds = [this.request.first.kind, this.request.second.kind];
    if (kinds[0] === "line" && kinds[1] === "line") {
      const outcome = this.#interpretNear(
        this.#ordinary(first.interval, second.interval),
        parameters,
      );
      return outcome.kind === "declared"
        ? declared(outcome.bounds)
        : unique(outcome.point);
    }
    const exact = [
      this.#models[0].exactPoint(parameters[0]),
      this.#models[1].exactPoint(parameters[1]),
    ];
    if (
      exact[0] &&
      exact[1] &&
      compareExact(exact[0][0], exact[1][0], this.budget) === 0 &&
      compareExact(exact[0][1], exact[1][1], this.budget) === 0
    ) {
      const ends = [join.first, join.second].map((location) =>
        location === "start" ? false : location === "end" ? true : null,
      );
      if (
        (ends[0] !== null &&
          ends[1] !== null &&
          this.#halfPlaneAtSharedEnd(first, ends[0], second, ends[1])) ||
        this.#conesDisjoint(first, second)
      )
        return declared();
      return fail(
        "join-near-pieces-unresolved",
        "A shared join point has no half-plane or tangent-cone certificate (cusp, spike or tangential reversal).",
      );
    }
    if (this.#conesDisjoint(first, second)) {
      const leftovers = this.#subdivide(first, second, LOCAL_DEPTH);
      if (leftovers.length === 0) return declared();
      let hull: [[number, number], [number, number]] = [
        [Infinity, -Infinity],
        [Infinity, -Infinity],
      ];
      for (const [a, b] of leftovers) {
        hull = [
          [
            Math.min(hull[0][0], a.interval[0]),
            Math.max(hull[0][1], a.interval[1]),
          ],
          [
            Math.min(hull[1][0], b.interval[0]),
            Math.max(hull[1][1], b.interval[1]),
          ],
        ];
      }
      if (
        neutralCurveParameterInside(parameters[0], hull[0]) &&
        neutralCurveParameterInside(parameters[1], hull[1])
      )
        return declared(hull);
      const outcome = this.#interpretNear(
        this.#ordinary(hull[0], hull[1]),
        parameters,
      );
      return outcome.kind === "declared"
        ? declared(outcome.bounds)
        : unique(outcome.point);
    }
    if (kinds[0] === "cubicBezier" && kinds[1] === "cubicBezier") {
      return fail(
        "join-near-pieces-unresolved",
        "Tangential cubic near pieces without a shared exact point are not certified.",
      );
    }
    const outcome = this.#interpretNear(
      this.#ordinary(first.interval, second.interval),
      parameters,
    );
    return outcome.kind === "declared"
      ? declared(outcome.bounds)
      : unique(outcome.point);
  }

  run(): NeutralCurveJoinResult {
    const request = this.request;
    this.#radius = request.modelingTolerance / 2;
    const radius = this.#radius;
    const located = request.joins.map((join) => {
      const parameters = [
        getNeutralCurveJoinParameter(request.first, join.first)!,
        getNeutralCurveJoinParameter(request.second, join.second)!,
      ] as const;
      for (const side of [0, 1] as const) {
        if (this.#models[side].zeroTangent(parameters[side]))
          fail(
            "join-zero-end-tangent",
            "A cubic has a zero tangent at a declared join location.",
          );
      }
      const positions = [
        evaluateNeutralCurve(request.first, parameters[0]),
        evaluateNeutralCurve(request.second, parameters[1]),
      ] as const;
      const center: SplineVector = [
        (positions[0][0] + positions[1][0]) / 2,
        (positions[0][1] + positions[1][1]) / 2,
      ];
      if (!Number.isFinite(center[0]) || !Number.isFinite(center[1]))
        fail("join-ball-exceeds-tolerance", "The join centre is not finite.");
      this.#centers.push(center);
      for (const side of [0, 1] as const) {
        const declaredPoint = this.#models[side].enclose([
          parameters[side],
          parameters[side],
        ]);
        if (!this.#containedInBall(declaredPoint, center, radius))
          fail(
            "join-ball-exceeds-tolerance",
            "The declared join points do not fit in one ball of radius modelingTolerance / 2.",
          );
      }
      return { join, parameters, positions, center };
    });

    const structural = this.#structuralOverlap();
    if (structural) return this.#overlapResult(structural, located);

    const nearPieces: (readonly [Piece, Piece])[] = [];
    for (const { join, parameters, positions, center } of located) {
      const pieces = ([0, 1] as const).map((side) => {
        const location = side === 0 ? join.first : join.second;
        const distance = Math.hypot(
          positions[side][0] - center[0],
          positions[side][1] - center[1],
        );
        return this.#nearInterval(
          side,
          parameters[side],
          location,
          center,
          radius,
          distance,
        );
      }) as unknown as readonly [Piece, Piece];
      nearPieces.push(pieces);
    }
    const pieces = ([0, 1] as const).map((side) => {
      const model = this.#models[side];
      const near = nearPieces
        .map((pair) => pair[side])
        .sort((a, b) => a.interval[0] - b.interval[0]);
      for (let index = 1; index < near.length; index += 1) {
        if (!(near[index - 1]!.interval[1] < near[index]!.interval[0]))
          fail(
            "join-ball-crowded",
            "Two declared joins share near pieces on one curve.",
          );
      }
      // A full turn's far pieces run from the first near piece's upper end
      // once around to E = ↑(l₁ + 2π) ≥ l₁ + 2π; the last near piece must end
      // strictly less than a turn after the first one starts.
      const [first, last] = [near[0]!.interval, near.at(-1)!.interval];
      if (
        !model.domain &&
        compareFiniteSpanToTwoPiExact(first[0], last[1], this.budget) !== -1
      )
        fail(
          "join-ball-crowded",
          "Two declared joins share near pieces around one full-turn circle.",
        );
      const [from, to] = model.domain ?? [
        first[1],
        this.#arithmetic.up(first[0] + TWO_PI_OUTWARD_UPPER),
      ];
      // The overlap [l₁ + 2π, E] lies in N₁ + 2π iff E < h₁ + 2π: checked,
      // not assumed, since N₁ can be as narrow as the rounding of E.
      if (
        !model.domain &&
        compareFiniteSpanToTwoPiExact(from, to, this.budget) !== -1
      )
        fail(
          "join-ball-crowded",
          "A full-turn circle's far pieces are not certified to end inside its first near piece.",
        );
      const result: Piece[] = [...near];
      let cursor = from;
      const gaps: Domain[] = [];
      for (const piece of near) {
        if (cursor < piece.interval[0]) gaps.push([cursor, piece.interval[0]]);
        cursor = piece.interval[1];
      }
      if (cursor < to) gaps.push([cursor, to]);
      for (const gap of gaps) {
        const count =
          model.curve.kind === "circle"
            ? Math.max(1, Math.ceil((gap[1] - gap[0]) / MAX_ARC_PIECE) + 1)
            : 1;
        let start = gap[0];
        for (let index = 1; index <= count; index += 1) {
          const end =
            index === count
              ? gap[1]
              : gap[0] + ((gap[1] - gap[0]) * index) / count;
          if (start < end) result.push(model.piece(side, [start, end]));
          start = end;
        }
      }
      return result;
    });

    const joins = nearPieces.map((near, index) => this.#join(index, near));

    const points: NeutralCurvePointWitness[] = [];
    const isNearPair = (first: Piece, second: Piece) =>
      nearPieces.some(([a, b]) => a === first && b === second);
    for (const first of pieces[0]!) {
      for (const second of pieces[1]!) {
        if (isNearPair(first, second)) continue;
        const leftovers = this.#subdivide(first, second, FAR_DEPTH);
        for (const [firstInterval, secondInterval] of this.#clusters(
          leftovers,
        )) {
          const result = this.#ordinary(firstInterval, secondInterval);
          if (result.kind !== "verified")
            throw new JoinUncertain(result.code, result.message, result.kind);
          if (result.overlaps.length > 0)
            fail(
              "join-overlap-unsupported",
              "Declared-join pairs with an exact overlap outside the join balls are not admitted.",
            );
          points.push(...result.points);
        }
      }
    }
    points.sort(
      (first, second) =>
        first.firstParameter - second.firstParameter ||
        first.secondParameter - second.secondParameter,
    );
    this.#requireOutsideBalls(points, joins);
    return admitVerifiedJoinResult(request, joins, points, this.budget);
  }

  /** Every reported point is certified strictly outside every join ball. */
  #requireOutsideBalls(
    points: readonly NeutralCurvePointWitness[],
    joins: readonly NeutralCurveJoinWitness[],
  ) {
    for (const found of points) {
      const enclosure = this.#models[0].enclose(
        found.proof.firstParameterBounds,
      );
      for (const join of joins) {
        if (!this.#outsideBall(enclosure, join.position, join.ballRadius))
          fail(
            "join-ball-crowded",
            "A contact outside the near pieces lies inside a declared join ball.",
          );
      }
    }
  }

  /**
   * The ordinary structural owner on the whole pair, on the same budget, for
   * the only families whose exact overlap it proves: finite line pairs and
   * same/reversed cubic pole identity. Null unless it verifies an interval
   * correspondence; its non-verified results pass through.
   */
  #structuralOverlap(): VerifiedPair | null {
    const { first, second, modelingTolerance } = this.request;
    if (
      !(first.kind === "line" && second.kind === "line") &&
      !haveExactStructuralCubicBasis(first, second)
    )
      return null;
    const result = this.certifyPair(
      { modelingTolerance, first, second },
      this.budget,
    );
    if (result.kind !== "verified")
      throw new JoinUncertain(result.code, result.message, result.kind);
    return result.completenessProof.kind ===
      "completeStructuralCorrespondence" &&
      result.completenessProof.correspondence === "interval"
      ? result
      : null;
  }

  /**
   * Every declared join lies on the proven exact overlap, where the two
   * curves coincide: each is realized at its declared ends, the overlap is
   * reported unchanged, and the owner's remaining points must lie outside
   * every join ball.
   */
  #overlapResult(
    structural: VerifiedPair,
    located: readonly {
      readonly parameters: readonly [number, number];
      readonly center: SplineVector;
    }[],
  ): NeutralCurveJoinResult {
    const joins = located.map(
      ({ parameters, center }): NeutralCurveJoinWitness => {
        if (!joinOnOverlap(parameters, structural.overlaps))
          fail(
            "join-overlap-unsupported",
            "A declared join off the exact overlap of its pair is not admitted.",
          );
        return {
          firstParameter: parameters[0],
          secondParameter: parameters[1],
          firstParameterBounds: [parameters[0], parameters[0]],
          secondParameterBounds: [parameters[1], parameters[1]],
          position: center,
          ballRadius: this.#radius,
          realization: "declaredEnds",
        };
      },
    );
    this.#requireOutsideBalls(structural.points, joins);
    return admitVerifiedJoinResult(
      this.request,
      joins,
      structural.points,
      this.budget,
      structural,
    );
  }
}

/** Both declared parameters lie in the closed intervals of one overlap. */
function joinOnOverlap(
  parameters: readonly [number, number],
  overlaps: readonly NeutralCurveOverlapWitness[],
) {
  return overlaps.some(
    (overlap) =>
      neutralCurveParameterInside(parameters[0], overlap.firstInterval) &&
      neutralCurveParameterInside(parameters[1], [
        Math.min(...overlap.secondInterval),
        Math.max(...overlap.secondInterval),
      ]),
  );
}

/**
 * Independent re-evaluation of every join witness, point witness and overlap.
 * `structural` is the whole-pair ordinary result whose overlap the joins lie
 * on; it is re-admitted by the ordinary consistency check.
 */
function admitVerifiedJoinResult(
  request: NeutralCurveJoinRequest,
  joins: readonly NeutralCurveJoinWitness[],
  points: readonly NeutralCurvePointWitness[],
  budget: ExactProofBudget,
  structural?: VerifiedPair,
): Extract<NeutralCurveJoinResult, { readonly kind: "verified" }> {
  const overlaps = structural?.overlaps ?? [];
  budget.operation(
    16 + joins.length * 8 + points.length * 8 + overlaps.length * 8,
  );
  const pairRequest: NeutralCurveQueryRequest = {
    modelingTolerance: request.modelingTolerance,
    first: request.first,
    second: request.second,
  };
  if (structural) {
    admitVerifiedNeutralCurveResult(
      pairRequest,
      structural.points,
      structural.overlaps,
      structural.completenessProof,
      budget,
      "pair",
    );
    const overlapValid =
      structural.points === points &&
      structural.completenessProof.kind ===
        "completeStructuralCorrespondence" &&
      structural.completenessProof.correspondence === "interval" &&
      joins.every(
        (join) =>
          join.realization === "declaredEnds" &&
          joinOnOverlap([join.firstParameter, join.secondParameter], overlaps),
      ) &&
      overlaps.every((overlap) =>
        joins.some((join) =>
          joinOnOverlap([join.firstParameter, join.secondParameter], [overlap]),
        ),
      );
    if (!overlapValid) throw new Error("Invalid declared-join overlap.");
  }
  const domains = [request.first, request.second].map((curve) =>
    curve.kind === "circle"
      ? curve.sourceDomain.kind === "arc"
        ? curve.sourceDomain.interval
        : null
      : curve.sourceDomain,
  );
  // A full turn's bounds are a real-angle lift (they may cross the seam)
  // shorter than one exact turn.
  const ordered = (bounds: Domain, domain: Domain | null) =>
    Number.isFinite(bounds[0]) &&
    Number.isFinite(bounds[1]) &&
    bounds[0] <= bounds[1] &&
    (domain
      ? bounds[0] >= domain[0] && bounds[1] <= domain[1]
      : bounds[0] === bounds[1] ||
        compareFiniteSpanToTwoPiExact(bounds[0], bounds[1], budget) === -1);
  const joinsValid =
    joins.length === request.joins.length &&
    joins.every((join) => {
      if (
        !ordered(join.firstParameterBounds, domains[0]!) ||
        !ordered(join.secondParameterBounds, domains[1]!) ||
        !neutralCurveSourceParameterInside(
          request.first,
          join.firstParameter,
        ) ||
        !neutralCurveSourceParameterInside(
          request.second,
          join.secondParameter,
        ) ||
        !neutralCurveParameterInside(
          join.firstParameter,
          join.firstParameterBounds,
        ) ||
        !neutralCurveParameterInside(
          join.secondParameter,
          join.secondParameterBounds,
        ) ||
        !Number.isFinite(join.position[0]) ||
        !Number.isFinite(join.position[1]) ||
        !(join.ballRadius > 0) ||
        !(join.ballRadius <= request.modelingTolerance)
      )
        return false;
      // Independent float re-check allowance, not a semantic tolerance.
      const allowance = 64 * Number.EPSILON;
      return [
        evaluateNeutralCurve(request.first, join.firstParameter),
        evaluateNeutralCurve(request.second, join.secondParameter),
      ].every((position) => {
        const scale = Math.max(
          1,
          Math.abs(position[0]),
          Math.abs(position[1]),
          request.first.kind === "circle" ? request.first.radius : 1,
          request.second.kind === "circle" ? request.second.radius : 1,
        );
        return (
          Math.hypot(
            position[0] - join.position[0],
            position[1] - join.position[1],
          ) <=
          join.ballRadius + allowance * scale
        );
      });
    });
  const pointsValid = points.every(
    (found) =>
      ordered(found.proof.firstParameterBounds, domains[0]!) &&
      ordered(found.proof.secondParameterBounds, domains[1]!) &&
      checkNeutralCurvePointConsistency(pairRequest, found) === null,
  );
  if (!joinsValid || !pointsValid)
    throw new Error("Invalid declared-join witness.");
  const disjoint = points.every((found, index) =>
    points.slice(index + 1).every((other) => {
      const first = found.proof.firstParameterBounds;
      const otherFirst = other.proof.firstParameterBounds;
      const second = found.proof.secondParameterBounds;
      const otherSecond = other.proof.secondParameterBounds;
      return (
        first[1] < otherFirst[0] ||
        otherFirst[1] < first[0] ||
        second[1] < otherSecond[0] ||
        otherSecond[1] < second[0]
      );
    }),
  );
  if (!disjoint)
    fail(
      "join-contact-not-distinct",
      "Two reported contacts share a parameter box across adjacent pieces.",
    );
  return {
    kind: "verified",
    joins,
    points,
    overlaps,
    completenessProof: {
      kind: "completeOutsideDeclaredJoins",
      joinCount: joins.length,
      distinctRootCount: points.length,
    },
  };
}

/**
 * Certifies one declared-join request on the caller's single proof budget.
 * Budget exhaustion propagates; certificate failures return `uncertain`.
 */
export function certifyNeutralCurveJoin(
  request: NeutralCurveJoinRequest,
  budget: ExactProofBudget,
  certifyPair: PairCertifier,
): NeutralCurveJoinResult {
  const invalid = validateNeutralCurveJoinRequest(request);
  if (invalid) return invalid;
  for (const curve of [request.first, request.second]) {
    if (
      curve.kind === "circle" &&
      !validateCertifiedCircleAngularDomain(curve, budget)
    )
      return {
        kind: "uncertain",
        code: "invalid-neutral-curve-join-query",
        message:
          "Join queries require circle domains shorter than the exact full turn.",
      };
  }
  try {
    return new JoinCertifier(request, budget, certifyPair).run();
  } catch (error) {
    if (error instanceof JoinUncertain) {
      const failure: Failure = {
        kind: error.kind,
        code: error.code,
        message: error.detail,
      };
      return failure;
    }
    throw error;
  }
}
