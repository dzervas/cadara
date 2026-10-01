import type {
  CertifiedTubePieceChainRequests,
  NeutralCurve,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId } from "@/contracts/shared/ids";
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import {
  extractDeclaredOffsetChainConnectivity,
  type DeclaredOffsetChainConnectivity,
  type DeclaredOffsetChainConnectivityFailure,
} from "@/contracts/sketch/offset-chain-connectivity";
import {
  adoptOffsetChainPlan,
  certifyDeclaredOffsetChain,
  classifyOffsetChainVertex,
  declaredOffsetChainPieces,
  firstChoiceOffsetChainPlan,
  offsetArcSweepAdmissible,
  offsetChainJointLeaves,
  uncheckedDeclaredOffsetChainPieces,
  type CertifiedNeutralCurveRequestQuery,
  type CertifiedOffsetChainTubeStability,
  type DeclaredOffsetPieceSource,
  type OffsetChainAdjacencyPlan,
  type OffsetChainDomainEnd,
  type OffsetChainFirstChoice,
  type OffsetChainJointLeaf,
  type OffsetChainPiece,
  type OffsetChainTopologySuccess,
  type OffsetChainVertex,
  type ResolvedOffsetArc,
  type ResolvedOffsetLineArcEndpoints,
  type UncheckedDeclaredOffsetChainPieces,
} from "@/contracts/sketch/offset-chain-topology";
import {
  OFFSET_DIAGNOSTIC_CODES,
  type OffsetChainFailure,
} from "@/contracts/sketch/offset-geometry";
import type {
  SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import type { SplineOffsetCubicSpan } from "@/contracts/sketch/spline-offset-geometry";

/**
 * T08b-g1: the solve / publish frame owner of one offset relationship. Live
 * since T08b-g5: `evaluateSketchDerivations` runs the solve frame (solver
 * projection, every session/display path, authoring) and
 * `publishSketchOffsets` runs publish inside the `deriveSketchRegions`
 * boundary ([TECH] G1/G2′). The frame itself is not persisted; its plan is
 * solved revision data (`offsetFramePlans`, [TECH] G17).
 *
 * - `solveOffsetFrame` (every synchronous caller, certifier-free): N2
 *   connectivity, the UNCHECKED piece builder ([TECH] G4, the checked
 *   adapter's own construction), a plan (the given one, else the SEL's
 *   deterministic first choice with its certifier-free fallbacks), adoption
 *   per plan (the SEL's own adoption), trim representatives by a fixed-
 *   topology Newton step on the terminal-pair equation (seeded from the
 *   plan's representatives, else from the source vertex). No query, no
 *   certifier, no global gate: its geometry is uncertified. Its one
 *   threshold, `RESIDUAL_ROUNDING`, is the Newton step's convergence test
 *   and never admits geometry (publish trusts only the witness bounds); a
 *   trim that does not converge fails the solve frame, hence the solve
 *   ([TECH] G16), or takes the first choice's absorption fallback.
 * - `publishOffsetFrame` (one accepted solve): N2, the E1–E4-checked
 *   adapter, the UNCHANGED SEL (`certifyDeclaredOffsetChain`), then [TECH]
 *   G3 plan agreement: the certified pieces must equal the solve frame's
 *   bitwise and every solve-frame trim representative must lie inside its
 *   witness bounds; otherwise `planChanged` with the certifier's plan for
 *   ONE hinted re-solve, whose own disagreement fails closed (the caller
 *   must pass the hint to `solveOffsetFrame` unchanged: the bound rests on
 *   its `certified` origin, which is plain data). Then the
 *   T08b-g plan §2.1 arc checks on the published ends (the [TECH F10] wrap
 *   guard with trim representatives on seed arcs and on every joint (F1)
 *   arc, the review-R12 radius family, the R7 removed leaves; micro arcs
 *   are published as certified with no new threshold, [TECH] G10). A
 *   `planChanged` names its reason (`plan` / `representatives`) so the
 *   re-solve rate can be measured. The result is per relationship ([TECH] G5); a
 *   publish failure is a relationship-scoped diagnostic, never a solve
 *   diagnostic ([TECH] G16). Only publish constructs the branded
 *   `CertifiedOffsetFramePublication` (T08b-a math A2): a class instance
 *   whose private nominal member rejects literals, spreads and destructured
 *   copies at type level.
 * - [TECH] G6: trim, parallel and absorbed are revision data (a change among
 *   them is `planChanged`); arc presence, when authored (`arcJoints`), is
 *   intent: a certified arc set that differs is `topologyChanged`.
 * - T08b-g2: `prepareOffsetFrameDerivatives` gives a solve frame's
 *   fixed-topology JVP (the owner's batched multi-direction differential,
 *   [TECH] G8a) and its pullback by basis application with a per-frame
 *   cache; `offsetFrameCurveResidual` is the point-on-derived-curve
 *   residual (closest point restricted to the query domain, location held
 *   fixed for the gradient). No finite differences at runtime.
 *
 * Trust note (T08b-g plan §2.5, verbatim):
 *
 * 1. **M0.** The tube certificate is the sole global gate. It is about the abstract chain trimmed at exact witnessed roots, never at binary64 representatives. Publish additionally checks that each representative lies in its witness bounds.
 * 2. **R7** (declared vertex with a gap g).
 *    - At a declared vertex, O* is the gap-free reference (Q translated by −g) plus a straight bridge of vector g at the declared join. This realizes a declared join within τ under the standing declared-joins decision.
 *    - It requires e·g ≥ 0 and Lemma G's bound, and fails closed otherwise.
 *    - d math A6: at a concave vertex with g ≠ 0 the certificate proves O* simple and bridged; it does **not** prove that the untranslated true offsets cross exactly once.
 * 3. **R_C′**: at a declared coincident or shared-point cubic↔cubic join that passes H2 in a solver-accepted frame, O* is the two pieces' true offsets, each trimmed at their unique common point.
 *    - **R_C″** ([TECH], T08b-g5d, amends R_C): at a declared coincident or shared-point line↔cubic join that passes H2 in a solver-accepted frame, O* is the two pieces' true offsets, each trimmed at the unique common point of the two joined pieces' true offsets over the joint window. Since T08b-g5d (U-G6) the trim may lie on an inner leaf of the terminal source span (Lemma T-W, deep S2); the leaves before it are removed and never drawn. The claim is joint-local (g5d math review A1): removed leaves carry no claim against other pieces (they are neither in E nor in O*; every retained pair keeps K3).
 * 4. **R′** (seed arcs, F1/R10 wording): circles through the arc's declared ends, with r_V = |V − C| at declared-join ends and ρ_s at trimmed or chain-terminal ends, plus a vertical radial step of length |r_E − r_S| at an interior knot. It realizes the arc's own declared end-point incidence within τ, measured exactly, and is not undeclared healing.
 * 5. **G1 is disclaimed.** Tangent deviation at joint-arc ends is reported, never gated (E4, e A4). A user tangent constraint on a gapped joint arc sees a residual ≈ |g|.
 * 6. **Angles are not certified.** Consumers draw arcs from rounded `atan2` angles of certified ends (e R4). Rounding across π draws the same half circle; only a 0/2π wrap is rejected (F10 wrap guard on the published ends).
 * 7. **Never-drawn realization segments.** Radial connectors and rationalized Lemma-W segments of certified length are part of the certified reference, not drawn geometry (f).
 * 8. **R12:** a trimmed-start seed-arc radius is certified as a family and published only when inside it.
 * 9. **Micro arcs** (G10) are certified as given (E9: the certifier certifies the given radius).
 *
 * Trusted fields: `resolved.joints` (the joint requests and witnesses) is
 * trusted and never re-derived by the certifier.
 */

const codes = OFFSET_DIAGNOSTIC_CODES;

/** The offset relationship a frame evaluates (not persisted in g1). */
export interface OffsetFrameRelationship {
  readonly derivationId: string;
  readonly seedEntityIds: readonly SketchEntityId[];
  /** The chain distance d (signed, left positive). */
  readonly distance: number;
  /**
   * [TECH] G6 authored arc presence, by declared adjacency index. Absent
   * before initial authoring (the certified plan then decides).
   */
  readonly arcJoints?: readonly number[];
}

/** One adjacency of a frame plan ([TECH] G3); trims may carry their leaves and representatives. */
export type OffsetFramePlanEntry =
  | {
      readonly kind: "trim";
      /** The trimmed leaf of each side (`provenance.sourceSpanId`). */
      readonly leaves?: readonly [number, number];
      /** Newton seeds in those leaves' parameters (never trim identity). */
      readonly representatives?: readonly [number, number];
    }
  | Exclude<OffsetChainAdjacencyPlan, { readonly kind: "trim" }>;

export interface OffsetFramePlan {
  /**
   * `firstChoice`: the SEL's deterministic first choice; `published`: the
   * last publication; `certified`: a `planChanged` hint, allowed for ONE
   * re-solve (its own disagreement fails closed). The one-re-solve bound
   * holds only if the caller passes a hint unchanged: rewriting its origin
   * or rebuilding the plan is never unsound (publish certifies only on
   * agreement) but can re-solve without bound.
   */
  readonly origin: "firstChoice" | "published" | "certified";
  readonly adjacencies: readonly OffsetFramePlanEntry[];
}

/** One side of a solve-frame trim: the trimmed leaf and its representative. */
export interface OffsetFrameTrimSide {
  readonly seedEntityId: SketchEntityId;
  readonly leaf: number;
  readonly parameter: number;
}

export interface OffsetFrameTrim {
  readonly jointIndex: number;
  readonly first: OffsetFrameTrimSide;
  readonly second: OffsetFrameTrimSide;
  /** The published trim point (on the seed-arc side, if any). */
  readonly position: SketchPoint2D;
}

export interface OffsetFrameCubicSpan {
  readonly span: SplineOffsetCubicSpan;
  readonly sourceDomain: readonly [number, number];
  readonly start: OffsetChainDomainEnd;
  readonly end: OffsetChainDomainEnd;
  /** The representative active domain (trim ends at their representatives). */
  readonly representativeQueryDomain: readonly [number, number];
}

/** An uncertified solve-frame evaluation of one offset relationship. */
export interface OffsetSolveFrame {
  readonly ok: true;
  readonly derivationId: string;
  readonly distance: number;
  readonly modelingTolerance: number;
  readonly connectivity: DeclaredOffsetChainConnectivity;
  /** The effective plan; `origin` is the GIVEN plan's (a hint stays a hint). */
  readonly plan: OffsetFramePlan;
  /** Adopted pieces in declared traversal order. */
  readonly pieces: readonly OffsetChainPiece[];
  readonly vertices: readonly OffsetChainVertex[];
  readonly trims: readonly OffsetFrameTrim[];
  readonly arcs: readonly ResolvedOffsetArc[];
  readonly cubics: ReadonlyMap<SketchEntityId, readonly OffsetFrameCubicSpan[]>;
  readonly lineArcEndpoints: ReadonlyMap<
    SketchEntityId,
    ResolvedOffsetLineArcEndpoints
  >;
}

/** A relationship-scoped failure with its source-linked diagnostic. */
export interface OffsetFrameFailure {
  readonly ok: false;
  readonly derivationId: string;
  readonly failure: OffsetChainFailure;
  readonly diagnostic: SketchSolveDiagnostic;
}

export type OffsetSolveFrameResult = OffsetSolveFrame | OffsetFrameFailure;

/**
 * A certified publication of one relationship (T08b-a math A2). A class
 * instance whose private nominal member makes it unforgeable at type level:
 * a literal, a spread (`{ ...publication, frame: other }`) or a destructured
 * copy is not this type. The class is exported as a type only, so only
 * `publishOffsetFrame` constructs it. The check is compile-time (a cast
 * still forges it); a worker-transported publication is a separate plain
 * type, trusted as transported (T08b-g plan §2.4).
 */
class CertifiedOffsetFramePublication {
  /**
   * Nominal brand (T08b-a math A2): a protected prototype method, so no own
   * runtime field (JSON and `toEqual` see the same value) and no TS
   * `declare` field (T08b-g5: the dev-server transform rejects those).
   */
  protected brand(): true {
    return true;
  }
  readonly status: "certified";
  readonly derivationId: string;
  /** The published geometry: the solve frame, proved equal to the certified chain. */
  readonly frame: OffsetSolveFrame;
  /** The branded SEL certificate of exactly these pieces. */
  readonly certified: CertifiedOffsetChainTubeStability;
  /** The plan to seed the next solve frames with. */
  readonly plan: OffsetFramePlan;

  constructor(
    derivationId: string,
    frame: OffsetSolveFrame,
    certified: CertifiedOffsetChainTubeStability,
    plan: OffsetFramePlan,
  ) {
    this.status = "certified";
    this.derivationId = derivationId;
    this.frame = frame;
    this.certified = certified;
    this.plan = plan;
  }
}

export type { CertifiedOffsetFramePublication };

export type OffsetFramePublication =
  | CertifiedOffsetFramePublication
  | {
      readonly status: "planChanged";
      readonly derivationId: string;
      /**
       * Why the solve frame is not the certified chain (for measuring the
       * re-solve rate): `representatives` when only a trim representative
       * lies outside its witness bounds (the plan, adapter data, pieces and
       * arcs agree bitwise); `plan` for any other disagreement.
       */
      readonly reason: "plan" | "representatives";
      /**
       * The certifier's plan (origin `certified`) for ONE hinted re-solve;
       * pass it to `solveOffsetFrame` unchanged.
       */
      readonly plan: OffsetFramePlan;
    }
  | ({ readonly status: "failed" } & Omit<OffsetFrameFailure, "ok">);

function frameFailure(
  relationship: OffsetFrameRelationship,
  failure: OffsetChainFailure,
): OffsetFrameFailure {
  const entityId = failure.seedEntityId ?? relationship.seedEntityIds[0];
  return {
    ok: false,
    derivationId: relationship.derivationId,
    failure,
    diagnostic: {
      code: failure.code,
      severity: "error",
      message: `Offset relationship ${relationship.derivationId}: ${failure.message}`,
      target: entityId ? { kind: "entity", entityId } : null,
    },
  };
}

function chainFailure(
  code: OffsetChainFailure["code"],
  message: string,
  seedEntityId: SketchEntityId | null,
): OffsetChainFailure {
  return { ok: false, code, message, seedEntityId };
}

/** N2 diagnostics as offset codes (the connectivity codes are not source-linked codes). */
function connectivityFailure(
  failure: DeclaredOffsetChainConnectivityFailure,
): OffsetChainFailure {
  return chainFailure(
    failure.code === "disconnected"
      ? codes.disconnectedChain
      : failure.code === "unsupportedSeed"
        ? codes.unsupportedSeed
        : codes.topologyUncertain,
    failure.message,
    failure.seedEntityId,
  );
}

// ---------------------------------------------------------------------------
// Solve frame
// ---------------------------------------------------------------------------

interface Jet {
  readonly position: SketchPoint2D;
  readonly first: SketchPoint2D;
}

const ZERO_POLES: SplinePoles = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

/**
 * Position and parameter derivative of one query leaf in its own source
 * parameter (the query's units: a segment's t ∈ [0, 1] with exact ends, a
 * circle's angle, a cubic's source parameter). Lines and circles extend
 * past their domain for the Newton step; a cubic does not (null).
 */
function leafJet(curve: NeutralCurve, parameter: number): Jet | null {
  if (curve.kind === "line") {
    if (curve.form !== "endpointSegment") return null;
    const { start, end } = curve;
    const first: SketchPoint2D = [end[0] - start[0], end[1] - start[1]];
    const position: SketchPoint2D =
      parameter === 0
        ? start
        : parameter === 1
          ? end
          : [start[0] + parameter * first[0], start[1] + parameter * first[1]];
    return { position, first };
  }
  if (curve.kind === "circle") {
    const cosine = Math.cos(parameter);
    const sine = Math.sin(parameter);
    return {
      position: [
        curve.center[0] + curve.radius * cosine,
        curve.center[1] + curve.radius * sine,
      ],
      first: [-curve.radius * sine, curve.radius * cosine],
    };
  }
  if (curve.kind !== "cubicBezier") return null;
  const [low, high] = curve.sourceDomain;
  if (!(parameter >= low && parameter <= high)) return null;
  const evaluated = evaluateSplineSpan(
    {
      interval: curve.sourceDomain,
      poles: curve.poles,
      differential: { interval: [0, 0], poles: ZERO_POLES },
    },
    { kind: "source", value: parameter },
  );
  return { position: evaluated.position, first: evaluated.first };
}

/** Largest coordinate magnitude of a leaf's defining data (the rounding scale). */
function leafScale(curve: NeutralCurve) {
  const points: SketchPoint2D[] =
    curve.kind === "line" && curve.form === "endpointSegment"
      ? [curve.start, curve.end]
      : curve.kind === "circle"
        ? [
            [
              Math.abs(curve.center[0]) + curve.radius,
              Math.abs(curve.center[1]) + curve.radius,
            ],
          ]
        : curve.kind === "cubicBezier"
          ? [...curve.poles]
          : [];
  return Math.max(
    0,
    ...points.flatMap((point) => [Math.abs(point[0]), Math.abs(point[1])]),
  );
}

/**
 * Binary64 rounding level of the trim residual: 2⁻³⁶ of the data scale,
 * about 2¹⁶ times the evaluation rounding. A convergence test of the
 * uncertified solve frame only (publish trusts no residual: the witness
 * bounds decide), never a geometric tolerance.
 */
const RESIDUAL_ROUNDING = 2 ** -36;

/**
 * The fixed-topology Newton step on the terminal-pair equation
 * P(s) = Q(t): full steps halved (at most 8 times) until the binary64
 * residual strictly decreases, at most 64 steps, stopping when the step
 * rounds away. Converged only at the rounding level; a representative seed
 * already there is kept bitwise (no step).
 */
function newtonTrim(
  first: NeutralCurve,
  second: NeutralCurve,
  seed: readonly [number, number],
  keepConvergedSeed: boolean,
): readonly [number, number] | null {
  const bound =
    Math.max(leafScale(first), leafScale(second)) * RESIDUAL_ROUNDING;
  const residual = (x: readonly [number, number]) => {
    const a = leafJet(first, x[0]);
    const b = leafJet(second, x[1]);
    if (!a || !b) return null;
    const value: SketchPoint2D = [
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
    ];
    if (!value.every(Number.isFinite)) return null;
    return { a, b, value, norm: value[0] * value[0] + value[1] * value[1] };
  };
  let x = seed;
  let current = residual(x);
  if (!current) return null;
  const converged = (value: SketchPoint2D) =>
    Math.max(Math.abs(value[0]), Math.abs(value[1])) <= bound;
  if (keepConvergedSeed && converged(current.value)) return x;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const { a, b, value } = current;
    const determinant = b.first[0] * a.first[1] - a.first[0] * b.first[1];
    if (!Number.isFinite(determinant) || determinant === 0) break;
    // a′·δs − b′·δt = −F (Cramer).
    const ds = (value[0] * b.first[1] - b.first[0] * value[1]) / determinant;
    const dt = (value[0] * a.first[1] - a.first[0] * value[1]) / determinant;
    if (!Number.isFinite(ds) || !Number.isFinite(dt)) break;
    let step = 1;
    let accepted = false;
    let fixed = false;
    for (let halving = 0; halving <= 8; halving += 1, step /= 2) {
      const candidate = [x[0] + step * ds, x[1] + step * dt] as const;
      if (candidate[0] === x[0] && candidate[1] === x[1]) {
        fixed = halving === 0;
        break;
      }
      const next = residual(candidate);
      if (next && next.norm < current.norm) {
        x = candidate;
        current = next;
        accepted = true;
        break;
      }
    }
    if (fixed || !accepted) break;
  }
  return converged(current.value) ? x : null;
}

