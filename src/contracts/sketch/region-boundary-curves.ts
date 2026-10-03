/**
 * The one region-boundary curve owner (T10 plan §2.1, [TECH] T-2 with R1, R2
 * and R3). It hands every consumer of a region record (OCC profiles,
 * measurement, display fill, export) exactly the curve the arrangement
 * certified, so no consumer reconstructs boundary geometry on its own.
 *
 * R1: the branches come from the arrangement's own exported
 * `collectArrangementBranches`, called with the identical input the
 * arrangement read (definition, solved snapshot, projected references and
 * `offsetArrangementInput`'s `derivedCurves` / `unpublishedOffsetOutputs`).
 * There is no second publication or projection predicate: a shell that was
 * not consumable in that input is absent and does not resolve.
 *
 * R2: a basis binds one pair to a region set, and a segment resolves only
 * if it is one of that set's own segment objects (object identity). The
 * basis does NOT check that the regions were derived from that pair: a basis
 * built from a moved pair with stale regions resolves silently against the
 * new curves. Pairing regions with the pair that produced them is the
 * caller's duty: build the basis where both are held together (the OCC
 * `SketchRecord` binding lands in T10c, the session's live/stale regions in
 * T10e).
 *
 * Parameter mapping (stated once; every consumer uses it):
 * - **Line** (`endpointSegment`): the source parameter t ∈ [0, 1] is the
 *   kernel parameter, start + t·(end − start).
 * - **Arc / circle**: radians counter-clockwise from sketch +x about the
 *   sketch normal (`xAxis` [1, 0]); kernel parameter = source parameter. An
 *   arc's interval may start below 0 (`atan2`) and a split circle's wrap edge
 *   may end past 2π. OCC's `Geom_Circle` is periodic and is built on the
 *   sketch frame, so θ_OCC ≡ θ_source (mod 2π, up to one rounding of
 *   +fl(2π): OCC shifts a range with θ_lo < 0 by fl(2π), R3). OCC parameters
 *   are never read back for identity or provenance; witness rows compare
 *   positions, or angles mod 2π.
 * - **Cubic** (ordinary, projected or shell sub-span): the source parameter t
 *   maps to the Bézier local u = (t − s₀)/(s₁ − s₀) on the span's (sub-span's
 *   untrimmed) source domain [s₀, s₁], with exact 0 and 1 kept when t equals
 *   s₀ or s₁ bitwise (`solvedCubicSpanLocalDomain`, `cubicLocal`). The
 *   `Geom_BezierCurve` parameter is u; trims never re-pole.
 */
