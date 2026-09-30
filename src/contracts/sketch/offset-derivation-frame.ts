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
  declaredOffsetChainPieces,
  firstChoiceOffsetChainPlan,
  offsetArcSweepAdmissible,
  offsetChainJointLeaves,
  uncheckedDeclaredOffsetChainPieces,
  type CertifiedNeutralCurveRequestQuery,
  type CertifiedOffsetChainTubeStability,
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
  evaluateSplineSpan,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import type { SplineOffsetCubicSpan } from "@/contracts/sketch/spline-offset-geometry";

/**
 * T08b-g1: the solve / publish frame owner of one offset relationship (dark:
 * no production path imports it yet; nothing here is persisted).
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
 *
 * Trust note (T08b-g plan §2.5, verbatim):
 *
 * 1. **M0.** The tube certificate is the sole global gate. It is about the abstract chain trimmed at exact witnessed roots, never at binary64 representatives. Publish additionally checks that each representative lies in its witness bounds.
 * 2. **R7** (declared vertex with a gap g).
 *    - At a declared vertex, O* is the gap-free reference (Q translated by −g) plus a straight bridge of vector g at the declared join. This realizes a declared join within τ under the standing declared-joins decision.
 *    - It requires e·g ≥ 0 and Lemma G's bound, and fails closed otherwise.
 *    - d math A6: at a concave vertex with g ≠ 0 the certificate proves O* simple and bridged; it does **not** prove that the untranslated true offsets cross exactly once.
 * 3. **R_C′**: at a declared coincident or shared-point cubic↔cubic join that passes H2 in a solver-accepted frame, O* is the two pieces' true offsets, each trimmed at their unique common point.
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
  /** Nominal brand (T08b-a math A2): no runtime field. */
  declare private readonly brand: true;
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

/** One trim: seeded from the plan's representatives, else from the source vertex. */
function solveTrim(
  leaves: ReturnType<typeof offsetChainJointLeaves>,
  entry: Extract<OffsetFramePlanEntry, { kind: "trim" }>,
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
  return attempt(
    first[0]!,
    second[0]!,
    [vertexParameter(first[0]!), vertexParameter(second[0]!)],
    false,
  );
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

/** Trims by the Newton step, then the frame geometry from them. */
function buildFrameGeometry(
  pieces: readonly OffsetChainPiece[],
  plan: readonly OffsetFramePlanEntry[],
): BuiltFrame {
  const representatives = new Map<number, TrimRepresentative>();
  for (const [jointIndex, entry] of plan.entries()) {
    if (entry.kind !== "trim") continue;
    const solved = solveTrim(offsetChainJointLeaves(pieces, jointIndex), entry);
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
      const last = piece.spans.length - 1;
      cubics.set(
        seed,
        piece.spans.map((span, offset) => ({
          span,
          sourceDomain: span.sourceInterval,
          start: offset === 0 ? own.start : { kind: "source" },
          end: offset === last ? own.end : { kind: "source" },
          representativeQueryDomain: [
            offset === 0 && own.startParameter !== undefined
              ? own.startParameter
              : span.sourceInterval[0],
            offset === last && own.endParameter !== undefined
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
    const geometry = buildFrameGeometry(adopted.pieces, effective);
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
      arcs: adopted.arcs,
      geometry,
    };
  }
}

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
  input: {
    readonly relationship: OffsetFrameRelationship;
    readonly definition: Pick<
      SketchDefinition,
      "points" | "entities" | "constraints"
    >;
    readonly modelingTolerance: number;
  },
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
  const declared = uncheckedDeclaredOffsetChainPieces({
    definition,
    connectivity,
    distance: relationship.distance,
    modelingTolerance,
  });
  if (!declared.ok) return fail(declared);
  const frameOf = (run: Extract<PlanRun, { ok: true }>): OffsetSolveFrame => ({
    ok: true,
    derivationId: relationship.derivationId,
    distance: relationship.distance,
    modelingTolerance,
    connectivity,
    plan: { origin: plan?.origin ?? "firstChoice", adjacencies: run.plan },
    pieces: run.pieces,
    vertices: declared.vertices,
    trims: run.geometry.trims,
    arcs: run.arcs,
    cubics: run.geometry.cubics,
    lineArcEndpoints: run.geometry.lineArcEndpoints,
  });
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
  const certified = certifyDeclaredOffsetChain(
    declared,
    input.query,
    input.certifier,
  );
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