/**
 * The leaf of `leaves` (vertex inward, `startLeaf` first) whose domain holds
 * `parameter` strictly inside; a seed-arc angle may be one turn off its
 * leaf's winding (the winding is re-expressed, never the bits of a hit on
 * the start leaf).
 */
function locateLeaf(
  leaves: readonly OffsetChainJointLeaf[],
  startLeaf: OffsetChainJointLeaf,
  parameter: number,
): { readonly leaf: OffsetChainJointLeaf; readonly parameter: number } | null {
  const inside = (leaf: OffsetChainJointLeaf, value: number) =>
    value > leaf.bounds[0] && value < leaf.bounds[1];
  if (inside(startLeaf, parameter)) return { leaf: startLeaf, parameter };
  if (startLeaf.curve.kind !== "circle") return null;
  for (const leaf of [
    startLeaf,
    ...leaves.filter((item) => item !== startLeaf),
  ])
    for (const turn of [0, -1, 1]) {
      const value = turn === 0 ? parameter : parameter + turn * 2 * Math.PI;
      if (inside(leaf, value)) return { leaf, parameter: value };
    }
  return null;
}

type TrimOutcome =
  | {
      readonly ok: true;
      readonly first: { leaf: OffsetChainJointLeaf; parameter: number };
      readonly second: { leaf: OffsetChainJointLeaf; parameter: number };
    }
  | { readonly ok: false };

/**
 * One trim: seeded from the plan's representatives, else from the source
 * vertex. T08b-g5d: at a ring joint (`leaves.pairs`, a derived cubic side
 * with inner leaves in its terminal source span) whose terminal pair does
 * not converge, Newton runs on each candidate pair in the resolver's ring
 * order, seeded at the pair's vertex-side ends, and the first pair that
 * converges strictly inside both leaves is the trim; `scan` is false at a
 * D > 0 absorbable vertex, where the deep trim is only the SEL's fallback
 * after absorption (design §3.2 item 3), so the first choice absorbs.
 */
function solveTrim(
  leaves: ReturnType<typeof offsetChainJointLeaves>,
  entry: Extract<OffsetFramePlanEntry, { kind: "trim" }>,
  scan: boolean,
): TrimOutcome {
  const { first, second } = leaves;
  const attempt = (
    firstLeaf: OffsetChainJointLeaf,
    secondLeaf: OffsetChainJointLeaf,
    seed: readonly [number, number],
    keepConvergedSeed: boolean,
  ): TrimOutcome => {
    const root = newtonTrim(
      firstLeaf.curve,
      secondLeaf.curve,
      seed,
      keepConvergedSeed,
    );
    if (!root) return { ok: false };
    const a = locateLeaf(first, firstLeaf, root[0]);
    const b = locateLeaf(second, secondLeaf, root[1]);
    return a && b ? { ok: true, first: a, second: b } : { ok: false };
  };
  const { leaves: hintedLeaves, representatives } = entry;
  const firstHint = first.find((leaf) => leaf.leaf === hintedLeaves?.[0]);
  const secondHint = second.find((leaf) => leaf.leaf === hintedLeaves?.[1]);
  if (representatives && firstHint && secondHint) {
    const outcome = attempt(firstHint, secondHint, representatives, true);
    if (outcome.ok) return outcome;
  }
  const vertexParameter = (leaf: OffsetChainJointLeaf) =>
    leaf.bounds[leaf.vertexSide === "low" ? 0 : 1];
  const pairAttempt = (i: number, j: number) =>
    attempt(
      first[i]!,
      second[j]!,
      [vertexParameter(first[i]!), vertexParameter(second[j]!)],
      false,
    );
  const terminalOutcome = pairAttempt(0, 0);
  if (terminalOutcome.ok || !scan || !leaves.pairs) return terminalOutcome;
  for (const [i, j] of leaves.pairs) {
    const outcome = pairAttempt(i, j);
    if (outcome.ok) return outcome;
  }
  return terminalOutcome;
}