import { evaluateNeutralCurve } from "@/contracts/modeling/neutral-curve-query";
import {
  collectArrangementBranches,
  offsetArrangementInput,
  sourceDescription,
  type Branch,
  type SketchArrangementInput,
} from "@/contracts/sketch/region-extraction";
import { regionBranchKey } from "@/contracts/sketch/region-identity";
import {
  boxHull,
  boxOfIntervalPoint,
  certifyNeutralCurvePieceSignedArea,
  curvePoint,
  exact,
  iv,
  ivAdd,
  ivCross,
  ivMid,
  ivMul,
  ivPoint,
  ivPointSub,
  shiftInterval,
  TAU,
  widenByJoinBoxes,
  type Box,
  type Interval,
  type OwnedCurve,
} from "@/contracts/sketch/region-interval-geometry";
import type {
  RegionBoundaryBranch,
  RegionBoundarySegmentRecord,
  RegionLoopRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";
import {
  tessellateCubicSpans,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";

/** The arrangement-input fields the branch builder reads. */
export type RegionBoundaryBasisInput = Pick<
  SketchArrangementInput,
  | "definition"
  | "solvedSnapshot"
  | "projectedReferences"
  | "derivedCurves"
  | "unpublishedOffsetOutputs"
>;

declare const basisBrand: unique symbol;

/**
 * One pair bound to a region set (R2): opaque, built only by
 * `createRegionBoundaryBasis` (or the spec-only
 * `regionBoundaryBasisOfArrangementInput`).
 */
export interface RegionBoundaryBasis {
  readonly input: RegionBoundaryBasisInput;
  readonly regions: readonly RegionRecord[];
  readonly [basisBrand]: true;
}

interface BasisState {
  segments: ReadonlySet<RegionBoundarySegmentRecord>;
  branches: ReadonlyMap<string, readonly Branch[]>;
  /** Descriptions of the sources the arrangement has no neutral curve for. */
  unsupported: ReadonlySet<string>;
}

const basisStates = new WeakMap<RegionBoundaryBasis, BasisState>();

/**
 * The basis consumers build: one accepted pair, as stored with its regions
 * (`solvedSnapshot` with the offset publications applied, as
 * `applyOffsetPublications` returns it), and the regions derived from it.
 * The branch input is built here exactly as the solver adapter builds the
 * arrangement's: `offsetArrangementInput(definition, solvedSnapshot, [])`
 * (publications only name the diagnostic reasons, so the branch set depends
 * on the pair alone). The basis only guarantees that a resolved segment is
 * one of `regions`' own records; that `regions` came from this pair is the
 * caller's duty (module header, R2).
 */
export function createRegionBoundaryBasis(
  pair: Pick<
    SketchArrangementInput,
    "definition" | "solvedSnapshot" | "projectedReferences"
  >,
  regions: readonly RegionRecord[],
): RegionBoundaryBasis {
  return regionBoundaryBasisOfArrangementInput(
    {
      definition: pair.definition,
      solvedSnapshot: pair.solvedSnapshot,
      projectedReferences: pair.projectedReferences,
      ...offsetArrangementInput(pair.definition, pair.solvedSnapshot, []),
    },
    regions,
  );
}

/**
 * Spec and fixture use only: a basis from arrangement-input fields as given
 * (fabricated `derivedCurves` without offset relationships). Consumers call
 * `createRegionBoundaryBasis`, which derives these fields from the pair.
 */
export function regionBoundaryBasisOfArrangementInput(
  input: RegionBoundaryBasisInput,
  regions: readonly RegionRecord[],
): RegionBoundaryBasis {
  const { branches, obstacles } = collectArrangementBranches(
    input.definition,
    input.solvedSnapshot,
    input.projectedReferences,
    input.derivedCurves ?? [],
    input.unpublishedOffsetOutputs ?? [],
  );
  const byKey = new Map<string, Branch[]>();
  for (const branch of branches)
    byKey.set(branch.key, [...(byKey.get(branch.key) ?? []), branch]);
  const basis = Object.freeze({ input, regions }) as RegionBoundaryBasis;
  basisStates.set(basis, {
    segments: new Set(
      regions.flatMap((region) =>
        region.loops.flatMap((loop) => loop.segments),
      ),
    ),
    branches: byKey,
    unsupported: new Set(
      obstacles
        .filter((obstacle) => obstacle.code === "region-unsupported-curve")
        .map((obstacle) => obstacle.description),
    ),
  });
  return basis;
}

export interface ResolvedBoundaryCurve {
  readonly kind: "resolved";
  /** Exactly the curve the arrangement queried (the branch's own object). */
  readonly curve: OwnedCurve;
  /** The record's `sourceParameterInterval`, unchanged (source units). */
  readonly sourceInterval: readonly [number, number];
  /** The kernel parameter interval (see the module's parameter mapping). */
  readonly kernelInterval: readonly [number, number];
  readonly traversal: "forward" | "reverse";
}

export interface BoundaryCurveFailure {
  readonly kind: "failed";
  readonly code: "profile-boundary-unresolved" | "profile-boundary-unsupported";
  readonly message: string;
  readonly branch: RegionBoundaryBranch;
}

const failure = (
  segment: RegionBoundarySegmentRecord,
  code: BoundaryCurveFailure["code"],
  reason: string,
): BoundaryCurveFailure => ({
  kind: "failed",
  code,
  message: `${code}: the boundary segment on ${sourceDescription(segment.branch.source)} span ${segment.branch.spanId} ${reason}.`,
  branch: segment.branch,
});

/** Whether [a, b] (a < b) lies in the branch's drawn domain. */
function branchContains(branch: Branch, a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a < b)) return false;
  // A full circle's sub-edges start in [0, 2π); a wrap edge ends past 2π.
  if (branch.closed) return a >= 0 && a < TAU && b <= a + TAU;
  const tails = branch.derived?.tails;
  return (
    branch.domain[0] <= a &&
    b <= branch.domain[1] &&
    // A trimmed terminal sub-span is drawn only on its `queryDomain`.
    (!tails?.start || tails.start.parameter <= a) &&
    (!tails?.end || b <= tails.end.parameter)
  );
}

