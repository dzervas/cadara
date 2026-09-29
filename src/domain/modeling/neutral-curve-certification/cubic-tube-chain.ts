import type {
  CertifiedCubicTubeChain,
  CertifiedTubePieceChain,
  CertifiedTubePieceChainRequests,
  CubicTubeChainJoin,
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralCubicPieceTube,
  NeutralCubicTube,
  NeutralLineTube,
  PieceTubeChainRequest,
  TubeChainGraphTrimJoin,
  TubeChainTrimJoin,
  TubeChainVertexAuthority,
  TubeChainVertexDeclaration,
  TubeChainVertexJoin,
  TubePieceChainJoin,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  SplinePoles,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  crossExact,
  exactSqrtInterval,
  normalizedExact,
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
 *
 * L1b piece chains (`certifyPieceChain`) add, on their own paths only: line
 * tubes (same-parameter ε from the literal emitted ends against O = A + dν,
 * ν boxed by rot(a)/[L_lo, L_hi]); Lemma T at every inter-piece trim with
 * the exact source-tangent concavity gate sgn(d)·cross(u_in, u_out) > 0
 * fixing s, W = the whole terminal leaf (leaf-wide cone m′ > 0 of the TRUE
 * offset derivative O′: it makes O, not the emitted E, injective on that
 * leaf; E's injectivity comes from K1 or the S2 G1 cone, never from m′),
 * δ = (ε_A + ε_B)L_hi/m′ on the curve root
 * through the STORED query-domain map, η/L_lo with η = ε_A + ε_B + Mδ on the
 * line root, both strictly interior and ordered against the leaf's other end
 * (trim or J2′); cubic leaves add Mδ per trim end, lines take the larger end
 * displacement; K3 covers every pair outside the explicit adjacency set.
 * The trim certificate concerns only the abstract chain trimmed at the exact
 * witnessed roots (premises: stored bounds, ε, sources); it never claims the
 * rounded emitted ends connect.
 *
 * S2 graph trims (cubic↔cubic, terminal leaves A₀ of P and B₀ of Q only;
 * reference R_C′: at a declared coincident or shared-point cubic↔cubic join
 * that passes H2 in a solver-accepted frame, O* is the two pieces' true
 * offsets, each trimmed at their unique common point). One fixed precharge,
 * then the same H2 gate. e = binary64 sum of the two traversal emitted chords;
 * x = e·p, slope s(v) = cross(e, v)/(e·v), every check exact on it.
 * - G1/G2: the traversal emitted hodograph and the e-signed O′ box corner of
 *   both leaves are strictly e-positive (both are e-graphs; G1 is E's cone).
 * - Lemma P window: H = [x(Ê_Q(vtx)) − |e|ε_B, x(Ê_P(vtx)) + |e|ε_A] ⊇
 *   [α_Q, β_P]; t = |H|/adv_O (adv_O = leaf-wide min e·dO/dτ from the box),
 *   rounded UP to binary64, t < 1. The source is restricted exactly to the
 *   vertex-end sub-window ([1 − t, 1] or [0, t] by the NATURAL vertex side),
 *   must be e-positive there, and its slope hull ∩ the box slopes bounds the
 *   true slopes (O′ = λS′, λ > 0). σ = separation in the sgn(d) order > 0.
 * - Emitted orientation: exact restrictions of both emitted leaves to the
 *   stored witness bounds (stored query-domain map) are e-positive and their
 *   slopes are separated in the sgn(d) order; x̂ ∈ the met x-hulls.
 * - Lemma V: w = ε√(1 + L²) with L the leaf-wide box |slope|; w² ≤ τ² on
 *   both sides (chain claim max(w_P, w_Q) ≤ τ).
 * - Lemma X: δ = |e|(w_P + w_Q)/σ (upper √); x̂_hi + δ < x(Ê_P(vtx)) − |e|ε_A
 *   and x̂_lo − δ > x(Ê_Q(vtx)) + |e|ε_B, so the true offsets cross exactly
 *   once on [α_Q, β_P], inside both vertex windows, and both true terminal
 *   points are removed; root enclosures (δ + |x̂| + |e|ε)/adv_O, outward.
 * - Lemma C (after every trim wrote its corrections): the far map is the
 *   leaf's existing map with ρ₁ = ½ fixed (J2′ shift ≤ t_s, Lemma T ≤ δ),
 *   ε* = ε + c_far. Collar x(E(½)) + |e|ε* < Σ_lo (P; mirrored for Q) with
 *   Σ = [x̂_lo − δ, x̂_hi + δ], and Σ_lo < min(b_P, β_P) by Lemma X, so the
 *   stall exists: it compares x(O(ρ₁)) with x(E(½)) and the vertical map
 *   starts at x_L = max of the two. G = max(ε*, w) + ΔS·ε*·¼ < τ STRICTLY
 *   (ΔS = leaf-wide true ∪ emitted slope spread), exact, sqrt-free.
 * - Writes trim ½ at the natural vertex side (t_s + t_e < 1 then keeps the
 *   far end below ½); no correction joins the ε sum. Leaf report:
 *   baseErrorStar = up(max(ε*, G_own, w_other)), displacementBound = τ; K3
 *   radii unchanged, (A₀, B₀) joins the adjacency set.
 * The emitted chain trimmed at the exact witnessed root is simple WITHOUT any
 * resolver-side global gate (M0): each emitted cubic leaf is injective by K1
 * (intra-piece joins, isolated span) or, on S2 terminal leaves, by G1 (a
 * one-leaf piece with no graph end has neither and is excluded only by the
 * wrapper's one-leaf gate, `certifyOffsetChainTubeStability`); the
 * joint pair meets only at X̂ (the resolver's complete joint query: exactly
 * one transverse interior root of the FULL terminal supports); every other
 * leaf pair is K3-disjoint on full emitted leaves. O* is simple by G2 on the
 * joint pair (retained parts on either side of x*) and K3 with r ≥ ε
 * elsewhere, so the concatenated monotone couplings (far map, glue stall,
 * vertical map of Lemma GM) perturb to a homeomorphism under strict G < τ.
 *
 * Q4-E1 endpoint-local ε (owner `localError`, only after the leaf-wide check
 * failed with the band's code; one fixed precharge at entry; absent or
 * inadmissible metadata keeps the leaf-wide failure). The owner's
 * same-parameter bound refines pointwise to |E(τ) − O(τ)| ≤ λ(τ) =
 * Σ Bᵢ(τ)πᵢ + 16Rτ²(1 − τ)² (πᵢ bound the emitted poles' distance to the ideal
 * Hermite poles; the componentwise Hermite remainder is ≤ 16Rτ²(1 − τ)²).
 * On the vertex-anchored window of fraction s at the NATURAL vertex side,
 * sup λ ≤ π_v + 3sπ_a + 3s²π_b + s³π_f + 16Rs², capped by ε (exact).
 * - S2 (after a Lemma-X margin failure): Lemma P and Lemma X are re-run with
 *   ε at each vertex pole replaced by π_v (H, t, σ, the margins) and ε at
 *   each emitted witness parameter by the window bound reaching the far
 *   stored witness bound (Lemma V at x̂ for δ, the root reach). Lemma V's
 *   leaf-wide w ≤ τ (Lemma GM), Lemma C and the stars keep the leaf-wide ε.
 * - Lemma T (after the root-interior window check, or a trimmed leaf's
 *   composition check, failed): ε_B at τ̂ is replaced by the window bound
 *   reaching the far stored bound of U in δ, the line widening and the line
 *   end displacement; the cubic star keeps ε_B + Mδ (its far map is
 *   leaf-wide). Each trim is upgraded at most once.
 *
 * T08b-d declared vertices (`vertices`, piece path only; one index space with
 * the trims, every adjacency covered exactly once). Reference [TECH R7]: at a
 * declared vertex O* is the gap-free reference (Q translated by −g, Lemma B)
 * plus a straight bridge of vector g = Q_v − P_v at the declared join; this
 * realizes a declared join within τ under the standing declared-joins
 * decision, requires e·g ≥ 0 and Lemma G's bound, and fails closed
 * otherwise. One fixed precharge per vertex before authorization.
 * - Admission (C5, exact/bitwise, else knot-incidence-unproven): natural
 *   terminal leaves; shared-point = one ID on both terminals AND a bitwise
 *   source vertex; coincident = two distinct terminal IDs equal to the
 *   unordered pair; positional-closure = one closed piece, its natural
 *   last → first leaves, one spline, spans from 0, one point ID, distinct
 *   occurrences, bitwise vertex; distinct pieces of one spline never; the
 *   shared emitted pole Z is bitwise (traversal terminals).
 * - K1 at the vertex pair with the TRAVERSAL-signed cone (each leaf's
 *   hodographs and O′ box corner against eₗ = reversed ? −e : e; lines use
 *   their elevated emitted segment and exact direction box): both terminal
 *   leaves are injective e-graphs meeting only at Z. This is also the
 *   emitted cone of a one-leaf piece with a vertex end.
 * - Exact classification on traversal source tangents u₁, u₂: D = u₁·u₂ > 0
 *   or fail; X = u₁×u₂ = 0 is parallel (B − A = g exactly, Lemma G3).
 *   g is exact; |g|⁺ is one verified upper √; g ≠ 0 needs e·g ≥ 0 exactly
 *   ("backward declared gap" otherwise: O* need not be simple).
 * - Nonparallel: J2′'s local block with the join's e on TRAVERSAL data and
 *   the chain d (Lemma B: it reads only differences, so it is the approved
 *   certificate of (P, Q − g)); a line leaf's source hodograph is its source
 *   direction a (R′ = a, R″ = 0, κ = 0, λ = 1), never its emitted step; a
 *   reversed leaf's slope rate is negated (cross(R′, R″) flips, e·R′ is the
 *   signed cone). Convex: δ⁺ = √⁺(2d²X²/(U₁U₂(1 + c₋))), c₋ = D/√⁺(U₁U₂)
 *   (Lemma G2, tight). d = 0 fails; closed chains need n ≥ 5 when the
 *   vertex has a correction path (convex, or g ≠ 0).
 * - Keeper-only composition (review R2, §3.4): the whole correction path
 *   (arc, then bridge) goes to the keeper's vertex end: c_K = |g|⁺
 *   (parallel), δ⁺ + |g|⁺ (convex), tail_K + |g|⁺ (concave); the adopter
 *   adds tail_A (concave) or nothing (its ε already bounds its adopted
 *   pole). Four separate roles: the correction into ε* (cubic sum; a line's
 *   vertex end value is endError + c, max-form), strictness (< τ at the
 *   keeper's reserve end whenever the path is nonempty), the K3 inflation
 *   (both leaves: G⁺ or |g|⁺, concave tail + |g|⁺ when g ≠ 0) and
 *   displacementBound = τ on a leaf with a reserve at EITHER end. With a
 *   reserve at the leaf START the reserve interval is [0, η] and E maps it
 *   onto the path; with reserves at both ends η_s + η_e < 1 exists because
 *   ε* < τ strictly (the middle maps onto O with shift ≤ M(η_s + η_e)/(1 −
 *   η_s − η_e) → 0), also next to a trim fraction or an S2 far end (whose
 *   G < τ already gives ε* < τ). A line keeper's reserve end maps [1 − η, 1]
 *   (or [0, η]) onto the path and the rest affinely onto its O: its bound is
 *   max(ends) with the vertex end endError + c, strict. Vertex pairs join the
 *   explicit K3 adjacency set; they have no witness (M0: the two e-graphs
 *   meet only at Z by strict monotonicity).
 * - Failures of trim codes carry `magnitude: true` exactly when the failed
 *   check is a bound-versus-budget comparison (review R1 as briefed).
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
/** Fixed per-graph-trim precharge (constant-size S2 work), before H2. */
const GRAPH_TRIM_PRECHARGE = 256;
/**
 * Fixed precharge of one Q4-E1 local-ε attempt (one S2 graph trim or one
 * Lemma-T trim), at its entry before any metadata conversion.
 */
const LOCAL_ERROR_PRECHARGE = 128;
/** Fixed per-declared-vertex precharge, before its authorization. */
const VERTEX_PRECHARGE = 64;
/** Fixed entry charge of every staged retry k ≥ 2, before any work. */
const RETRY_ENTRY_CHARGE = 64;
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

/**
 * Piece-path flattening (never built for a legacy request). Leaf k of the
 * flattened chain is a cubic tube (`tubes[k]`) or a line (`lines[k]`, with
 * `tubes[k]` absent and never read). Leaves are in traversal piece order and
 * natural order inside each piece; adjacency is explicit, never k ± 1.
 */
interface GeneralChain {
  readonly distance: number;
  readonly pieces: PieceTubeChainRequest["pieces"];
  readonly trims: PieceTubeChainRequest["trims"];
  readonly vertices: readonly TubeChainVertexDeclaration[];
  readonly firstLeaf: readonly number[];
  readonly pieceOf: readonly number[];
  readonly lines: readonly (NeutralLineTube | undefined)[];
}

const finitePoint = (point: SplineVector | undefined) =>
  Array.isArray(point) &&
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]);

const strictlyOrderedFinite = (interval: readonly [number, number]) =>
  Array.isArray(interval) &&
  Number.isFinite(interval[0]) &&
  Number.isFinite(interval[1]) &&
  interval[0] < interval[1];

function lineAdmissionDefect(line: NeutralLineTube): string | null {
  if (
    !Array.isArray(line.emitted) ||
    line.emitted.length !== 2 ||
    !Array.isArray(line.source) ||
    line.source.length !== 2 ||
    ![...line.emitted, ...line.source].every(finitePoint)
  )
    return "non-finite line tube ends";
  // An affine leaf is injective only with distinct ends (M0 leaf injectivity).
  if (samePoint(line.emitted[0], line.emitted[1]))
    return "coincident emitted line ends";
  if (!Number.isFinite(line.distance))
    return "missing or non-finite owner offset distance";
  return null;
}

function certifyChain(
  request: CubicTubeChainRequest,
  budget: ExactProofBudget,
  general?: GeneralChain,
): TubePieceChainResult {
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
    const line = general?.lines[index];
    const defect = !general
      ? admissionDefect(tube, modelingTolerance)
      : line
        ? lineAdmissionDefect(line)
        : (admissionDefect(tube, modelingTolerance) ??
          (strictlyOrderedFinite((tube as NeutralCubicPieceTube).queryDomain)
            ? null
            : "invalid query domain"));
    if (defect)
      return uncertain(
        "invalid-cubic-tube-chain",
        `Tube ${index}: ${defect}.`,
        index,
      );
  }
  // One owner call has one signed distance: bitwise, so −0 differs from 0.
  budget.operation(count);
  const distanceValue = general
    ? general.distance
    : tubes[0]!.reference.distance;
  if (general) {
    // Piece i's owner distance is bitwise reversed ? −d : d (−0 visible).
    for (let index = 0; index < count; index += 1) {
      const owner =
        general.lines[index]?.distance ?? tubes[index]!.reference.distance;
      const reversed = general.pieces[general.pieceOf[index]!]!.reversed;
      if (!Object.is(owner, reversed ? -distanceValue : distanceValue))
        return uncertain(
          "invalid-cubic-tube-chain",
          `Tube ${index}: the owner distance is not the piece-oriented chain distance.`,
          index,
        );
    }
  } else
    for (let index = 1; index < count; index += 1)
      if (!Object.is(tubes[index]!.reference.distance, distanceValue))
        return uncertain(
          "invalid-cubic-tube-chain",
          "The tubes do not carry one bitwise owner offset distance.",
          0,
          index,
        );

  const joins: (readonly [number, number])[] = [];
  if (general) {
    // Intra-piece natural joins only; every inter-piece adjacency is a trim.
    general.pieces.forEach((piece, pieceIndex) => {
      if (piece.kind !== "cubic") return;
      const first = general.firstLeaf[pieceIndex]!;
      for (let offset = 0; offset + 1 < piece.tubes.length; offset += 1)
        joins.push([first + offset, first + offset + 1]);
    });
  } else {
    for (let index = 0; index + 1 < count; index += 1)
      joins.push([index, index + 1]);
    if (closed) joins.push([count - 1, 0]);
  }
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
  /** Upper verified √ bound only (piece path); null when not finite. */
  const squareRootUpper = (value: ExactFraction) => {
    const root = exactSqrtInterval(value, budget);
    budget.operation(3);
    return root && Number.isFinite(root.upper)
      ? exactFromNumber(root.upper, budget)
      : null;
  };

  // §1.1 line tubes (piece path only): same-parameter ε_k from the literal
  // emitted ends, the exact source direction a and the ν box rot(a)/[L_lo, L_hi].
  const lineData = new Map<
    number,
    {
      readonly poles: ExactCubic;
      readonly box: ExactFraction[][];
      readonly direction: ExactPoint;
      readonly length: ExactRange;
      readonly endErrors: readonly [ExactFraction, ExactFraction];
      readonly error: ExactFraction;
    }
  >();
  if (general) {
    const lineTolerance = exactFromNumber(modelingTolerance, budget);
    for (const [index, line] of general.lines.entries()) {
      if (!line) continue;
      budget.operation(48);
      const fail = (reason: string) =>
        uncertain(
          "line-tube-error-unproven",
          `Line ${index}: ${reason}.`,
          index,
        );
      const emitted = line.emitted.map(exactPoint);
      const source = line.source.map(exactPoint);
      const direction = difference(source[1]!, source[0]!);
      const length = squareRoot(dot(direction, direction));
      if (!length)
        return fail("the source segment length is not proved positive");
      const d = exactFromNumber(line.distance, budget);
      const rotated = [negateExact(direction[1], budget), direction[0]];
      // ν = rot(a)/|a| lies between rot(a)/L_hi and rot(a)/L_lo, per axis.
      const normal = rotated.map((value) => {
        const near = divideExact(value, length[1], budget);
        const far = divideExact(value, length[0], budget);
        return compareExact(near, far, budget) <= 0
          ? ([near, far] as const)
          : ([far, near] as const);
      });
      const endError = (end: 0 | 1) => {
        let squared = zero;
        for (const axis of [0, 1] as const) {
          const offset = subtractExact(
            emitted[end]![axis],
            source[end]![axis],
            budget,
          );
          const corners = normal[axis]!.map((value) => {
            const gap = subtractExact(
              offset,
              multiplyExact(d, value, budget),
              budget,
            );
            return multiplyExact(gap, gap, budget);
          });
          squared = addExact(
            squared,
            compareExact(corners[0]!, corners[1]!, budget) >= 0
              ? corners[0]!
              : corners[1]!,
            budget,
          );
        }
        return squareRootUpper(squared);
      };
      const startError = endError(0);
      const endErrorValue = endError(1);
      if (!startError || !endErrorValue)
        return fail("a verified square-root bound is not finite");
      const error =
        compareExact(startError, endErrorValue, budget) >= 0
          ? startError
          : endErrorValue;
      if (compareExact(error, lineTolerance, budget) > 0)
        return fail("the line tube error exceeds the modeling tolerance");
      // Exact never-emitted elevation of the emitted segment, for K3 only.
      const step = difference(emitted[1]!, emitted[0]!);
      const along = (fraction: ExactFraction): ExactPoint => [
        addExact(
          emitted[0]![0],
          multiplyExact(step[0], fraction, budget),
          budget,
        ),
        addExact(
          emitted[0]![1],
          multiplyExact(step[1], fraction, budget),
          budget,
        ),
      ];
      lineData.set(index, {
        poles: [
          emitted[0]!,
          along(exact(1n, 3n, budget)),
          along(exact(2n, 3n, budget)),
          emitted[1]!,
        ],
        box: direction.map((value) => [value, value]),
        direction,
        length,
        endErrors: [startError, endErrorValue],
        error,
      });
    }
  }

  const poles: ExactCubic[] = tubes.map(
    (tube, index) =>
      lineData.get(index)?.poles ??
      (tube.poles.map(exactPoint) as unknown as ExactCubic),
  );
  const hodographs = poles.map((cubic) =>
    [0, 1, 2].map((index) => difference(cubic[index + 1]!, cubic[index]!)),
  );
  const derivatives = tubes.map(
    (tube, index) =>
      lineData.get(index)?.box ??
      tube.reference.derivative.map((axis) => [
        exactFromNumber(axis[0], budget),
        exactFromNumber(axis[1], budget),
      ]),
  );
  const errors = tubes.map(
    (tube, index) =>
      lineData.get(index)?.error ??
      exactFromNumber(tube.certifiedError, budget),
  );
  const distance = exactFromNumber(distanceValue, budget);
  const tolerance = exactFromNumber(modelingTolerance, budget);
  // J2′ runs on natural data with the piece's owner distance (−d if reversed).
  const pieceDistances = general?.pieces.map((piece) =>
    piece.reversed ? negateExact(distance, budget) : distance,
  );
  const distanceOf = (leaf: number) =>
    pieceDistances ? pieceDistances[general!.pieceOf[leaf]!]! : distance;

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
        !general &&
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
  if (count === 1 && !general) {
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

  // Exactly restricted source leaf R: hodograph R′ and R″ control points in
  // leaf τ-units, then (concave only) the e-independent κ-only λ enclosure.
  // Source span poles and leaf interval, converted once per leaf (S2 reuses).
  const sources = new Map<
    number,
    { poles: ExactCubic; low: ExactFraction; high: ExactFraction }
  >();
  const leafSource = (index: number) => {
    const cached = sources.get(index);
    if (cached) return cached;
    const tube = tubes[index]!;
    const source = {
      poles: tube.reference.sourcePoles.map(
        exactPoint,
      ) as unknown as ExactCubic,
      low: exactFromNumber(tube.sourceLocalInterval[0], budget),
      high: exactFromNumber(tube.sourceLocalInterval[1], budget),
    };
    sources.set(index, source);
    return source;
  };
  // Q4-E1 owner metadata (R, π₀..π₃) of a cubic leaf, converted once per
  // leaf; null when absent or not finite and nonnegative (fails closed).
  const localErrors = new Map<
    number,
    { remainder: ExactFraction; poles: readonly ExactFraction[] } | null
  >();
  const leafLocalError = (index: number) => {
    const cached = localErrors.get(index);
    if (cached !== undefined) return cached;
    const local = tubes[index]?.reference.localError as
      | NeutralCubicTube["reference"]["localError"]
      | undefined;
    const result =
      !lineData.has(index) &&
      local &&
      Array.isArray(local.polePerturbations) &&
      local.polePerturbations.length === 4 &&
      [local.hermiteRemainder, ...local.polePerturbations].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
        ? {
            remainder: exactFromNumber(local.hermiteRemainder, budget),
            poles: local.polePerturbations.map((value) =>
              exactFromNumber(value, budget),
            ),
          }
        : null;
    localErrors.set(index, result);
    return result;
  };
  /**
   * Local tube bound (header Q4-E1) on the vertex-anchored sub-window of
   * leaf fraction s ≥ 0 at the NATURAL vertex side: [1 − s, 1] at "end",
   * [0, s] at "start"; s = null is the vertex itself. With v the vertex pole
   * and a, b, f the next ones inward, every τ there has
   * Σ Bᵢ(τ)πᵢ + 16Rτ²(1 − τ)² ≤ π_v + 3sπ_a + 3s²π_b + s³π_f + 16Rs² (exact),
   * capped by the leaf-wide ε (both are bounds). Null without metadata.
   */
  const localBound = (
    index: number,
    side: "start" | "end",
    fraction: ExactFraction | null,
  ): ExactFraction | null => {
    const local = leafLocalError(index);
    if (!local) return null;
    const [v, a, b, f] = side === "end" ? [3, 2, 1, 0] : [0, 1, 2, 3];
    let bound = local.poles[v]!;
    if (fraction) {
      const square = multiplyExact(fraction, fraction, budget);
      const three = exact(3n, 1n, budget);
      const terms = [
        multiplyExact(
          three,
          multiplyExact(fraction, local.poles[a]!, budget),
          budget,
        ),
        multiplyExact(
          three,
          multiplyExact(square, local.poles[b]!, budget),
          budget,
        ),
        multiplyExact(
          multiplyExact(square, fraction, budget),
          local.poles[f]!,
          budget,
        ),
        multiplyExact(
          multiplyExact(exact(16n, 1n, budget), local.remainder, budget),
          square,
          budget,
        ),
      ];
      for (const term of terms) bound = addExact(bound, term, budget);
    }
    return minimum([errors[index]!, bound]);
  };
  const shapes = new Map<
    number,
    { first: ExactPoint[]; second: ExactPoint[] }
  >();
  const leafShape = (index: number) => {
    const cached = shapes.get(index);
    if (cached) return cached;
    // A line leaf (vertex path only): R(τ) = s₀ + τa exactly, so R′ = a on
    // every control and R″ = 0: its SOURCE direction, never the emitted step.
    const line = lineData.get(index);
    if (line) {
      const shape = {
        first: [line.direction, line.direction, line.direction],
        second: [[zero, zero] as ExactPoint, [zero, zero] as ExactPoint],
      };
      shapes.set(index, shape);
      return shape;
    }
    const source = leafSource(index);
    const restricted = restrict(source.poles, source.low, source.high);
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
    const distance = distanceOf(index);
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
  // Declared vertices (T08b-d), decoupled roles: the keeper's reserve end
  // (strictness and displacementBound = τ) and each leaf's K3 inflation.
  const reserveStart: boolean[] = [];
  const reserveEnd: boolean[] = [];
  const inflation: (ExactFraction | undefined)[] = [];
  const vertexReports: TubeChainVertexJoin[] = [];
  const reports = new Map<number, J2Report>();
  /**
   * J2′ concave local certificate on one consistent frame: the knot's natural
   * data with its piece's owner distance, or a declared vertex's traversal
   * data with the chain d (Lemma B). `reversedLeaves` (vertex path only)
   * negates the slope rate of a leaf traversed against its natural order.
   * Returns the trim fractions and tails, or the failed J2′ reason.
   */
  const concaveJ2 = (
    first: number,
    second: number,
    incoming: ExactPoint,
    outgoing: ExactPoint,
    cross: ExactFraction,
    e: ExactPoint,
    distance: ExactFraction,
    alongIncoming: ExactFraction,
    alongOutgoing: ExactFraction,
    coneFirst: ExactRange,
    coneSecond: ExactRange,
    incomingSquared: ExactFraction,
    outgoingSquared: ExactFraction,
    reversedLeaves?: ReadonlySet<number>,
  ):
    | { readonly trim: ExactRange; readonly tail: ExactRange }
    | keyof typeof J2_MESSAGES => {
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
        // Traversal slope rate: a reversed leaf's cross(R′, R″) flips while
        // e·R′ is its signed cone (vertex path only; knots are natural).
        rate: reversedLeaves?.has(index) ? rangeNegate(slopeRate) : slopeRate,
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
    if (typeof leafFirst === "string") return leafFirst;
    const leafSecond = concaveLeaf(second, coneSecond);
    if (typeof leafSecond === "string") return leafSecond;
    const alpha = crossExact(incoming, e, budget);
    const beta = crossExact(outgoing, e, budget);
    const rootIncoming = squareRoot(incomingSquared);
    const rootOutgoing = rootIncoming && squareRoot(outgoingSquared);
    if (!rootIncoming || !rootOutgoing) return "root" as const;
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
      if (!rootProduct) return "root" as const;
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
    if (!unitGap) return "root" as const;
    const overlap = rangeMultiply(point(distance), unitGap);
    if (
      !positive(overlap[0]) ||
      compareExact(overlap[1], leafFirst.minimumAdvance, budget) >= 0 ||
      compareExact(overlap[1], leafSecond.minimumAdvance, budget) >= 0
    )
      return "window" as const;
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
    if (!ratio || !inverseRatio) return "root" as const;
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
    if (!chordFromIncoming || !chordToOutgoing) return "root" as const;
    const rateHull: ExactRange = [
      minimum([leafFirst.rate[0], leafSecond.rate[0]]),
      maximum([leafFirst.rate[1], leafSecond.rate[1]]),
    ];
    if (
      !excludesZero(
        rangeSubtract(point(slopeGap), rangeMultiply(overlap, rateHull)),
      )
    )
      return "unique" as const;
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
      return "exists" as const;
    const trim: ExactRange = [
      divideExact(overlap[1], leafFirst.minimumAdvance, budget),
      divideExact(overlap[1], leafSecond.minimumAdvance, budget),
    ];
    const tail: ExactRange = [
      multiplyExact(leafFirst.maximumSpeed, trim[0], budget),
      multiplyExact(leafSecond.maximumSpeed, trim[1], budget),
    ];
    return { trim, tail };
  };
  for (const { join, first, second, incoming, outgoing, cross } of candidates) {
    const fail = (reason: keyof typeof J2_MESSAGES) =>
      uncertain(KNOT_UNPROVEN, J2_MESSAGES[reason], first, second);
    const distance = distanceOf(first);
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

    const concave = concaveJ2(
      first,
      second,
      incoming,
      outgoing,
      cross,
      e,
      distance,
      alongIncoming,
      alongOutgoing,
      coneFirst,
      coneSecond,
      incomingSquared,
      outgoingSquared,
    );
    if (typeof concave === "string") return fail(concave);
    const { trim, tail } = concave;
    correctionEnd[first] = tail[0];
    correctionStart[second] = tail[1];
    trimEnd[first] = trim[0];
    trimStart[second] = trim[1];
    reports.set(join, { side: "concave", tail, trim });
  }

  // Lemma T at every inter-piece trim (piece path only). W is the WHOLE
  // terminal leaf; s is fixed by the exact source-tangent concavity gate.
  const trimReports: (TubeChainTrimJoin | TubeChainGraphTrimJoin)[] = [];
  const trimmedLeaves = new Set<number>();
  /** S2 glue data per graph-trimmed leaf, checked once every correction is known. */
  const graphSides = new Map<
    number,
    {
      /** True on P's leaf A₀ (the switch region lies at larger x). */
      readonly exiting: boolean;
      readonly middle: ExactFraction;
      /** Σ_lo on P, Σ_hi on Q. */
      readonly limit: ExactFraction;
      readonly eUpper: ExactFraction;
      readonly spread: ExactFraction;
      readonly ownSquared: ExactFraction;
      readonly ownUpper: ExactFraction;
      readonly otherUpper: ExactFraction;
    }[]
  >();
  /** Lemma-T trims with their one-shot Q4-E1 local upgrade (leaf loop). */
  const lemmaTrims: {
    readonly leaves: readonly [number, number];
    readonly upgrade: () => boolean;
  }[] = [];
  const lineJointStart: (ExactFraction | undefined)[] = [];
  const lineJointEnd: (ExactFraction | undefined)[] = [];
  if (general) {
    const pieceCount = general.pieces.length;
    const down = (value: ExactFraction) =>
      outwardExactNumber(value, "down", budget);
    const up = (value: ExactFraction) =>
      outwardExactNumber(value, "up", budget);
    const negated = (vector: ExactPoint): ExactPoint => [
      negateExact(vector[0], budget),
      negateExact(vector[1], budget),
    ];
    /** Traversal-terminal leaf of a piece and the natural side it ends on. */
    const terminal = (pieceIndex: number, exiting: boolean) => {
      const piece = general.pieces[pieceIndex]!;
      const first = general.firstLeaf[pieceIndex]!;
      const size = piece.kind === "cubic" ? piece.tubes.length : 1;
      const naturalEnd = exiting !== piece.reversed;
      return {
        leaf: naturalEnd ? first + size - 1 : first,
        side: naturalEnd ? ("end" as const) : ("start" as const),
        reversed: piece.reversed,
      };
    };
    type Terminal = ReturnType<typeof terminal>;
    /** Exact traversal source tangent at the vertex; null when not proved. */
    const vertexTangent = (end: Terminal): ExactPoint | null => {
      let natural = lineData.get(end.leaf)?.direction;
      if (!natural) {
        const tube = tubes[end.leaf]!;
        const p = tube.reference.sourcePoles;
        if (
          end.side === "end"
            ? tube.sourceLocalInterval[1] !== 1
            : tube.sourceLocalInterval[0] !== 0
        )
          return null;
        natural =
          end.side === "end"
            ? difference(exactPoint(p[3]), exactPoint(p[2]))
            : difference(exactPoint(p[1]), exactPoint(p[0]));
        if (!positive(dot(natural, natural))) return null;
      }
      return end.reversed ? negated(natural) : natural;
    };
    /**
     * S2 terminal-window certificate of one concave cubic↔cubic trim (header,
     * after H2). Exactly four exact restrictions, each of a once-converted
     * cubic with binary64-derived ends; no exhaustion is caught here. The
     * Lemma-C glue runs in the leaf loop, once every far-end correction is
     * written. Returns a failure, or null after recording the trim.
     */
    const graphTrim = (
      declaration: PieceTubeChainRequest["trims"][number],
      firstEnd: Terminal,
      secondEnd: Terminal,
      fail: (code: string, message: string, magnitude?: true) => Failure,
    ): Failure | null => {
      const WINDOW = "trim-window-unproven";
      const CLASSIFICATION = "trim-classification-unproven";
      const EXISTENCE = "trim-existence-unproven";
      const COMPOSITION = "trim-composition-unproven";
      // e: binary64 sum of both traversal emitted chords (uncharged, as K1).
      const direction: [number, number] = [0, 0];
      for (const end of [firstEnd, secondEnd]) {
        const cubic = tubes[end.leaf]!.poles;
        const sign = end.reversed ? -1 : 1;
        direction[0] += sign * (cubic[3]![0] - cubic[0]![0]);
        direction[1] += sign * (cubic[3]![1] - cubic[0]![1]);
      }
      if (!direction.every(Number.isFinite))
        return fail(WINDOW, "The graph direction e is not finite.");
      const e = exactPoint(direction);
      const eUpper = squareRootUpper(dot(e, e));
      if (!eUpper)
        return fail(WINDOW, "A verified square-root bound is not finite.");
      /** Slope s(v) = n·v / e·v, only for vectors proved e-signed nonzero. */
      const slope = (vector: ExactPoint) =>
        divideExact(crossExact(e, vector, budget), dot(e, vector), budget);
      const terminalData = (end: Terminal) => {
        const leaf = end.leaf;
        // Traversal e-positivity on natural data: eₗ = reversed ? −e : e.
        const signed = end.reversed ? negated(e) : e;
        if (!hodographs[leaf]!.every((step) => positive(dot(signed, step))))
          return "The emitted terminal hodograph is not proved inside the graph cone e (G1).";
        const box = derivatives[leaf]!;
        const corner: ExactPoint = [
          box[0]![positive(signed[0]) ? 0 : 1]!,
          box[1]![positive(signed[1]) ? 0 : 1]!,
        ];
        const along = dot(signed, corner);
        if (!positive(along))
          return "The true offset derivative box is not proved inside the graph cone e (G2).";
        const source = leafSource(leaf);
        const width = subtractExact(source.high, source.low, budget);
        const corners = box[0]!.flatMap((x) =>
          box[1]!.map((y): ExactPoint => [x, y]),
        );
        return {
          end,
          signed,
          source,
          width,
          // Leaf-wide min e·dO/dτ (traversal τ-units).
          advance: multiplyExact(along, width, budget),
          // Leaf-wide true (box corners, mediant) and emitted slope hulls.
          trueSlopes: hull(corners.map(slope)),
          emittedSlopes: hull(hodographs[leaf]!.map(slope)),
          vertex: dot(e, poles[leaf]![end.side === "end" ? 3 : 0]!),
          error: errors[leaf]!,
        };
      };
      const first = terminalData(firstEnd);
      if (typeof first === "string") return fail(WINDOW, first);
      const second = terminalData(secondEnd);
      if (typeof second === "string") return fail(WINDOW, second);
      type Side = typeof first;
      /** Per-side [P, Q] bounds of |E − O| at one point or sub-window. */
      type Pair = readonly [ExactFraction, ExactFraction];
      const leafWide: Pair = [first.error, second.error];

      /** Lemma P: exact source restriction to the natural vertex-end window. */
      const trueWindow = (side: Side, fraction: number) => {
        const t = exactFromNumber(fraction, budget);
        const [from, to] =
          side.end.side === "end"
            ? [subtractExact(one, t, budget), one]
            : [zero, t];
        const at = (value: ExactFraction) =>
          addExact(
            side.source.low,
            multiplyExact(value, side.width, budget),
            budget,
          );
        const restricted = restrict(side.source.poles, at(from), at(to));
        const steps = [0, 1, 2].map((index) =>
          difference(restricted[index + 1]!, restricted[index]!),
        );
        if (!steps.every((step) => positive(dot(side.signed, step))))
          return null;
        const refined = hull(steps.map(slope));
        return [
          maximum([refined[0], side.trueSlopes[0]]),
          minimum([refined[1], side.trueSlopes[1]]),
        ] as const;
      };
      /**
       * Lemma P window from the vertex errors: H ⊇ [α_Q, β_P]; t = |H|/adv_O
       * rounded up, t < 1; σ > 0 on the exact vertex-end source windows.
       */
      const lemmaP = (
        vertex: Pair,
      ):
        | Failure
        | {
            readonly separation: ExactFraction;
            readonly leftTurn: boolean;
          } => {
        const hullLow = subtractExact(
          second.vertex,
          multiplyExact(eUpper, vertex[1], budget),
          budget,
        );
        const hullHigh = addExact(
          first.vertex,
          multiplyExact(eUpper, vertex[0], budget),
          budget,
        );
        const hullWidth = subtractExact(hullHigh, hullLow, budget);
        if (!positive(hullWidth))
          return fail(
            EXISTENCE,
            "The true terminal offsets are not proved to overlap at the vertex.",
          );
        const fractions = [first, second].map((side) =>
          up(divideExact(hullWidth, side.advance, budget)),
        );
        if (!fractions.every((fraction) => fraction < 1))
          return fail(
            WINDOW,
            "The vertex window of a terminal leaf is not proved inside it (t ≥ 1).",
            true,
          );
        const firstTrue = trueWindow(first, fractions[0]!);
        const secondTrue = firstTrue && trueWindow(second, fractions[1]!);
        if (!firstTrue || !secondTrue)
          return fail(
            CLASSIFICATION,
            "The source hodograph is not proved inside the graph cone on a vertex window.",
          );
        // d > 0: the outgoing (Q) slopes exceed the incoming (P) ones; mirrored.
        const leftTurn = positive(distance);
        const separation = leftTurn
          ? subtractExact(secondTrue[0], firstTrue[1], budget)
          : subtractExact(firstTrue[0], secondTrue[1], budget);
        if (!positive(separation))
          return fail(
            CLASSIFICATION,
            "The true terminal slopes are not proved separated on the vertex windows.",
          );
        return { separation, leftTurn };
      };
      const window = lemmaP(leafWide);
      if ("code" in window) return window;
      const { leftTurn } = window;

      // Emitted witness: stored bounds through the stored query-domain map.
      const witness = (side: Side, bounds: readonly [number, number]) => {
        const domain = (tubes[side.end.leaf] as NeutralCubicPieceTube)
          .queryDomain;
        const from = normalizedExact(bounds[0], domain, budget);
        const to = normalizedExact(bounds[1], domain, budget);
        const restricted = restrict(poles[side.end.leaf]!, from, to);
        const steps = [0, 1, 2].map((index) =>
          difference(restricted[index + 1]!, restricted[index]!),
        );
        if (!steps.every((step) => positive(dot(side.signed, step))))
          return null;
        return {
          from,
          to,
          x: hull(restricted.map((pole) => dot(e, pole))),
          slopes: hull(steps.map(slope)),
        };
      };
      const firstWitness = witness(first, declaration.firstParameterBounds);
      const secondWitness =
        firstWitness && witness(second, declaration.secondParameterBounds);
      const orientation =
        firstWitness &&
        secondWitness &&
        (leftTurn
          ? subtractExact(
              secondWitness.slopes[0],
              firstWitness.slopes[1],
              budget,
            )
          : subtractExact(
              firstWitness.slopes[0],
              secondWitness.slopes[1],
              budget,
            ));
      if (
        !firstWitness ||
        !secondWitness ||
        !orientation ||
        !positive(orientation)
      )
        return fail(
          CLASSIFICATION,
          "The emitted crossing orientation is not proved on the witness bounds.",
        );
      const crossingLow = maximum([firstWitness.x[0], secondWitness.x[0]]);
      const crossingHigh = minimum([firstWitness.x[1], secondWitness.x[1]]);
      if (compareExact(crossingLow, crossingHigh, budget) > 0)
        return fail(EXISTENCE, "The two witness enclosures do not meet in x.");

      // Lemma V: w² = ε²(1 + L²), L the leaf-wide box |slope|; w ≤ τ each side.
      const deviationSquared = (side: Side) => {
        const bound = maximum([
          side.trueSlopes[1],
          negateExact(side.trueSlopes[0], budget),
        ]);
        const errorSquared = multiplyExact(side.error, side.error, budget);
        const factor = addExact(
          one,
          multiplyExact(bound, bound, budget),
          budget,
        );
        return {
          squared: multiplyExact(errorSquared, factor, budget),
          factor,
        };
      };
      const toleranceSquared = multiplyExact(tolerance, tolerance, budget);
      const firstDeviation = deviationSquared(first);
      const secondDeviation = deviationSquared(second);
      const firstSquared = firstDeviation.squared;
      const secondSquared = secondDeviation.squared;
      if (
        compareExact(firstSquared, toleranceSquared, budget) > 0 ||
        compareExact(secondSquared, toleranceSquared, budget) > 0
      )
        return fail(
          COMPOSITION,
          "The vertical graph deviation exceeds the modeling tolerance.",
          true,
        );
      const firstUpper = squareRootUpper(firstSquared);
      const secondUpper = firstUpper && squareRootUpper(secondSquared);
      if (!firstUpper || !secondUpper)
        return fail(COMPOSITION, "A verified square-root bound is not finite.");

      /**
       * Lemma X (E-emit): the true crossing is unique, inside both windows.
       * `vertex` bounds |E − O| at each vertex pole, `witness` on each
       * emitted witness parameter (Lemma V at x̂, root reach), `upper` the
       * verified upper √ of the witness-point w. Null when a margin fails.
       */
      const lemmaX = (
        vertex: Pair,
        witness: Pair,
        upper: Pair,
        separation: ExactFraction,
      ) => {
        const shift = divideExact(
          multiplyExact(eUpper, addExact(upper[0], upper[1], budget), budget),
          separation,
          budget,
        );
        const switchLow = subtractExact(crossingLow, shift, budget);
        const switchHigh = addExact(crossingHigh, shift, budget);
        if (
          compareExact(
            switchHigh,
            subtractExact(
              first.vertex,
              multiplyExact(eUpper, vertex[0], budget),
              budget,
            ),
            budget,
          ) >= 0 ||
          compareExact(
            switchLow,
            addExact(
              second.vertex,
              multiplyExact(eUpper, vertex[1], budget),
              budget,
            ),
            budget,
          ) <= 0
        )
          return null;
        const rootBounds = (
          side: Side,
          found: NonNullable<typeof firstWitness>,
          error: ExactFraction,
        ): [number, number] => {
          const reach = divideExact(
            addExact(
              addExact(
                shift,
                subtractExact(crossingHigh, crossingLow, budget),
                budget,
              ),
              multiplyExact(eUpper, error, budget),
              budget,
            ),
            side.advance,
            budget,
          );
          return [
            down(subtractExact(found.from, reach, budget)),
            up(addExact(found.to, reach, budget)),
          ];
        };
        return {
          switchLow,
          switchHigh,
          firstRootBounds: rootBounds(first, firstWitness, witness[0]),
          secondRootBounds: rootBounds(second, secondWitness, witness[1]),
        };
      };
      /**
       * Q4-E1 local branch (only after the leaf-wide Lemma X failed): the same
       * Lemma P and Lemma X with ε replaced, at each vertex pole, by π_v, and
       * on each witness parameter by the local bound on the vertex-anchored
       * sub-window reaching the far stored witness bound. Lemma V's leaf-wide
       * w ≤ τ (Lemma GM), Lemma C and the stars keep the leaf-wide ε.
       * Exactly two more restrictions (the local Lemma-P source windows).
       */
      const localLemmaX = () => {
        budget.operation(LOCAL_ERROR_PRECHARGE);
        const vertexError = (side: Side) =>
          localBound(side.end.leaf, side.end.side, null);
        const firstVertex = vertexError(first);
        const secondVertex = firstVertex && vertexError(second);
        if (!firstVertex || !secondVertex) return null;
        const vertex: Pair = [firstVertex, secondVertex];
        const localWindow = lemmaP(vertex);
        if ("code" in localWindow) return null;
        const witnessError = (
          side: Side,
          found: NonNullable<typeof firstWitness>,
        ) => {
          const reach =
            side.end.side === "end"
              ? subtractExact(one, found.from, budget)
              : found.to;
          return negative(reach)
            ? null
            : localBound(side.end.leaf, side.end.side, reach);
        };
        const firstLocal = witnessError(first, firstWitness);
        const secondLocal = firstLocal && witnessError(second, secondWitness);
        if (!firstLocal || !secondLocal) return null;
        const deviationUpper = (
          error: ExactFraction,
          deviation: typeof firstDeviation,
        ) =>
          squareRootUpper(
            multiplyExact(
              multiplyExact(error, error, budget),
              deviation.factor,
              budget,
            ),
          );
        const firstLocalUpper = deviationUpper(firstLocal, firstDeviation);
        const secondLocalUpper =
          firstLocalUpper && deviationUpper(secondLocal, secondDeviation);
        if (!firstLocalUpper || !secondLocalUpper) return null;
        const located = lemmaX(
          vertex,
          [firstLocal, secondLocal],
          [firstLocalUpper, secondLocalUpper],
          localWindow.separation,
        );
        return located && { ...located, separation: localWindow.separation };
      };
      const leafWideLocated = lemmaX(
        leafWide,
        leafWide,
        [firstUpper, secondUpper],
        window.separation,
      );
      const located = leafWideLocated
        ? { ...leafWideLocated, separation: window.separation }
        : localLemmaX();
      if (!located)
        return fail(
          EXISTENCE,
          "The true terminal offsets are not proved to cross once inside both terminal leaves.",
          true,
        );
      const {
        switchLow,
        switchHigh,
        firstRootBounds,
        secondRootBounds,
        separation,
      } = located;

      // Retention ½ at the natural vertex side; glue data for Lemma C.
      const eight = exact(8n, 1n, budget);
      for (const [side, exiting, ownSquared, ownUpper, otherUpper] of [
        [first, true, firstSquared, firstUpper, secondUpper],
        [second, false, secondSquared, secondUpper, firstUpper],
      ] as const) {
        const leaf = side.end.leaf;
        trimmedLeaves.add(leaf);
        if (side.end.side === "start") trimStart[leaf] = half;
        else trimEnd[leaf] = half;
        const x = poles[leaf]!.map((pole) => dot(e, pole));
        const middle = divideExact(
          addExact(
            addExact(x[0]!, multiplyExact(three, x[1]!, budget), budget),
            addExact(multiplyExact(three, x[2]!, budget), x[3]!, budget),
            budget,
          ),
          eight,
          budget,
        );
        const spread = subtractExact(
          maximum([side.trueSlopes[1], side.emittedSlopes[1]]),
          minimum([side.trueSlopes[0], side.emittedSlopes[0]]),
          budget,
        );
        const entry = {
          exiting,
          middle,
          limit: exiting ? switchLow : switchHigh,
          eUpper,
          spread,
          ownSquared,
          ownUpper,
          otherUpper,
        };
        const existing = graphSides.get(leaf);
        if (existing) existing.push(entry);
        else graphSides.set(leaf, [entry]);
      }
      trimReports.push({
        kind: "graph-trim",
        jointIndex: declaration.jointIndex,
        first: first.end.leaf,
        second: second.end.leaf,
        direction: [direction[0], direction[1]],
        firstRootBounds,
        secondRootBounds,
        separation: down(separation),
      });
      return null;
    };
    /** Natural terminal data of one traversal end (cubic leaf or line). */
    const endData = (end: Terminal) => {
      const atEnd = end.side === "end";
      const line = general.lines[end.leaf];
      if (line)
        return {
          terminal: true,
          pointId: atEnd ? line.endPointId : line.startPointId,
          vertex: line.source[atEnd ? 1 : 0],
          emitted: line.emitted[atEnd ? 1 : 0],
          splineId: undefined as string | undefined,
          occurrence: undefined as string | undefined,
        };
      const tube = tubes[end.leaf]!;
      return {
        terminal: atEnd
          ? tube.sourceLocalInterval[1] === 1
          : tube.sourceLocalInterval[0] === 0,
        pointId: atEnd ? tube.source.endPointId : tube.source.startPointId,
        vertex: tube.reference.sourcePoles[atEnd ? 3 : 0],
        emitted: tube.poles[atEnd ? 3 : 0],
        splineId: tube.source.splineId as string | undefined,
        occurrence: (atEnd
          ? tube.source.endOccurrenceId
          : tube.source.startOccurrenceId) as string | undefined,
      };
    };
    /**
     * C5 authority of one adjacency (design §6.2): point IDs, structure and
     * bitwise source vertices only, never coordinates proximity (string
     * compares are uncharged). Null when admitted, else the defect.
     */
    const authorityDefect = (
      authority: TubeChainVertexAuthority | undefined,
      firstPiece: number,
      secondPiece: number,
      firstEnd: Terminal,
      secondEnd: Terminal,
    ): string | null => {
      const a = endData(firstEnd);
      const b = endData(secondEnd);
      if (!a.terminal || !b.terminal)
        return "a terminal leaf does not reach its natural source end";
      const sameVertex = samePoint(a.vertex, b.vertex);
      switch (authority?.kind) {
        case "shared-point":
        case "coincident": {
          if (firstPiece === secondPiece)
            return "one piece closes only through its positional closure";
          if (a.splineId !== undefined && a.splineId === b.splineId)
            return "two pieces of one spline are never a declared vertex";
          if (typeof a.pointId !== "string" || typeof b.pointId !== "string")
            return "a terminal point ID is missing";
          if (authority.kind === "shared-point")
            return a.pointId === authority.pointId &&
              b.pointId === authority.pointId &&
              sameVertex
              ? null
              : "a shared point needs one terminal point ID and a bitwise source vertex";
          const [p, q] = authority.pointIds;
          return p !== q &&
            ((a.pointId === p && b.pointId === q) ||
              (a.pointId === q && b.pointId === p))
            ? null
            : "a coincident join needs the two distinct terminal point IDs";
        }
        case "positional-closure": {
          const piece = general.pieces[firstPiece]!;
          if (
            general.pieces.length !== 1 ||
            !closed ||
            firstPiece !== secondPiece ||
            piece.kind !== "cubic"
          )
            return "a positional closure is the closure of one closed spline piece";
          // Natural last leaf's end and first leaf's start of ONE spline
          // whose leaves run through consecutive spans from span 0.
          const leaves = piece.tubes;
          const spans = leaves.every(
            (tube, index) =>
              tube.source.splineId === leaves[0]!.source.splineId &&
              (index === 0
                ? tube.source.spanIndex === 0
                : tube.source.spanIndex - leaves[index - 1]!.source.spanIndex >=
                    0 &&
                  tube.source.spanIndex - leaves[index - 1]!.source.spanIndex <=
                    1),
          );
          const [last, first] = firstEnd.side === "end" ? [a, b] : [b, a];
          return spans &&
            last.pointId === authority.pointId &&
            first.pointId === authority.pointId &&
            last.occurrence !== first.occurrence &&
            sameVertex
            ? null
            : "a positional closure needs one spline from span 0, one point ID, distinct occurrences and a bitwise vertex";
        }
        default:
          return "no declared authority";
      }
    };
    /**
     * One declared vertex (header T08b-d): admission, traversal-signed K1,
     * exact classification, the Lemma-B/G J2′ local block and the
     * keeper-only composition writes. Returns a failure, or null.
     */
    const certifyVertex = (
      declaration: TubeChainVertexDeclaration,
    ): Failure | null => {
      budget.operation(VERTEX_PRECHARGE);
      const index = declaration.jointIndex;
      const firstPiece = index;
      const secondPiece = (index + 1) % pieceCount;
      const firstEnd = terminal(firstPiece, true);
      const secondEnd = terminal(secondPiece, false);
      const fail = (message: string) =>
        uncertain(
          KNOT_UNPROVEN,
          `Declared vertex ${index}: ${message}`,
          firstEnd.leaf,
          secondEnd.leaf,
        );
      const defect = authorityDefect(
        declaration.authority,
        firstPiece,
        secondPiece,
        firstEnd,
        secondEnd,
      );
      if (defect) return fail(`${defect}.`);
      const a = endData(firstEnd);
      const b = endData(secondEnd);
      if (!samePoint(a.emitted, b.emitted))
        return fail("the terminals do not share one bitwise emitted pole.");

      // K1 at the vertex pair: e = binary64 traversal-signed chord sum
      // (uncharged, as K1); exact e-positivity of every emitted hodograph
      // step and O′ box corner against e_l = reversed ? −e : e.
      const direction: [number, number] = [0, 0];
      for (const end of [firstEnd, secondEnd]) {
        const sign = end.reversed ? -1 : 1;
        const line = general.lines[end.leaf];
        if (line) {
          direction[0] += sign * (line.emitted[1][0] - line.emitted[0][0]);
          direction[1] += sign * (line.emitted[1][1] - line.emitted[0][1]);
          continue;
        }
        const cubic = tubes[end.leaf]!.poles;
        for (let pole = 0; pole < 3; pole += 1) {
          direction[0] += sign * (cubic[pole + 1]![0] - cubic[pole]![0]);
          direction[1] += sign * (cubic[pole + 1]![1] - cubic[pole]![1]);
        }
      }
      const coneFailure = () =>
        uncertain(
          "cubic-tube-cone-unproven",
          `Declared vertex ${index}: the emitted and true offset derivatives are not proved inside one open half-plane.`,
          firstEnd.leaf,
          secondEnd.leaf,
        );
      if (!direction.every(Number.isFinite)) return coneFailure();
      const e = exactPoint(direction);
      for (const end of [firstEnd, secondEnd]) {
        const signed = end.reversed ? negated(e) : e;
        if (!hodographs[end.leaf]!.every((step) => positive(dot(signed, step))))
          return coneFailure();
        const box = derivatives[end.leaf]!;
        const corner: ExactPoint = [
          box[0]![positive(signed[0]) ? 0 : 1]!,
          box[1]![positive(signed[1]) ? 0 : 1]!,
        ];
        if (!positive(dot(signed, corner))) return coneFailure();
      }

      // Exact classification on the traversal source tangents (authoritative).
      const incoming = vertexTangent(firstEnd);
      const outgoing = vertexTangent(secondEnd);
      if (!incoming || !outgoing)
        return fail("the traversal source tangents are not proved nonzero.");
      const cross = crossExact(incoming, outgoing, budget);
      if (!positive(dot(incoming, outgoing)))
        return fail(
          "the traversal source tangents have no positive dot (D ≤ 0).",
        );
      const parallel = compareExact(cross, zero, budget) === 0;
      // Declared source gap g = Q_v − P_v, exact; |g|⁺ outward (Lemma G).
      const gap = difference(exactPoint(b.vertex), exactPoint(a.vertex));
      const gapZero =
        compareExact(gap[0], zero, budget) === 0 &&
        compareExact(gap[1], zero, budget) === 0;
      let bridge = zero;
      if (!gapZero) {
        const norm = squareRootUpper(dot(gap, gap));
        if (!norm) return fail(J2_MESSAGES.root);
        bridge = norm;
        if (negative(dot(e, gap)))
          return fail(
            "backward declared gap (e·g < 0): the bridged reference is not proved simple.",
          );
      }
      const convex = !parallel && positive(distance) !== positive(cross);
      const pathful = convex || !gapZero;
      if (!parallel && distanceValue === 0)
        return fail("zero offset distance at a non-parallel vertex (no side).");
      if (closed && pathful && count < 5)
        return fail(
          "a closed chain with a declared-vertex correction path needs at least five leaves.",
        );

      // Nonparallel: the J2′ local block on traversal data (Lemma B).
      let arc: ExactFraction | undefined;
      let concave:
        | { readonly trim: ExactRange; readonly tail: ExactRange }
        | undefined;
      if (!parallel) {
        budget.operation(16);
        const alongIncoming = dot(e, incoming);
        const alongOutgoing = dot(e, outgoing);
        if (!positive(alongIncoming) || !positive(alongOutgoing))
          return fail(J2_MESSAGES.cone);
        const sourceCone = (end: Terminal) => {
          const signed = end.reversed ? negated(e) : e;
          return hull(
            leafShape(end.leaf).first.map((vector) => dot(signed, vector)),
          );
        };
        const coneFirst = sourceCone(firstEnd);
        const coneSecond = sourceCone(secondEnd);
        if (!positive(coneFirst[0]) || !positive(coneSecond[0]))
          return fail(J2_MESSAGES.cone);
        const incomingSquared = dot(incoming, incoming);
        const outgoingSquared = dot(outgoing, outgoing);
        if (convex) {
          // Lemma G2, tight [TECH T3]: |A − A′|² = 2d²X²/(U₁U₂(1 + c)) with
          // c = D/√(U₁U₂) ≥ c₋ = D/√⁺(U₁U₂) > 0.
          const product = multiplyExact(
            incomingSquared,
            outgoingSquared,
            budget,
          );
          const rootProduct = squareRootUpper(product);
          if (!rootProduct) return fail(J2_MESSAGES.root);
          const cosineLow = divideExact(
            dot(incoming, outgoing),
            rootProduct,
            budget,
          );
          const chord = squareRootUpper(
            divideExact(
              multiplyExact(
                multiplyExact(
                  two,
                  multiplyExact(distance, distance, budget),
                  budget,
                ),
                multiplyExact(cross, cross, budget),
                budget,
              ),
              multiplyExact(product, addExact(one, cosineLow, budget), budget),
              budget,
            ),
          );
          if (!chord) return fail(J2_MESSAGES.root);
          arc = chord;
        } else {
          const result = concaveJ2(
            firstEnd.leaf,
            secondEnd.leaf,
            incoming,
            outgoing,
            cross,
            e,
            distance,
            alongIncoming,
            alongOutgoing,
            coneFirst,
            coneSecond,
            incomingSquared,
            outgoingSquared,
            new Set(
              [firstEnd, secondEnd]
                .filter((end) => end.reversed)
                .map((end) => end.leaf),
            ),
          );
          if (typeof result === "string") return fail(J2_MESSAGES[result]);
          concave = result;
        }
      }

      // Keeper-only composition (§3.4): the correction path (arc, then the
      // bridge) goes wholly to the keeper's vertex end; the adopter adds its
      // concave tail only. Four roles are written separately.
      const [keeperEnd, adopterEnd] =
        declaration.keeper === "first"
          ? [firstEnd, secondEnd]
          : [secondEnd, firstEnd];
      const tailOf = (end: Terminal) =>
        concave && (end === firstEnd ? concave.tail[0] : concave.tail[1]);
      const withBridge = (value: ExactFraction | undefined) =>
        gapZero ? value : value ? addExact(value, bridge, budget) : bridge;
      const keeperCorrection = withBridge(arc ?? tailOf(keeperEnd));
      const adopterCorrection = tailOf(adopterEnd);
      const correct = (end: Terminal, value: ExactFraction | undefined) => {
        if (!value) return;
        const line = lineData.get(end.leaf);
        // A line's vertex-end displacement is its literal end error plus c.
        if (line) {
          const at = end.side === "end" ? 1 : 0;
          const total = addExact(line.endErrors[at], value, budget);
          if (at === 1) lineJointEnd[end.leaf] = total;
          else lineJointStart[end.leaf] = total;
        } else if (end.side === "end") correctionEnd[end.leaf] = value;
        else correctionStart[end.leaf] = value;
      };
      correct(keeperEnd, keeperCorrection);
      correct(adopterEnd, adopterCorrection);
      if (pathful) {
        if (keeperEnd.side === "end") reserveEnd[keeperEnd.leaf] = true;
        else reserveStart[keeperEnd.leaf] = true;
      }
      const inflate = (end: Terminal, value: ExactFraction | undefined) => {
        if (!value) return;
        const existing = inflation[end.leaf];
        inflation[end.leaf] = existing
          ? addExact(existing, value, budget)
          : value;
      };
      if (!concave) {
        // Parallel |g|⁺ or convex G⁺ on BOTH leaves (neighbour of neighbour).
        inflate(keeperEnd, keeperCorrection);
        inflate(adopterEnd, keeperCorrection);
      } else if (!gapZero) {
        inflate(keeperEnd, keeperCorrection);
        inflate(adopterEnd, withBridge(adopterCorrection));
      }
      if (concave)
        for (const [end, fraction] of [
          [firstEnd, concave.trim[0]],
          [secondEnd, concave.trim[1]],
        ] as const)
          if (end.side === "end") trimEnd[end.leaf] = fraction;
          else trimStart[end.leaf] = fraction;

      const base = {
        jointIndex: index,
        first: firstEnd.leaf,
        second: secondEnd.leaf,
        direction: [direction[0], direction[1]] as SplineVector,
        authority: declaration.authority.kind,
        keeper: declaration.keeper,
        bridge: gapZero ? 0 : up(bridge),
      };
      vertexReports.push(
        parallel
          ? { ...base, kind: "parallel-vertex" }
          : concave
            ? {
                ...base,
                kind: "nonparallel-vertex",
                side: "concave",
                retainedCrossing: true,
                tail: [up(concave.tail[0]), up(concave.tail[1])],
                trim: [up(concave.trim[0]), up(concave.trim[1])],
              }
            : {
                ...base,
                kind: "nonparallel-vertex",
                side: "convex",
                arcDeviation: up(arc!),
              },
      );
      return null;
    };
    for (const declaration of general.vertices) {
      const failure = certifyVertex(declaration);
      if (failure) return failure;
    }
    for (const declaration of general.trims) {
      budget.operation(64);
      // One index space (review R5): the declared adjacency index.
      const { jointIndex } = declaration;
      const firstEnd = terminal(jointIndex, true);
      const secondEnd = terminal((jointIndex + 1) % pieceCount, false);
      const fail = (code: string, message: string, magnitude?: true) =>
        magnitude
          ? {
              ...uncertain(code, message, firstEnd.leaf, secondEnd.leaf),
              magnitude,
            }
          : uncertain(code, message, firstEnd.leaf, secondEnd.leaf);
      // T7: a trim inside ONE closed piece needs its positional closure.
      if (jointIndex === (jointIndex + 1) % pieceCount) {
        const defect = authorityDefect(
          declaration.authority?.kind === "positional-closure"
            ? declaration.authority
            : undefined,
          jointIndex,
          jointIndex,
          firstEnd,
          secondEnd,
        );
        if (defect)
          return uncertain(
            KNOT_UNPROVEN,
            `Trim ${jointIndex}: ${defect}.`,
            firstEnd.leaf,
            secondEnd.leaf,
          );
      }
      const firstIsLine = lineData.has(firstEnd.leaf);
      const graph = !firstIsLine && !lineData.has(secondEnd.leaf);
      // S2 cubic↔cubic: one fixed precharge before H2 or any conversion.
      if (graph) budget.operation(GRAPH_TRIM_PRECHARGE);
      // H2 gate: sgn(d)·cross(u_in, u_out) > 0 on exact source tangents.
      const incoming = vertexTangent(firstEnd);
      const outgoing = vertexTangent(secondEnd);
      if (!incoming || !outgoing || distanceValue === 0)
        return fail(
          "trim-side-unproven",
          "The source tangents at the trim vertex or the offset side are not proved.",
        );
      const turn = crossExact(incoming, outgoing, budget);
      if (!(positive(distance) ? positive(turn) : negative(turn)))
        return fail(
          "trim-side-unproven",
          "The exact source-tangent turn is not concave toward the offset side.",
        );
      if (graph) {
        const failure = graphTrim(declaration, firstEnd, secondEnd, fail);
        if (failure) return failure;
        continue;
      }
      const lineEnd = firstIsLine ? firstEnd : secondEnd;
      const curveEnd = firstIsLine ? secondEnd : firstEnd;
      const line = lineData.get(lineEnd.leaf)!;
      const curveLine = lineData.get(curveEnd.leaf);
      // s_trav = +sgn(d) line-first, −sgn(d) line-second; exact negation on a
      // reversed curve leaf (never 1 − τ).
      const travelling: 1 | -1 = firstIsLine === positive(distance) ? 1 : -1;
      const orientation: 1 | -1 = curveEnd.reversed
        ? travelling === 1
          ? -1
          : 1
        : travelling;
      const along = lineEnd.reversed ? negated(line.direction) : line.direction;
      const rotated: ExactPoint = [negateExact(along[1], budget), along[0]];
      const w = orientation > 0 ? rotated : negated(rotated);
      const box = derivatives[curveEnd.leaf]!;
      const corner: ExactPoint = [
        box[0]![positive(w[0]) ? 0 : 1]!,
        box[1]![positive(w[1]) ? 0 : 1]!,
      ];
      const local = tubes[curveEnd.leaf]?.sourceLocalInterval;
      const width = local
        ? subtractExact(
            exactFromNumber(local[1], budget),
            exactFromNumber(local[0], budget),
            budget,
          )
        : one;
      // H1 on the whole leaf: m′ = min over the O′ box of s·rot(a)·B′(τ).
      const advance = multiplyExact(dot(w, corner), width, budget);
      if (!positive(advance))
        return fail(
          "trim-window-unproven",
          "The leaf-wide cone s·rot(a)·B′ > 0 is not proved on the terminal leaf.",
        );
      const lineError = line.error;
      const curveError = errors[curveEnd.leaf]!;
      // δ = (ε_A + ε_B)·L_hi/m′ and M = max corner |O′|·(b − a), upper √.
      const shift = divideExact(
        multiplyExact(
          addExact(lineError, curveError, budget),
          line.length[1],
          budget,
        ),
        advance,
        budget,
      );
      let speedSquared = zero;
      for (const axis of box) {
        const low = multiplyExact(axis[0]!, axis[0]!, budget);
        const high = multiplyExact(axis[1]!, axis[1]!, budget);
        speedSquared = addExact(
          speedSquared,
          compareExact(low, high, budget) >= 0 ? low : high,
          budget,
        );
      }
      const speed = curveLine
        ? curveLine.length[1]
        : squareRootUpper(speedSquared);
      if (!speed)
        return fail(
          "trim-window-unproven",
          "A verified square-root bound is not finite.",
        );
      const speedWidth = multiplyExact(speed, width, budget);
      // Curve side: stored bounds through the stored query-domain map, ±δ.
      const curveBounds = firstIsLine
        ? declaration.secondParameterBounds
        : declaration.firstParameterBounds;
      const toLeaf = (value: number) =>
        curveLine
          ? exactFromNumber(value, budget)
          : normalizedExact(
              value,
              (tubes[curveEnd.leaf] as NeutralCubicPieceTube).queryDomain,
              budget,
            );
      const curveLeaf: ExactRange = [
        toLeaf(curveBounds[0]),
        toLeaf(curveBounds[1]),
      ];
      const lineBounds = firstIsLine
        ? declaration.firstParameterBounds
        : declaration.secondParameterBounds;
      const lineLeaf: ExactRange = [
        exactFromNumber(lineBounds[0], budget),
        exactFromNumber(lineBounds[1], budget),
      ];
      const reportIndex = trimReports.length;
      /**
       * Places the trim from the bound `atWitness` of |B̂ − B| at τ̂ and its
       * δ; false (nothing written) when a root enclosure is not strictly
       * interior. Cubic stars keep the leaf-wide ε plus the tail Mδ.
       */
      const place = (atWitness: ExactFraction, delta: ExactFraction) => {
        const tail = multiplyExact(speedWidth, delta, budget);
        const curveRoot: ExactRange = [
          subtractExact(curveLeaf[0], delta, budget),
          addExact(curveLeaf[1], delta, budget),
        ];
        // Line side (H1 of the review): |t* − t̂| ≤ η/L_lo, η = ε_A + ε_B(τ̂) + Mδ.
        const widen = divideExact(
          addExact(addExact(lineError, atWitness, budget), tail, budget),
          line.length[0],
          budget,
        );
        const lineRoot: ExactRange = [
          subtractExact(lineLeaf[0], widen, budget),
          addExact(lineLeaf[1], widen, budget),
        ];
        const jointDisplacement = addExact(atWitness, tail, budget);
        const ends = [
          [curveEnd, curveRoot],
          [lineEnd, lineRoot],
        ] as const;
        // Strictly interior: the true terminal point is removed and the far
        // end retained; ordering against the other end is the leaf check.
        for (const [, root] of ends)
          if (!positive(root[0]) || compareExact(root[1], one, budget) >= 0)
            return false;
        for (const [end, root] of ends) {
          trimmedLeaves.add(end.leaf);
          const isLine = lineData.has(end.leaf);
          if (end.side === "start") {
            trimStart[end.leaf] = root[1];
            if (isLine) lineJointStart[end.leaf] = jointDisplacement;
            else correctionStart[end.leaf] = tail;
          } else {
            trimEnd[end.leaf] = subtractExact(one, root[0], budget);
            if (isLine) lineJointEnd[end.leaf] = jointDisplacement;
            else correctionEnd[end.leaf] = tail;
          }
        }
        const firstRoot = firstIsLine ? lineRoot : curveRoot;
        const secondRoot = firstIsLine ? curveRoot : lineRoot;
        trimReports[reportIndex] = {
          kind: "trim",
          jointIndex: declaration.jointIndex,
          first: firstEnd.leaf,
          second: secondEnd.leaf,
          line: firstIsLine ? "first" : "second",
          orientation,
          firstRootBounds: [down(firstRoot[0]), up(firstRoot[1])],
          secondRootBounds: [down(secondRoot[0]), up(secondRoot[1])],
          tail: up(tail),
        };
        return true;
      };
      const trim = {
        leaves: [curveEnd.leaf, lineEnd.leaf] as const,
        local: false,
        /**
         * Q4-E1 local branch, at most once per trim and only after a
         * leaf-wide window or composition failure: ε_B at τ̂ is replaced by
         * the local bound on the vertex-anchored sub-window reaching the far
         * stored bound of U; δ and every δ-derived quantity are recomputed.
         */
        upgrade: () => {
          if (trim.local) return false;
          trim.local = true;
          budget.operation(LOCAL_ERROR_PRECHARGE);
          if (curveLine) return false;
          const reach =
            curveEnd.side === "end"
              ? subtractExact(one, curveLeaf[0], budget)
              : curveLeaf[1];
          const atWitness =
            !negative(reach) && localBound(curveEnd.leaf, curveEnd.side, reach);
          if (!atWitness) return false;
          const delta = divideExact(
            multiplyExact(
              addExact(lineError, atWitness, budget),
              line.length[1],
              budget,
            ),
            advance,
            budget,
          );
          return place(atWitness, delta);
        },
      };
      lemmaTrims.push(trim);
      if (!place(curveError, shift) && !trim.upgrade())
        return fail(
          "trim-window-unproven",
          "A true-root enclosure is not strictly inside its terminal leaf.",
          true,
        );
    }
  }

  // Per-leaf composition (sums of both ends) and the K3 radii.
  budget.operation(4 * count);
  const stars: ExactFraction[] = [];
  const radii: ExactFraction[] = [];
  for (let index = 0; index < count; index += 1) {
    const trimmed = trimmedLeaves.has(index);
    const leafFailure = (reason: string): Failure =>
      trimmed
        ? {
            ...uncertain(
              reason.startsWith("retained")
                ? "trim-window-unproven"
                : "trim-composition-unproven",
              `Leaf ${index}: ${reason}.`,
              index,
            ),
            magnitude: true,
          }
        : uncertain(KNOT_UNPROVEN, `Leaf ${index}: ${reason}.`, index);
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
    const composed = () => {
      let sum = errors[index]!;
      for (const correction of [correctionStart[index], correctionEnd[index]])
        if (correction) sum = addExact(sum, correction, budget);
      const line = lineData.get(index);
      if (!line) return sum;
      // Affine map of the retained segment: the larger end displacement.
      const startValue = lineJointStart[index] ?? line.endErrors[0];
      const endValue = lineJointEnd[index] ?? line.endErrors[1];
      return compareExact(startValue, endValue, budget) >= 0
        ? startValue
        : endValue;
    };
    let star = composed();
    const graphs = graphSides.get(index);
    if (graphs) {
      // S2 Lemma C: ε* = ε + c_far (the graph end adds no correction); the
      // collar makes the stall exist; G < τ strictly; A1 max-form star.
      const base = star;
      const candidates: ExactFraction[] = [];
      for (const side of graphs) {
        const reach = multiplyExact(side.eUpper, base, budget);
        const collared = side.exiting
          ? compareExact(
              addExact(side.middle, reach, budget),
              side.limit,
              budget,
            ) < 0
          : compareExact(
              subtractExact(side.middle, reach, budget),
              side.limit,
              budget,
            ) > 0;
        if (!collared)
          return {
            ...uncertain(
              "trim-window-unproven",
              `Leaf ${index}: the graph-trim glue collar at τ = ½ does not clear the switch region.`,
              index,
            ),
            magnitude: true,
          };
        const correction = divideExact(
          multiplyExact(side.spread, base, budget),
          exact(4n, 1n, budget),
          budget,
        );
        const room = subtractExact(tolerance, correction, budget);
        const roomSquared = multiplyExact(room, room, budget);
        if (
          !positive(room) ||
          compareExact(
            roomSquared,
            multiplyExact(base, base, budget),
            budget,
          ) <= 0 ||
          compareExact(roomSquared, side.ownSquared, budget) <= 0
        )
          return {
            ...uncertain(
              "trim-composition-unproven",
              `Leaf ${index}: the graph-trim glue bound is not strictly below the modeling tolerance.`,
              index,
            ),
            magnitude: true,
          };
        candidates.push(
          addExact(maximum([base, side.ownUpper]), correction, budget),
          side.otherUpper,
        );
      }
      star = maximum(candidates);
    } else {
      const convex =
        arcStart[index] !== undefined || arcEnd[index] !== undefined;
      // Strict at a J2′ convex end and at a declared-vertex reserve end.
      const reserve =
        reserveStart[index] === true || reserveEnd[index] === true;
      const exceeds = (value: ExactFraction) => {
        const comparison = compareExact(value, tolerance, budget);
        return convex || reserve ? comparison >= 0 : comparison > 0;
      };
      let failed = exceeds(star);
      if (failed && trimmed) {
        // Q4-E1: upgrade this leaf's Lemma-T trims to the local ε at τ̂ (the
        // star keeps the leaf-wide ε; only the tails Mδ shrink), recompose.
        // Leaves composed earlier in this loop keep the stars and
        // displacement bounds built from the pre-upgrade (larger) tails and
        // joint displacements: still valid upper bounds (sound, conservative),
        // just not re-tightened; the trim record reports the upgraded values.
        let upgraded = false;
        for (const trim of lemmaTrims)
          if (trim.leaves.includes(index) && trim.upgrade()) upgraded = true;
        if (upgraded) {
          star = composed();
          failed = exceeds(star);
        }
      }
      if (failed)
        return leafFailure(
          convex
            ? "corrected base error is not below the modeling tolerance at a convex end"
            : reserve
              ? "corrected base error is not below the modeling tolerance at a declared-vertex reserve end"
              : "corrected base error exceeds the modeling tolerance",
        );
    }
    let radius = errors[index]!;
    for (const arc of [arcStart[index], arcEnd[index], inflation[index]])
      if (arc) radius = addExact(radius, arc, budget);
    stars.push(star);
    radii.push(radius);
  }

  // K3: exact hull clearance of every non-join pair.
  // Piece path: explicit adjacency (intra-piece natural joins, trims, wrap).
  const adjacency =
    general &&
    new Set(
      [
        ...joins,
        ...[...trimReports, ...vertexReports].map((join) => [
          join.first,
          join.second,
        ]),
      ].map(([a, b]) => `${Math.min(a!, b!)}:${Math.max(a!, b!)}`),
    );
  const isJoin = (first: number, second: number) =>
    adjacency
      ? adjacency.has(`${first}:${second}`)
      : second === first + 1 || (closed && first === 0 && second === count - 1);
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
  // Vertex records were bounded outward in their own metered step.
  const up = (value: ExactFraction) => outwardExactNumber(value, "up", budget);
  const leaves = tubes.map((tube, index) => {
    const unchanged = (value: ExactFraction) =>
      value === errors[index] && !lineData.has(index)
        ? tube.certifiedError
        : up(value);
    const baseErrorStar = unchanged(stars[index]!);
    return {
      baseErrorStar,
      // τ on convex-END leaves (arc reserve), graph-trim leaves (glue
      // reserve) and leaves with a declared-vertex reserve at EITHER end.
      displacementBound:
        arcEnd[index] === undefined &&
        !graphSides.has(index) &&
        reserveStart[index] !== true &&
        reserveEnd[index] !== true
          ? baseErrorStar
          : modelingTolerance,
      clearanceRadius: unchanged(radii[index]!),
    };
  });
  const certifiedJoins: TubePieceChainJoin[] = joins.map(
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
  // Trim records were bounded outward in their own metered step.
  certifiedJoins.push(...trimReports, ...vertexReports);
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

const invalidPieceChain = (message: string): Failure =>
  uncertain("invalid-cubic-tube-chain", message);

/**
 * Piece-chain entry. A single cubic piece without trims IS the legacy chain:
 * a constant-time bitwise distance binding on its first tube (uncharged) and
 * then exactly the legacy sequence. Otherwise pieces + trims are precharged
 * BEFORE any enumeration, then the flattened admission cost in the core.
 *
 * UNSOUND on its own for a one-leaf cubic piece in a multi-piece chain
 * WITHOUT a declared-vertex end: K1 cone-checks emitted hodographs only at
 * intra-piece joins and at vertex pairs, and Lemma T's m′ is a cone of the
 * TRUE offset derivative, so such a leaf's emitted self-injectivity is never
 * checked and a looped emitted cubic can verify (an S2 graph-trim end does
 * check the emitted G1 cone; a Lemma-T end does not). A vertex end runs K1 on
 * the whole emitted leaf. Callers must reject the other one-leaf pieces (the
 * offset-chain wrapper does) until the emitted-cone fix for single-leaf
 * pieces lands here.
 */
function certifyPieceChain(
  request: PieceTubeChainRequest,
  budget: ExactProofBudget,
): TubePieceChainResult {
  const { pieces, trims, closed, modelingTolerance, distance } = request;
  const vertices = request.vertices ?? [];
  const only = pieces.length === 1 ? pieces[0] : undefined;
  if (only?.kind === "cubic" && trims.length === 0 && vertices.length === 0) {
    const owner = only.tubes[0]?.reference?.distance;
    if (
      owner !== undefined &&
      !Object.is(owner, only.reversed ? -distance : distance)
    )
      return invalidPieceChain(
        "The owner distance is not the piece-oriented chain distance.",
      );
    return certifyChain(
      { modelingTolerance, closed, tubes: only.tubes },
      budget,
    );
  }
  budget.operation(pieces.length + trims.length + vertices.length);
  if (pieces.length === 0)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-empty",
      message: "A cubic tube chain needs at least one emitted cubic.",
    };
  if (!Number.isFinite(distance))
    return invalidPieceChain("The chain distance must be finite.");
  // One index space (review R5): every declared adjacency is covered exactly
  // once by a trim or a vertex; each list strictly increasing.
  const adjacencies = closed ? pieces.length : pieces.length - 1;
  if (trims.length + vertices.length !== adjacencies)
    return invalidPieceChain(
      vertices.length === 0
        ? "One trim declaration is required per inter-piece adjacency."
        : "One trim or vertex declaration is required per adjacency.",
    );
  const covered = new Set<number>();
  const admissibleIndex = (value: number, previous: number) =>
    Number.isSafeInteger(value) &&
    value > previous &&
    value < adjacencies &&
    !covered.has(value);
  for (const [index, trim] of trims.entries()) {
    if (
      !admissibleIndex(trim.jointIndex, trims[index - 1]?.jointIndex ?? -1) ||
      (vertices.length === 0 && trim.jointIndex !== index) ||
      !orderedFinite(trim.firstParameterBounds) ||
      !orderedFinite(trim.secondParameterBounds)
    )
      return invalidPieceChain(`Trim ${index}: invalid joint bounds.`);
    covered.add(trim.jointIndex);
  }
  for (const [index, vertex] of vertices.entries()) {
    if (
      !admissibleIndex(
        vertex.jointIndex,
        vertices[index - 1]?.jointIndex ?? -1,
      ) ||
      (vertex.keeper !== "first" && vertex.keeper !== "second")
    )
      return invalidPieceChain(`Vertex ${index}: invalid declaration.`);
    covered.add(vertex.jointIndex);
  }
  const tubes: (NeutralCubicPieceTube | undefined)[] = [];
  const lines: (NeutralLineTube | undefined)[] = [];
  const firstLeaf: number[] = [];
  const pieceOf: number[] = [];
  for (const [pieceIndex, piece] of pieces.entries()) {
    firstLeaf.push(tubes.length);
    if (piece.kind === "line") {
      tubes.push(undefined);
      lines.push(piece.tube);
      pieceOf.push(pieceIndex);
      continue;
    }
    if (piece.kind !== "cubic" || piece.tubes.length === 0)
      return invalidPieceChain(`Piece ${pieceIndex}: no emitted leaves.`);
    budget.operation(piece.tubes.length);
    for (const tube of piece.tubes) {
      tubes.push(tube);
      lines.push(undefined);
      pieceOf.push(pieceIndex);
    }
  }
  return certifyChain(
    {
      modelingTolerance,
      closed,
      // Line leaves have no cubic tube; the core reads them through `lines`.
      tubes: tubes as readonly NeutralCubicTube[],
    },
    budget,
    { distance, pieces, trims, vertices, firstLeaf, pieceOf, lines },
  );
}

/**
 * The production additive ceilings of `ExactProofBudget` (one request), per
 * attempt stage: the staged whole-request meter lets attempt k use at most
 * k times these in total (review R9). `integerBits` is per value, unscaled.
 */
const STAGE_CEILINGS = {
  operations: 10_000_000,
  determinantTerms: 1_536,
  euclideanSteps: 1_500_000,
  refinementSteps: 4_096,
  projectionAttempts: 2,
} as const;

/**
 * ONE budget over `attempts` certifications (ceilings × attempts, lower
 * limits absolute) whose cumulative additive meters are also capped at
 * stage k × the production ceilings while attempt k runs. Never reset,
 * replaced or topped up; the stage only moves forward.
 */
class StagedProofBudget extends ExactProofBudget {
  #stage = 1;
  #operations = 0;
  #determinantTerms = 0;
  #euclideanSteps = 0;
  #refinementSteps = 0;
  #projectionAttempts = 0;

  constructor(lowerLimits: LowerProofLimits | undefined, attempts: number) {
    super(lowerLimits, attempts);
  }

  advance() {
    this.#stage += 1;
  }

  #check(total: number, ceiling: number) {
    if (total > this.#stage * ceiling)
      throw new ExactQueryProofBudgetExceeded();
  }

  override operation(count = 1) {
    super.operation(count);
    this.#operations += count;
    this.#check(this.#operations, STAGE_CEILINGS.operations);
  }

  override determinantTerm() {
    super.determinantTerm();
    this.#determinantTerms += 1;
    this.#check(this.#determinantTerms, STAGE_CEILINGS.determinantTerms);
  }

  override euclideanStep() {
    super.euclideanStep();
    this.#euclideanSteps += 1;
    this.#check(this.#euclideanSteps, STAGE_CEILINGS.euclideanSteps);
  }

  override refinementStep() {
    super.refinementStep();
    this.#refinementSteps += 1;
    this.#check(this.#refinementSteps, STAGE_CEILINGS.refinementSteps);
  }

  override projectionAttempt() {
    super.projectionAttempt();
    this.#projectionAttempts += 1;
    this.#check(this.#projectionAttempts, STAGE_CEILINGS.projectionAttempts);
  }
}

function createCertifier(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain &
  CertifiedTubePieceChain &
  CertifiedTubePieceChainRequests {
  // One budget for the whole request: admission, conversion, every join,
  // knot, trim, leaf, pair, split and the certificate. Never reset or replaced.
  const run = <T>(
    certify: (budget: ExactProofBudget) => T,
  ): T | typeof EXHAUSTED => {
    const budget = new ExactProofBudget(lowerLimits);
    try {
      return certify(budget);
    } catch (error) {
      if (error instanceof ExactQueryProofBudgetExceeded) return EXHAUSTED;
      throw error;
    } finally {
      observeBudget?.(budget.snapshot());
    }
  };
  return {
    certifyChain: (request) =>
      // Without a piece chain the core never emits trim joins.
      run((budget) => certifyChain(request, budget) as CubicTubeChainResult),
    certifyPieceChain: (request) =>
      run((budget) => certifyPieceChain(request, budget)),
    openRequest: (attempts) => {
      if (!Number.isSafeInteger(attempts) || attempts < 1)
        throw new RangeError(
          "A staged certifier request needs a positive integer attempt count.",
        );
      // attempts = 1 is exactly the single-request meter.
      const budget =
        attempts === 1
          ? new ExactProofBudget(lowerLimits)
          : new StagedProofBudget(lowerLimits, attempts);
      let issued = 0;
      let spent = false;
      return {
        certifyPieceChain(request) {
          if (issued === attempts)
            throw new RangeError(
              "The staged certifier request issued more attempts than it was sized for.",
            );
          issued += 1;
          // Sticky: an exhausted attempt never lets a later one work.
          if (spent) return EXHAUSTED;
          try {
            if (issued > 1) {
              (budget as StagedProofBudget).advance();
              budget.operation(RETRY_ENTRY_CHARGE);
            }
            return certifyPieceChain(request, budget);
          } catch (error) {
            if (!(error instanceof ExactQueryProofBudgetExceeded)) throw error;
            spent = true;
            return EXHAUSTED;
          } finally {
            observeBudget?.(budget.snapshot());
          }
        },
      };
    },
  };
}

/**
 * Production certifier under the unchanged exact-proof ceilings. Its
 * `certifyPieceChain` is unsound on its own for one-leaf cubic pieces in a
 * multi-piece chain (see `certifyPieceChain`).
 */
export function createCertifiedCubicTubeChain(): CertifiedCubicTubeChain &
  CertifiedTubePieceChain &
  CertifiedTubePieceChainRequests {
  return createCertifier();
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createCertifiedCubicTubeChainWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedCubicTubeChain &
  CertifiedTubePieceChain &
  CertifiedTubePieceChainRequests {
  return createCertifier(lowerLimits);
}

/**
 * Test-only whole-request meter observation under production ceilings: once
 * per request, and once after every attempt of a staged request.
 */
export function createCertifiedCubicTubeChainWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedCubicTubeChain &
  CertifiedTubePieceChain &
  CertifiedTubePieceChainRequests {
  return createCertifier(undefined, observeBudget);
}