/**
 * The published trim point: evaluated on a seed-arc side (the one whose
 * natural START is this trim first, so the review-R12 family covers it),
 * else on the traversal-first side.
 */
function trimPosition(
  pieces: readonly OffsetChainPiece[],
  jointIndex: number,
  first: { leaf: OffsetChainJointLeaf; parameter: number },
  second: { leaf: OffsetChainJointLeaf; parameter: number },
): SketchPoint2D {
  const next = (jointIndex + 1) % pieces.length;
  const firstArc = pieces[jointIndex]!.kind === "arc";
  const secondArc = pieces[next]!.kind === "arc";
  const secondStarts = !pieces[next]!.reversed;
  const onSecond = secondArc && (secondStarts || !firstArc);
  const side = onSecond ? second : first;
  return leafJet(side.leaf.curve, side.parameter)!.position;
}

interface PieceEnds {
  start: OffsetChainDomainEnd;
  end: OffsetChainDomainEnd;
  startParameter?: number;
  endParameter?: number;
  startPosition?: SketchPoint2D;
  endPosition?: SketchPoint2D;
  startLeaf?: number;
  endLeaf?: number;
  removed: [number, number];
}

type BuiltFrame =
  | {
      readonly ok: true;
      readonly trims: readonly OffsetFrameTrim[];
      readonly cubics: ReadonlyMap<
        SketchEntityId,
        readonly OffsetFrameCubicSpan[]
      >;
      readonly lineArcEndpoints: ReadonlyMap<
        SketchEntityId,
        ResolvedOffsetLineArcEndpoints
      >;
    }
  | { readonly ok: false; readonly jointIndex: number }
  | OffsetChainFailure;

/** The representative parameters of one trim (never trim identity). */
interface TrimRepresentative {
  readonly first: { readonly leaf: number; readonly parameter: number };
  readonly second: { readonly leaf: number; readonly parameter: number };
}

/**
 * Trims by the Newton step, then the frame geometry from them. `absorbable`:
 * the D > 0 absorbable declared vertices (no deep scan there, `solveTrim`).
 */
function buildFrameGeometry(
  pieces: readonly OffsetChainPiece[],
  plan: readonly OffsetFramePlanEntry[],
  absorbable: (jointIndex: number) => boolean,
): BuiltFrame {
  const representatives = new Map<number, TrimRepresentative>();
  for (const [jointIndex, entry] of plan.entries()) {
    if (entry.kind !== "trim") continue;
    const solved = solveTrim(
      offsetChainJointLeaves(pieces, jointIndex),
      entry,
      !absorbable(jointIndex),
    );
    if (!solved.ok) return { ok: false, jointIndex };
    representatives.set(jointIndex, {
      first: {
        leaf: solved.first.leaf.leaf,
        parameter: solved.first.parameter,
      },
      second: {
        leaf: solved.second.leaf.leaf,
        parameter: solved.second.parameter,
      },
    });
  }
  return assembleFrameGeometry(pieces, plan, representatives);
}

/**
 * The published frame geometry as a pure function of (pieces, plan, trim
 * representatives): trim points, domain ends, representative query domains
 * and R7 removed leaves exactly as the resolution assembles them. Publish
 * re-derives it from the certified pieces to bind every published datum.
 */
function assembleFrameGeometry(
  pieces: readonly OffsetChainPiece[],
  plan: readonly OffsetFramePlanEntry[],
  representatives: ReadonlyMap<number, TrimRepresentative>,
): BuiltFrame {
  const count = pieces.length;
  const ends: PieceEnds[] = pieces.map(() => ({
    start: { kind: "source" },
    end: { kind: "source" },
    removed: [0, 0],
  }));
  /** The natural end of piece `index` at the traversal end (`exiting`) or start. */
  const naturalSide = (index: number, exiting: boolean) =>
    exiting !== pieces[index]!.reversed ? "end" : "start";
  const trims: OffsetFrameTrim[] = [];
  for (const [jointIndex, entry] of plan.entries()) {
    const next = (jointIndex + 1) % count;
    const exitSide = naturalSide(jointIndex, true);
    const entrySide = naturalSide(next, false);
    if (entry.kind !== "trim") {
      const end: OffsetChainDomainEnd =
        entry.kind === "arc"
          ? { kind: "arc", jointIndex }
          : { kind: "vertex", vertexIndex: jointIndex };
      ends[jointIndex]![exitSide] = end;
      ends[next]![entrySide] = end;
      continue;
    }
    const representative = representatives.get(jointIndex);
    const leaves = offsetChainJointLeaves(pieces, jointIndex);
    const firstLeaf = leaves.first.find(
      (leaf) => leaf.leaf === representative?.first.leaf,
    );
    const secondLeaf = leaves.second.find(
      (leaf) => leaf.leaf === representative?.second.leaf,
    );
    if (!representative || !firstLeaf || !secondLeaf)
      return chainFailure(
        codes.topologyUncertain,
        "A frame trim has no representative on a candidate leaf.",
        pieces[jointIndex]!.seedEntityId,
      );
    const first = {
      leaf: firstLeaf,
      parameter: representative.first.parameter,
    };
    const second = {
      leaf: secondLeaf,
      parameter: representative.second.parameter,
    };
    const position = trimPosition(pieces, jointIndex, first, second);
    trims.push({
      jointIndex,
      first: {
        seedEntityId: pieces[jointIndex]!.seedEntityId,
        leaf: firstLeaf.leaf,
        parameter: first.parameter,
      },
      second: {
        seedEntityId: pieces[next]!.seedEntityId,
        leaf: secondLeaf.leaf,
        parameter: second.parameter,
      },
      position,
    });
    const end: OffsetChainDomainEnd = { kind: "joint", jointIndex };
    const record = (
      index: number,
      side: "start" | "end",
      trimmed: { leaf: OffsetChainJointLeaf; parameter: number },
      terminalLeaf: number,
    ) => {
      const piece = ends[index]!;
      piece[side] = end;
      piece[`${side}Parameter`] = trimmed.parameter;
      piece[`${side}Position`] = position;
      piece[`${side}Leaf`] = trimmed.leaf.leaf;
      // Review R7: the leaves between the vertex and the trimmed leaf.
      piece.removed[side === "start" ? 0 : 1] = Math.abs(
        trimmed.leaf.leaf - terminalLeaf,
      );
    };
    record(jointIndex, exitSide, first, leaves.first[0]!.leaf);
    record(next, entrySide, second, leaves.second[0]!.leaf);
  }
  const cubics = new Map<SketchEntityId, OffsetFrameCubicSpan[]>();
  const lineArcEndpoints = new Map<
    SketchEntityId,
    ResolvedOffsetLineArcEndpoints
  >();
  for (const [index, piece] of pieces.entries()) {
    const own = ends[index]!;
    const seed = piece.seedEntityId;
    if (piece.kind === "circle") continue;
    if (piece.kind === "derivedCubic") {
      // T08b-g5d: a trim end sits on its own trim leaf (g3 review A4); the
      // leaves before it are `removed` by that trim, exactly as the
      // resolution assembles them.
      const startLeaf =
        own.start.kind === "joint" && own.startLeaf !== undefined
          ? own.startLeaf
          : 0;
      const endLeaf =
        own.end.kind === "joint" && own.endLeaf !== undefined
          ? own.endLeaf
          : piece.spans.length - 1;
      if (startLeaf > endLeaf)
        return chainFailure(
          codes.jointUnsatisfied,
          "Both trims of one offset curve remove its whole active domain.",
          seed,
        );
      const removedBy = (end: OffsetChainDomainEnd): OffsetChainDomainEnd =>
        end.kind === "joint"
          ? { kind: "removed", jointIndex: end.jointIndex }
          : end;
      cubics.set(
        seed,
        piece.spans.map((span, offset) => ({
          span,
          sourceDomain: span.sourceInterval,
          start:
            offset < startLeaf
              ? removedBy(own.start)
              : offset > endLeaf
                ? removedBy(own.end)
                : offset === startLeaf
                  ? own.start
                  : { kind: "source" },
          end:
            offset < startLeaf
              ? removedBy(own.start)
              : offset > endLeaf
                ? removedBy(own.end)
                : offset === endLeaf
                  ? own.end
                  : { kind: "source" },
          representativeQueryDomain: [
            offset === startLeaf && own.startParameter !== undefined
              ? own.startParameter
              : span.sourceInterval[0],
            offset === endLeaf && own.endParameter !== undefined
              ? own.endParameter
              : span.sourceInterval[1],
          ],
        })),
      );
      continue;
    }
    const leafCount =
      piece.kind === "arc" ? (piece.splits?.length ?? 0) + 1 : 1;
    const [head, tail] = own.removed;
    if (head + tail >= leafCount)
      return chainFailure(
        codes.jointUnsatisfied,
        "Both trims of one offset curve remove its whole active domain.",
        seed,
      );
    // Two trims on one leaf must be ordered along it.
    if (
      own.startParameter !== undefined &&
      own.endParameter !== undefined &&
      own.startLeaf === own.endLeaf
    ) {
      const ccw =
        piece.kind === "lineSegment" ||
        piece.sweepDirection === "counterClockwise";
      if (
        !(ccw
          ? own.startParameter < own.endParameter
          : own.endParameter < own.startParameter)
      )
        return chainFailure(
          codes.jointUnsatisfied,
          "Both trims of one offset curve remove its whole active domain.",
          seed,
        );
    }
    lineArcEndpoints.set(seed, {
      start: own.startPosition ?? piece.start,
      end: own.endPosition ?? piece.end,
      startDomainEnd: own.start,
      endDomainEnd: own.end,
      ...(piece.kind === "arc" && (head > 0 || tail > 0)
        ? { removedLeaves: [head, tail] as const }
        : {}),
    });
  }
  return { ok: true, trims, cubics, lineArcEndpoints };
}

type PlanRun =
  | {
      readonly ok: true;
      readonly plan: readonly OffsetFramePlanEntry[];
      readonly pieces: readonly OffsetChainPiece[];
      readonly sources: readonly DeclaredOffsetPieceSource[];
      readonly arcs: readonly ResolvedOffsetArc[];
      readonly geometry: Extract<BuiltFrame, { ok: true }>;
    }
  | OffsetChainFailure;

/** Arc presence of a plan by adjacency index (G6). */
const arcSet = (plan: readonly { readonly kind: string }[]) =>
  plan.flatMap((entry, index) => (entry.kind === "arc" ? [index] : []));

const sameArcSet = (first: readonly number[], second: readonly number[]) => {
  const sorted = (values: readonly number[]) =>
    [...values].sort((a, b) => a - b).join(",");
  return sorted(first) === sorted(second);
};

/**
 * Runs one plan: adoption, then trims. With `choices` (the first choice) a
 * failing adjacency takes the SEL's certifier-free fallback once: an
 * absorption-first corner whose adoption fails its arc (U-E) or deferred
 * trim (F6), a short arc its absorption (E8), an inadmissible trim its
 * absorption (step 2(b)). Authored arc presence (G6) is never switched.
 */