function kernelInterval(
  curve: OwnedCurve,
  [a, b]: readonly [number, number],
): readonly [number, number] {
  if (curve.kind !== "cubicBezier") return [a, b];
  const [s0, s1] = curve.sourceDomain;
  const local = (t: number) =>
    t === s0 ? 0 : t === s1 ? 1 : (t - s0) / (s1 - s0);
  return [local(a), local(b)];
}

/**
 * The curve the arrangement queried for one boundary segment record, or a
 * typed failure: `profile-boundary-unsupported` when the record names a
 * source the arrangement has no neutral curve for (projected source
 * samples), and `profile-boundary-unresolved` when the segment is not a
 * record of this basis, its branch is absent (e.g. a shell that is not
 * consumable in this pair), or its interval does not lie in exactly one
 * branch's drawn domain (span, sub-span or `queryDomain`).
 */
export function resolveRegionBoundaryCurve(
  basis: RegionBoundaryBasis,
  segment: RegionBoundarySegmentRecord,
): ResolvedBoundaryCurve | BoundaryCurveFailure {
  const state = basisStates.get(basis);
  if (!state)
    throw new Error(
      "region boundary basis was not created by createRegionBoundaryBasis in this realm",
    );
  if (!state.segments.has(segment))
    return failure(
      segment,
      "profile-boundary-unresolved",
      "is not a record of this basis's regions",
    );
  const branches = state.branches.get(regionBranchKey(segment.branch)) ?? [];
  if (branches.length === 0)
    return state.unsupported.has(sourceDescription(segment.branch.source))
      ? failure(
          segment,
          "profile-boundary-unsupported",
          "has no neutral region curve form",
        )
      : failure(
          segment,
          "profile-boundary-unresolved",
          "has no branch in this pair",
        );
  const [a, b] = segment.sourceParameterInterval;
  const matches = branches.filter((branch) => branchContains(branch, a, b));
  if (matches.length !== 1)
    return failure(
      segment,
      "profile-boundary-unresolved",
      matches.length === 0
        ? `has interval [${a}, ${b}] outside its branch's drawn domain`
        : `has interval [${a}, ${b}] in more than one sub-span`,
    );
  const curve = matches[0]!.curve;
  return {
    kind: "resolved",
    curve,
    sourceInterval: segment.sourceParameterInterval,
    kernelInterval: kernelInterval(curve, segment.sourceParameterInterval),
    traversal: segment.traversalDirection,
  };
}