function runPlan(
  declared: UncheckedDeclaredOffsetChainPieces,
  initial: readonly OffsetFramePlanEntry[],
  choices: readonly OffsetChainFirstChoice[] | undefined,
  authoredArcs: boolean,
): PlanRun {
  let plan = [...initial];
  const switched = new Set<number>();
  const seedOf = (index: number) => declared.pieces[index]!.seedEntityId;
  const fallback = (index: number): OffsetFramePlanEntry | null => {
    const choice = choices?.[index];
    if (!choice || switched.has(index)) return null;
    const current = plan[index]!;
    if (current.kind === "absorbed" && choice.fallback === "trim")
      return { kind: "trim" };
    if (authoredArcs) return null;
    if (current.kind === "absorbed" && choice.fallback === "arc")
      return { kind: "arc" };
    if (
      (current.kind === "arc" || current.kind === "trim") &&
      choice.absorbable
    )
      return { kind: "absorbed", keeper: choice.absorbable };
    return null;
  };
  const take = (index: number) => {
    const replacement = fallback(index);
    if (!replacement) return false;
    switched.add(index);
    plan = plan.map((entry, position) =>
      position === index ? replacement : entry,
    );
    return true;
  };
  for (;;) {
    const adopted = adoptOffsetChainPlan(declared, plan);
    if (!adopted.ok) {
      if (take(adopted.jointIndex)) continue;
      return chainFailure(
        codes.knotIncidenceUnproven,
        `Declared vertex ${adopted.jointIndex} is not buildable in the solve frame: ${adopted.reason}`,
        seedOf(adopted.jointIndex),
      );
    }
    const short = adopted.shortArcs.find(
      (index) => choices?.[index]?.absorbable && !switched.has(index),
    );
    if (short !== undefined && take(short)) continue;
    // Effective keepers from adoption; trim leaves/representatives kept.
    const effective = adopted.plan.map((entry, index) =>
      entry.kind === "trim" ? plan[index]! : entry,
    );
    const geometry = buildFrameGeometry(adopted.pieces, effective, (index) => {
      const vertex = declared.vertices[index];
      if (!vertex) return false;
      const vertexClass = classifyOffsetChainVertex(vertex);
      return vertexClass.class === "nonparallel" && vertexClass.forward;
    });
    if (!geometry.ok) {
      if ("code" in geometry) return geometry;
      if (take(geometry.jointIndex)) continue;
      return chainFailure(
        codes.jointUnsatisfied,
        "The solve frame's offset joint has no converged transverse trim.",
        seedOf(geometry.jointIndex),
      );
    }
    const trims = new Map(
      geometry.trims.map((trim) => [trim.jointIndex, trim] as const),
    );
    return {
      ok: true,
      plan: effective.map((entry, index): OffsetFramePlanEntry => {
        const trim = trims.get(index);
        return trim
          ? {
              kind: "trim",
              leaves: [trim.first.leaf, trim.second.leaf],
              representatives: [trim.first.parameter, trim.second.parameter],
            }
          : entry;
      }),
      pieces: adopted.pieces,
      sources: adopted.sources,
      arcs: adopted.arcs,
      geometry,
    };
  }
}

/**
 * T08b-g5 (g2 routed item): the source-basis directions a solve frame's OWN
 * owner calls carried, kept beside the frame (never in it, so publish's
 * bitwise comparison and every frame consumer see the direction-free
 * pieces). `prepareOffsetFrameDerivatives` builds its pullback basis from
 * them instead of a second owner call per spline.
 */
const frameSourceBasis = new WeakMap<
  OffsetSolveFrame,
  {
    readonly pieces: readonly OffsetChainPiece[];
    readonly sources: readonly DeclaredOffsetPieceSource[];
  }
>();

/**
 * The SEL's first choice (G3), with authored arc presence (G6) applied: a
 * convex corner takes its arc iff authored. A choice that cannot honour the
 * authored arc set is `topologyChanged`.
 */
function firstChoice(
  declared: UncheckedDeclaredOffsetChainPieces,
  arcJoints: readonly number[] | undefined,
): readonly OffsetChainFirstChoice[] | OffsetChainFailure {
  const choices = firstChoiceOffsetChainPlan(declared);
  if ("ok" in choices || !arcJoints) return choices;
  const changed = (index: number) =>
    chainFailure(
      codes.topologyChanged,
      `The authored arc set no longer fits declared adjacency ${index}.`,
      declared.pieces[index]?.seedEntityId ?? null,
    );
  const result: OffsetChainFirstChoice[] = [];
  for (const [index, choice] of choices.entries()) {
    const authored = arcJoints.includes(index);
    if ((choice.kind === "arc") === authored) {
      result.push(choice);
      continue;
    }
    if (authored && choice.kind === "absorbed" && choice.fallback === "arc") {
      result.push({ kind: "arc" });
      continue;
    }
    if (!authored && choice.kind === "arc" && choice.absorbable) {
      result.push({ kind: "absorbed", keeper: choice.absorbable });
      continue;
    }
    return changed(index);
  }
  return result;
}

/**
 * The solve frame of one relationship (T08b-g plan §3.1): uncertified
 * geometry for the solver and every synchronous display path, from the
 * current definition iterate. With a plan (the last publication or a
 * `planChanged` hint) that plan is run; if it does not build or its trims do
 * not converge, the SEL's first choice is run instead (the origin is kept,
 * so a hinted re-solve stays the one re-solve). Failures are projection
 * diagnostics of the solve ([TECH] G16), never publications.
 */
export function solveOffsetFrame(
  input: OffsetSolveFrameInput,
  plan?: OffsetFramePlan,
): OffsetSolveFrameResult {
  return solveFrameMemo.solve(input, plan);
}

/** The input of one solve frame. */
export interface OffsetSolveFrameInput {
  readonly relationship: OffsetFrameRelationship;
  readonly definition: Pick<
    SketchDefinition,
    "points" | "entities" | "constraints"
  >;
  readonly modelingTolerance: number;
  /**
   * T08b-g5: carry the source-basis directions (every point, authored
   * tangent and circle radius DOF) on this frame's own owner calls, for
   * the solver's pullback. Geometry is byte-identical without it ([TECH]
   * G8a); only the solver projection asks for it.
   */
  readonly withSourceBasis?: boolean;
}

/**
 * The point ids a seed entity's frame reads (positions or existence): a
 * superset of N2's and the piece builder's reads for every seed kind the
 * frame supports; any other kind fails the frame without reading points.
 */
function seedReadPointIds(
  entity: OffsetSolveFrameInput["definition"]["entities"][number],
): readonly string[] {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "arc":
      return [entity.startPointId, entity.endPointId, entity.centerPointId];
    case "circle":
      return [entity.centerPointId];
    case "spline":
      return entity.pointOccurrences.map((occurrence) => occurrence.pointId);
    default:
      return [];
  }
}

/**
 * The bitwise content key of a solve frame (T08b-g5b, g5a review REQUIRED):
 * everything `solveOffsetFrame` reads, encoded with every number by its
 * binary64 bits. That is the frame relationship (id, seeds, d, authored
 * arc joints), τ, the plan hint (origin included), the basis flag, the seed
 * entities in seed order (absent ones as null; their kind, closure,
 * occurrences, authored tangents and circle radius), every coincident
 * constraint (N2 reads them all, including paths through unselected
 * points), and the position (or absence) of every point a seed or a
 * coincident constraint names.
 */
function solveFrameKey(
  input: OffsetSolveFrameInput,
  plan: OffsetFramePlan | undefined,
): string {
  const { relationship, definition } = input;
  const entities = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const seeds = relationship.seedEntityIds.map(
    (seedId) => entities.get(seedId) ?? null,
  );
  const coincident = definition.constraints.flatMap((constraint) =>
    constraint.kind === "coincident" ? [constraint] : [],
  );
  const pointIds = new Set<string>();
  for (const seed of seeds)
    if (seed)
      for (const pointId of seedReadPointIds(seed)) pointIds.add(pointId);
  for (const constraint of coincident)
    for (const pointId of constraint.pointIds) pointIds.add(pointId);
  const positions = new Map(
    definition.points.map((point) => [point.pointId as string, point.position]),
  );
  return encode([
    relationship,
    input.modelingTolerance,
    plan ?? null,
    input.withSourceBasis === true,
    seeds,
    coincident,
    [...pointIds].map((pointId) => [pointId, positions.get(pointId) ?? null]),
  ]);
}

/**
 * T08b-g5b (g5a review REQUIRED, g2 routed "g4/g5 must cache"): a bounded,
 * content-keyed memo of solve frames. The frame is deterministic in exactly
 * its key (`solveFrameKey`), so a hit returns the SAME frame object the same
 * call computed before; that identity keeps `frameSourceBasis` (keyed by the
 * frame) valid. It does not reuse fixed-topology derivatives: the derivation
 * layer's `offsetDerivatives` cache is keyed by the per-evaluation record, so
 * those are recomputed on each evaluation. Least-recently-used eviction.
 */
class OffsetSolveFrameMemo {
  private readonly entries = new Map<string, OffsetSolveFrameResult>();
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  solve(
    input: OffsetSolveFrameInput,
    plan: OffsetFramePlan | undefined,
  ): OffsetSolveFrameResult {
    const key = solveFrameKey(input, plan);
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.entries.set(key, known);
      return known;
    }
    const result = solveOffsetFrameUnmemoized(input, plan);
    this.entries.set(key, result);
    if (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    return result;
  }
}

const solveFrameMemo = new OffsetSolveFrameMemo(64);

/**
 * Test seam (T08b-g5b memo equivalence): the solve frame computed without
 * the memo. Production code calls `solveOffsetFrame`.
 */
export function solveOffsetFrameWithoutMemoForTest(
  input: OffsetSolveFrameInput,
  plan?: OffsetFramePlan,
): OffsetSolveFrameResult {
  return solveOffsetFrameUnmemoized(input, plan);
}

function solveOffsetFrameUnmemoized(
  input: OffsetSolveFrameInput,
  plan?: OffsetFramePlan,
): OffsetSolveFrameResult {
  const { relationship, definition, modelingTolerance } = input;
  const fail = (failure: OffsetChainFailure) =>
    frameFailure(relationship, failure);
  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition,
    seedIds: relationship.seedEntityIds,
  });
  if (!connectivity.ok) return fail(connectivityFailure(connectivity));
  const basis = input.withSourceBasis
    ? frameSourceDofs(
        definition,
        connectivity.pieces.map((piece) => piece.seedEntityId),
      ).map(basisVariation)
    : undefined;
  const declared = uncheckedDeclaredOffsetChainPieces({
    definition,
    connectivity,
    distance: relationship.distance,
    modelingTolerance,
    ...(basis ? { directions: basis.map(sourceDirection) } : {}),
  });
  if (!declared.ok) return fail(declared);
  const frameOf = (run: Extract<PlanRun, { ok: true }>): OffsetSolveFrame => {
    const frame: OffsetSolveFrame = {
      ok: true,
      derivationId: relationship.derivationId,
      distance: relationship.distance,
      modelingTolerance,
      connectivity,
      plan: { origin: plan?.origin ?? "firstChoice", adjacencies: run.plan },
      pieces: basis ? withoutDirections(run.pieces) : run.pieces,
      vertices: declared.vertices,
      trims: run.geometry.trims,
      arcs: run.arcs,
      cubics: basis
        ? cubicsWithoutDirections(run.geometry.cubics)
        : run.geometry.cubics,
      lineArcEndpoints: run.geometry.lineArcEndpoints,
    };
    if (basis)
      frameSourceBasis.set(frame, { pieces: run.pieces, sources: run.sources });
    return frame;
  };
  const arcJoints = relationship.arcJoints;
  if (
    plan &&
    plan.adjacencies.length === declared.vertices.length &&
    (!arcJoints || sameArcSet(arcSet(plan.adjacencies), arcJoints))
  ) {
    const given = runPlan(declared, plan.adjacencies, undefined, true);
    if (given.ok) return frameOf(given);
  }
  const choices = firstChoice(declared, arcJoints);
  if ("ok" in choices) return fail(choices);
  const run = runPlan(declared, choices, choices, arcJoints !== undefined);
  return run.ok ? frameOf(run) : fail(run);
}

// ---------------------------------------------------------------------------
// Publish frame
// ---------------------------------------------------------------------------

const bits = new DataView(new ArrayBuffer(8));

/** Bitwise encoding (every number by its binary64 bits). */
function encode(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "number") return item;
    bits.setFloat64(0, item);
    return `f64:${bits.getBigUint64(0).toString(16)}`;
  });
}

/** The certified plan of a verified SEL resolution (origin `certified`). */
function certifiedPlanOf(
  resolved: OffsetChainTopologySuccess,
  adjacencies: number,
): readonly OffsetFramePlanEntry[] {
  return Array.from({ length: adjacencies }, (_, index) => {
    const joint = resolved.joints.find((item) => item.jointIndex === index);
    if (joint)
      return {
        kind: "trim",
        leaves: [
          Number(joint.request.first.provenance.sourceSpanId),
          Number(joint.request.second.provenance.sourceSpanId),
        ],
        representatives: [joint.firstParameter, joint.secondParameter],
      } as const;
    const vertex = resolved.vertices.find((item) => item.jointIndex === index);
    if (vertex) return { kind: vertex.kind, keeper: vertex.keeper } as const;
    return { kind: "arc" } as const;
  });
}

/** Plan agreement without representatives: kinds, keepers and trim leaves. */
function samePlan(
  first: readonly OffsetFramePlanEntry[],
  second: readonly OffsetFramePlanEntry[],
) {
  return (
    first.length === second.length &&
    first.every((entry, index) => {
      const other = second[index]!;
      if (entry.kind === "trim")
        return (
          other.kind === "trim" &&
          entry.leaves?.[0] === other.leaves?.[0] &&
          entry.leaves?.[1] === other.leaves?.[1]
        );
      if (entry.kind === "arc") return other.kind === "arc";
      return other.kind === entry.kind && other.keeper === entry.keeper;
    })
  );
}

/**
 * [TECH] G3: the solve frame is exactly the certified chain. The adapter
 * data and the adopted pieces bitwise, the plan (kinds, effective keepers,
 * trimmed leaves), the F1 arcs, the R7 removed leaves, every representative
 * inside its witness bounds (closed), and every published trim point the
 * evaluation of its representative. A difference is not a tolerance
 * question: it is a different plan or a different frame. Returns null on
 * agreement, else the `planChanged` reason (`representatives` only when a
 * representative outside its bounds is the first difference).
 */
function disagreement(
  frame: OffsetSolveFrame,
  certified: CertifiedOffsetChainTubeStability,
  connectivity: DeclaredOffsetChainConnectivity,
  plan: readonly OffsetFramePlanEntry[],
): "plan" | "representatives" | null {
  const { resolved } = certified;
  const input = resolved.input;
  if (
    encode(frame.connectivity) !== encode(connectivity) ||
    !Object.is(frame.modelingTolerance, input.modelingTolerance) ||
    !Object.is(frame.distance, input.distance) ||
    encode(frame.pieces) !== encode(input.pieces) ||
    encode(frame.vertices) !== encode(input.vertices) ||
    !samePlan(frame.plan.adjacencies, plan) ||
    encode(frame.arcs) !== encode(resolved.arcs)
  )
    return "plan";
  // Every representative inside its witness bounds (closed), in order.
  const inside = (value: number, bounds: readonly [number, number]) =>
    value >= bounds[0] && value <= bounds[1];
  if (
    frame.trims.length !== resolved.joints.length ||
    resolved.joints.some(
      (joint, position) =>
        frame.trims[position]!.jointIndex !== joint.jointIndex,
    )
  )
    return "plan";
  if (
    !resolved.joints.every((joint, position) => {
      const trim = frame.trims[position]!;
      return (
        inside(trim.first.parameter, joint.firstParameterBounds) &&
        inside(trim.second.parameter, joint.secondParameterBounds)
      );
    })
  )
    return "representatives";
  // Every published datum is the assembly of the CERTIFIED pieces with
  // these representatives (trim points, domain ends, query domains, R7).
  const expected = assembleFrameGeometry(
    input.pieces,
    frame.plan.adjacencies,
    new Map(
      frame.trims.map((trim) => [
        trim.jointIndex,
        { first: trim.first, second: trim.second },
      ]),
    ),
  );
  if (
    !expected.ok ||
    encode(expected.trims) !== encode(frame.trims) ||
    encode([...expected.cubics]) !== encode([...frame.cubics]) ||
    encode([...expected.lineArcEndpoints]) !==
      encode([...frame.lineArcEndpoints])
  )
    return "plan";
  // And the SEL's own assembly names the same domain ends and removals.
  for (const [seed, spans] of resolved.cubics) {
    const own = frame.cubics.get(seed);
    if (
      !own ||
      encode(own.map(({ start, end }) => [start, end])) !==
        encode(spans.map(({ start, end }) => [start, end]))
    )
      return "plan";
  }
  for (const [seed, ends] of resolved.lineArcEndpoints) {
    const own = frame.lineArcEndpoints.get(seed);
    if (
      !own ||
      encode(own.removedLeaves ?? null) !==
        encode(ends.removedLeaves ?? null) ||
      encode(own.startDomainEnd) !== encode(ends.startDomainEnd) ||
      encode(own.endDomainEnd) !== encode(ends.endDomainEnd)
    )
      return "plan";
  }
  return frame.cubics.size === resolved.cubics.size &&
    frame.lineArcEndpoints.size === resolved.lineArcEndpoints.size
    ? null
    : "plan";
}

/**
 * The T08b-g plan §2.1 seed-arc checks on the PUBLISHED ends (trim
 * representatives included): the [TECH F10] 0/2π wrap guard (f math A3) and
 * the review-R12 radius family (the solver's point-defined radius is
 * hypot(start − C), so a trimmed start publishes hypot(X_rep − C)); the
 * certificate's R7 removals must be the published ones. Micro arcs pass as
 * certified: no threshold is applied ([TECH] G10). The same reject-only
 * wrap guard runs on every published joint (F1) arc (`resolved.arcs`, which
 * agreement made bitwise `frame.arcs`): consumers draw those from rounded
 * atan2 angles of certified ends too (e R4).
 */
function arcCheckFailure(
  frame: OffsetSolveFrame,
  certified: CertifiedOffsetChainTubeStability,
): OffsetChainFailure | null {
  for (const record of certified.certificate.seedArcs ?? []) {
    const piece = frame.pieces[record.piece];
    if (record.kind !== "arc" || piece?.kind !== "arc") continue;
    const ends = frame.lineArcEndpoints.get(piece.seedEntityId);
    if (!ends)
      return chainFailure(
        codes.topologyUncertain,
        "A certified seed arc has no published ends.",
        piece.seedEntityId,
      );
    if (
      encode(ends.removedLeaves ?? [0, 0]) !== encode(record.removed) ||
      !Object.is(record.center[0], piece.center[0]) ||
      !Object.is(record.center[1], piece.center[1])
    )
      return chainFailure(
        codes.topologyUncertain,
        "The published seed arc is not the certified one (centre or removed leaves).",
        piece.seedEntityId,
      );
    if (
      !offsetArcSweepAdmissible(
        piece.center,
        ends.start,
        ends.end,
        piece.sweepDirection,
      )
    )
      return chainFailure(
        codes.topologyUncertain,
        "A published seed-arc end wraps across 0/2π against its exact sweep.",
        piece.seedEntityId,
      );
    const radius = canonicalArcSupport(
      piece.center,
      ends.start,
      ends.end,
      piece.sweepDirection,
    ).radius;
    if (!(radius >= record.radiusFamily[0] && radius <= record.radiusFamily[1]))
      return chainFailure(
        codes.topologyUncertain,
        "The published seed-arc radius lies outside the certified radius family.",
        piece.seedEntityId,
      );
  }
  for (const arc of certified.resolved.arcs)
    if (
      !offsetArcSweepAdmissible(
        arc.center,
        arc.start,
        arc.end,
        arc.sweepDirection,
      )
    )
      return chainFailure(
        codes.topologyUncertain,
        "A published joint-arc end wraps across 0/2π against its exact sweep.",
        frame.pieces[arc.jointIndex]!.seedEntityId,
      );
  return null;
}

/**
 * Publishes one accepted solve of one relationship (T08b-g plan §3.1): the
 * checked adapter on the accepted `(definition, solvedSnapshot)` pair, the
 * unchanged SEL, then plan agreement with `solveFrame` ([TECH] G3), the
 * authored arc set ([TECH] G6) and the §2.1 arc checks. A disagreement of a
 * frame that is not itself the hinted re-solve is `planChanged` with the
 * certifier's plan; the re-solve's disagreement fails closed. Every failure
 * is relationship-scoped ([TECH] G5/G16). Exceptions from the query, owner
 * or certifier propagate.
 */
export function publishOffsetFrame(input: {
  readonly relationship: OffsetFrameRelationship;
  readonly pair: {
    readonly definition: Pick<
      SketchDefinition,
      "points" | "entities" | "constraints" | "dimensions"
    >;
    readonly solvedSnapshot: SolvedSketchSnapshot;
  };
  readonly modelingTolerance: number;
  readonly query: CertifiedNeutralCurveRequestQuery;
  readonly certifier: CertifiedTubePieceChainRequests;
  readonly solveFrame: OffsetSolveFrame;
  /** T08b-g5: the per-deriver certifier memo (see `OffsetCertificationMemo`). */
  readonly memo?: OffsetCertificationMemo;
}): OffsetFramePublication {
  const { relationship, pair, modelingTolerance, solveFrame } = input;
  const failed = (failure: OffsetChainFailure): OffsetFramePublication => {
    const scoped = frameFailure(relationship, failure);
    return {
      status: "failed",
      derivationId: scoped.derivationId,
      failure: scoped.failure,
      diagnostic: scoped.diagnostic,
    };
  };
  const connectivity = extractDeclaredOffsetChainConnectivity({
    definition: pair.definition,
    seedIds: relationship.seedEntityIds,
  });
  if (!connectivity.ok) return failed(connectivityFailure(connectivity));
  const declared = declaredOffsetChainPieces({
    definition: pair.definition,
    solvedSnapshot: pair.solvedSnapshot,
    connectivity,
    distance: relationship.distance,
    modelingTolerance,
  });
  if (!declared.ok) return failed(declared);
  const certified = input.memo
    ? input.memo.certify(declared, input.query, input.certifier)
    : certifyDeclaredOffsetChain(declared, input.query, input.certifier);
  if (!certified.ok) return failed(certified);
  const plan = certifiedPlanOf(certified.resolved, declared.vertices.length);
  if (
    relationship.arcJoints &&
    !sameArcSet(arcSet(plan), relationship.arcJoints)
  )
    return failed(
      chainFailure(
        codes.topologyChanged,
        "The certified corner plan changes the authored arc set.",
        certified.seedEntityId,
      ),
    );
  const reason = disagreement(solveFrame, certified, connectivity, plan);
  if (reason) {
    if (solveFrame.plan.origin === "certified")
      return failed(
        chainFailure(
          codes.topologyUncertain,
          "The certified corner plan does not match the solved frame.",
          certified.seedEntityId,
        ),
      );
    return {
      status: "planChanged",
      derivationId: relationship.derivationId,
      reason,
      plan: { origin: "certified", adjacencies: plan },
    };
  }
  const arcFailure = arcCheckFailure(solveFrame, certified);
  if (arcFailure) return failed(arcFailure);
  // The only construction of the branded certified publication.
  return new CertifiedOffsetFramePublication(
    relationship.derivationId,
    solveFrame,
    certified,
    { origin: "published", adjacencies: solveFrame.plan.adjacencies },
  );
}