function resolveLoop(
  basis: RegionBoundaryBasis,
  loop: RegionLoopRecord,
): ResolvedBoundaryCurve[] | BoundaryCurveFailure {
  const resolved: ResolvedBoundaryCurve[] = [];
  for (const segment of loop.segments) {
    const curve = resolveRegionBoundaryCurve(basis, segment);
    if (curve.kind === "failed") return curve;
    resolved.push(curve);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

/**
 * Certified signed area of one boundary loop, the arrangement's `cycleArea`
 * shape over the records: each piece's exact Green form between its end
 * enclosures, plus the straight connector from each piece's end to the next
 * piece's start, all from one origin, widened by each declared join's
 * contraction box (multiplier ⌊(m_in + m_out + 3)/2⌋, REQ-3). End enclosures:
 * a verified intersection's witness `parameterBounds` on this branch
 * (shifted one turn on a circle's wrap end), any other end its
 * representative parameter widened by one ulp. A declared join's box is the
 * record's ball (position ± ballRadius) hulled with the two piece ends it
 * connects.
 *
 * What the interval contains: the area of the realized loop (the pieces at
 * the record/witness parameters joined by straight connectors) and of the
 * loop routed through each declared join's record `position`. It equals the
 * arrangement's own `cycleArea` interval only when every join class has at
 * most two members (the arrangement hulls one ball per joined pair; the
 * record carries one position and the largest radius) and every
 * intersection end's witness names the segment's branch (otherwise the end
 * is its representative ± 1 ulp). Neither case fails closed: the widening is
 * symmetric, so `value`, the interval midpoint and the display value, is the
 * realized loop's area up to rounding whatever the boxes, multipliers and
 * enclosure widths. Those width terms (witness bounds, the wrap shift, the
 * multipliers) are certified by construction and by the
 * `widenByJoinBoxes` rows, not by the owner's oracle rows.
 */
export function boundaryLoopSignedArea(
  basis: RegionBoundaryBasis,
  loop: RegionLoopRecord,
):
  | {
      readonly kind: "measured";
      readonly interval: Interval;
      readonly value: number;
    }
  | BoundaryCurveFailure {
  const resolved = resolveLoop(basis, loop);
  if (!Array.isArray(resolved)) return resolved;
  const pieces = loop.segments.map((segment, index) => {
    const { curve, sourceInterval, traversal } = resolved[index]!;
    const key = regionBranchKey(segment.branch);
    const enclosure = (
      vertex: RegionBoundarySegmentRecord["start"],
      parameter: number,
    ): Interval => {
      if (vertex?.kind === "verifiedIntersection") {
        for (const side of [vertex.witness.first, vertex.witness.second]) {
          if (regionBranchKey(side.branch) !== key) continue;
          if (side.parameter === parameter) return side.parameterBounds;
          if (curve.kind === "circle" && side.parameter + TAU === parameter)
            return shiftInterval(side.parameterBounds, 1);
        }
      }
      return iv(parameter, parameter);
    };
    const [lo, hi] = sourceInterval;
    const forward = traversal === "forward";
    return {
      curve,
      from: enclosure(segment.start, forward ? lo : hi),
      to: enclosure(segment.end, forward ? hi : lo),
    };
  });
  const first = pieces[0]!;
  const originPoint = curvePoint(first.curve, first.from);
  const origin: SplineVector = [ivMid(originPoint[0]), ivMid(originPoint[1])];
  const o = ivPoint(origin);
  const crossings = (curve: OwnedCurve) =>
    curve.kind === "line" ? 1 : curve.kind === "circle" ? 2 : 3;
  let total: Interval = exact(0);
  const boxes: { box: Box; multiplier: number }[] = [];
  pieces.forEach((current, index) => {
    const following = pieces[(index + 1) % pieces.length]!;
    total = ivAdd(
      total,
      certifyNeutralCurvePieceSignedArea(
        current.curve,
        current.from,
        current.to,
        origin,
      ),
    );
    const endPoint = curvePoint(current.curve, current.to);
    const startPoint = curvePoint(following.curve, following.from);
    total = ivAdd(
      total,
      ivMul(
        exact(0.5),
        ivCross(ivPointSub(endPoint, o), ivPointSub(startPoint, o)),
      ),
    );
    const join = loop.segments[(index + 1) % pieces.length]!.start;
    if (join?.kind === "declaredJoin") {
      const [x, y] = join.position;
      const r = join.ballRadius;
      boxes.push({
        box: [
          boxOfIntervalPoint(endPoint),
          boxOfIntervalPoint(startPoint),
        ].reduce(boxHull, { x: iv(x - r, x + r), y: iv(y - r, y + r) }),
        multiplier: Math.floor(
          (crossings(current.curve) + crossings(following.curve) + 3) / 2,
        ),
      });
    }
  });
  const interval = widenByJoinBoxes(total, boxes);
  return { kind: "measured", interval, value: ivMid(interval) };
}

/** Adaptive Gauss–Legendre recursion bound (A7); larger requests are clamped. */
export const CURVE_LENGTH_MAX_DEPTH = 50;
/** Relative error target: well inside the 1e-12 display contract (T-6). */
const CURVE_LENGTH_RELATIVE_TOLERANCE = 1e-13;
/** 8-point Gauss–Legendre nodes and weights on [−1, 1]. */
const GL_NODES = [
  0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363,
];
const GL_WEIGHTS = [
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];

/**
 * Length of `curve` over its kernel interval (T-6, A7). Lines and arcs are
 * closed form. A cubic's ∫|B′(u)| du is adaptive 8-point Gauss–Legendre:
 * an interval is accepted when its two halves agree with it to the local
 * tolerance (1e-13 × the coarse length, halved per level); a branch that
 * reaches `maxDepth` (at most `CURVE_LENGTH_MAX_DEPTH`) or whose midpoint
 * no longer splits it in binary64 keeps its best value and marks the result
 * `approximate`. Not interval-certified: a displayed number on the
 * accepted spans, never a topology decision.
 */
export function curveLength(
  curve:
    | Pick<Extract<OwnedCurve, { kind: "line" }>, "kind" | "start" | "end">
    | Pick<Extract<OwnedCurve, { kind: "circle" }>, "kind" | "radius">
    | Pick<Extract<OwnedCurve, { kind: "cubicBezier" }>, "kind" | "poles">,
  [from, to]: readonly [number, number],
  options?: { maxDepth?: number },
): { readonly value: number; readonly approximate: boolean } {
  if (curve.kind === "line")
    return {
      value:
        Math.hypot(
          curve.end[0] - curve.start[0],
          curve.end[1] - curve.start[1],
        ) * Math.abs(to - from),
      approximate: false,
    };
  if (curve.kind === "circle")
    return { value: curve.radius * Math.abs(to - from), approximate: false };
  const [p0, p1, p2, p3] = curve.poles;
  const d = [
    [p1[0] - p0[0], p1[1] - p0[1]],
    [p2[0] - p1[0], p2[1] - p1[1]],
    [p3[0] - p2[0], p3[1] - p2[1]],
  ] as const;
  const speed = (u: number) => {
    const v = 1 - u;
    const [a, b, c] = [v * v, 2 * u * v, u * u];
    return (
      3 *
      Math.hypot(
        a * d[0][0] + b * d[1][0] + c * d[2][0],
        a * d[0][1] + b * d[1][1] + c * d[2][1],
      )
    );
  };
  const gauss = (lo: number, hi: number) => {
    const middle = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    let sum = 0;
    GL_NODES.forEach((node, k) => {
      sum +=
        GL_WEIGHTS[k]! *
        (speed(middle - half * node) + speed(middle + half * node));
    });
    return sum * half;
  };
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const maxDepth = Math.min(
    options?.maxDepth ?? CURVE_LENGTH_MAX_DEPTH,
    CURVE_LENGTH_MAX_DEPTH,
  );
  let approximate = false;
  const refine = (
    a: number,
    b: number,
    estimate: number,
    tolerance: number,
    depth: number,
  ): number => {
    const m = (a + b) / 2;
    if (!(a < m && m < b)) {
      approximate = true;
      return estimate;
    }
    const left = gauss(a, m);
    const right = gauss(m, b);
    const refined = left + right;
    if (Math.abs(refined - estimate) <= tolerance) return refined;
    if (depth >= maxDepth || !Number.isFinite(refined)) {
      approximate = true;
      return refined;
    }
    return (
      refine(a, m, left, tolerance / 2, depth + 1) +
      refine(m, b, right, tolerance / 2, depth + 1)
    );
  };
  const whole = gauss(lo, hi);
  const value = refine(
    lo,
    hi,
    whole,
    CURVE_LENGTH_RELATIVE_TOLERANCE * Math.abs(whole),
    0,
  );
  return { value, approximate: approximate || !Number.isFinite(value) };
}

// ---------------------------------------------------------------------------
// Display tessellation of a resolved loop
// ---------------------------------------------------------------------------

/**
 * Display polyline of one boundary loop in traversal order, as a closed
 * polygon (each segment from its start up to, not including, its end): a line
 * contributes its start, an arc `samplesPerCurve` steps and a cubic the one
 * tessellator's `samplesPerCurve` steps over its kernel interval. Display
 * output only, never geometry.
 */
export function tessellateBoundaryLoop(
  basis: RegionBoundaryBasis,
  loop: RegionLoopRecord,
  samplesPerCurve = 16,
): readonly SplineVector[] | BoundaryCurveFailure {
  const resolved = resolveLoop(basis, loop);
  if (!Array.isArray(resolved)) return resolved;
  return resolved.flatMap(({ curve, sourceInterval, traversal }) => {
    let points: readonly SplineVector[];
    if (curve.kind === "line")
      points = sourceInterval.map((t) => evaluateNeutralCurve(curve, t));
    else if (curve.kind === "circle") {
      const [a, b] = sourceInterval;
      points = Array.from({ length: samplesPerCurve + 1 }, (_, step) => {
        const angle =
          step === samplesPerCurve ? b : a + ((b - a) * step) / samplesPerCurve;
        return [
          curve.center[0] + curve.radius * Math.cos(angle),
          curve.center[1] + curve.radius * Math.sin(angle),
        ] as const;
      });
    } else
      points = tessellateCubicSpans(
        [
          {
            interval: curve.sourceDomain,
            poles: curve.poles,
            queryDomain: sourceInterval,
          },
        ],
        samplesPerCurve,
      );
    const ordered = traversal === "forward" ? points : [...points].reverse();
    return ordered.slice(0, -1);
  });
}