/**
 * T08b-g5 (g1 routed item, plan §3.4): a bounded memo of the SEL's result
 * keyed by the bitwise encoding of the CHECKED adapter output (pieces,
 * sources, vertices, connectivity, d and τ) plus the identity of the query
 * and certifier capabilities. The SEL is deterministic in exactly that
 * input, so a hit returns the result the same call would compute. Plan
 * agreement and the arc checks still run on every frame (they read the
 * solve frame, which is not part of the key).
 */
export class OffsetCertificationMemo {
  private readonly entries = new Map<
    string,
    ReturnType<typeof certifyDeclaredOffsetChain>
  >();
  private readonly capabilityIds = new WeakMap<object, number>();
  private nextCapabilityId = 0;
  private readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  private capabilityId(capability: object) {
    let id = this.capabilityIds.get(capability);
    if (id === undefined) {
      id = this.nextCapabilityId++;
      this.capabilityIds.set(capability, id);
    }
    return id;
  }

  certify(
    declared: Parameters<typeof certifyDeclaredOffsetChain>[0],
    query: CertifiedNeutralCurveRequestQuery,
    certifier: CertifiedTubePieceChainRequests,
  ): ReturnType<typeof certifyDeclaredOffsetChain> {
    const key = `${this.capabilityId(query)}:${this.capabilityId(certifier)}:${encode(declared)}`;
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.entries.set(key, known);
      return known;
    }
    const result = certifyDeclaredOffsetChain(declared, query, certifier);
    this.entries.set(key, result);
    if (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Frame derivatives (T08b-g2; live since T08b-g5)
// ---------------------------------------------------------------------------

/**
 * One source direction of a solve frame: point variations by point ID,
 * authored-tangent variations by spline seed and occurrence ID, circle seed
 * radius variations by entity ID. Also the shape of a pulled-back source
 * cotangent.
 */
export interface OffsetFrameVariation {
  readonly points?: Readonly<Record<string, SketchPoint2D>>;
  readonly splineTangents?: Readonly<
    Record<string, Readonly<Record<string, SketchPoint2D>>>
  >;
  readonly circleRadii?: Readonly<Record<string, number>>;
}

/** Point-defined arc variation (the solver's arc state: radius and end angles). */
export interface OffsetFrameArcVariation {
  readonly center: SketchPoint2D;
  readonly start: SketchPoint2D;
  readonly end: SketchPoint2D;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/**
 * The fixed-topology JVP of every published datum of one solve frame along
 * one source direction (T08b-g plan §2.6; keyed as the frame is):
 * - `cubics`: per spline seed, per owner leaf (the frame's `cubics` order),
 *   the pole variations and the representative query-domain variation;
 * - `lineArcEndpoints`: the published natural-order ends of line and seed-arc
 *   outputs; `seedArcs`: their point-defined arc variation; `circles`:
 *   centre and radius;
 * - `trims`: the trim point and both representative-parameter variations
 *   (frame order); `arcs`: each F1 arc's point-defined variation.
 * A pulled-back cotangent (`OffsetFrameCotangent`) has the same shape.
 */
export interface OffsetFrameJvp {
  readonly cubics: ReadonlyMap<
    SketchEntityId,
    readonly {
      readonly poles: SplinePoles;
      readonly queryDomain: readonly [number, number];
    }[]
  >;
  readonly lineArcEndpoints: ReadonlyMap<
    SketchEntityId,
    { readonly start: SketchPoint2D; readonly end: SketchPoint2D }
  >;
  readonly seedArcs: ReadonlyMap<SketchEntityId, OffsetFrameArcVariation>;
  readonly circles: ReadonlyMap<
    SketchEntityId,
    { readonly center: SketchPoint2D; readonly radius: number }
  >;
  readonly trims: readonly {
    readonly jointIndex: number;
    readonly position: SketchPoint2D;
    readonly first: number;
    readonly second: number;
  }[];
  readonly arcs: readonly (OffsetFrameArcVariation & {
    readonly jointIndex: number;
  })[];
}

type Partialized<T> = {
  readonly [K in keyof T]?: T[K];
};

/** A cotangent on (any subset of) a frame's published data (`OffsetFrameJvp` shape). */
export interface OffsetFrameCotangent {
  readonly cubics?: ReadonlyMap<
    SketchEntityId,
    readonly (
      | Partialized<{
          poles: SplinePoles;
          queryDomain: readonly [number, number];
        }>
      | undefined
    )[]
  >;
  readonly lineArcEndpoints?: ReadonlyMap<
    SketchEntityId,
    Partialized<{ start: SketchPoint2D; end: SketchPoint2D }>
  >;
  readonly seedArcs?: ReadonlyMap<
    SketchEntityId,
    Partialized<OffsetFrameArcVariation>
  >;
  readonly circles?: ReadonlyMap<
    SketchEntityId,
    Partialized<{ center: SketchPoint2D; radius: number }>
  >;
  readonly trims?: readonly (Partialized<
    Omit<OffsetFrameJvp["trims"][number], "jointIndex">
  > & { readonly jointIndex: number })[];
  readonly arcs?: readonly (Partialized<OffsetFrameArcVariation> & {
    readonly jointIndex: number;
  })[];
}

/** One source degree of freedom of a frame (a pullback basis direction). */
export type OffsetFrameSourceDof =
  | { readonly kind: "point"; readonly pointId: string; readonly axis: 0 | 1 }
  | {
      readonly kind: "tangent";
      readonly entityId: SketchEntityId;
      readonly occurrenceId: string;
      readonly axis: 0 | 1;
    }
  | { readonly kind: "circleRadius"; readonly entityId: SketchEntityId };

/**
 * The derivatives of ONE solve frame (T08b-g2): the batched fixed-topology
 * JVP and the pullback by basis application with a per-frame cache.
 */
export interface OffsetFrameDerivatives {
  /** The frame's source degrees of freedom (points, authored tangents, circle radii). */
  readonly sourceDofs: readonly OffsetFrameSourceDof[];
  /**
   * The JVP along each direction, from ONE batched owner call per spline
   * seed (plus one per adopting piece). A direction whose derivative is not
   * available (a singular or non-finite joint, a non-finite owner
   * direction) is a `derivativeUnavailable` failure; the others are
   * unaffected.
   */
  jvp(
    variations: readonly OffsetFrameVariation[],
  ): readonly (OffsetFrameJvp | OffsetChainFailure)[];
  /**
   * Jᵀw by basis application: ⟨J eᵢ, w⟩ per source DOF. The basis columns
   * are computed once per frame (one batched JVP over every DOF) and
   * cached. `derivativeUnavailable` when any column is unavailable.
   */
  pullback(
    cotangent: OffsetFrameCotangent,
  ): OffsetFrameVariation | OffsetChainFailure;
}

type Vec = SketchPoint2D;
const ZERO: Vec = [0, 0];
const plus = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const times = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
const dotVec = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const crossVec = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];

/** d(v/|v|) for dv (v ≠ 0). */
function unitDifferential(vector: Vec, differential: Vec): Vec {
  const length = Math.hypot(vector[0], vector[1]);
  const unit = times(vector, 1 / length);
  return times(
    minus(differential, times(unit, dotVec(unit, differential))),
    1 / length,
  );
}

/**
 * The point-defined arc variation of (C, S, E): radius hypot(S − C) (the
 * published / `canonicalArcSupport` radius, never the rounded certified ρ),
 * angles atan2 of S − C and E − C. Analytic; fails closed only when not
 * finite ([TECH] G10: no threshold).
 */
function pointDefinedArcVariation(
  center: Vec,
  start: Vec,
  end: Vec,
  variation: { center: Vec; start: Vec; end: Vec },
): OffsetFrameArcVariation {
  const s = minus(start, center);
  const e = minus(end, center);
  const ds = minus(variation.start, variation.center);
  const de = minus(variation.end, variation.center);
  const radius = Math.hypot(s[0], s[1]);
  return {
    ...variation,
    radius: dotVec(s, ds) / radius,
    startAngle: crossVec(s, ds) / dotVec(s, s),
    endAngle: crossVec(e, de) / dotVec(e, e),
  };
}

/** Every number reachable in plain arrays / objects is finite. */
const finiteNumbers = (value: unknown): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : typeof value !== "object" || value === null
      ? true
      : Object.values(value).every(finiteNumbers);

/** The source DOFs of a relationship's seeds, in seed order (points deduplicated). */
function frameSourceDofs(
  definition: Pick<SketchDefinition, "entities">,
  seeds: readonly SketchEntityId[],
): OffsetFrameSourceDof[] {
  const dofs: OffsetFrameSourceDof[] = [];
  const seen = new Set<string>();
  const point = (pointId: string) => {
    if (seen.has(pointId)) return;
    seen.add(pointId);
    dofs.push({ kind: "point", pointId, axis: 0 });
    dofs.push({ kind: "point", pointId, axis: 1 });
  };
  for (const seed of seeds) {
    const entity = definition.entities.find((item) => item.entityId === seed);
    if (entity?.kind === "lineSegment") {
      point(entity.startPointId);
      point(entity.endPointId);
    } else if (entity?.kind === "arc") {
      point(entity.centerPointId);
      point(entity.startPointId);
      point(entity.endPointId);
    } else if (entity?.kind === "circle") {
      point(entity.centerPointId);
      dofs.push({ kind: "circleRadius", entityId: seed });
    } else if (entity?.kind === "spline") {
      for (const occurrence of entity.pointOccurrences)
        point(occurrence.pointId);
      for (const occurrence of entity.pointOccurrences)
        if (occurrence.tangent.kind === "authored")
          for (const axis of [0, 1] as const)
            dofs.push({
              kind: "tangent",
              entityId: seed,
              occurrenceId: occurrence.occurrenceId,
              axis,
            });
    }
  }
  return dofs;
}

/** The basis direction of one source DOF. */
function basisVariation(dof: OffsetFrameSourceDof): OffsetFrameVariation {
  const unit: Vec =
    dof.kind === "circleRadius" || dof.axis === 0 ? [1, 0] : [0, 1];
  if (dof.kind === "point") return { points: { [dof.pointId]: unit } };
  if (dof.kind === "tangent")
    return { splineTangents: { [dof.entityId]: { [dof.occurrenceId]: unit } } };
  return { circleRadii: { [dof.entityId]: 1 } };
}

/** The owner-direction part of one source variation (circle radii are analytic). */
function sourceDirection(variation: OffsetFrameVariation) {
  return {
    ...(variation.points ? { points: variation.points } : {}),
    ...(variation.splineTangents
      ? { splineTangents: variation.splineTangents }
      : {}),
  };
}

/** ⟨jvp, cotangent⟩ over every datum the cotangent names. */
function pairing(jvp: OffsetFrameJvp, cotangent: OffsetFrameCotangent) {
  const vec = (a: Vec, b: Vec | undefined) => (b ? dotVec(a, b) : 0);
  const num = (a: number, b: number | undefined) =>
    b === undefined ? 0 : a * b;
  const arc = (
    a: OffsetFrameArcVariation,
    b: Partialized<OffsetFrameArcVariation>,
  ) =>
    vec(a.center, b.center) +
    vec(a.start, b.start) +
    vec(a.end, b.end) +
    num(a.radius, b.radius) +
    num(a.startAngle, b.startAngle) +
    num(a.endAngle, b.endAngle);
  const missing = (what: string): never => {
    throw new RangeError(
      `The cotangent names a ${what} the frame does not publish.`,
    );
  };
  let sum = 0;
  for (const [seed, leaves] of cotangent.cubics ?? []) {
    const own = jvp.cubics.get(seed) ?? missing("cubic output");
    leaves.forEach((leaf, index) => {
      if (!leaf) return;
      const value = own[index] ?? missing("cubic leaf");
      if (leaf.poles)
        value.poles.forEach((pole, k) => (sum += vec(pole, leaf.poles![k])));
      if (leaf.queryDomain)
        sum +=
          value.queryDomain[0] * leaf.queryDomain[0] +
          value.queryDomain[1] * leaf.queryDomain[1];
    });
  }
  for (const [seed, ends] of cotangent.lineArcEndpoints ?? []) {
    const own = jvp.lineArcEndpoints.get(seed) ?? missing("line/arc output");
    sum += vec(own.start, ends.start) + vec(own.end, ends.end);
  }
  for (const [seed, value] of cotangent.seedArcs ?? [])
    sum += arc(jvp.seedArcs.get(seed) ?? missing("seed arc"), value);
  for (const [seed, value] of cotangent.circles ?? []) {
    const own = jvp.circles.get(seed) ?? missing("circle");
    sum += vec(own.center, value.center) + num(own.radius, value.radius);
  }
  for (const value of cotangent.trims ?? []) {
    const own =
      jvp.trims.find((trim) => trim.jointIndex === value.jointIndex) ??
      missing("trim");
    sum +=
      vec(own.position, value.position) +
      num(own.first, value.first) +
      num(own.second, value.second);
  }
  for (const value of cotangent.arcs ?? [])
    sum += arc(
      jvp.arcs.find((item) => item.jointIndex === value.jointIndex) ??
        missing("joint arc"),
      value,
    );
  return sum;
}

/** The frame's pieces without the batched owner directions (for the bitwise reproduction check). */
function withoutDirections(pieces: readonly OffsetChainPiece[]) {
  return pieces.map((piece) =>
    piece.kind === "derivedCubic"
      ? {
          ...piece,
          spans: piece.spans.map(
            ({ directions: _directions, ...rest }) => rest,
          ),
        }
      : piece,
  );
}

/** The frame's cubic outputs without the batched owner directions (review R3: frames carry none). */
function cubicsWithoutDirections(
  cubics: OffsetSolveFrame["cubics"],
): OffsetSolveFrame["cubics"] {
  return new Map(
    [...cubics].map(([seed, spans]) => [
      seed,
      spans.map((leaf) => ({
        ...leaf,
        span: (({ directions: _directions, ...span }) => span)(leaf.span),
      })),
    ]),
  );
}

/**
 * The derivatives of one solve frame (T08b-g2; wired by T08b-g5). Fixed topology: the
 * frame's plan, adoption (effective keepers), trim leaves and
 * representatives; every datum is differentiated as `assembleFrameGeometry`
 * publishes it:
 * - spline poles: the owner's batched `directions` (T08b-g2 [TECH] G8a),
 *   from ONE reconstruction + owner call per spline seed carrying every
 *   direction (seed points AND authored tangents, fixing the legacy
 *   omission) plus the adoption re-call, whose poles must reproduce the
 *   frame bitwise;
 * - line / seed-arc / circle pieces: analytic (`offsetLinePoints`, the
 *   ray-scaled S′/E′ with R̃ = ρ_s − σd, r − d);
 * - declared vertices (parallel / absorbed): both terminals move with the
 *   KEEPER's terminal variation, the adopted pole (also where the poles were
 *   already bitwise equal and no re-call ran), and each piece's effective
 *   end variation is used both by its trim jets and its published ends
 *   (d math A3). At a d-A3 plan boundary (poles already bitwise shared, no
 *   re-call, the adopter trimmed at its other end) a generic direction
 *   leaves the plan: the JVP is then the one-sided derivative that assumes
 *   the line start stays on the spline's shared pole, correct along
 *   pole-preserving directions;
 * - trims: the implicit joint-parameter JVP of P(s) = Q(t) at the frame's
 *   representatives (the resolver's 2×2 solve); a singular or non-finite
 *   joint is `derivativeUnavailable` for that direction;
 * - query domains: a trim end's parameter JVP, else the moving source-span
 *   end (`differential.sourceInterval`);
 * - arcs (F1 and seed arcs): the point-defined variation of their published
 *   centre and ends (radius = hypot(S − C)); the review-R12 radius family is
 *   a publish check only and has no effect here.
 * No finite differences at runtime.
 */
export function prepareOffsetFrameDerivatives(
  input: {
    readonly relationship: OffsetFrameRelationship;
    readonly definition: Pick<
      SketchDefinition,
      "points" | "entities" | "constraints"
    >;
    readonly modelingTolerance: number;
  },
  frame: OffsetSolveFrame,
): OffsetFrameDerivatives {
  const { relationship, definition, modelingTolerance } = input;
  const seeds = frame.connectivity.pieces.map((piece) => piece.seedEntityId);
  const sourceDofs = frameSourceDofs(definition, seeds);
  const unavailable = (message: string, seed: SketchEntityId | null) =>
    chainFailure(codes.derivativeUnavailable, message, seed);

  const jvp = (
    variations: readonly OffsetFrameVariation[],
  ): readonly (OffsetFrameJvp | OffsetChainFailure)[] => {
    if (variations.length === 0) return [];
    const declared = uncheckedDeclaredOffsetChainPieces({
      definition,
      connectivity: frame.connectivity,
      distance: relationship.distance,
      modelingTolerance,
      directions: variations.map(sourceDirection),
    });
    if (!declared.ok)
      throw new RangeError(
        `The solve frame is not reproduced by its definition: ${declared.message}`,
      );
    const adopted = adoptOffsetChainPlan(declared, frame.plan.adjacencies);
    if (
      !adopted.ok ||
      adopted.plan.some((entry, index) => {
        const planned = frame.plan.adjacencies[index]!;
        return (
          entry.kind !== planned.kind ||
          ("keeper" in entry &&
            "keeper" in planned &&
            entry.keeper !== planned.keeper)
        );
      }) ||
      encode(withoutDirections(adopted.pieces)) !== encode(frame.pieces)
    )
      throw new RangeError(
        "The solve frame is not reproduced by its definition (pieces differ).",
      );
    return variations.map(
      (variation, index) =>
        directionJvp(
          frame,
          adopted.pieces,
          adopted.sources,
          definition,
          variation,
          index,
        ) ??
        unavailable(
          "The offset frame derivative is singular or non-finite in this direction.",
          seeds[0] ?? null,
        ),
    );
  };

  let columns: readonly (OffsetFrameJvp | OffsetChainFailure)[] | undefined;
  const basisColumns = () => {
    // T08b-g5: the solve frame's own batched owner call already carries the
    // source basis (same DOF order: same definition and seeds).
    const own = frameSourceBasis.get(frame);
    if (!own) return jvp(sourceDofs.map(basisVariation));
    return sourceDofs.map(
      (dof, index) =>
        directionJvp(
          frame,
          own.pieces,
          own.sources,
          definition,
          basisVariation(dof),
          index,
        ) ??
        unavailable(
          "The offset frame derivative is singular or non-finite in this direction.",
          seeds[0] ?? null,
        ),
    );
  };
  const pullback = (
    cotangent: OffsetFrameCotangent,
  ): OffsetFrameVariation | OffsetChainFailure => {
    columns ??= basisColumns();
    const points: Record<string, [number, number]> = {};
    const splineTangents: Record<string, Record<string, [number, number]>> = {};
    const circleRadii: Record<string, number> = {};
    for (const [index, dof] of sourceDofs.entries()) {
      const column = columns[index]!;
      if ("ok" in column) return column;
      const value = pairing(column, cotangent);
      if (dof.kind === "point")
        (points[dof.pointId] ??= [0, 0])[dof.axis] = value;
      else if (dof.kind === "tangent")
        ((splineTangents[dof.entityId] ??= {})[dof.occurrenceId] ??= [0, 0])[
          dof.axis
        ] = value;
      else circleRadii[dof.entityId] = value;
    }
    return { points, splineTangents, circleRadii };
  };
  return { sourceDofs, jvp, pullback };
}

/**
 * One direction's JVP of the frame (see `prepareOffsetFrameDerivatives`),
 * from the batched pieces; null when not available (singular, non-finite).
 */
function directionJvp(
  frame: OffsetSolveFrame,
  pieces: readonly OffsetChainPiece[],
  sources: readonly DeclaredOffsetPieceSource[],
  definition: Pick<SketchDefinition, "entities">,
  variation: OffsetFrameVariation,
  direction: number,
): OffsetFrameJvp | null {
  const count = pieces.length;
  const pointVariation = (pointId: string | undefined) =>
    (pointId === undefined ? undefined : variation.points?.[pointId]) ?? ZERO;
  const entityOf = (seed: SketchEntityId) =>
    definition.entities.find((entity) => entity.entityId === seed);
  // Own (unadopted) piece variations, natural order.
  interface PieceVariation {
    start: Vec;
    end: Vec;
    center?: Vec;
    radius?: number;
    /** Cubic leaves' directional differentials (poles copied, may be overridden). */
    leaves?: { sourceInterval: readonly [number, number]; poles: Vec[] }[];
  }
  const own: PieceVariation[] = [];
  for (const [index, piece] of pieces.entries()) {
    const source = sources[index]!;
    const entity = entityOf(piece.seedEntityId);
    if (piece.kind === "derivedCubic") {
      const leaves: NonNullable<PieceVariation["leaves"]> = [];
      for (const span of piece.spans) {
        const value = span.directions?.[direction];
        if (!value) return null;
        leaves.push({
          sourceInterval: value.sourceInterval,
          poles: [...value.poles],
        });
      }
      own.push({
        start: leaves[0]!.poles[0]!,
        end: leaves.at(-1)!.poles[3]!,
        leaves,
      });
      continue;
    }
    if (piece.kind === "lineSegment" && source.kind === "line") {
      // offsetLinePoints: P + d·rot(û), û = (E − S)/|E − S|.
      const dStart = pointVariation(source.startPointId);
      const dEnd = pointVariation(source.endPointId);
      const du = unitDifferential(
        minus(source.source[1], source.source[0]),
        minus(dEnd, dStart),
      );
      const dNormal = times([-du[1], du[0]], source.distance);
      own.push({ start: plus(dStart, dNormal), end: plus(dEnd, dNormal) });
      continue;
    }
    if (
      piece.kind === "arc" &&
      source.kind === "arc" &&
      entity?.kind === "arc"
    ) {
      // S′ = C + R̃·(S − C)/|S − C|, E′ likewise, R̃ = ρ_s − σd, ρ_s = |S − C|.
      const dCenter = pointVariation(entity.centerPointId);
      const [start, end] = source.source;
      const shifted =
        source.sourceRadius -
        (entity.sweepDirection === "counterClockwise" ? 1 : -1) *
          source.distance;
      const ws = minus(start, source.center);
      const dws = minus(pointVariation(source.startPointId), dCenter);
      const dRho = dotVec(ws, dws) / Math.hypot(ws[0], ws[1]);
      const scaled = (point: Vec, dPoint: Vec) => {
        const w = minus(point, source.center);
        const unit = times(w, 1 / Math.hypot(w[0], w[1]));
        return plus(
          dCenter,
          plus(
            times(unitDifferential(w, minus(dPoint, dCenter)), shifted),
            times(unit, dRho),
          ),
        );
      };
      own.push({
        center: dCenter,
        start: scaled(start, pointVariation(source.startPointId)),
        end: scaled(end, pointVariation(source.endPointId)),
      });
      continue;
    }
    if (piece.kind === "circle" && entity?.kind === "circle") {
      own.push({
        start: ZERO,
        end: ZERO,
        center: pointVariation(entity.centerPointId),
        radius: variation.circleRadii?.[entity.entityId] ?? 0,
      });
      continue;
    }
    throw new RangeError(
      `Unsupported offset frame piece ${piece.seedEntityId}`,
    );
  }
  // Declared vertices: the non-keeper terminal takes the keeper's (adoption).
  const terminal = (index: number, exiting: boolean) =>
    exiting !== pieces[index]!.reversed ? ("end" as const) : ("start" as const);
  const setTerminal = (index: number, side: "start" | "end", value: Vec) => {
    const piece = own[index]!;
    piece[side] = value;
    if (piece.leaves) {
      const leaf = side === "start" ? piece.leaves[0]! : piece.leaves.at(-1)!;
      leaf.poles[side === "start" ? 0 : 3] = value;
    }
  };
  for (const [jointIndex, entry] of frame.plan.adjacencies.entries()) {
    if (entry.kind !== "parallel" && entry.kind !== "absorbed") continue;
    const next = (jointIndex + 1) % count;
    const first = { index: jointIndex, side: terminal(jointIndex, true) };
    const second = { index: next, side: terminal(next, false) };
    const [keep, adopt] =
      entry.keeper === "first" ? [first, second] : [second, first];
    setTerminal(adopt.index, adopt.side, own[keep.index]![keep.side]);
  }
  // Seed-arc piece radius (the circle leaves' radius): hypot(start − C) of
  // the (possibly adopted) piece start.
  for (const [index, piece] of pieces.entries())
    if (piece.kind === "arc") {
      const value = own[index]!;
      const s = minus(piece.start, piece.center);
      value.radius =
        dotVec(s, minus(value.start, value.center!)) / Math.hypot(s[0], s[1]);
    }
  // Trims: the implicit joint-parameter JVP at the representatives.
  const jet = (index: number, leaf: number, parameter: number) => {
    const piece = pieces[index]!;
    const value = own[index]!;
    if (piece.kind === "lineSegment")
      return {
        first: minus(piece.end, piece.start),
        variation: plus(
          value.start,
          times(minus(value.end, value.start), parameter),
        ),
      };
    if (piece.kind === "derivedCubic") {
      const span = piece.spans[leaf]!;
      const differential = value.leaves![leaf]!;
      const evaluated = evaluateSplineSpan(
        {
          interval: span.sourceInterval,
          poles: span.poles,
          differential: {
            interval: differential.sourceInterval,
            poles: differential.poles as unknown as SplinePoles,
          },
        },
        { kind: "source", value: parameter },
      );
      return {
        first: evaluated.first,
        variation: evaluated.differential.position,
      };
    }
    const radius = piece.radius;
    const cosine = Math.cos(parameter);
    const sine = Math.sin(parameter);
    return {
      first: [-radius * sine, radius * cosine] as Vec,
      variation: plus(value.center!, times([cosine, sine], value.radius!)),
    };
  };
  const trims: {
    jointIndex: number;
    position: Vec;
    first: number;
    second: number;
  }[] = [];
  for (const trim of frame.trims) {
    const next = (trim.jointIndex + 1) % count;
    const a = jet(trim.jointIndex, trim.first.leaf, trim.first.parameter);
    const b = jet(next, trim.second.leaf, trim.second.parameter);
    const determinant = b.first[0] * a.first[1] - a.first[0] * b.first[1];
    if (!Number.isFinite(determinant) || determinant === 0) return null;
    const rx = b.variation[0] - a.variation[0];
    const ry = b.variation[1] - a.variation[1];
    const ds = (b.first[0] * ry - b.first[1] * rx) / determinant;
    const dt = (a.first[0] * ry - a.first[1] * rx) / determinant;
    // The published point's side (`trimPosition`).
    const firstArc = pieces[trim.jointIndex]!.kind === "arc";
    const onSecond =
      pieces[next]!.kind === "arc" && (!pieces[next]!.reversed || !firstArc);
    trims.push({
      jointIndex: trim.jointIndex,
      position: onSecond
        ? plus(b.variation, times(b.first, dt))
        : plus(a.variation, times(a.first, ds)),
      first: ds,
      second: dt,
    });
  }
  const trimOf = (jointIndex: number) =>
    trims.find((trim) => trim.jointIndex === jointIndex)!;
  // The trim's first side is piece `jointIndex` at its exiting natural side;
  // every other end at that joint is the second side. By piece and side, not
  // by seed: a self-trim (one positional-closure piece) has one seed on both.
  const trimParameter = (
    end: OffsetChainDomainEnd,
    index: number,
    side: "start" | "end",
  ) => {
    if (end.kind !== "joint") return undefined;
    const value = trimOf(end.jointIndex);
    return end.jointIndex === index && side === terminal(index, true)
      ? value.first
      : value.second;
  };
  const cubics = new Map<
    SketchEntityId,
    { poles: SplinePoles; queryDomain: readonly [number, number] }[]
  >();
  const lineArcEndpoints = new Map<SketchEntityId, { start: Vec; end: Vec }>();
  const seedArcs = new Map<SketchEntityId, OffsetFrameArcVariation>();
  const circles = new Map<SketchEntityId, { center: Vec; radius: number }>();
  for (const [index, piece] of pieces.entries()) {
    const seed = piece.seedEntityId;
    const value = own[index]!;
    if (piece.kind === "circle") {
      circles.set(seed, { center: value.center!, radius: value.radius! });
      continue;
    }
    if (piece.kind === "derivedCubic") {
      const spans = frame.cubics.get(seed)!;
      cubics.set(
        seed,
        spans.map((span, leaf) => {
          const differential = value.leaves![leaf]!;
          return {
            poles: differential.poles as unknown as SplinePoles,
            queryDomain: [
              trimParameter(span.start, index, "start") ??
                differential.sourceInterval[0],
              trimParameter(span.end, index, "end") ??
                differential.sourceInterval[1],
            ],
          };
        }),
      );
      continue;
    }
    const ends = frame.lineArcEndpoints.get(seed)!;
    const endpoint = (end: OffsetChainDomainEnd, variationOf: Vec) =>
      end.kind === "joint" ? trimOf(end.jointIndex).position : variationOf;
    const published = {
      start: endpoint(ends.startDomainEnd, value.start),
      end: endpoint(ends.endDomainEnd, value.end),
    };
    lineArcEndpoints.set(seed, published);
    if (piece.kind === "arc")
      seedArcs.set(
        seed,
        pointDefinedArcVariation(piece.center, ends.start, ends.end, {
          center: value.center!,
          ...published,
        }),
      );
  }
  const arcs = frame.arcs.map((arc) => {
    const next = (arc.jointIndex + 1) % count;
    return {
      jointIndex: arc.jointIndex,
      ...pointDefinedArcVariation(arc.center, arc.start, arc.end, {
        center: pointVariation(frame.vertices[arc.jointIndex]!.first.pointId),
        start: own[arc.jointIndex]![terminal(arc.jointIndex, true)],
        end: own[next]![terminal(next, false)],
      }),
    };
  });
  const result: OffsetFrameJvp = {
    cubics,
    lineArcEndpoints,
    seedArcs,
    circles,
    trims,
    arcs,
  };
  return finiteNumbers([
    [...cubics],
    [...lineArcEndpoints],
    [...seedArcs],
    [...circles],
    trims,
    arcs,
  ])
    ? result
    : null;
}

/** A held location on a derived cubic output: an owner leaf and its local Bézier parameter u. */
export interface OffsetFrameCurveLocation {
  readonly leaf: number;
  readonly u: number;
}

/** The local sub-interval of one leaf's representative query domain (exact ends kept). */
function localQueryDomain(
  span: OffsetFrameCubicSpan,
): readonly [number, number] {
  const [low, high] = span.sourceDomain;
  const [from, to] = span.representativeQueryDomain;
  const local = (value: number, end: number, exact: 0 | 1) =>
    value === end ? exact : (value - low) / (high - low);
  return [local(from, low, 0), local(to, high, 1)];
}

/**
 * The point-on-derived-curve residual helper (T08b-g2; the g5
 * `pointOnCurve` residual on a derived cubic output): r = P − C(leaf, u).
 * The location comes from a closest-point search restricted to every
 * leaf's representative query domain (`closestSplineSpanLocation` with
 * `domains`; T08b-g5d: never a leaf `removed` by a deep trim), so a point
 * never binds to a trimmed-off tail, unless a held `location` is given (a
 * held location on a leaf a later frame removes is the caller's: like the
 * g5b query-domain restriction, a fresh search jumps to the drawn domain). The gradient holds (leaf, u) fixed: ∂r/∂P = I and
 * ∂r_c/∂source is the pullback of the held leaf's pole cotangent
 * −Bᵢ(u)·e_c. `derivativeUnavailable` when the search finds nothing or the
 * pullback is unavailable.
 */
export function offsetFrameCurveResidual(input: {
  readonly frame: OffsetSolveFrame;
  readonly derivatives: OffsetFrameDerivatives;
  readonly seedEntityId: SketchEntityId;
  readonly point: SketchPoint2D;
  readonly location?: OffsetFrameCurveLocation;
}):
  | {
      readonly ok: true;
      readonly location: OffsetFrameCurveLocation;
      readonly value: SketchPoint2D;
      readonly gradient: {
        /** ∂r/∂P (rows r_x, r_y). */
        readonly point: readonly [SketchPoint2D, SketchPoint2D];
        /** ∂r_x/∂source, ∂r_y/∂source. */
        readonly source: readonly [OffsetFrameVariation, OffsetFrameVariation];
      };
    }
  | OffsetChainFailure {
  const { frame, derivatives, seedEntityId, point } = input;
  const leaves = frame.cubics.get(seedEntityId);
  if (!leaves)
    throw new RangeError(
      `Offset seed ${seedEntityId} has no derived cubic output in this frame.`,
    );
  const zeroPoles: SplinePoles = [ZERO, ZERO, ZERO, ZERO];
  const found =
    input.location ??
    (() => {
      const hit = closestSplineSpanLocation(
        point,
        leaves.map((leaf) => ({
          interval: leaf.sourceDomain,
          poles: leaf.span.poles,
          differential: { interval: [0, 0] as const, poles: zeroPoles },
        })),
        // T08b-g5d: a removed leaf has no drawn domain (never bound).
        leaves.map((leaf) =>
          leaf.start.kind === "removed" ? undefined : localQueryDomain(leaf),
        ),
      );
      return hit ? { leaf: hit.spanIndex, u: hit.u } : null;
    })();
  if (!found)
    return chainFailure(
      codes.derivativeUnavailable,
      "No closest point on the derived curve's active domain.",
      seedEntityId,
    );
  const leaf = leaves[found.leaf]!;
  const { u } = found;
  const curve = evaluateSplineSpan(
    {
      interval: leaf.sourceDomain,
      poles: leaf.span.poles,
      differential: { interval: [0, 0], poles: zeroPoles },
    },
    { kind: "local", value: u },
  ).position;
  const v = 1 - u;
  const weights = [v * v * v, 3 * u * v * v, 3 * u * u * v, u * u * u];
  const component = (axis: 0 | 1) => {
    const unit: SketchPoint2D = axis === 0 ? [-1, 0] : [0, -1];
    const cotangentLeaves: { poles: SplinePoles }[] = [];
    cotangentLeaves[found.leaf] = {
      poles: weights.map((weight) =>
        times(unit, weight),
      ) as unknown as SplinePoles,
    };
    return derivatives.pullback({
      cubics: new Map([[seedEntityId, cotangentLeaves]]),
    });
  };
  const x = component(0);
  if ("ok" in x) return x;
  const y = component(1);
  if ("ok" in y) return y;
  return {
    ok: true,
    location: found,
    value: minus(point, curve),
    gradient: {
      point: [
        [1, 0],
        [0, 1],
      ],
      source: [x, y],
    },
  };
}
