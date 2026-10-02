import type {
  CertifiedCubicTubeChain,
  CertifiedTubePieceChain,
  CertifiedTubePieceChainRequests,
  CubicTubeChainJoin,
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralArcTube,
  NeutralCircleTube,
  NeutralCubicPieceTube,
  NeutralCubicTube,
  NeutralLineTube,
  PieceTubeChainRequest,
  TubeChainPiece,
  TubeChainArcDeclaration,
  TubeChainArcJoin,
  TubeChainArcRecord,
  TubeChainArcTrimJoin,
  TubeChainGraphTrimJoin,
  TubeChainSeedArcRecord,
  TubeChainSeedKnotJoin,
  TubeChainTrimJoin,
  TubeChainVertexAuthority,
  TubeChainVertexDeclaration,
  TubeChainVertexJoin,
  TubePieceChainJoin,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import {
  seedArcLeafSplits,
  seedArcMinimumLeaves,
} from "@/contracts/sketch/canonical-arc-support";
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
  exactToNumber,
  multiplyExact,
  negateExact,
  nextBinary64,
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
 *   apart than r_i + r_j, by exact dyadic de Casteljau subdivision. An exact
 *   broad phase (T08b-f0) skips only pairs whose r-inflated top-level boxes
 *   are strictly disjoint on an axis, which the first exact test rejects.
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
 *
 * T08b-e F1 arcs (`arcs`, piece path only; the same index space; user
 * decision U2): at a convex declared vertex the chain may carry a true arc
 * of centre V = P_v (bitwise), the GIVEN radius ρ (finite, > 0, certified as
 * given [TECH E9]) and the exact turn orientation σ, from A′ to B′, the two
 * neighbours' own free emitted terminal poles. Reference O* = O_P (untrimmed)
 * ∪ arc(P_v, |d|; A → B°) ∪ [B°, B] ∪ O_Q (untrimmed) (R7 with the arc
 * macroscopic); emitted E_v = [A′, Â] ∪ Ĉ ∪ [B̂, B′] with never-drawn radial
 * connectors (consumers join by point identity and draw from rounded
 * `atan2` angles, which are not certified). One fixed precharge per arc
 * before authorization. With a = A′ − V, b = B′ − V and the exact reference
 * directions nᵢ = sign(d)·rot(uᵢ), all exact on binary64 inputs, no angle:
 * - Admission: C5 authority as a vertex; X ≠ 0, sign(d)·X < 0 (convex),
 *   d ≠ 0, the sweep is σ; (A1) σ(a×b) > 0 (no zero-length arc, rule Z);
 *   a·n₁ > 0 and b·n₂ > 0 (each end shift < π/2, review A2). Split rule
 *   (R1): one sub-arc iff a·b > 0 ∧ a·n₂ > 0 ∧ b·n₁ > 0, else two at s = a +
 *   b with σ(a×s), σ(s×b), a·s, s·b, σ(n₁×s), σ(s×n₂) > 0 (A4); every
 *   emitted sub-arc sweep is then < π/2 and every reference sub-arc sweep
 *   < π (only its σ-orientation is checked; Lemma A needs < π, R2 nothing
 *   more).
 * - Lemma A: the emitted and reference arcs are concentric (radii ρ, |d|);
 *   with π_A, π_B the endpoint-local end bounds (owner π₀/π₃ capped by ε,
 *   a line's exact end error), δ_a = ||a|² − d²|/|d|, u_A = |ρ² − |a|²|/ρ,
 *   ε_in = max(|ρ − |d|| + δ_a + π_A, u_A + π_A), ε_out = |ρ − |d|| + δ_b +
 *   π_B + |g|⁺ (|g|⁺ the only √), one sub-arc max(ε_in, ε_out). Every arc
 *   leaf has a collapsed connector, so ε < τ STRICTLY and its
 *   displacementBound is τ (the η-perturbed homeomorphism, review R3).
 *   This holds on EVERY arc leaf, not only where the connectors collapse
 *   with g = 0: when g ≠ 0 and ρ = |b| exactly, the exit connector has zero
 *   length while its reference image, the bridge [B°, B], does not, so the
 *   affine leaf map cannot be onto and only the η reparametrization (strict
 *   ε, τ reserve) makes the Fréchet claim hold. Do not narrow the rule to
 *   "collapsed connectors only".
 * - Lemma E: e_in = σ·rot(a) makes [A′, Â] e-vertical; the incoming
 *   terminal leaf's traversal emitted hodograph and O′ box corner (a line's
 *   emitted step AND source direction, R7) are strictly e_in-positive, the
 *   sub-arc wedges are e-positive by the split rule, so both E and O* are
 *   locally simple at the entry; symmetrically e_out = σ·rot(b) at the exit
 *   with e_out·g ≥ 0 (E4′). The bridge against the adjacent reference (R2):
 *   one sub-arc needs e_out·(O′_P box) > 0 or e_in·g ≥ 0; two need
 *   σrot(s)·g ≥ 0.
 * - Composition: P and Q keep their own ε (no correction, reserve or
 *   inflation at an arc end; each maps same-parameter onto its untrimmed
 *   true offset). Arc leaves follow every piece leaf in adjacency order
 *   [TECH E3]; K3 radius r = ε_k; K3 runs on every non-adjacent pair,
 *   including the arc's (P, Q) leaves, with exact wedge boxes V + ρ·U (U the
 *   verified unit-direction hull, ±1 at contained axis directions) hulled
 *   with the connector end each carries, bisected at exactly admitted
 *   binary64 near-bisectors; the connector end stays with its child (R8).
 *   Closed chains need at least five leaves, arc leaves included.
 * - A verified certificate carries exactly one record, one arc-entry and
 *   one arc-exit join per declared arc, in declaration order; anything else
 *   fails closed (a skipped arc would leave its adjacency uncertified).
 * - G1 [TECH E4]: tan α = |a·h|/|a×h| is reported, never gated.
 * - Failures of the arc stage and K3 failures of its leaves or its (P, Q)
 *   pair carry `arcJoints` (never produced from the request).
 *
 * T08b-f seed arcs and circles (`{kind: "arc" | "circle"}` pieces, piece
 * path only; never entered without them, so arc-free charge sequences are
 * unchanged). Reference R′ ([TECH F1], the R10 wording in
 * `NeutralArcTube`): the offset of the circle through each end's r_V
 * (|V − C| at a declared-join end, ρ_s at a trimmed or chain-terminal end)
 * with one radial step |r_E − r_S| at the middle retained knot (inside a
 * single retained leaf), exactly vertical in that knot's cone.
 * - Precharge 64 + 16·16 per arc (8 fixed leaves: 64 + 16·8 per circle)
 *   BEFORE its partition is chosen or any tube field is read. The rule-B′
 *   partition (review R1) is recomputed with `seedArcLeafSplits` (A6; two
 *   leaves at least where `seedArcMinimumLeaves` says so, T08b-g7 P3) and
 *   re-proved: every leaf
 *   of BOTH the emitted (a … b) and the reference (s … e) wedge has σ(u×v)
 *   > 0 and 2u·v > σ(u×v) exactly, the half-plane sequence never returns
 *   (total < 2π), a·s > 0 and b·e > 0. Admission: ρ_o = hypot(S′ − C), ρ_s
 *   = hypot(S − C) bitwise (E7), no exact full turn, and [TECH F10] the
 *   binary64 atan2 sweep must not wrap across 0/2π (minor above 3π/2,
 *   major below π/2; rounding across π is accepted). R7 removals only at
 *   trims. R_V ≤ 0 is `arc-tube-collapse`.
 * - Lemma A-R per retained leaf: ε = max|ρ_o − R| over its radii (|v|
 *   rationalized, review A1) + R⁺·(end chord) + u⁺ (connector), strictly
 *   below τ; displacementBound = τ on every seed leaf (R3 convention).
 *   Bounds are rounded outward to binary64 (sound; small operands).
 * - Vertices with a seed side: [TECH F5] cone e = σ_trav·rot(Z − C) (the
 *   radial connector [Ẑ, Z] exactly vertical, Lemma E), K1-wedge on each
 *   seed leaf's emitted and reference wedges, (Z − C)·(V − C) > 0; two seed
 *   arcs join by ONE rationalized segment (Lemma W, review R4: v = α₁x₁ −
 *   α₂x₂, α = (|x|² − ρ²)/(|x|(|x| + ρ))), structural vertical when x₁ ∥
 *   x₂ ⊥ e. J2′ reads exact κ = σ/r_V, λ = R_V/r_V (review R5) on a
 *   vertex-anchored 1/8 sub-wedge (rate e²σ/(R c³), advance R Δ_lo c_lo,
 *   speed R Δ_hi; c's hull takes the interior maximum |e|), its fractions
 *   bounding the leaf's; seed vertices round the J2′ intervals outward.
 * - F1 arcs at a seed end: π_V from the rationalized ||p| − r_V + σd| +
 *   R_V⁺c_V; the arc-entry/-exit connectors are replaced by one Lemma-W
 *   segment between the consumer ends.
 * - Lemma T° at a trim with a seed side (precharge 256 before H2): the
 *   implicit circle K = (C_A, R_A) of a seed leaf (R_A exact at a trimmed
 *   end; never a stepped leaf, and never a trimmed leaf with a realization
 *   segment at its other end). (T°1/T°2, review R2) a monotone window W
 *   of (O_B − C_A)·O_B′ holding the bracket: on a line split at the exact
 *   foot t₀ (the other side excluded, or PAIRED with the line's other-end
 *   T° trim against the same K: a line meets a circle at most twice, or,
 *   T08b-g7 Lemma T°2′, its exact direction cone from C_A, in one open
 *   half-plane of the line's own normal, disjoint from EVERY closed leaf
 *   wedge of A's whole partition, R7-removed leaves included: then the
 *   other side meets no circle about C_A inside A's wedge; ties fail
 *   closed; no bisection, no new constant); on
 *   an arc split at ±(C_B − C_A) exactly, the rest excluded by bisected
 *   wedge boxes; on a cubic by dyadic windows (O′ = λS′ on the restricted
 *   source). (T°3) φ = η(2R⁺ + η) with η = ε_B(τ̂) (owner Q4-E1 local
 *   bound) + |ρ_o − R| + w, δ = φ/(2m°); on an arc B, exact sign-bracketing
 *   candidate directions. (R3) the same monotone/exclusion/bracket tests on
 *   the EMITTED supports against the emitted circle (radius family): the
 *   joint pair meets once on the full circle, or (T°2′) on a Lemma-T°
 *   line's other monotone side against every circle about C_A inside A's
 *   whole exact certifier wedge (every rule-B′ leaf, R7-removed included;
 *   never the query's angle domain), and the emitted analogue (R3); O* is
 *   then the unique common point of the drawn pieces' true offsets. (T°4) both root boxes strictly inside A's reference /
 *   emitted leaf wedges; cut chord R⁺|X̂ − X*|/min(ρ_lo, R_A). Composition:
 *   B takes M(δ + Δ) (cubic tail, line end), both cut arcs their chords;
 *   a one-leaf arc cut at both ends needs the cuts σ-ordered. R7 removals
 *   are never trusted: on the implicit side T° runs on the full circles,
 *   and T°2′ tests the line's rest cone against every leaf wedge of A,
 *   removed or retained (the carried count is never read there); on an
 *   explicit arc every removed leaf at the joint is excluded by T°2 on
 *   both wedges (review Q1), else fail closed.
 * - T08b-g7 P3: an arc whose natural start and end are both declared
 *   adjacencies (`seedArcMinimumLeaves`, structural: every arc of a closed
 *   chain of ≥ 2 pieces, every non-terminal arc of an open chain) takes at
 *   least two leaves, computed by the owner and here from the same helper.
 * - Review R12 (option c): a seed arc whose natural START is a trim
 *   certifies the radius family [lo, hi] (record `radiusFamily`) computed
 *   before any trim; w is added to every leaf's ε, star and K3 radius and
 *   to T°'s φ; T° runs on the family; Lemma W is not attempted on it.
 * - K3: seed leaves are exact wedge items hulled with their pole
 *   connectors and Lemma-W far-end boxes; [TECH F7] intra-piece pairs are
 *   exempt except (review R9) the (first, last) pair when a non-radial
 *   segment is attached and the retained sweep is at least π.
 * - Records `seedArcs`; completeness (uncharged): one record per seed piece
 *   and every adjacency covered exactly once, else invalid-cubic-tube-chain.
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
/**
 * [TECH] F12: applies the leaf multiplier of a request once its flattened
 * leaf count is known and charged (see `leafMultiplier`).
 */
type LeafScale = (leaves: number) => void;

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
/** Fixed per-declared-arc precharge (T08b-e), before its authorization. */
const ARC_PRECHARGE = 64;
/** Fixed per-leaf precharge of its top-level K3 box (T08b-f0), before it. */
const K3_LEAF_BOX_PRECHARGE = 16;
/** Fixed per-leaf precharge of the K3 broad-phase sweep, before it. */
const K3_SWEEP_PRECHARGE = 16;
/**
 * T08b-g7 (Lemma T°2′): fixed precharge per leaf wedge of A's whole
 * partition, before one rest side's cone is built (run only for a T°2
 * entry with no opposite partner).
 */
const T2_WEDGE_PRECHARGE = 16;
/**
 * Fixed per-seed-arc precharge (T08b-f), before its partition is chosen or
 * any of its data is read: 64 + 16 per leaf at the partition cap of 16.
 */
const ARC_SEED_PRECHARGE = 64 + 16 * 16;
/** Fixed per-circle-piece precharge (8 fixed leaves), before its data. */
const CIRCLE_SEED_PRECHARGE = 64 + 16 * 8;
/** Fixed per-Lemma-T° trim precharge (the S2 pattern), before H2. */
const ARC_TRIM_PRECHARGE = 256;
/** Fixed precharge of one Lemma-W realization-segment test, before it. */
const JUNCTION_PRECHARGE = 32;
/** T08b-g5d: fixed precharge of one removed leaf's Lemma T-W window cone. */
const WINDOW_CONE_PRECHARGE = 16;
/** T08b-g5d: fixed precharge of one removed leaf of a deep S2 covering (one restriction). */
const DEEP_COVERING_PRECHARGE = 64;
/** T08b-g5d: fixed precharge of one Lemma-C glue candidate k ≥ 2. */
const GLUE_CANDIDATE_PRECHARGE = 32;
/** T08b-g5d: Lemma-C glue candidates 1 − 2⁻ᵏ, k = 1 (the reviewed ½) … 4. */
const GLUE_DEPTH = 4;
/** Bisection depth of the Lemma-T° window / exclusion subdivision. */
const SEED_TRIM_DEPTH = 5;
/** The eight exact circle leaf directions ([TECH] F11), counter-clockwise. */
const CIRCLE_DIRECTIONS: readonly SplineVector[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
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

/**
 * Deterministic stable merge sort; `ordered(a, b)` keeps a before b. The
 * comparison count depends on the input only, never on the engine's sort.
 */
function mergeSort<T>(
  items: readonly T[],
  ordered: (first: T, second: T) => boolean,
): T[] {
  if (items.length < 2) return [...items];
  const middle = items.length >> 1;
  const left = mergeSort(items.slice(0, middle), ordered);
  const right = mergeSort(items.slice(middle), ordered);
  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length)
    merged.push(ordered(left[i]!, right[j]!) ? left[i++]! : right[j++]!);
  return [...merged, ...left.slice(i), ...right.slice(j)];
}

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

/**
 * One F1 sub-arc wedge (T08b-e, K3 geometry): the points V + ρ·w/|w| for w
 * in the exact wedge [from, to] of sweep < π/2 and orientation σ, plus the
 * radial connector to the exact emitted end it carries at `from` (A′) or at
 * `to` (B′). A bisected wedge keeps each connector with the child that
 * contains its end direction (review R8).
 */
interface ArcWedge {
  readonly kind: "arc";
  /** The F1 arc's adjacency, or −1 on a seed-arc leaf (T08b-f). */
  readonly jointIndex: number;
  readonly center: ExactPoint;
  readonly radius: ExactFraction;
  readonly sigma: 1 | -1;
  readonly from: ExactPoint;
  readonly to: ExactPoint;
  readonly start?: ExactPoint;
  readonly end?: ExactPoint;
  /**
   * T08b-f: exact boxes hulled into the wedge box with the end they belong
   * to (the far consumer end of a Lemma-W realization segment); never an
   * on-curve point.
   */
  readonly startHull?: readonly ExactRange[];
  readonly endHull?: readonly ExactRange[];
}

/** One natural end of a seed arc (T08b-f), exact on binary64 inputs. */
interface SeedEnd {
  /** `join`: a declared vertex or F1 arc (r_V = |V − C|); else r_V = ρ_s. */
  readonly kind: "trim" | "join" | "terminal";
  /** Its end leaves are removed by a deep trim (R7). */
  readonly removed: boolean;
  /** v = V − C (source end) and p = pole − C (emitted end). */
  readonly vertex: ExactPoint;
  readonly relative: ExactPoint;
  readonly pole: ExactPoint;
  readonly vertexSquared: ExactFraction;
  /** The reference radius R_V = r_V − σd, enclosed (exact when r_V = ρ_s). */
  readonly reference: ExactRange;
  /** |ρ_o − R_V|⁺ (rationalized). */
  readonly gap: ExactFraction;
  /** √-free |λ_V|⁺ = ||v|² − ρ_s²|/ρ_s (recorded). */
  readonly lambda: ExactFraction;
  /** c_V ≥ |p̂ − v̂| and u⁺ ≥ |ρ_o − |p|| (0 when removed). */
  readonly chord: ExactFraction;
  readonly connector: ExactFraction;
  /** π_V ≥ |pole − (V + d·N(V))| (declared-join ends; F1 Lemma A). */
  readonly bound?: ExactFraction;
}

/** One admitted seed-arc or circle piece (T08b-f). */
interface SeedArc {
  readonly piece: number;
  readonly kind: "arc" | "circle";
  readonly center: ExactPoint;
  readonly centerValue: SplineVector;
  /** ρ_o, exact of the given binary64. */
  readonly radius: ExactFraction;
  readonly radiusValue: number;
  /** Natural orientation σ_s (circles +1). */
  readonly sigma: 1 | -1;
  readonly reversed: boolean;
  /** σ·d_i (circles: d). */
  readonly signedDistance: ExactFraction;
  /** Boundary directions of the whole partition, natural order (m + 1). */
  readonly emitted: readonly ExactPoint[];
  readonly reference: readonly ExactPoint[];
  readonly start?: SeedEnd;
  readonly end?: SeedEnd;
  /** Flattened retained leaves, natural order. */
  readonly leaves: number[];
  readonly step: ExactFraction;
  readonly gaps: readonly [ExactFraction, ExactFraction];
  readonly removed: readonly [number, number];
  /** Review R12: the certified emitted radius family (w = 0 unless set by a trim). */
  family: { width: ExactFraction; range: readonly [number, number] };
  /** A non-radial (Lemma W) realization segment is attached (review R9). */
  nonRadial: boolean;
}

/** One flattened seed leaf. */
interface SeedLeaf {
  readonly arc: SeedArc;
  /** Index in the whole partition. */
  readonly index: number;
  /** The reference radius ranges the leaf's reference touches (2 with a step inside). */
  readonly radii: readonly ExactRange[];
  readonly stepInside: boolean;
  /** Lemma A-R ε (without the R12 family width). */
  readonly epsilon: ExactFraction;
  readonly startEnd?: SeedEnd;
  readonly endEnd?: SeedEnd;
}

/** A flattened seed-arc or circle leaf (T08b-f): its piece and partition index. */
interface SeedLeafRef {
  readonly piece: number;
  readonly leaf: number;
}

/** The recomputed rule-B′ partition of one seed-arc or circle piece. */
interface SeedPartition {
  readonly kind: "arc" | "circle";
  /** Interior split directions (arc) or the eight fixed directions (circle). */
  readonly splits: readonly SplineVector[];
  /** Leaves of the whole partition. */
  readonly count: number;
  readonly removed: readonly [number, number];
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
  readonly arcs: readonly TubeChainArcDeclaration[];
  readonly firstLeaf: readonly number[];
  readonly pieceOf: readonly number[];
  readonly lines: readonly (NeutralLineTube | undefined)[];
  /** Retained leaves per piece. */
  readonly sizes: readonly number[];
  /** Seed-arc / circle leaves (T08b-f); `tubes[k]` is absent there. */
  readonly seeds: readonly (SeedLeafRef | undefined)[];
  readonly partitions: ReadonlyMap<number, SeedPartition>;
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
  scale?: LeafScale,
): TubePieceChainResult {
  const { tubes, closed, modelingTolerance } = request;
  const count = tubes.length;
  // Admission and preallocation guard: charged before any per-tube work.
  budget.operation(64 + 16 * count);
  // [TECH] F12: every leaf is charged (legacy: exactly `count`; a piece
  // chain: its flattened leaves + 1 per declared F1 arc, see
  // `certifyPieceChain`) and so is this precharge; no core work yet.
  scale?.(count + (general?.arcs.length ?? 0));
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
    // Seed-arc / circle leaves are admitted by their own stage (T08b-f).
    if (general?.seeds[index]) continue;
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
      const seed = general.seeds[index];
      const owner =
        general.lines[index]?.distance ??
        (seed
          ? seedTubeOf(general.pieces[seed.piece]!).distance
          : tubes[index]!.reference.distance);
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

  // T08b-f seed arcs and circles (piece path only; never entered without
  // them, so every arc-free charge sequence is unchanged).
  const seedArcs = new Map<number, SeedArc>();
  const seedLeaves = new Map<number, SeedLeaf>();
  if (general && general.partitions.size > 0) {
    const failure = seedStage(general);
    if (failure) return failure;
  }
  /**
   * Seed stage (header T08b-f): admission, the rule-B′ partition re-proved
   * leaf by leaf on BOTH the emitted and the reference wedges, the R′
   * reference radii by end kind, the step, and Lemma A-R per leaf (strict
   * ε < τ). Every exact step charges the one request budget.
   */
  function seedStage(chain: GeneralChain): Failure | null {
    const pieceCount = chain.pieces.length;
    const seedTolerance = exactFromNumber(modelingTolerance, budget);
    const seedOne = exact(1n, 1n, budget);
    const seedTwo = exact(2n, 1n, budget);
    // Every seed bound is rounded up to binary64 (sound; small operands).
    const up = (value: ExactFraction) =>
      exactFromNumber(outwardExactNumber(value, "up", budget), budget);
    const negate = (value: ExactFraction) => negateExact(value, budget);
    const absolute = (value: ExactFraction) =>
      compareExact(value, zero, budget) < 0 ? negate(value) : value;
    const larger = (left: ExactFraction, right: ExactFraction) =>
      compareExact(left, right, budget) >= 0 ? left : right;
    const cross = (u: ExactPoint, v: ExactPoint) => crossExact(u, v, budget);
    const down = (value: ExactFraction) =>
      exactFromNumber(outwardExactNumber(value, "down", budget), budget);
    /**
     * c ≥ |û − v̂| for u·v > 0, from c² = 2(u×v)²/(|u|²|v|²(1 + c₋)) with
     * c₋ = u·v/√⁺(|u|²|v|²) (the tight T3 form), every factor rounded
     * outward to binary64 (numerator up, denominator factors down); null
     * without a positive verified √ bound.
     */
    function seedChord(u: ExactPoint, v: ExactPoint) {
      const along = dot(u, v);
      if (!positive(along)) return null;
      const product = multiplyExact(dot(u, u), dot(v, v), budget);
      const rootProduct = squareRootUpper(product);
      if (!rootProduct) return null;
      const skew = cross(u, v);
      return squareRootUpper(
        divideExact(
          up(multiplyExact(seedTwo, multiplyExact(skew, skew, budget), budget)),
          multiplyExact(
            down(product),
            addExact(
              seedOne,
              down(divideExact(along, rootProduct, budget)),
              budget,
            ),
            budget,
          ),
          budget,
        ),
      );
    }
    const kindOf = (jointIndex: number | null): SeedEnd["kind"] => {
      if (jointIndex === null) return "terminal";
      if (chain.trims.some((trim) => trim.jointIndex === jointIndex))
        return "trim";
      return "join";
    };
    const adjacencyCount = closed ? pieceCount : pieceCount - 1;
    for (const [pieceIndex, partition] of chain.partitions) {
      const piece = chain.pieces[pieceIndex]!;
      const first = chain.firstLeaf[pieceIndex]!;
      const last = first + chain.sizes[pieceIndex]! - 1;
      const fail = (code: string, message: string) =>
        uncertain(code, `Seed arc ${pieceIndex}: ${message}`, first, last);
      const admission = (message: string) =>
        fail("arc-tube-admission-unproven", message);
      const tube = seedTubeOf(piece);
      const center = exactPoint(tube.center);
      const radius = exactFromNumber(tube.radius, budget);
      const distance = exactFromNumber(tube.distance, budget);
      if (!(tube.radius > 0))
        return admission("the emitted radius is not positive.");
      if (partition.kind === "circle") {
        // [TECH] F11: reference radius r − d, emitted fl(r − d) as given.
        if (!Object.is(tube.radius, tube.sourceRadius - tube.distance))
          return admission("the emitted radius is not fl(r − d).");
        const reference = subtractExact(
          exactFromNumber(tube.sourceRadius, budget),
          distance,
          budget,
        );
        if (!positive(reference))
          return fail(
            "arc-tube-collapse",
            "the offset radius r − d is not positive.",
          );
        const epsilon = absolute(subtractExact(radius, reference, budget));
        if (compareExact(epsilon, seedTolerance, budget) >= 0)
          return fail(
            "arc-tube-error-unproven",
            "the circle's emitted radius error is not strictly below the modeling tolerance.",
          );
        const directions = partition.splits.map(exactPoint);
        const arc: SeedArc = {
          piece: pieceIndex,
          kind: "circle",
          center,
          centerValue: tube.center,
          radius,
          radiusValue: tube.radius,
          sigma: 1,
          reversed: false,
          signedDistance: distance,
          emitted: [...directions, directions[0]!],
          reference: [...directions, directions[0]!],
          leaves: [],
          step: zero,
          gaps: [zero, zero],
          removed: [0, 0],
          family: { width: zero, range: [tube.radius, tube.radius] },
          nonRadial: false,
        };
        seedArcs.set(pieceIndex, arc);
        for (let leaf = 0; leaf < partition.count; leaf += 1) {
          arc.leaves.push(first + leaf);
          seedLeaves.set(first + leaf, {
            arc,
            index: leaf,
            radii: [[reference, reference]],
            stepInside: false,
            epsilon,
          });
        }
        continue;
      }
      // Admission (bitwise / float, reject-only): the canonical supports.
      const [startPole, endPole] = tube.emitted;
      const [startSource, endSource] = tube.source;
      const hypot = (point: SplineVector) =>
        Math.hypot(point[0] - tube.center[0], point[1] - tube.center[1]);
      if (!Object.is(tube.radius, hypot(startPole)))
        return admission(
          "the emitted radius is not the canonical hypot(S′ − C) (E7).",
        );
      if (!Object.is(tube.sourceRadius, hypot(startSource)))
        return admission(
          "the source radius is not the canonical hypot(S − C) (E7).",
        );
      const sigma: 1 | -1 = tube.sweep === "counterClockwise" ? 1 : -1;
      const oriented = (value: ExactFraction) =>
        sigma > 0 ? value : negate(value);
      const turn = (u: ExactPoint, v: ExactPoint) => oriented(cross(u, v));
      const a = difference(exactPoint(startPole), center);
      const b = difference(exactPoint(endPole), center);
      const s = difference(exactPoint(startSource), center);
      const e = difference(exactPoint(endSource), center);
      // [TECH] F10: an exactly full turn (a ∥ b, same sense) is never a seed.
      const abTurn = turn(a, b);
      const abZero = compareExact(abTurn, zero, budget) === 0;
      if (abZero && positive(dot(a, b)))
        return admission("a full-turn point-defined arc is not a seed.");
      // [TECH] F10: the consumer's binary64 atan2 sweep must not wrap across
      // 0/2π against the exact wedge (reject-only; never a tolerance): a
      // minor wedge drawn above 3π/2 or a major one below π/2 fails.
      // Rounding across π is harmless and accepted.
      const angle = (point: SplineVector) =>
        Math.atan2(point[1] - tube.center[1], point[0] - tube.center[0]);
      const low = angle(sigma > 0 ? startPole : endPole);
      let high = angle(sigma > 0 ? endPole : startPole);
      while (high <= low) high += 2 * Math.PI;
      const floatSweep = high - low;
      const minor = positive(abTurn);
      if (
        !(floatSweep > 0 && floatSweep < 2 * Math.PI) ||
        (minor && !(floatSweep < 1.5 * Math.PI)) ||
        (!minor && !abZero && !(floatSweep > 0.5 * Math.PI))
      )
        return admission(
          "the consumer's binary64 sweep class disagrees with the exact wedge.",
        );
      // Each end shift < π/2 (fixes the lift of the end map, Lemma A-R).
      if (!positive(dot(a, s)) || !positive(dot(b, e)))
        return admission(
          "an emitted end direction is not within a quarter turn of its source end.",
        );
      // Review R1 (rule B′): every leaf of BOTH wedges has σ(u × v) > 0 and
      // 2u·v > σ(u × v); the half-plane sequence about the first direction
      // never returns (total sweep < 2π).
      const splits = partition.splits.map(exactPoint);
      const emitted = [a, ...splits, b];
      const reference = [s, ...splits, e];
      for (const directions of [emitted, reference]) {
        let half = 0;
        for (let leaf = 0; leaf < partition.count; leaf += 1) {
          const u = directions[leaf]!;
          const v = directions[leaf + 1]!;
          const leafTurn = turn(u, v);
          if (
            !positive(leafTurn) ||
            !positive(
              subtractExact(
                multiplyExact(seedTwo, dot(u, v), budget),
                leafTurn,
                budget,
              ),
            )
          )
            return fail(
              "arc-tube-partition-unproven",
              `leaf ${leaf} is not a rule-B′ leaf of both the emitted and the reference wedges.`,
            );
          const baseTurn = turn(directions[0]!, v);
          const next =
            positive(baseTurn) ||
            (compareExact(baseTurn, zero, budget) === 0 &&
              positive(dot(directions[0]!, v)))
              ? 0
              : 1;
          if (next < half)
            return fail(
              "arc-tube-partition-unproven",
              "the leaf wedges wind past a full turn.",
            );
          half = next;
        }
      }
      // End kinds (natural start / end) and R7 removal only at trims.
      const entry = closed
        ? (pieceIndex - 1 + pieceCount) % pieceCount
        : pieceIndex > 0
          ? pieceIndex - 1
          : null;
      const exit = pieceIndex < adjacencyCount ? pieceIndex : null;
      const [startKind, endKind] = piece.reversed
        ? [kindOf(exit), kindOf(entry)]
        : [kindOf(entry), kindOf(exit)];
      const [headRemoved, tailRemoved] = partition.removed;
      if (
        (headRemoved > 0 && startKind !== "trim") ||
        (tailRemoved > 0 && endKind !== "trim")
      )
        return admission("leaves are removed at an end that is not a trim.");
      // R′ radii (header): r_V = |V − C| at a declared-join end, ρ_s at a
      // trimmed or chain-terminal end; R_V = r_V − σd > 0 or collapse.
      const sourceRadius = exactFromNumber(tube.sourceRadius, budget);
      const signedDistance = sigma > 0 ? distance : negate(distance);
      const sourceSquared = multiplyExact(sourceRadius, sourceRadius, budget);
      const radiusSquared = multiplyExact(radius, radius, budget);
      const shifted = addExact(radius, signedDistance, budget);
      const endData = (
        kind: SeedEnd["kind"],
        removed: boolean,
        source: ExactPoint,
        pole: SplineVector,
        relative: ExactPoint,
        f1: boolean,
      ): SeedEnd | string => {
        const vertexSquared = dot(source, source);
        const lambda = up(
          divideExact(
            absolute(subtractExact(vertexSquared, sourceSquared, budget)),
            sourceRadius,
            budget,
          ),
        );
        let reference: ExactRange;
        let gap: ExactFraction;
        if (kind === "join") {
          if (
            positive(signedDistance) &&
            compareExact(
              multiplyExact(distance, distance, budget),
              vertexSquared,
              budget,
            ) >= 0
          )
            return "collapse";
          const root = squareRoot(vertexSquared);
          if (!root) return "root";
          reference = [
            subtractExact(root[0], signedDistance, budget),
            subtractExact(root[1], signedDistance, budget),
          ];
          // Review A1: |ρ_o − R_V| = |(ρ_o + σd)² − |v|²| / ((ρ_o + σd) + |v|),
          // the only √ in a positive denominator.
          gap = up(
            positive(shifted)
              ? divideExact(
                  absolute(
                    subtractExact(
                      multiplyExact(shifted, shifted, budget),
                      vertexSquared,
                      budget,
                    ),
                  ),
                  addExact(shifted, root[0], budget),
                  budget,
                )
              : larger(
                  absolute(subtractExact(radius, reference[0], budget)),
                  absolute(subtractExact(radius, reference[1], budget)),
                ),
          );
        } else {
          const exactReference = subtractExact(
            sourceRadius,
            signedDistance,
            budget,
          );
          if (!positive(exactReference)) return "collapse";
          reference = [exactReference, exactReference];
          gap = absolute(subtractExact(radius, exactReference, budget));
        }
        const base = {
          kind,
          removed,
          vertex: source,
          relative,
          pole: exactPoint(pole),
          reference,
          gap,
          lambda,
        };
        if (removed)
          return { ...base, chord: zero, connector: zero, vertexSquared };
        // End shift c_V ≥ |p̂ − v̂| (tight T08b-d T3 form) and the radial
        // connector u⁺ = |ρ_o² − |p|²|/ρ_o ≥ |ρ_o − |p||.
        const relativeSquared = dot(relative, relative);
        const chord = seedChord(relative, source);
        if (!chord) return "root";
        const connector = up(
          divideExact(
            absolute(subtractExact(radiusSquared, relativeSquared, budget)),
            radius,
            budget,
          ),
        );
        let bound: ExactFraction | undefined;
        if (kind === "join" && f1) {
          // π_V ≥ |pole − (C + R_V v̂)| ≤ ||p| − r_V + σd| + R_V⁺ c_V, with
          // |p| − |v| = (|p|² − |v|²)/(|p| + |v|) (√ only in the denominator).
          const pRoot = squareRoot(relativeSquared);
          const vRoot = squareRoot(vertexSquared);
          if (!pRoot || !vRoot) return "root";
          const numerator = subtractExact(
            relativeSquared,
            vertexSquared,
            budget,
          );
          const quotients = [
            divideExact(
              numerator,
              addExact(pRoot[0], vRoot[0], budget),
              budget,
            ),
            divideExact(
              numerator,
              addExact(pRoot[1], vRoot[1], budget),
              budget,
            ),
          ].map((value) => absolute(addExact(value, signedDistance, budget)));
          bound = up(
            addExact(
              larger(quotients[0]!, quotients[1]!),
              multiplyExact(reference[1], chord, budget),
              budget,
            ),
          );
        }
        return {
          ...base,
          chord,
          connector,
          vertexSquared,
          ...(bound ? { bound } : {}),
        };
      };
      // π_V is read only by an F1 arc at that end (T08b-e Lemma A).
      const isArc = (jointIndex: number | null) =>
        jointIndex !== null &&
        chain.arcs.some((arc) => arc.jointIndex === jointIndex);
      const [startArc, endArc] = piece.reversed
        ? [isArc(exit), isArc(entry)]
        : [isArc(entry), isArc(exit)];
      const ends = [
        endData(startKind, headRemoved > 0, s, startPole, a, startArc),
        endData(endKind, tailRemoved > 0, e, endPole, b, endArc),
      ] as const;
      for (const end of ends) {
        if (end === "collapse")
          return fail(
            "arc-tube-collapse",
            "an offset reference radius r_V − σd is not positive.",
          );
        if (end === "root")
          return admission("a verified square-root bound is not positive.");
      }
      const [start, end] = ends as readonly [SeedEnd, SeedEnd];
      // The step (R′): r_S = r_E exactly, else a radial step of length
      // |r_E − r_S| at one interior knot of the retained leaves.
      const radiusOf = (data: SeedEnd) =>
        data.kind === "join" ? data.vertexSquared : sourceSquared;
      const stepped =
        compareExact(radiusOf(start), radiusOf(end), budget) !== 0;
      const retained = partition.count - headRemoved - tailRemoved;
      const stepInside = stepped && retained === 1;
      const stepBoundary = stepped
        ? headRemoved + Math.ceil(retained / 2)
        : Number.POSITIVE_INFINITY;
      // Recorded only: |r_E − r_S| ≤ |r_E² − r_S²| / (√⁻r_S² + √⁻r_E²).
      const startRoot = stepped ? squareRoot(radiusOf(start)) : null;
      const endRoot = startRoot && squareRoot(radiusOf(end));
      if (stepped && !endRoot)
        return admission("a verified square-root bound is not positive.");
      const step = endRoot
        ? divideExact(
            absolute(subtractExact(radiusOf(end), radiusOf(start), budget)),
            addExact(startRoot![0], endRoot[0], budget),
            budget,
          )
        : zero;
      const arc: SeedArc = {
        piece: pieceIndex,
        kind: "arc",
        center,
        centerValue: tube.center,
        radius,
        radiusValue: tube.radius,
        sigma,
        reversed: piece.reversed,
        signedDistance,
        emitted,
        reference,
        start,
        end,
        leaves: [],
        step,
        gaps: [start.lambda, end.lambda],
        removed: [headRemoved, tailRemoved],
        family: { width: zero, range: [tube.radius, tube.radius] },
        nonRadial: false,
      };
      seedArcs.set(pieceIndex, arc);
      // Lemma A-R per retained leaf (header): ε_k = max |ρ_o − R| over the
      // leaf's reference radii + R⁺·(end shift) + (radial connector).
      for (
        let leaf = headRemoved;
        leaf < partition.count - tailRemoved;
        leaf += 1
      ) {
        const flattened = first + leaf - headRemoved;
        arc.leaves.push(flattened);
        const radii = stepInside
          ? [start.reference, end.reference]
          : [leaf < stepBoundary ? start.reference : end.reference];
        const gaps = stepInside
          ? [start.gap, end.gap]
          : [leaf < stepBoundary ? start.gap : end.gap];
        let epsilon = gaps.reduce(larger);
        const upper = radii.map((range) => range[1]).reduce(larger);
        const carried = [
          ...(leaf === 0 && !start.removed ? [start] : []),
          ...(leaf === partition.count - 1 && !end.removed ? [end] : []),
        ];
        if (carried.length > 0) {
          epsilon = addExact(
            epsilon,
            addExact(
              multiplyExact(
                upper,
                carried.map((data) => data.chord).reduce(larger),
                budget,
              ),
              carried.map((data) => data.connector).reduce(larger),
              budget,
            ),
            budget,
          );
        }
        epsilon = up(epsilon);
        if (compareExact(epsilon, seedTolerance, budget) >= 0)
          return fail(
            "arc-tube-error-unproven",
            `leaf ${leaf}: the Lemma A-R error (radial gap, step, end shift, connector) is not strictly below the modeling tolerance.`,
          );
        seedLeaves.set(flattened, {
          arc,
          index: leaf,
          radii,
          stepInside,
          epsilon,
          ...(leaf === 0 && !start.removed ? { startEnd: start } : {}),
          ...(leaf === partition.count - 1 && !end.removed
            ? { endEnd: end }
            : {}),
        });
      }
    }
    return null;
  }
  const seedDummy: ExactCubic = [
    [zero, zero],
    [zero, zero],
    [zero, zero],
    [zero, zero],
  ];
  const poles: ExactCubic[] = tubes.map((tube, index) =>
    seedLeaves.has(index)
      ? seedDummy
      : (lineData.get(index)?.poles ??
        (tube.poles.map(exactPoint) as unknown as ExactCubic)),
  );
  const hodographs = poles.map((cubic, index) =>
    seedLeaves.has(index)
      ? []
      : [0, 1, 2].map((pole) => difference(cubic[pole + 1]!, cubic[pole]!)),
  );
  const derivatives = tubes.map((tube, index) =>
    seedLeaves.has(index)
      ? [
          [zero, zero],
          [zero, zero],
        ]
      : (lineData.get(index)?.box ??
        tube.reference.derivative.map((axis) => [
          exactFromNumber(axis[0], budget),
          exactFromNumber(axis[1], budget),
        ])),
  );
  const errors = tubes.map(
    (tube, index) =>
      seedLeaves.get(index)?.epsilon ??
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
  /** T08b-f: review-R5 J2′ data of a seed terminal leaf (vertex path). */
  const seedJ2Data = new Map<
    number,
    {
      readonly rate: ExactRange;
      readonly minimumAdvance: ExactFraction;
      readonly maximumSpeed: ExactFraction;
    }
  >();
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
    /**
     * T08b-f seed vertices only: outward binary64 rounding of interval
     * bounds (`range`) and of upper bounds (`up`). Sound; absent on every
     * arc-free vertex and knot, whose charge sequences are unchanged.
     */
    round?: {
      readonly range: (value: ExactRange) => ExactRange;
      readonly up: (value: ExactFraction) => ExactFraction;
    },
  ):
    | { readonly trim: ExactRange; readonly tail: ExactRange }
    | keyof typeof J2_MESSAGES => {
    const tight = (value: ExactRange) => (round ? round.range(value) : value);
    const eSquared = dot(e, e);
    const concaveLeaf = (index: number, cone: ExactRange) => {
      // A seed leaf reads its exact κ/λ data (R5), not the cubic enclosure.
      const seedData = seedJ2Data.get(index);
      if (seedData)
        return {
          rate: reversedLeaves?.has(index)
            ? rangeNegate(seedData.rate)
            : seedData.rate,
          minimumAdvance: seedData.minimumAdvance,
          maximumSpeed: seedData.maximumSpeed,
        };
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
      const rateValue = tight(slopeRate);
      return {
        // Traversal slope rate: a reversed leaf's cross(R′, R″) flips while
        // e·R′ is its signed cone (vertex path only; knots are natural).
        rate: reversedLeaves?.has(index) ? rangeNegate(rateValue) : rateValue,
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
    const overlap = tight(rangeMultiply(point(distance), tight(unitGap)));
    if (
      !positive(overlap[0]) ||
      compareExact(overlap[1], leafFirst.minimumAdvance, budget) >= 0 ||
      compareExact(overlap[1], leafSecond.minimumAdvance, budget) >= 0
    )
      return "window" as const;
    const slope = (vector: ExactPoint, along: ExactFraction) =>
      divideExact(crossExact(e, vector, budget), along, budget);
    const slopeGapValue = subtractExact(
      slope(incoming, alongIncoming),
      slope(outgoing, alongOutgoing),
      budget,
    );
    const slopeGap = tight(point(slopeGapValue));
    const ratio = squareRoot(
      divideExact(outgoingSquared, incomingSquared, budget),
    );
    const inverseRatio =
      ratio &&
      squareRoot(divideExact(incomingSquared, outgoingSquared, budget));
    if (!ratio || !inverseRatio) return "root" as const;
    const scaledCross = point(multiplyExact(eSquared, cross, budget));
    const chordFromIncomingRaw = rangeDividePositive(
      scaledCross,
      rangeMultiply(
        point(alongIncoming),
        rangeAdd(
          rangeMultiply(ratio, point(alongIncoming)),
          point(alongOutgoing),
        ),
      ),
    );
    const chordToOutgoingRaw = rangeDividePositive(
      scaledCross,
      rangeMultiply(
        point(alongOutgoing),
        rangeAdd(
          point(alongIncoming),
          rangeMultiply(inverseRatio, point(alongOutgoing)),
        ),
      ),
    );
    if (!chordFromIncomingRaw || !chordToOutgoingRaw) return "root" as const;
    const chordFromIncoming = tight(chordFromIncomingRaw);
    const chordToOutgoing = tight(chordToOutgoingRaw);
    const rateHull: ExactRange = [
      minimum([leafFirst.rate[0], leafSecond.rate[0]]),
      maximum([leafFirst.rate[1], leafSecond.rate[1]]),
    ];
    if (
      !excludesZero(
        tight(rangeSubtract(slopeGap, tight(rangeMultiply(overlap, rateHull)))),
      )
    )
      return "unique" as const;
    const halfOverlap = tight(rangeMultiply(overlap, point(half)));
    const atB = tight(
      rangeAdd(
        chordFromIncoming,
        tight(rangeMultiply(halfOverlap, leafFirst.rate)),
      ),
    );
    const atA = tight(
      rangeSubtract(
        rangeNegate(chordToOutgoing),
        tight(rangeMultiply(halfOverlap, leafSecond.rate)),
      ),
    );
    if (
      !excludesZero(atB) ||
      !excludesZero(atA) ||
      positive(atB[0]) === positive(atA[0])
    )
      return "exists" as const;
    const roundUp = (value: ExactFraction) => (round ? round.up(value) : value);
    const trim: ExactRange = [
      roundUp(divideExact(overlap[1], leafFirst.minimumAdvance, budget)),
      roundUp(divideExact(overlap[1], leafSecond.minimumAdvance, budget)),
    ];
    const tail: ExactRange = [
      roundUp(multiplyExact(leafFirst.maximumSpeed, trim[0], budget)),
      roundUp(multiplyExact(leafSecond.maximumSpeed, trim[1], budget)),
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
      /**
       * T08b-g5d glue fallback (k ≥ 2, review R14): the leaf's exact e-dot
       * poles, the natural side of its vertex and its trim report.
       */
      readonly poleX: readonly ExactFraction[];
      readonly vertexSide: "start" | "end";
      readonly report: number;
      readonly sideIndex: 0 | 1;
      /** A deep S2 side: only there may k ≥ 2 run (pre-g5d verdicts kept). */
      readonly deep: boolean;
    }[]
  >();
  /**
   * T08b-g5d (U-G6): cubic leaves wholly removed by deep trims, each proved
   * by the Lemma T-W window cone or the deep S2 covering. Not part of E or
   * O*: no composition, and K3-exempt except a deep S2 removed leaf against
   * its partner piece's non-window leaves (`removedPartners`, review R13:
   * that rule wins over the own-piece exemption on a self-trim).
   */
  const removedLeaves = new Set<number>();
  const removedPartners = new Map<
    number,
    { readonly piece: number; readonly window: ReadonlySet<number> }
  >();
  /** Lemma-T trims with their one-shot Q4-E1 local upgrade (leaf loop). */
  const lemmaTrims: {
    readonly leaves: readonly [number, number];
    readonly upgrade: () => boolean;
  }[] = [];
  const lineJointStart: (ExactFraction | undefined)[] = [];
  const lineJointEnd: (ExactFraction | undefined)[] = [];
  // F1 arcs (T08b-e): arc leaf k is flattened after every piece leaf, at
  // count + k [TECH E3]; each is one sub-arc wedge [from, to] (sweep < π/2)
  // of centre V and the given radius ρ, hulled with the radial connector end
  // it carries (A′ on the entry leaf, B′ on the exit leaf).
  const arcLeaves: ArcWedge[] = [];
  const arcStars: ExactFraction[] = [];
  const arcReports: TubeChainArcJoin[] = [];
  const arcRecords: TubeChainArcRecord[] = [];
  /** Arc attribution of K3 pairs: arc leaf → jointIndex, and (P, Q) pairs. */
  const arcNeighbours = new Map<string, number>();
  /** T08b-f: far-end boxes of Lemma-W segments, per seed leaf and natural side. */
  const seedHulls = new Map<
    number,
    { start?: readonly ExactRange[]; end?: readonly ExactRange[] }
  >();
  /** T08b-f Lemma-T° cut per seed leaf and natural side (composition). */
  const seedCuts = new Map<
    number,
    {
      start?: {
        chord: ExactFraction;
        wedge: readonly [ExactPoint, ExactPoint];
      };
      end?: { chord: ExactFraction; wedge: readonly [ExactPoint, ExactPoint] };
    }
  >();
  const seedTrimReports: TubeChainArcTrimJoin[] = [];
  /** Lemma-T° line trims whose other monotone side is not excluded (T°2 pairs). */
  const linePairs: {
    readonly leaf: number;
    readonly side: "start" | "end";
    readonly piece: number;
    readonly radius: ExactFraction;
    readonly low: readonly (boolean | undefined)[];
    /**
     * T08b-g7 (T°2′): every unexcluded rest side is wedge-clear, so the
     * entry needs no partner (it still partners another entry). Metered,
     * and run only for an entry with no opposite partner, so a pairing
     * certificate's charge sequence is unchanged.
     */
    readonly wedgeClear: () => boolean;
  }[] = [];
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
    /**
     * Traversal-terminal leaf of a piece and the natural side it ends on;
     * T08b-g5d: `offset` leaves inward (a deep trim leaf, offset < size).
     */
    const terminal = (pieceIndex: number, exiting: boolean, offset = 0) => {
      const piece = general.pieces[pieceIndex]!;
      const first = general.firstLeaf[pieceIndex]!;
      const size = general.sizes[pieceIndex]!;
      const naturalEnd = exiting !== piece.reversed;
      return {
        leaf: naturalEnd ? first + size - 1 - offset : first + offset,
        side: naturalEnd ? ("end" as const) : ("start" as const),
        reversed: piece.reversed,
      };
    };
    type Terminal = ReturnType<typeof terminal>;
    /**
     * T08b-g5d: a deep trim's chain-vertex leaves and its removed leaves per
     * side, from the vertex inward (empty on a side whose trim leaf is its
     * traversal terminal).
     */
    interface DeepWindow {
      readonly firstVertex: Terminal;
      readonly secondVertex: Terminal;
      readonly removedFirst: readonly number[];
      readonly removedSecond: readonly number[];
    }
    const rotate = (vector: ExactPoint): ExactPoint => [
      negateExact(vector[1], budget),
      vector[0],
    ];
    const nearestValue = (value: ExactPoint): SplineVector => [
      exactToNumber(value[0], budget),
      exactToNumber(value[1], budget),
    ];
    // T08b-f: seed-only bounds are rounded outward to binary64 (lower bounds
    // down, upper bounds up): sound, and it keeps every operand small.
    const lower = (value: ExactFraction) =>
      exactFromNumber(outwardExactNumber(value, "down", budget), budget);
    const upper = (value: ExactFraction) =>
      exactFromNumber(outwardExactNumber(value, "up", budget), budget);
    const outward = (range: ExactRange): ExactRange => [
      lower(range[0]),
      upper(range[1]),
    ];
    /** The natural seed end (T08b-f) a traversal terminal reaches. */
    const seedEndOf = (end: Terminal) => {
      const seed = seedLeaves.get(end.leaf);
      return seed && (end.side === "end" ? seed.arc.end : seed.arc.start);
    };
    /**
     * T08b-f natural wedge boundaries of a seed leaf: the emitted and the
     * reference [from, to] (shared split directions inside the arc).
     */
    const seedWedges = (seed: SeedLeaf) =>
      [
        [seed.arc.emitted[seed.index]!, seed.arc.emitted[seed.index + 1]!],
        [seed.arc.reference[seed.index]!, seed.arc.reference[seed.index + 1]!],
      ] as const;
    /** e_l·σrot(w) = σ·(w × e_l): the natural tangent's e-dot (unnormalized). */
    const seedAlong = (seed: SeedLeaf, w: ExactPoint, signed: ExactPoint) => {
      const value = crossExact(w, signed, budget);
      return seed.arc.sigma > 0 ? value : negateExact(value, budget);
    };
    /**
     * K1-wedge (header T08b-f): the seed leaf is a strict traversal e-graph
     * on BOTH its emitted and reference wedges iff e_l·σrot(w) > 0 at the
     * four exact boundary directions (linear in w, sweep < π).
     */
    const seedInsideCone = (end: Terminal, e: ExactPoint) => {
      const seed = seedLeaves.get(end.leaf)!;
      const signed = end.reversed ? negated(e) : e;
      return seedWedges(seed).every((pair) =>
        pair.every((w) => positive(seedAlong(seed, w, signed))),
      );
    };
    /** The reference wedge's minimum of e_l·σrot(w) (sign only; T08b-e R2). */
    const seedReferenceAlong = (end: Terminal, e: ExactPoint) => {
      const seed = seedLeaves.get(end.leaf)!;
      const signed = end.reversed ? negated(e) : e;
      return minimum(
        seedWedges(seed)[1].map((w) => seedAlong(seed, w, signed)),
      );
    };
    // Unit-direction enclosures (one verified √ per direction, cached).
    const seedUnits = new Map<ExactPoint, readonly ExactRange[] | null>();
    const seedUnit = (direction: ExactPoint) => {
      const cached = seedUnits.get(direction);
      if (cached !== undefined) return cached;
      const length = squareRoot(dot(direction, direction));
      const result =
        length &&
        ([0, 1] as const).map((axis): ExactRange => {
          const near = divideExact(direction[axis], length[1], budget);
          const far = divideExact(direction[axis], length[0], budget);
          return outward(
            compareExact(near, far, budget) <= 0 ? [near, far] : [far, near],
          );
        });
      seedUnits.set(direction, result);
      return result;
    };
    /** Exact box of C + ρ·x/|x| (ρ exact), or null without a √ bound. */
    const seedPointBox = (
      center: ExactPoint,
      radius: ExactFraction,
      direction: ExactPoint,
    ): ExactRange[] | null => {
      const unit = seedUnit(direction);
      return (
        unit &&
        ([0, 1] as const).map(
          (axis): ExactRange => [
            addExact(
              center[axis],
              multiplyExact(radius, unit[axis]![0], budget),
              budget,
            ),
            addExact(
              center[axis],
              multiplyExact(radius, unit[axis]![1], budget),
              budget,
            ),
          ],
        )
      );
    };
    /**
     * Review R5 J2′ data of a seed terminal leaf at a vertex end (header):
     * the reference circle through V (source radius r = r_V, offset R = R_V)
     * over the reference wedge [u, w] in the linear-angle parameter; exact
     * κ = σ/r and λ = R/r (never from the cross/speed³ interval), Δ ∈
     * [sin Δ, tan Δ], e·R′ = rΔ·c with c = e_l·σrot(ŵ) whose hull takes the
     * interior maximum |e| (the arcBox trick), Δ_lo for minimumAdvance and
     * Δ_hi for maximumSpeed; slope rate e²κ/(λc³) = e²σ/(R c³).
     */
    const seedJ2 = (
      end: Terminal,
      e: ExactPoint,
      concave: boolean,
    ):
      | {
          readonly cone: ExactRange;
          readonly rate: ExactRange;
          readonly minimumAdvance: ExactFraction;
          readonly maximumSpeed: ExactFraction;
        }
      | "root"
      | "cone" => {
      const seed = seedLeaves.get(end.leaf)!;
      const data = seedEndOf(end)!;
      const signed = end.reversed ? negated(e) : e;
      const radius = squareRoot(data.vertexSquared);
      if (!radius) return "root";
      const orientedTurn = (x: ExactPoint, y: ExactPoint) =>
        seed.arc.sigma > 0
          ? crossExact(x, y, budget)
          : negateExact(crossExact(x, y, budget), budget);
      const along = (unit: readonly ExactRange[]) => {
        const value = rangeSubtract(
          rangeMultiply(unit[0]!, point(signed[1])),
          rangeMultiply(unit[1]!, point(signed[0])),
        );
        return seed.arc.sigma > 0 ? value : rangeNegate(value);
      };
      /**
       * Δ ∈ [sin Δ, tan Δ] and the hull of c = e_l·σrot(ŵ) over one exact
       * wedge [u, w] of sweep < π/2 (min at an end; max |e| when the peak
       * direction σ·(e_y, −e_x) is inside, else at an end).
       */
      const wedgeData = (u: ExactPoint, w: ExactPoint) => {
        const turn = orientedTurn(u, w);
        const rootProduct = squareRootUpper(
          multiplyExact(dot(u, u), dot(w, w), budget),
        );
        const unitFrom = seedUnit(u);
        const unitTo = seedUnit(w);
        if (!rootProduct || !unitFrom || !unitTo) return null;
        const ends = [along(unitFrom), along(unitTo)];
        const coneLow = minimum(ends.map((range) => range[0]));
        const peakBase: ExactPoint = [
          signed[1],
          negateExact(signed[0], budget),
        ];
        const peak = seed.arc.sigma > 0 ? peakBase : negated(peakBase);
        const peakInside =
          positive(orientedTurn(u, peak)) && positive(orientedTurn(peak, w));
        const norm = peakInside ? squareRootUpper(dot(signed, signed)) : null;
        if (peakInside && !norm) return null;
        return {
          low: lower(divideExact(turn, rootProduct, budget)),
          high: upper(divideExact(turn, dot(u, w), budget)),
          coneLow: lower(coneLow),
          coneHigh: upper(norm ?? maximum(ends.map((range) => range[1]))),
        };
      };
      const [u, w] = seedWedges(seed)[1];
      const leafWide = wedgeData(u, w);
      if (!leafWide) return "root";
      if (!positive(leafWide.coneLow)) return "cone";
      const cone: ExactRange = outward([
        multiplyExact(
          multiplyExact(radius[0], leafWide.low, budget),
          leafWide.coneLow,
          budget,
        ),
        multiplyExact(
          multiplyExact(radius[1], leafWide.high, budget),
          leafWide.coneHigh,
          budget,
        ),
      ]);
      // A convex vertex reads only the cone (Lemma G2).
      if (!concave)
        return { cone, rate: cone, minimumAdvance: zero, maximumSpeed: zero };
      // Only the overlap window next to V matters: the rate, advance and
      // speed are taken on the vertex-anchored sub-wedge of 1/8 of the leaf
      // (three exactly admitted near-bisections), a leaf of its own in the
      // sub-wedge's linear-angle parameter; concaveJ2 checks the window
      // lies inside it (overlap < its advance), and its fractions bound
      // the leaf's from above.
      let near: readonly [ExactPoint, ExactPoint] = [u, w];
      for (let step = 0; step < 3; step += 1) {
        const approximate = (value: ExactPoint) => {
          const x = exactToNumber(value[0], budget);
          const y = exactToNumber(value[1], budget);
          const length = Math.hypot(x, y);
          return [x / length, y / length] as const;
        };
        const from = approximate(near[0]);
        const to = approximate(near[1]);
        const middle: SplineVector = [from[0] + to[0], from[1] + to[1]];
        if (!middle.every(Number.isFinite)) return "root";
        const direction = exactPoint(middle);
        if (
          !positive(orientedTurn(near[0], direction)) ||
          !positive(orientedTurn(direction, near[1]))
        )
          return "root";
        near =
          end.side === "start" ? [near[0], direction] : [direction, near[1]];
      }
      const window = wedgeData(near[0], near[1]);
      if (!window) return "root";
      const reference = data.reference;
      const eSquared = dot(signed, signed);
      const cube = (value: ExactFraction) =>
        multiplyExact(multiplyExact(value, value, budget), value, budget);
      const rate: ExactRange = outward([
        divideExact(
          eSquared,
          multiplyExact(reference[1], cube(window.coneHigh), budget),
          budget,
        ),
        divideExact(
          eSquared,
          multiplyExact(reference[0], cube(window.coneLow), budget),
          budget,
        ),
      ]);
      return {
        cone,
        rate: seed.arc.sigma > 0 ? rate : rangeNegate(rate),
        minimumAdvance: lower(
          multiplyExact(
            multiplyExact(reference[0], window.low, budget),
            window.coneLow,
            budget,
          ),
        ),
        maximumSpeed: upper(multiplyExact(reference[1], window.high, budget)),
      };
    };
    /** Traversal slope hull of a circle leaf's tangents over its wedge in e. */
    const wedgeSlopes = (
      sigma: 1 | -1,
      reversed: boolean,
      wedge: readonly [ExactPoint, ExactPoint],
      e: ExactPoint,
    ): ExactRange | null => {
      const values: ExactFraction[] = [];
      for (const w of wedge) {
        const tangentBase = rotate(w);
        const tangent =
          sigma > 0 !== reversed ? tangentBase : negated(tangentBase);
        const along = dot(e, tangent);
        if (!positive(along)) return null;
        values.push(divideExact(crossExact(e, tangent, budget), along, budget));
      }
      return hull(values);
    };
    /**
     * Lemma W (header T08b-f) on the realization segment between two consumer
     * ends of circles (Cᵢ, ρᵢ) through one shared pole Z, rationalized (review
     * R4): Êᵢ = Z − αᵢxᵢ with xᵢ = Z − Cᵢ exact and αᵢ = (|xᵢ|² − ρᵢ²) /
     * (|xᵢ|(|xᵢ| + ρᵢ)) (√ only in a positive denominator), so v = α₁x₁ −
     * α₂x₂; two irrational points are never subtracted. Exactly collinear
     * x₁, x₂ ⊥ e is the structural vertical. Returns the kind, or null.
     */
    const junction = (
      pole: ExactPoint,
      ends: readonly (readonly [ExactPoint, ExactFraction])[],
      e: ExactPoint,
      slopes: readonly [ExactRange, ExactRange],
    ): {
      readonly kind: "vertical" | "steep";
      /** x₁ ∥ x₂ ⊥ e exactly: vertical for every radius (structural). */
      readonly radial: boolean;
    } | null => {
      budget.operation(JUNCTION_PRECHARGE);
      const [x1, x2] = ends.map(([center]) => difference(pole, center)) as [
        ExactPoint,
        ExactPoint,
      ];
      const alphas: ExactRange[] = [];
      for (const [index, x] of [x1, x2].entries()) {
        const radius = ends[index]![1];
        const squared = dot(x, x);
        const length = squareRoot(squared);
        if (!length) return null;
        const numerator = subtractExact(
          squared,
          multiplyExact(radius, radius, budget),
          budget,
        );
        const denominators = length.map((value) =>
          multiplyExact(value, addExact(value, radius, budget), budget),
        );
        const quotients = denominators.map((value) =>
          divideExact(numerator, value, budget),
        );
        alphas.push(hull(quotients));
      }
      const along = (x: ExactPoint) => point(dot(e, x));
      const across = (x: ExactPoint) => point(crossExact(e, x, budget));
      const eDot = rangeSubtract(
        rangeMultiply(alphas[0]!, along(x1)),
        rangeMultiply(alphas[1]!, along(x2)),
      );
      const eCross = rangeSubtract(
        rangeMultiply(alphas[0]!, across(x1)),
        rangeMultiply(alphas[1]!, across(x2)),
      );
      const collinear =
        compareExact(crossExact(x1, x2, budget), zero, budget) === 0 &&
        compareExact(dot(e, x1), zero, budget) === 0;
      if (collinear) return { kind: "vertical", radial: true };
      if (
        compareExact(eDot[0], zero, budget) === 0 &&
        compareExact(eDot[1], zero, budget) === 0
      )
        return { kind: "vertical", radial: false };
      // (W0) e·v ≥ 0 throughout.
      if (!negative(eDot[0])) return { kind: "steep", radial: false };
      const smallest = minimum([slopes[0][0], slopes[1][0]]);
      const largest = maximum([slopes[0][1], slopes[1][1]]);
      // (W1) e×v > 0 and (e×v)/(e·v) < min α wherever e·v < 0.
      if (
        positive(eCross[0]) &&
        compareExact(
          eCross[0],
          maximum([multiplyExact(smallest, eDot[0], budget), zero]),
          budget,
        ) > 0
      )
        return { kind: "steep", radial: false };
      // (W2) e×v < 0 and (e×v)/(e·v) > max β wherever e·v < 0.
      if (
        negative(eCross[1]) &&
        compareExact(
          eCross[1],
          minimum([multiplyExact(largest, eDot[0], budget), zero]),
          budget,
        ) < 0
      )
        return { kind: "steep", radial: false };
      return null;
    };
    const seedHull = (
      leaf: number,
      side: "start" | "end",
      box: readonly ExactRange[],
    ) => {
      const entry = seedHulls.get(leaf) ?? {};
      entry[side] = box;
      seedHulls.set(leaf, entry);
    };
    /** Exact traversal source tangent at the vertex; null when not proved. */
    const vertexTangent = (end: Terminal): ExactPoint | null => {
      const seedEnd = seedEndOf(end);
      if (seedEnd) {
        // A seed arc's reference circle at V: σ_s·rot(V − C) (F3), exact.
        const tangent =
          seedLeaves.get(end.leaf)!.arc.sigma > 0
            ? rotate(seedEnd.vertex)
            : negated(rotate(seedEnd.vertex));
        return end.reversed ? negated(tangent) : tangent;
      }
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
     *
     * T08b-g5d deep S2 (`deep`, a trim leaf offset > 0 on either side): the
     * windows A₀ … A_I, B₀ … B_J end at the trim leaves `firstEnd` /
     * `secondEnd`, all inside the terminal source span (checked by the
     * caller). G1 on the trim leaves only; G2 on every window leaf; Lemma P
     * as a covering from the chain vertex over the removed leaves into the
     * trim leaf, H clipped to the windows' x-overlap; fix (a): the Lemma-X
     * margins at the TRIM leaves' vertex-side knot poles, so Σ lies inside
     * the x-ranges of A_I and B_J; no Q4-E1 local branch. `unitChords`: the
     * e fallback (sum of binary64-normalized chords), tried only after the
     * raw chords failed G1, G2 or Lemma V (`retryable`).
     */
    const graphTrim = (
      declaration: PieceTubeChainRequest["trims"][number],
      firstEnd: Terminal,
      secondEnd: Terminal,
      fail: (code: string, message: string, magnitude?: true) => Failure,
      deep: DeepWindow | null,
      unitChords: boolean,
      retryable: WeakSet<Failure>,
    ): Failure | null => {
      const WINDOW = "trim-window-unproven";
      const CLASSIFICATION = "trim-classification-unproven";
      const EXISTENCE = "trim-existence-unproven";
      const COMPOSITION = "trim-composition-unproven";
      /** A G1, G2 or Lemma V failure: the e fallback may retry it. */
      const retry = (failure: Failure) => {
        retryable.add(failure);
        return failure;
      };
      // e: binary64 sum of both traversal emitted chords (uncharged, as K1);
      // T08b-g5d fallback: of both binary64-normalized chords.
      const direction: [number, number] = [0, 0];
      for (const end of [firstEnd, secondEnd]) {
        const cubic = tubes[end.leaf]!.poles;
        const sign = end.reversed ? -1 : 1;
        const chord = [
          cubic[3]![0] - cubic[0]![0],
          cubic[3]![1] - cubic[0]![1],
        ] as const;
        const length = unitChords ? Math.hypot(chord[0], chord[1]) : 1;
        direction[0] += (sign * chord[0]) / length;
        direction[1] += (sign * chord[1]) / length;
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
      if (typeof first === "string") return retry(fail(WINDOW, first));
      const second = terminalData(secondEnd);
      if (typeof second === "string") return retry(fail(WINDOW, second));
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
       * T08b-g5d deep Lemma P covering of one side: from the chain vertex over
       * the removed leaves (whole leaves: G2 on the true O′ box, advance =
       * min e·O′ · width, slopes = exact source restriction ∩ box) into the
       * trim leaf with fraction t < 1 rounded up, or the whole window when
       * the clip is this side's own far end. A string names the failure.
       */
      const deepCovering = (
        side: Side,
        removed: readonly number[],
        width: ExactFraction,
        whole: boolean,
      ):
        | "G2"
        | "t"
        | "cone"
        | { readonly low: ExactFraction; readonly high: ExactFraction } => {
        const { signed } = side;
        let covered = zero;
        let low: ExactFraction | null = null;
        let high: ExactFraction | null = null;
        const add = (range: readonly [ExactFraction, ExactFraction]) => {
          low = low ? minimum([low, range[0]]) : range[0];
          high = high ? maximum([high, range[1]]) : range[1];
        };
        for (const leaf of removed) {
          budget.operation(DEEP_COVERING_PRECHARGE);
          const box = derivatives[leaf]!;
          const corner: ExactPoint = [
            box[0]![positive(signed[0]) ? 0 : 1]!,
            box[1]![positive(signed[1]) ? 0 : 1]!,
          ];
          const along = dot(signed, corner);
          if (!positive(along)) return "G2";
          const source = leafSource(leaf);
          const leafWidth = subtractExact(source.high, source.low, budget);
          const advance = multiplyExact(along, leafWidth, budget);
          const corners = box[0]!.flatMap((x) =>
            box[1]!.map((y): ExactPoint => [x, y]),
          );
          const boxSlopes = hull(corners.map(slope));
          const remaining = subtractExact(width, covered, budget);
          const done = !whole && compareExact(advance, remaining, budget) >= 0;
          const t = done
            ? exactFromNumber(
                up(divideExact(remaining, advance, budget)),
                budget,
              )
            : one;
          if (done && compareExact(t, one, budget) >= 0) return "t";
          // The natural vertex-end window [1 − t, 1] or [0, t] of this leaf.
          const [from, to] =
            side.end.side === "end"
              ? [subtractExact(one, t, budget), one]
              : [zero, t];
          const at = (value: ExactFraction) =>
            addExact(
              source.low,
              multiplyExact(value, leafWidth, budget),
              budget,
            );
          const restricted = restrict(source.poles, at(from), at(to));
          const steps = [0, 1, 2].map((index) =>
            difference(restricted[index + 1]!, restricted[index]!),
          );
          if (!steps.every((step) => positive(dot(signed, step))))
            return "cone";
          const refined = hull(steps.map(slope));
          add([
            maximum([refined[0], boxSlopes[0]]),
            minimum([refined[1], boxSlopes[1]]),
          ]);
          if (done) return { low: low!, high: high! };
          covered = addExact(covered, advance, budget);
        }
        const fraction = whole
          ? 1
          : up(
              divideExact(
                subtractExact(width, covered, budget),
                side.advance,
                budget,
              ),
            );
        if (!whole && !(fraction < 1)) return "t";
        const refined = trueWindow(side, fraction);
        if (!refined) return "cone";
        add(refined);
        return { low: low!, high: high! };
      };
      /**
       * Lemma P window from the vertex errors: H ⊇ [α_Q, β_P]; t = |H|/adv_O
       * rounded up, t < 1; σ > 0 on the exact vertex-end source windows.
       * T08b-g5d deep: H from the CHAIN vertex leaves, clipped to the
       * windows' x-overlap, each side covered by `deepCovering` (review O3).
       */
      const lemmaP = (
        vertex: Pair,
      ):
        | Failure
        | {
            readonly separation: ExactFraction;
            readonly leftTurn: boolean;
          } => {
        if (deep) {
          const chainVertex = (end: Terminal) =>
            dot(e, poles[end.leaf]![end.side === "end" ? 3 : 0]!);
          const deepLow = subtractExact(
            chainVertex(deep.secondVertex),
            multiplyExact(eUpper, errors[deep.secondVertex.leaf]!, budget),
            budget,
          );
          const deepHigh = addExact(
            chainVertex(deep.firstVertex),
            multiplyExact(eUpper, errors[deep.firstVertex.leaf]!, budget),
            budget,
          );
          if (!positive(subtractExact(deepHigh, deepLow, budget)))
            return fail(
              EXISTENCE,
              "The true terminal offsets are not proved to overlap at the vertex.",
            );
          // Each window's own far x-end (P reaches down, Q up), with ε.
          const farX = (side: Side) =>
            dot(e, poles[side.end.leaf]![side.end.side === "end" ? 0 : 3]!);
          const firstFar = subtractExact(
            farX(first),
            multiplyExact(eUpper, first.error, budget),
            budget,
          );
          const secondFar = addExact(
            farX(second),
            multiplyExact(eUpper, second.error, budget),
            budget,
          );
          const firstWhole = compareExact(firstFar, deepLow, budget) >= 0;
          const secondWhole = compareExact(secondFar, deepHigh, budget) <= 0;
          const lowClip = firstWhole ? firstFar : deepLow;
          const highClip = secondWhole ? secondFar : deepHigh;
          if (compareExact(lowClip, highClip, budget) >= 0)
            return fail(
              EXISTENCE,
              "The deep trim windows' x-ranges are not proved to overlap.",
            );
          const covering = [
            deepCovering(
              first,
              deep.removedFirst,
              subtractExact(deepHigh, lowClip, budget),
              firstWhole,
            ),
          ];
          if (typeof covering[0] !== "string")
            covering.push(
              deepCovering(
                second,
                deep.removedSecond,
                subtractExact(highClip, deepLow, budget),
                secondWhole,
              ),
            );
          const failed = covering.find((item) => typeof item === "string");
          if (failed === "t")
            return fail(
              WINDOW,
              "The deep trim window is not proved covered by its window leaves (t ≥ 1).",
              true,
            );
          if (failed === "G2")
            return retry(
              fail(
                WINDOW,
                "The true offset derivative box of a removed window leaf is not proved inside the graph cone e (G2).",
              ),
            );
          if (failed === "cone")
            return fail(
              CLASSIFICATION,
              "The source hodograph is not proved inside the graph cone on a deep trim window leaf.",
            );
          const [firstHull, secondHull] = covering as {
            readonly low: ExactFraction;
            readonly high: ExactFraction;
          }[];
          const deepLeft = positive(distance);
          const deepSeparation = deepLeft
            ? subtractExact(secondHull!.low, firstHull!.high, budget)
            : subtractExact(firstHull!.low, secondHull!.high, budget);
          if (!positive(deepSeparation))
            return fail(
              CLASSIFICATION,
              "The true slopes are not proved separated on the deep trim windows.",
            );
          return { separation: deepSeparation, leftTurn: deepLeft };
        }
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
      // T08b-g5d review R12 (uncharged binary64 comparisons, exact): the
      // stored bounds map strictly inside the named leaf, 0 < from ≤ to < 1
      // (never an extrapolation of its polynomial; a wrong leaf offset fails).
      const inside = (side: Side, bounds: readonly [number, number]) => {
        const domain = (tubes[side.end.leaf] as NeutralCubicPieceTube)
          .queryDomain;
        return (
          bounds[0] > domain[0] &&
          bounds[0] <= bounds[1] &&
          bounds[1] < domain[1]
        );
      };
      if (
        !inside(first, declaration.firstParameterBounds) ||
        !inside(second, declaration.secondParameterBounds)
      )
        return fail(
          WINDOW,
          "The stored witness bounds are not strictly inside the trim leaf.",
        );
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
        return retry(
          fail(
            COMPOSITION,
            "The vertical graph deviation exceeds the modeling tolerance.",
            true,
          ),
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
      // The Q4-E1 local branch stays off on deep windows (review A5).
      const located = leafWideLocated
        ? { ...leafWideLocated, separation: window.separation }
        : deep
          ? null
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
      const report = trimReports.length;
      for (const [
        side,
        exiting,
        ownSquared,
        ownUpper,
        otherUpper,
        sideIndex,
      ] of [
        [first, true, firstSquared, firstUpper, secondUpper, 0],
        [second, false, secondSquared, secondUpper, firstUpper, 1],
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
          poleX: x,
          vertexSide: side.end.side,
          report,
          sideIndex,
          deep: deep !== null,
        };
        const existing = graphSides.get(leaf);
        if (existing) existing.push(entry);
        else graphSides.set(leaf, [entry]);
      }
      if (deep) {
        // Removed leaves leave E and O*; each keeps K3 against the partner
        // piece's non-window leaves (removed × partner window: D monotone).
        const window = (removed: readonly number[], end: Terminal) =>
          new Set([...removed, end.leaf]);
        const firstPartner = {
          piece: general.pieceOf[secondEnd.leaf]!,
          window: window(deep.removedSecond, secondEnd),
        };
        const secondPartner = {
          piece: general.pieceOf[firstEnd.leaf]!,
          window: window(deep.removedFirst, firstEnd),
        };
        for (const leaf of deep.removedFirst) {
          removedLeaves.add(leaf);
          removedPartners.set(leaf, firstPartner);
        }
        for (const leaf of deep.removedSecond) {
          removedLeaves.add(leaf);
          removedPartners.set(leaf, secondPartner);
        }
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
        ...(deep && deep.removedFirst.length > 0
          ? { firstLeafOffset: deep.removedFirst.length }
          : {}),
        ...(deep && deep.removedSecond.length > 0
          ? { secondLeafOffset: deep.removedSecond.length }
          : {}),
      });
      return null;
    };
    /** Natural terminal data of one traversal end (cubic leaf or line). */
    const endData = (end: Terminal) => {
      const atEnd = end.side === "end";
      const seed = seedLeaves.get(end.leaf);
      if (seed) {
        const tube = seedTubeOf(general.pieces[seed.arc.piece]!);
        const reached = atEnd
          ? seed.endEnd !== undefined
          : seed.startEnd !== undefined;
        return {
          // A circle has no ends; a deep-trimmed end is not reached.
          terminal: seed.arc.kind === "arc" && reached,
          pointId: atEnd ? tube.endPointId : tube.startPointId,
          vertex: tube.source?.[atEnd ? 1 : 0] ?? tube.center,
          emitted: tube.emitted?.[atEnd ? 1 : 0] ?? tube.center,
          splineId: undefined as string | undefined,
          occurrence: undefined as string | undefined,
        };
      }
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
      const coneFailure = () =>
        uncertain(
          "cubic-tube-cone-unproven",
          `Declared vertex ${index}: the emitted and true offset derivatives are not proved inside one open half-plane.`,
          firstEnd.leaf,
          secondEnd.leaf,
        );
      const firstSeed = seedLeaves.get(firstEnd.leaf);
      const secondSeed = seedLeaves.get(secondEnd.leaf);
      let direction: [number, number] = [0, 0];
      let e: ExactPoint;
      let realization: "vertical" | "steep" | undefined;
      if (firstSeed || secondSeed) {
        // T08b-f [TECH F5]: e = σ_trav·rot(Z − C) of the (first) seed side, so
        // its radial realization connector [Ẑ, Z] is exactly vertical
        // (T08b-e Lemma E verbatim); K1-wedge on each seed leaf's emitted
        // and reference wedges, the existing K1 on a line or cubic leaf.
        const [keyEnd, keySeed] = firstSeed
          ? [firstEnd, firstSeed]
          : [secondEnd, secondSeed!];
        const pole = exactPoint(a.emitted);
        const radial = difference(pole, keySeed.arc.center);
        e =
          keySeed.arc.sigma > 0 !== keyEnd.reversed
            ? rotate(radial)
            : negated(rotate(radial));
        direction = [...nearestValue(e)];
        for (const [end, seed] of [
          [firstEnd, firstSeed],
          [secondEnd, secondSeed],
        ] as const) {
          if (!seed) continue;
          if (seed.arc.kind !== "arc" || !seedInsideCone(end, e))
            return coneFailure();
          // (Z − C)·(V − C) > 0: the pole and the vertex share a half-ray side.
          if (
            !positive(
              dot(difference(pole, seed.arc.center), seedEndOf(end)!.vertex),
            )
          )
            return coneFailure();
        }
        if (firstSeed && secondSeed) {
          // Two seed arcs: one segment between both consumer ends (Lemma W).
          const slopesFirst = wedgeSlopes(
            firstSeed.arc.sigma,
            firstEnd.reversed,
            seedWedges(firstSeed)[0],
            e,
          );
          const slopesSecond = wedgeSlopes(
            secondSeed.arc.sigma,
            secondEnd.reversed,
            seedWedges(secondSeed)[0],
            e,
          );
          const kind =
            slopesFirst &&
            slopesSecond &&
            junction(
              pole,
              [
                [firstSeed.arc.center, firstSeed.arc.radius],
                [secondSeed.arc.center, secondSeed.arc.radius],
              ],
              e,
              [slopesFirst, slopesSecond],
            );
          // A radius-dependent segment on an R12 radius family (a trimmed
          // natural start) is not certified: fail closed.
          if (
            !kind ||
            (!kind.radial &&
              [firstSeed, secondSeed].some(
                (seed) => seed.arc.start?.kind === "trim",
              ))
          )
            return uncertain(
              "cubic-tube-cone-unproven",
              `Declared vertex ${index}: the realization segment between the two seed-arc ends is not proved steep (Lemma W).`,
              firstEnd.leaf,
              secondEnd.leaf,
            );
          realization = kind.kind;
          if (!kind.radial) {
            firstSeed.arc.nonRadial = true;
            secondSeed.arc.nonRadial = true;
            const far = seedPointBox(
              secondSeed.arc.center,
              secondSeed.arc.radius,
              difference(pole, secondSeed.arc.center),
            );
            if (!far) return coneFailure();
            seedHull(firstEnd.leaf, firstEnd.side, far);
          }
        } else realization = "vertical";
      } else {
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
        if (!direction.every(Number.isFinite)) return coneFailure();
        e = exactPoint(direction);
      }
      for (const end of [firstEnd, secondEnd]) {
        if (seedLeaves.has(end.leaf)) continue;
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
        seedJ2Data.clear();
        const sourceCone = (
          end: Terminal,
        ): ExactRange | keyof typeof J2_MESSAGES => {
          // T08b-f: a seed leaf's exact R5 data (its e·R′ hull is the cone).
          if (seedLeaves.has(end.leaf)) {
            const data = seedJ2(end, e, !convex);
            if (typeof data === "string") return data;
            seedJ2Data.set(end.leaf, data);
            return data.cone;
          }
          const signed = end.reversed ? negated(e) : e;
          return hull(
            leafShape(end.leaf).first.map((vector) => dot(signed, vector)),
          );
        };
        const coneFirst = sourceCone(firstEnd);
        if (typeof coneFirst === "string") return fail(J2_MESSAGES[coneFirst]);
        const coneSecond = sourceCone(secondEnd);
        if (typeof coneSecond === "string")
          return fail(J2_MESSAGES[coneSecond]);
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
          const seeded = firstSeed || secondSeed;
          // T08b-f seed vertices: numerator up, denominator factors down.
          const numerator = multiplyExact(
            multiplyExact(
              two,
              multiplyExact(distance, distance, budget),
              budget,
            ),
            multiplyExact(cross, cross, budget),
            budget,
          );
          const chord = squareRootUpper(
            seeded
              ? divideExact(
                  upper(numerator),
                  multiplyExact(
                    lower(product),
                    addExact(one, lower(cosineLow), budget),
                    budget,
                  ),
                  budget,
                )
              : divideExact(
                  numerator,
                  multiplyExact(
                    product,
                    addExact(one, cosineLow, budget),
                    budget,
                  ),
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
            firstSeed || secondSeed ? { range: outward, up: upper } : undefined,
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
        ...(realization ? { realization } : {}),
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
    /**
     * Review R12 (option c): the certified radius family of a seed arc
     * whose natural START is a trim. w bounds ||X − C| − ρ_o| over binary64
     * X one ulp around the emitted root box; the family is that widened by
     * two ulps each way for the consumer's binary64 difference and
     * `Math.hypot` (a publisher must still check containment).
     */
    const seedFamily = (arc: SeedArc, rootBox: readonly ExactRange[]) => {
      // Null (fail closed) whenever a binary64 bound overflows (meter A4).
      const ulpBox: ExactRange[] = [];
      for (const [low, high] of rootBox) {
        const lowValue = nextBinary64(down(low), "down", budget);
        if (!Number.isFinite(lowValue)) return null;
        const lowBound = exactFromNumber(lowValue, budget);
        const highValue = nextBinary64(up(high), "up", budget);
        if (!Number.isFinite(highValue)) return null;
        ulpBox.push([lowBound, exactFromNumber(highValue, budget)]);
      }
      let distanceRange: ExactRange = [zero, zero];
      for (const axis of [0, 1] as const) {
        const low = subtractExact(ulpBox[axis]![0], arc.center[axis], budget);
        const high = subtractExact(ulpBox[axis]![1], arc.center[axis], budget);
        const squares = [
          multiplyExact(low, low, budget),
          multiplyExact(high, high, budget),
        ];
        const straddles = !positive(low) && !negative(high);
        distanceRange = rangeAdd(distanceRange, [
          straddles ? zero : minimum(squares),
          maximum(squares),
        ]);
      }
      const near = positive(distanceRange[0])
        ? squareRoot(distanceRange[0])
        : null;
      const far = squareRootUpper(distanceRange[1]);
      if (!far) return null;
      const inward = near
        ? subtractExact(arc.radius, near[0], budget)
        : arc.radius;
      const outward = subtractExact(far, arc.radius, budget);
      const width = maximum([inward, outward, zero]);
      const lowValue = nextBinary64(
        nextBinary64(
          down(subtractExact(arc.radius, width, budget)),
          "down",
          budget,
        ),
        "down",
        budget,
      );
      const highValue = nextBinary64(
        nextBinary64(up(addExact(arc.radius, width, budget)), "up", budget),
        "up",
        budget,
      );
      if (!Number.isFinite(lowValue) || !Number.isFinite(highValue))
        return null;
      const low = exactFromNumber(lowValue, budget);
      const high = exactFromNumber(highValue, budget);
      return {
        width: maximum([
          subtractExact(high, arc.radius, budget),
          subtractExact(arc.radius, low, budget),
        ]),
        range: [lowValue, highValue] as const,
      };
    };
    /**
     * Lemma T° (header T08b-f, review R2/R3/R12) at one concave trim with a
     * seed-arc terminal leaf, after H2. The implicit side A is a seed leaf
     * whose reference circle K = (C_A, R_A) is exact at the trimmed end; B
     * is the other terminal leaf. Tried with the first seed side implicit,
     * then (circle↔circle) the second. Returns a failure, or null after
     * recording the trim.
     */
    const seedTrim = (
      declaration: PieceTubeChainRequest["trims"][number],
      firstEnd: Terminal,
      secondEnd: Terminal,
      fail: (code: string, message: string, magnitude?: true) => Failure,
    ): Failure | null => {
      const WINDOW = "trim-window-unproven";
      const CLASSIFICATION = "trim-classification-unproven";
      const EXISTENCE = "trim-existence-unproven";
      const ends = [firstEnd, secondEnd] as const;
      const storedBounds = [
        declaration.firstParameterBounds,
        declaration.secondParameterBounds,
      ] as const;
      for (const end of ends) {
        const seed = seedLeaves.get(end.leaf);
        if (!seed) continue;
        if (seed.arc.kind !== "arc" || seed.stepInside)
          return fail(
            CLASSIFICATION,
            "A trimmed seed-arc leaf carries the reference step (a one-leaf stepped arc): Lemma T° is not attempted.",
          );
        // M0: the joint pair must meet only on the full emitted circle, so a
        // trimmed leaf carries no realization segment at its other end (a
        // trimmed other end has none).
        const other = end.side === "start" ? seed.endEnd : seed.startEnd;
        if (other && other.kind !== "trim")
          return fail(
            CLASSIFICATION,
            "A trimmed one-leaf seed arc carries a realization segment at its other end: Lemma T° is not attempted.",
          );
      }
      const negate = (value: ExactFraction) => negateExact(value, budget);
      const absolute = (value: ExactFraction) =>
        negative(value) ? negate(value) : value;
      const square = (value: ExactFraction) =>
        multiplyExact(value, value, budget);
      const rangeSquarePositive = (value: ExactRange): ExactRange => [
        square(value[0]),
        square(value[1]),
      ];
      /** σ-oriented cross of a seed arc (natural orientation). */
      const turnOf = (arc: SeedArc) => (u: ExactPoint, v: ExactPoint) => {
        const value = crossExact(u, v, budget);
        return arc.sigma > 0 ? value : negate(value);
      };
      const strictlyInside = (
        arc: SeedArc,
        wedge: readonly [ExactPoint, ExactPoint],
        direction: ExactPoint,
      ) =>
        positive(turnOf(arc)(wedge[0], direction)) &&
        positive(turnOf(arc)(direction, wedge[1]));
      /** Binary64 near-bisector of a wedge, admitted exactly (the K3 rule). */
      const bisectWedge = (
        arc: SeedArc,
        wedge: readonly [ExactPoint, ExactPoint],
      ) => {
        const approximate = (value: ExactPoint) => {
          const x = exactToNumber(value[0], budget);
          const y = exactToNumber(value[1], budget);
          const length = Math.hypot(x, y);
          return [x / length, y / length] as const;
        };
        const from = approximate(wedge[0]);
        const to = approximate(wedge[1]);
        const middle: SplineVector = [from[0] + to[0], from[1] + to[1]];
        if (!middle.every(Number.isFinite)) return null;
        const direction = exactPoint(middle);
        if (!strictlyInside(arc, wedge, direction)) return null;
        return [
          [wedge[0], direction],
          [direction, wedge[1]],
        ] as const;
      };
      /** Chord bound c ≥ |û − v̂| (tight T3 form), u·v > 0; null otherwise. */
      const chordBound = (u: ExactPoint, v: ExactPoint) => {
        const along = dot(u, v);
        if (!positive(along)) return null;
        const product = multiplyExact(dot(u, u), dot(v, v), budget);
        const root = squareRootUpper(product);
        if (!root) return null;
        const skew = crossExact(u, v, budget);
        return squareRootUpper(
          divideExact(
            upper(multiplyExact(two, square(skew), budget)),
            multiplyExact(
              lower(product),
              addExact(one, lower(divideExact(along, root, budget)), budget),
              budget,
            ),
            budget,
          ),
        );
      };
      /** Exact box of every point of a circle wedge with radius range ρ. */
      const wedgeBox = (
        arc: SeedArc,
        center: ExactPoint,
        radius: ExactRange,
        wedge: readonly [ExactPoint, ExactPoint],
      ): ExactRange[] | null => {
        const from = seedUnit(wedge[0]);
        const to = from && seedUnit(wedge[1]);
        if (!from || !to) return null;
        return ([0, 1] as const).map((axis): ExactRange => {
          const unit: ExactPoint = axis === 0 ? [one, zero] : [zero, one];
          let low = minimum([from[axis]![0], to[axis]![0]]);
          let high = maximum([from[axis]![1], to[axis]![1]]);
          if (strictlyInside(arc, wedge, unit)) high = one;
          if (strictlyInside(arc, wedge, negated(unit))) low = negate(one);
          const product = rangeMultiply(radius, [low, high]);
          return [
            addExact(center[axis], product[0], budget),
            addExact(center[axis], product[1], budget),
          ];
        });
      };
      /** |P − C|² over a box (exact interval). */
      const boxDistance = (
        box: readonly ExactRange[],
        center: ExactPoint,
      ): ExactRange => {
        let result: ExactRange = [zero, zero];
        for (const axis of [0, 1] as const)
          result = rangeAdd(
            result,
            rangeSquare([
              subtractExact(box[axis]![0], center[axis], budget),
              subtractExact(box[axis]![1], center[axis], budget),
            ]),
          );
        return result;
      };
      /** The two σ-extreme corner directions of a box seen from C (span < π). */
      const boxDirections = (
        arc: SeedArc,
        box: readonly ExactRange[],
        center: ExactPoint,
      ): readonly [ExactPoint, ExactPoint] | null => {
        const inside = ([0, 1] as const).every(
          (axis) =>
            compareExact(box[axis]![0], center[axis], budget) <= 0 &&
            compareExact(center[axis], box[axis]![1], budget) <= 0,
        );
        if (inside) return null;
        const corners = box[0]!.flatMap((x) =>
          box[1]!.map(
            (y): ExactPoint => [
              subtractExact(x, center[0], budget),
              subtractExact(y, center[1], budget),
            ],
          ),
        );
        const turn = turnOf(arc);
        let low = corners[0]!;
        let high = corners[0]!;
        for (const corner of corners.slice(1)) {
          if (positive(turn(corner, low))) low = corner;
          if (positive(turn(high, corner))) high = corner;
        }
        if (negative(turn(low, high))) return null;
        return [low, high];
      };
      const attempt = (implicit: 0 | 1): Failure | null => {
        const aEnd = ends[implicit];
        const bEnd = ends[1 - implicit]!;
        const aSeed = seedLeaves.get(aEnd.leaf)!;
        const aArc = aSeed.arc;
        const aData = aEnd.side === "start" ? aArc.start! : aArc.end!;
        const aReference = aData.reference;
        const bSeed = seedLeaves.get(bEnd.leaf);
        const bLine = lineData.get(bEnd.leaf);
        const bBounds = storedBounds[1 - implicit]!;
        const aWedges = seedWedges(aSeed);
        const center = aArc.center;
        const pointRadius = (arc: SeedArc): ExactRange => [
          arc.radius,
          arc.radius,
        ];
        // B's seed-arc bracket (circle↔circle): candidate directions from the
        // stored angle bounds, admitted inside the window and sign-proved.
        type Bracket = {
          readonly wedge: readonly [ExactPoint, ExactPoint];
        };
        const familyRange = (arc: SeedArc): ExactRange => [
          subtractExact(arc.radius, arc.family.width, budget),
          addExact(arc.radius, arc.family.width, budget),
        ];
        const aFamily = positive(aArc.family.width) ? aArc.family : null;
        const bFamily =
          bSeed && positive(bSeed.arc.family.width) ? bSeed.arc.family : null;
        const radiusRange = (arc: SeedArc, family: typeof aFamily) =>
          family ? familyRange(arc) : pointRadius(arc);

        let referenceBox: ExactRange[] | null = null;
        let emittedBox: ExactRange[] | null = null;
        let bRootBounds: readonly [number, number] | undefined;
        let bTail = zero;
        /** η ≥ |X̂ − X*|, the emitted-to-true root distance. */
        let rootDistance = zero;
        let bCut: {
          chord: ExactFraction;
          wedge: readonly [ExactPoint, ExactPoint];
        } | null = null;
        const aSquaredReference = rangeSquarePositive(aReference);

        if (bSeed) {
          // ---- arc B: exact reference and emitted brackets on directions.
          if (bSeed.arc.kind !== "arc")
            return fail(CLASSIFICATION, "A circle piece is never trimmed.");
          const bArc = bSeed.arc;
          const bData = bEnd.side === "start" ? bArc.start! : bArc.end!;
          const bReference = bData.reference;
          const bWedges = seedWedges(bSeed);
          const offset = difference(bArc.center, center);
          const turnB = turnOf(bArc);
          // g′ sign on B: σ_B·(C_B − C_A)·rot(w) = σ_B·(w × (C_B − C_A)).
          const rateSign = (w: ExactPoint) => {
            const value = crossExact(w, offset, budget);
            return bArc.sigma > 0 ? value : negate(value);
          };
          /** (T°2): f = |P − C_A|² − R² excludes 0 on a wedge of B, bisected. */
          const excludesOn = (
            radius: ExactRange,
            circleSquared: ExactRange,
          ) => {
            const excludes = (
              wedge: readonly [ExactPoint, ExactPoint],
              depth: number,
            ): boolean => {
              const box = wedgeBox(bArc, bArc.center, radius, wedge);
              if (box) {
                const f = rangeSubtract(
                  boxDistance(box, center),
                  circleSquared,
                );
                if (excludesZero(f)) return true;
              }
              if (depth >= SEED_TRIM_DEPTH) return false;
              budget.refinementStep();
              const children = bisectWedge(bArc, wedge);
              return (
                children !== null &&
                excludes(children[0], depth + 1) &&
                excludes(children[1], depth + 1)
              );
            };
            return excludes;
          };
          // The zero direction of g′ is ±(C_B − C_A), exactly.
          const windowOf = (
            wedge: readonly [ExactPoint, ExactPoint],
          ): {
            readonly window: readonly [ExactPoint, ExactPoint];
            readonly rest: readonly (readonly [ExactPoint, ExactPoint])[];
          } | null => {
            const s0 = compareExact(rateSign(wedge[0]), zero, budget);
            const s1 = compareExact(rateSign(wedge[1]), zero, budget);
            if (s0 !== 0 && s0 === s1) return { window: wedge, rest: [] };
            const split = [offset, negated(offset)].find((z) =>
              strictlyInside(bArc, wedge, z),
            );
            if (!split) return null;
            return {
              window: wedge,
              rest: [
                [wedge[0], split],
                [split, wedge[1]],
              ],
            };
          };
          // Candidate bracket directions from the stored angle bounds.
          const angleOf = (value: number): ExactPoint =>
            exactPoint([Math.cos(value), Math.sin(value)]);
          const referenceSign = (direction: ExactPoint) => {
            // sign |C_B + R_B d̂ − C_A|² − R_A² (exact, √-free by squaring).
            const radiusB = bReference[0];
            const radiusA = aReference[0];
            const k = subtractExact(
              square(radiusA),
              addExact(dot(offset, offset), square(radiusB), budget),
              budget,
            );
            const x = multiplyExact(
              multiplyExact(two, radiusB, budget),
              dot(offset, direction),
              budget,
            );
            const xSign = compareExact(x, zero, budget);
            const kSign = compareExact(k, zero, budget);
            if (xSign !== kSign || xSign === 0)
              return xSign > kSign ? 1 : xSign < kSign ? -1 : 0;
            const difference_ = compareExact(
              square(x),
              multiplyExact(square(k), dot(direction, direction), budget),
              budget,
            );
            return xSign > 0 ? difference_ : -difference_;
          };
          const emittedSign = (
            direction: ExactPoint,
            radiusA: ExactRange,
            radiusB: ExactRange,
          ) => {
            const unit = seedUnit(direction);
            if (!unit) return 0;
            let value: ExactRange = [zero, zero];
            for (const axis of [0, 1] as const)
              value = rangeAdd(
                value,
                rangeSquare(
                  rangeAdd(
                    point(offset[axis]),
                    rangeMultiply(radiusB, unit[axis]!),
                  ),
                ),
              );
            const f = rangeSubtract(value, rangeSquarePositive(radiusA));
            return positive(f[0]) ? 1 : negative(f[1]) ? -1 : 0;
          };
          const bracketAt = (
            radiusA: ExactRange,
            radiusB: ExactRange,
          ): Bracket | null => {
            // The margin ladder only seeds binary64 candidate directions; the
            // exact signs below decide. It is not a tolerance.
            for (const margin of [0, 2 ** -40, 2 ** -30, 2 ** -20]) {
              const low = angleOf(
                bBounds[0] - margin * (1 + Math.abs(bBounds[0])),
              );
              const high = angleOf(
                bBounds[1] + margin * (1 + Math.abs(bBounds[1])),
              );
              const wedge: readonly [ExactPoint, ExactPoint] =
                bArc.sigma > 0 ? [low, high] : [high, low];
              if (!positive(turnB(wedge[0], wedge[1]))) continue;
              if (
                !bWedges.every(
                  (leafWedge) =>
                    strictlyInside(bArc, leafWedge, wedge[0]) &&
                    strictlyInside(bArc, leafWedge, wedge[1]),
                )
              )
                continue;
              const r0 = referenceSign(wedge[0]);
              const r1 = referenceSign(wedge[1]);
              const e0 = emittedSign(wedge[0], radiusA, radiusB);
              const e1 = emittedSign(wedge[1], radiusA, radiusB);
              if (r0 !== 0 && r0 === -r1 && e0 !== 0 && e0 === -e1)
                return { wedge };
            }
            return null;
          };
          const radiusA = radiusRange(aArc, aFamily);
          const radiusB = radiusRange(bArc, bFamily);
          const bracket = bracketAt(radiusA, radiusB);
          if (!bracket)
            return fail(
              EXISTENCE,
              "The seed-arc joint root of the radius family is not bracketed on the explicit arc.",
              true,
            );
          // (T°1/T°2) on the reference and (R3) on the emitted wedge: the
          // monotone window holds the bracket; the rest excludes f exactly.
          for (const [which, leafWedge] of bWedges.entries()) {
            const reference = which === 1;
            const split = windowOf(leafWedge);
            if (!split)
              return fail(
                CLASSIFICATION,
                `The ${reference ? "true" : "emitted"} offset of the explicit arc is not proved monotone about the implicit circle (T°1).`,
              );
            if (split.rest.length === 0) continue;
            const [left, right] = split.rest as readonly [
              readonly [ExactPoint, ExactPoint],
              readonly [ExactPoint, ExactPoint],
            ];
            const window =
              strictlyInside(bArc, left, bracket.wedge[0]) &&
              strictlyInside(bArc, left, bracket.wedge[1])
                ? left
                : strictlyInside(bArc, right, bracket.wedge[0]) &&
                    strictlyInside(bArc, right, bracket.wedge[1])
                  ? right
                  : null;
            if (!window)
              return fail(
                WINDOW,
                "The joint bracket is not inside one monotone sub-window of the explicit arc (T°1).",
                true,
              );
            const excluded = window === left ? right : left;
            // (T°2): f excludes 0 on the rest, bisected if needed.
            const radius = reference ? bReference : radiusB;
            const circleSquared = reference
              ? aSquaredReference
              : rangeSquarePositive(radiusA);
            if (!excludesOn(radius, circleSquared)(excluded, 0))
              return fail(
                CLASSIFICATION,
                `The ${reference ? "true" : "emitted"} offset of the explicit arc is not proved off the implicit circle outside its monotone window (T°2).`,
              );
          }
          // Review Q1 (R7 on the explicit side): the carried `removed` count
          // is request data, never trusted. Every leaf of B between its
          // terminal leaf and this natural end (the removed ones) must be
          // proved off K on its reference wedge and off the emitted family
          // on its emitted wedge (R3), by the same T°2 exclusion; else a
          // crossing nearer the vertex could be skipped. Fail closed.
          const count = bArc.emitted.length - 1;
          const [from, to] =
            bEnd.side === "start" ? [0, bSeed.index] : [bSeed.index + 1, count];
          for (let leaf = from; leaf < to; leaf += 1)
            for (const reference of [false, true]) {
              const directions = reference ? bArc.reference : bArc.emitted;
              const clear = excludesOn(
                reference ? bReference : radiusB,
                reference ? aSquaredReference : rangeSquarePositive(radiusA),
              )([directions[leaf]!, directions[leaf + 1]!], 0);
              if (!clear)
                return fail(
                  CLASSIFICATION,
                  `The ${reference ? "true" : "emitted"} offset of removed leaf ${leaf} of the explicit arc (R7) is not proved off the implicit circle (T°2).`,
                );
            }
          referenceBox = wedgeBox(
            bArc,
            bArc.center,
            [bReference[0], bReference[1]],
            bracket.wedge,
          );
          emittedBox = wedgeBox(bArc, bArc.center, radiusB, bracket.wedge);
          const chord = chordBound(bracket.wedge[0], bracket.wedge[1]);
          if (!referenceBox || !emittedBox || !chord)
            return fail(EXISTENCE, J2_MESSAGES.root, true);
          bCut = {
            chord: multiplyExact(bReference[1], chord, budget),
            wedge: bracket.wedge,
          };
          // |X̂ − X*| ≤ |ρ_B − R_B| + R_B⁺·chord (both on B's cut wedge).
          rootDistance = addExact(
            addExact(bData.gap, bFamily ? bFamily.width : zero, budget),
            bCut.chord,
            budget,
          );
        } else {
          // ---- line or cubic B: φ-located reference root, R3 on B̂.
          const lineTube = general.lines[bEnd.leaf];
          const errorB = errors[bEnd.leaf]!;
          const cubicDomain = lineTube
            ? null
            : (tubes[bEnd.leaf] as NeutralCubicPieceTube).queryDomain;
          const toLeaf = (value: number) =>
            cubicDomain
              ? normalizedExact(value, cubicDomain, budget)
              : exactFromNumber(value, budget);
          const stored: ExactRange = [toLeaf(bBounds[0]), toLeaf(bBounds[1])];
          const radiusA = radiusRange(aArc, aFamily);
          const familyShift = (rate: ExactFraction) => {
            if (!aFamily) return zero;
            const high = subtractExact(
              square(radiusA[1]),
              square(aArc.radius),
              budget,
            );
            const low = subtractExact(
              square(aArc.radius),
              square(radiusA[0]),
              budget,
            );
            return divideExact(
              maximum([high, low]),
              multiplyExact(two, rate, budget),
              budget,
            );
          };
          let referenceRate: ExactFraction;
          let emittedRate: ExactFraction;
          let referenceWindow: ExactRange;
          let emittedWindow: ExactRange;
          let referencePosition: (
            from: ExactFraction,
            to: ExactFraction,
          ) => ExactRange[];
          let emittedPosition: (
            from: ExactFraction,
            to: ExactFraction,
          ) => ExactRange[];
          let speed: ExactFraction;
          const lineSplits: {
            reference?: { rest: ExactRange | null; low?: boolean };
            emitted?: { rest: ExactRange | null; low?: boolean };
          } = {};
          if (bLine) {
            const tube = lineTube!;
            const source = exactPoint(tube.source[0]);
            const emitted = tube.emitted.map(exactPoint);
            const a = bLine.direction;
            const step = difference(emitted[1]!, emitted[0]!);
            /**
             * (T°1) on a line: g′/2 = v(t) = v₀ + t|a|² is linear, so it is
             * monotone on each side of its exact zero t₀ = −v₀/|a|². W is the
             * whole leaf when t₀ ∉ (0, 1); otherwise the side holding the
             * stored bracket, cut at t_c halfway to t₀ (the rate is bounded
             * away from t₀; [t_c, t₀] is root-free by monotonicity), and the
             * other side is `rest`, excluded below or paired (T°2).
             */
            const lineWindow = (base: ExactFraction, slope: ExactFraction) => {
              const values = [base, addExact(base, slope, budget)];
              if (values.every(positive) || values.every(negative))
                return {
                  window: [zero, one] as ExactRange,
                  rate: minimum(values.map(absolute)),
                  rest: null,
                };
              if (!values.every((value) => positive(value) || negative(value)))
                return null;
              const foot = divideExact(negate(base), slope, budget);
              const at = (t: ExactFraction) =>
                absolute(
                  addExact(base, multiplyExact(t, slope, budget), budget),
                );
              if (compareExact(stored[1], foot, budget) < 0) {
                const cut = multiplyExact(
                  addExact(stored[1], foot, budget),
                  half,
                  budget,
                );
                return {
                  window: [zero, cut] as ExactRange,
                  rate: minimum([at(zero), at(cut)]),
                  rest: [foot, one] as ExactRange,
                  low: true,
                };
              }
              if (compareExact(stored[0], foot, budget) > 0) {
                const cut = multiplyExact(
                  addExact(stored[0], foot, budget),
                  half,
                  budget,
                );
                return {
                  window: [cut, one] as ExactRange,
                  rate: minimum([at(cut), at(one)]),
                  rest: [zero, foot] as ExactRange,
                  low: false,
                };
              }
              return null;
            };
            const referenceSplit = lineWindow(
              dot(difference(source, center), a),
              dot(a, a),
            );
            if (!referenceSplit)
              return fail(
                CLASSIFICATION,
                "The true offset line is not proved monotone about the implicit circle on a window holding the joint bracket (T°1).",
              );
            const emittedSplit = lineWindow(
              dot(difference(emitted[0]!, center), step),
              dot(step, step),
            );
            if (!emittedSplit)
              return fail(
                CLASSIFICATION,
                "The emitted line is not proved monotone about the emitted circle on a window holding the joint bracket (R3).",
              );
            lineSplits.reference = referenceSplit;
            lineSplits.emitted = emittedSplit;
            referenceRate = referenceSplit.rate;
            referenceWindow = referenceSplit.window;
            emittedRate = emittedSplit.rate;
            emittedWindow = emittedSplit.window;
            const distanceB = exactFromNumber(tube.distance, budget);
            const rotated: ExactPoint = [negateExact(a[1], budget), a[0]];
            const normal = rotated.map((value) =>
              hull([
                divideExact(value, bLine.length[1], budget),
                divideExact(value, bLine.length[0], budget),
              ]),
            );
            const at = (
              base: ExactPoint,
              vector: ExactPoint,
              t: ExactFraction,
            ): ExactPoint => [
              addExact(base[0], multiplyExact(vector[0], t, budget), budget),
              addExact(base[1], multiplyExact(vector[1], t, budget), budget),
            ];
            referencePosition = (from, to) =>
              ([0, 1] as const).map((axis) => {
                const range = hull([
                  at(source, a, from)[axis],
                  at(source, a, to)[axis],
                ]);
                return rangeAdd(
                  range,
                  rangeMultiply(point(distanceB), normal[axis]!),
                );
              });
            emittedPosition = (from, to) =>
              ([0, 1] as const).map((axis) =>
                hull([
                  at(emitted[0]!, step, from)[axis],
                  at(emitted[0]!, step, to)[axis],
                ]),
              );
            speed = bLine.length[1];
          } else {
            const curvature = leafCurvature(bEnd.leaf);
            if (typeof curvature === "string")
              return fail(CLASSIFICATION, J2_MESSAGES[curvature]);
            const source = leafSource(bEnd.leaf);
            const width = subtractExact(source.high, source.low, budget);
            const inflate = (box: ExactRange[]): ExactRange[] =>
              box.map(
                ([low, high]): ExactRange => [
                  subtractExact(low, errorB, budget),
                  addExact(high, errorB, budget),
                ],
              );
            const cubicBox = (cubic: ExactCubic): ExactRange[] =>
              ([0, 1] as const).map((axis) =>
                hull(cubic.map((pole) => pole[axis])),
              );
            const hodographBox = (
              cubic: ExactCubic,
              span: ExactFraction,
            ): ExactRange[] =>
              ([0, 1] as const).map((axis) =>
                hull(
                  [0, 1, 2].map((index) =>
                    divideExact(
                      multiplyExact(
                        three,
                        subtractExact(
                          cubic[index + 1]![axis],
                          cubic[index]![axis],
                          budget,
                        ),
                        budget,
                      ),
                      span,
                      budget,
                    ),
                  ),
                ),
              );
            referencePosition = (from, to) =>
              inflate(cubicBox(restrict(poles[bEnd.leaf]!, from, to)));
            emittedPosition = (from, to) =>
              cubicBox(restrict(poles[bEnd.leaf]!, from, to));
            const productRange = (
              position: ExactRange[],
              derivative: ExactRange[],
            ) =>
              rangeAdd(
                rangeMultiply(
                  [
                    subtractExact(position[0]![0], center[0], budget),
                    subtractExact(position[0]![1], center[0], budget),
                  ],
                  derivative[0]!,
                ),
                rangeMultiply(
                  [
                    subtractExact(position[1]![0], center[1], budget),
                    subtractExact(position[1]![1], center[1], budget),
                  ],
                  derivative[1]!,
                ),
              );
            /**
             * (T°1/T°2) by dyadic subdivision of the leaf τ: every window is
             * monotone (the witness windows, one sign, contiguous) or
             * excludes f; returns the monotone run and its rate bound.
             */
            const monotoneRun = (
              reference: boolean,
            ): {
              window: ExactRange;
              rate: ExactFraction;
              sign: number;
            } | null => {
              const labelled: {
                low: ExactFraction;
                high: ExactFraction;
                sign: number;
                rate: ExactFraction;
                excluded: boolean;
              }[] = [];
              const circleSquared = reference
                ? aSquaredReference
                : rangeSquarePositive(radiusA);
              const visit = (
                low: ExactFraction,
                high: ExactFraction,
                depth: number,
              ): boolean => {
                const position = reference
                  ? referencePosition(low, high)
                  : emittedPosition(low, high);
                const span = subtractExact(high, low, budget);
                const derivative = reference
                  ? hodographBox(
                      restrict(
                        source.poles,
                        addExact(
                          source.low,
                          multiplyExact(low, width, budget),
                          budget,
                        ),
                        addExact(
                          source.low,
                          multiplyExact(high, width, budget),
                          budget,
                        ),
                      ),
                      span,
                    )
                  : hodographBox(restrict(poles[bEnd.leaf]!, low, high), span);
                const product = productRange(position, derivative);
                const sign = positive(product[0])
                  ? 1
                  : negative(product[1])
                    ? -1
                    : 0;
                const excluded = excludesZero(
                  rangeSubtract(boxDistance(position, center), circleSquared),
                );
                const touches =
                  compareExact(low, stored[1], budget) <= 0 &&
                  compareExact(stored[0], high, budget) <= 0;
                if (
                  (sign !== 0 && (touches || !excluded)) ||
                  (!touches && excluded)
                ) {
                  labelled.push({
                    low,
                    high,
                    sign,
                    rate:
                      sign > 0
                        ? product[0]
                        : sign < 0
                          ? negate(product[1])
                          : zero,
                    excluded,
                  });
                  return true;
                }
                if (depth >= SEED_TRIM_DEPTH) return false;
                budget.refinementStep();
                const middle = multiplyExact(
                  addExact(low, high, budget),
                  half,
                  budget,
                );
                return (
                  visit(low, middle, depth + 1) &&
                  visit(middle, high, depth + 1)
                );
              };
              if (!visit(zero, one, 0)) return null;
              const witness = labelled.filter(
                (item) =>
                  compareExact(item.low, stored[1], budget) <= 0 &&
                  compareExact(stored[0], item.high, budget) <= 0,
              );
              const sign = witness[0]?.sign ?? 0;
              if (sign === 0 || witness.some((item) => item.sign !== sign))
                return null;
              let from = labelled.indexOf(witness[0]!);
              let to = labelled.indexOf(witness.at(-1)!);
              while (from > 0 && labelled[from - 1]!.sign === sign) from -= 1;
              while (
                to + 1 < labelled.length &&
                labelled[to + 1]!.sign === sign
              )
                to += 1;
              if (
                labelled.some(
                  (item, index) =>
                    (index < from || index > to) && !item.excluded,
                )
              )
                return null;
              const run = labelled.slice(from, to + 1);
              return {
                window: [run[0]!.low, run.at(-1)!.high],
                rate: minimum(run.map((item) => item.rate)),
                sign,
              };
            };
            const referenceRun = monotoneRun(true);
            if (!referenceRun)
              return fail(
                CLASSIFICATION,
                "The true offset cubic is not proved monotone about the implicit circle on a window, and off it elsewhere (T°1/T°2).",
              );
            const emittedRun = monotoneRun(false);
            if (!emittedRun)
              return fail(
                CLASSIFICATION,
                "The emitted cubic is not proved monotone about the emitted circle on a window, and off it elsewhere (R3).",
              );
            // |g′| ≥ 2λ_lo·min|(O − C)·S′_τ| on the true side (O′ = λS′).
            referenceRate = multiplyExact(
              curvature.lambda[0],
              referenceRun.rate,
              budget,
            );
            emittedRate = emittedRun.rate;
            referenceWindow = referenceRun.window;
            emittedWindow = emittedRun.window;
            let speedSquared = zero;
            for (const axis of derivatives[bEnd.leaf]!) {
              const low = multiplyExact(axis[0]!, axis[0]!, budget);
              const high = multiplyExact(axis[1]!, axis[1]!, budget);
              speedSquared = addExact(
                speedSquared,
                compareExact(low, high, budget) >= 0 ? low : high,
                budget,
              );
            }
            const root = squareRootUpper(speedSquared);
            if (!root) return fail(WINDOW, J2_MESSAGES.root, true);
            speed = multiplyExact(root, width, budget);
          }
          if (!positive(referenceRate) || !positive(emittedRate))
            return fail(
              CLASSIFICATION,
              "The monotone rate about the implicit circle is not proved positive (T°1).",
            );
          const shift = familyShift(emittedRate);
          const emittedRoot: ExactRange = [
            subtractExact(stored[0], shift, budget),
            addExact(stored[1], shift, budget),
          ];
          // ε_B at the emitted roots: the owner's Q4-E1 local bound on the
          // vertex-anchored window reaching the far emitted root bound
          // (capped by ε; the leaf-wide ε without metadata, or on a line).
          let witnessError = errorB;
          if (!bLine) {
            budget.operation(LOCAL_ERROR_PRECHARGE);
            const reach =
              bEnd.side === "end"
                ? subtractExact(one, emittedRoot[0], budget)
                : emittedRoot[1];
            const local =
              !negative(reach) && localBound(bEnd.leaf, bEnd.side, reach);
            if (local) witnessError = local;
          }
          // (T°3) |f(O_B(τ̂*))| ≤ φ = η(2R⁺ + η), η = ε_B(τ̂*) + |ρ_o − R| + w.
          const eta = addExact(
            addExact(witnessError, aData.gap, budget),
            aFamily ? aFamily.width : zero,
            budget,
          );
          const phi = multiplyExact(
            eta,
            addExact(multiplyExact(two, aReference[1], budget), eta, budget),
            budget,
          );
          const delta = divideExact(
            phi,
            multiplyExact(two, referenceRate, budget),
            budget,
          );
          const referenceRoot: ExactRange = [
            subtractExact(stored[0], delta, budget),
            addExact(stored[1], delta, budget),
          ];
          const strictlyWithin = (range: ExactRange, window: ExactRange) =>
            compareExact(range[0], window[0], budget) > 0 &&
            compareExact(range[1], window[1], budget) < 0 &&
            positive(range[0]) &&
            compareExact(range[1], one, budget) < 0;
          if (
            !strictlyWithin(referenceRoot, referenceWindow) ||
            !strictlyWithin(emittedRoot, emittedWindow)
          )
            return fail(
              WINDOW,
              "A Lemma-T° root enclosure is not strictly inside the monotone window of the terminal leaf.",
              true,
            );
          // (T°2) on a line's other monotone side: f excludes 0 there, or it
          // holds the root of this line's OTHER-end trim against the same
          // exact circle K (paired after every trim: a line meets a circle
          // at most twice, so the retained segment meets K only at its ends).
          if (bLine) {
            const splits = [
              [lineSplits.reference, aSquaredReference],
              [lineSplits.emitted, rangeSquarePositive(radiusA)],
            ] as const;
            const unexcluded: {
              readonly reference: boolean;
              readonly rest: ExactRange;
            }[] = [];
            for (const [split, circleSquared] of splits) {
              if (!split?.rest) continue;
              const box = (
                split === lineSplits.reference
                  ? referencePosition
                  : emittedPosition
              )(split.rest[0], split.rest[1]);
              if (
                !excludesZero(
                  rangeSubtract(boxDistance(box, center), circleSquared),
                )
              )
                unexcluded.push({
                  reference: split === lineSplits.reference,
                  rest: split.rest,
                });
            }
            const positions = [emittedPosition, referencePosition] as const;
            const tube = lineTube!;
            const sourceDirection = bLine.direction;
            /**
             * T08b-g7 Lemma T°2′ on one rest side [t_a, t_b]: every corner
             * of its two endpoint boxes, from C_A, has the same nonzero
             * sign against the line's own normal rot(a) (one open half-
             * plane, so the segment's directions run monotonically inside
             * the corners' σ-hull [lo, hi], span < π), and that closed
             * cone is disjoint from EVERY closed leaf wedge of A's whole
             * partition (reference wedges for the true line, emitted for
             * the emitted one; R7-removed leaves included, review R1): four
             * exact turn signs per leaf, ties fail closed. Then the side
             * meets no circle about C_A inside A's wedge.
             */
            const restClear = (side: (typeof unexcluded)[number]) => {
              const boundaries = side.reference ? aArc.reference : aArc.emitted;
              budget.operation(T2_WEDGE_PRECHARGE * (boundaries.length - 1));
              const position = positions[side.reference ? 1 : 0];
              const direction = side.reference
                ? sourceDirection
                : difference(
                    exactPoint(tube.emitted[1]),
                    exactPoint(tube.emitted[0]),
                  );
              const normal: ExactPoint = [negate(direction[1]), direction[0]];
              const corners = side.rest.flatMap((t) => {
                const box = position(t, t);
                return box[0]!.flatMap((x) =>
                  box[1]!.map(
                    (y): ExactPoint => [
                      subtractExact(x, center[0], budget),
                      subtractExact(y, center[1], budget),
                    ],
                  ),
                );
              });
              const sign = compareExact(dot(corners[0]!, normal), zero, budget);
              if (
                sign === 0 ||
                corners.some(
                  (corner) =>
                    compareExact(dot(corner, normal), zero, budget) !== sign,
                )
              )
                return false;
              const turn = turnOf(aArc);
              let low = corners[0]!;
              let high = corners[0]!;
              for (const corner of corners.slice(1)) {
                if (positive(turn(corner, low))) low = corner;
                if (positive(turn(high, corner))) high = corner;
              }
              if (negative(turn(low, high))) return false;
              const closedIn = (
                wedge: readonly [ExactPoint, ExactPoint],
                value: ExactPoint,
              ) =>
                !negative(turn(wedge[0], value)) &&
                !negative(turn(value, wedge[1]));
              const cone = [low, high] as const;
              for (let leaf = 0; leaf + 1 < boundaries.length; leaf += 1) {
                const wedge = [
                  boundaries[leaf]!,
                  boundaries[leaf + 1]!,
                ] as const;
                if (
                  closedIn(wedge, low) ||
                  closedIn(wedge, high) ||
                  closedIn(cone, wedge[0]) ||
                  closedIn(cone, wedge[1])
                )
                  return false;
              }
              return true;
            };
            if (unexcluded.length > 0)
              linePairs.push({
                leaf: bEnd.leaf,
                side: bEnd.side,
                piece: aArc.piece,
                radius: aReference[0],
                low: [lineSplits.reference?.low, lineSplits.emitted?.low],
                wedgeClear: () => unexcluded.every(restClear),
              });
          }
          referenceBox = referencePosition(referenceRoot[0], referenceRoot[1]);
          emittedBox = emittedPosition(emittedRoot[0], emittedRoot[1]);
          // Composition of B: the hull of both root enclosures.
          const joint: ExactRange = [
            minimum([referenceRoot[0], emittedRoot[0]]),
            maximum([referenceRoot[1], emittedRoot[1]]),
          ];
          // Both roots are measured from the one emitted root τ̂_o ∈ stored:
          // |τ̂_ρ − τ*| ≤ Δ + δ, so the removed-tail shift is M(δ + Δ) and
          // |X̂ − X*| ≤ ε_B(τ̂) + M(δ + Δ).
          bTail = multiplyExact(speed, addExact(delta, shift, budget), budget);
          const displacement = addExact(errorB, bTail, budget);
          rootDistance = addExact(witnessError, bTail, budget);
          trimmedLeaves.add(bEnd.leaf);
          if (bEnd.side === "start") {
            trimStart[bEnd.leaf] = joint[1];
            if (bLine) lineJointStart[bEnd.leaf] = displacement;
            else correctionStart[bEnd.leaf] = bTail;
          } else {
            trimEnd[bEnd.leaf] = subtractExact(one, joint[0], budget);
            if (bLine) lineJointEnd[bEnd.leaf] = displacement;
            else correctionEnd[bEnd.leaf] = bTail;
          }
          bRootBounds = [down(referenceRoot[0]), up(referenceRoot[1])];
        }
        // (T°4) the cut on A: both root boxes seen from C_A strictly inside
        // A's reference / emitted leaf wedges; the cut chord hulls both.
        const referenceDirections = boxDirections(aArc, referenceBox!, center);
        const emittedDirections = boxDirections(aArc, emittedBox!, center);
        if (
          !referenceDirections ||
          !emittedDirections ||
          !referenceDirections.every((direction) =>
            strictlyInside(aArc, aWedges[1], direction),
          ) ||
          !emittedDirections.every((direction) =>
            strictlyInside(aArc, aWedges[0], direction),
          )
        )
          return fail(
            WINDOW,
            "The Lemma-T° cut is not proved strictly inside the implicit arc's terminal leaf.",
            true,
          );
        const turnA = turnOf(aArc);
        const cutLow = positive(
          turnA(emittedDirections[0], referenceDirections[0]),
        )
          ? emittedDirections[0]
          : referenceDirections[0];
        const cutHigh = positive(
          turnA(emittedDirections[1], referenceDirections[1]),
        )
          ? referenceDirections[1]
          : emittedDirections[1];
        // |dir X̂ − dir X*| ≤ |X̂ − X*| / min(|X̂ − C_A|, |X* − C_A|): the
        // radial projection onto the smaller sphere is 1-Lipschitz, with
        // |X̂ − C_A| ≥ ρ_lo (emitted circle) and |X* − C_A| = R_A.
        const nearest = minimum([radiusRange(aArc, aFamily)[0], aReference[0]]);
        if (!positive(nearest)) return fail(WINDOW, J2_MESSAGES.root, true);
        const aCut = {
          chord: divideExact(
            multiplyExact(aReference[1], rootDistance, budget),
            nearest,
            budget,
          ),
          wedge: [cutLow, cutHigh] as const,
        };
        // Commit: cuts, families, the record.
        for (const [end, cut] of [
          [aEnd, aCut],
          [bEnd, bCut],
        ] as const) {
          if (!cut) continue;
          trimmedLeaves.add(end.leaf);
          const entry = seedCuts.get(end.leaf) ?? {};
          entry[end.side] = cut;
          seedCuts.set(end.leaf, entry);
        }
        const cutOf = (end: Terminal) =>
          end === aEnd
            ? up(aCut.chord)
            : bCut && end === bEnd
              ? up(bCut.chord)
              : 0;
        seedTrimReports.push({
          kind: "arc-trim",
          jointIndex: declaration.jointIndex,
          first: firstEnd.leaf,
          second: secondEnd.leaf,
          circle: implicit === 0 ? "first" : "second",
          ...(bRootBounds && implicit === 0
            ? { secondRootBounds: bRootBounds }
            : {}),
          ...(bRootBounds && implicit === 1
            ? { firstRootBounds: bRootBounds }
            : {}),
          cut: [cutOf(firstEnd), cutOf(secondEnd)],
          tail: up(bTail),
        });
        return null;
      };
      const tries: (0 | 1)[] = [];
      if (seedLeaves.has(firstEnd.leaf)) tries.push(0);
      if (seedLeaves.has(secondEnd.leaf)) tries.push(1);
      let first: Failure | null = null;
      for (const implicit of tries) {
        const failure = attempt(implicit);
        if (!failure) return null;
        first ??= failure;
      }
      return first;
    };
    // Review R12 (option c), before any trim: the radius family of every
    // seed arc whose natural START is a trim, from that trim's stored root
    // bounds on the arc itself (angles; binary64 cos/sin one ulp outward),
    // so every Lemma-T° test at either end runs on the whole family.
    for (const arc of seedArcs.values()) {
      if (arc.kind !== "arc" || arc.start?.kind !== "trim") continue;
      const piece = general.pieces[arc.piece]!;
      const jointIndex = piece.reversed
        ? arc.piece
        : (arc.piece - 1 + pieceCount) % pieceCount;
      const declaration = general.trims.find(
        (trim) => trim.jointIndex === jointIndex,
      );
      // Meter A4: a family that cannot be computed fails closed (never a
      // silent zero-width family at a trimmed start).
      const noFamily = () =>
        uncertain(
          "arc-tube-error-unproven",
          `Seed arc ${arc.piece}: the review-R12 radius family of its trimmed start is not computable (a binary64 bound overflows).`,
          arc.leaves[0],
          arc.leaves.at(-1),
        );
      if (!declaration) return noFamily();
      // The arc is the traversal-first side iff it exits into this joint.
      const bounds =
        jointIndex === arc.piece
          ? declaration.firstParameterBounds
          : declaration.secondParameterBounds;
      const corners = bounds.map((angle) => [
        arc.centerValue[0] + arc.radiusValue * Math.cos(angle),
        arc.centerValue[1] + arc.radiusValue * Math.sin(angle),
      ]);
      if (!corners.flat().every(Number.isFinite)) return noFamily();
      const box: ExactRange[] = [];
      for (const axis of [0, 1] as const) {
        const values = corners.map((corner) => corner[axis]!);
        const low = nextBinary64(Math.min(...values), "down", budget);
        const high = nextBinary64(Math.max(...values), "up", budget);
        if (!Number.isFinite(low) || !Number.isFinite(high)) return noFamily();
        box.push([exactFromNumber(low, budget), exactFromNumber(high, budget)]);
      }
      const family = seedFamily(arc, box);
      if (!family) return noFamily();
      arc.family = family;
    }
    // T08b-g5d (uncharged, structural; nothing without a leaf offset): a
    // trim leaf offset is a count below its CUBIC piece's size, and review
    // R4: the deep trims at a piece's two natural ends never overlap,
    // k_start + k_end ≤ size − 1 (no leaf is removed by one end and trimmed
    // or removed by the other; one shared trim leaf keeps the retained-domain
    // check).
    const deepEnds = new Map<number, [number, number]>();
    for (const declaration of general.trims) {
      const { jointIndex } = declaration;
      for (const [offset, pieceIndex, exiting] of [
        [declaration.firstLeafOffset, jointIndex, true],
        [declaration.secondLeafOffset, (jointIndex + 1) % pieceCount, false],
      ] as const) {
        if (offset === undefined) continue;
        const piece = general.pieces[pieceIndex]!;
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset >= general.sizes[pieceIndex]! ||
          (offset > 0 && piece.kind !== "cubic")
        )
          return invalidPieceChain(
            `Trim ${jointIndex}: invalid trim leaf offset.`,
          );
        const ends = deepEnds.get(pieceIndex) ?? [0, 0];
        ends[exiting !== piece.reversed ? 1 : 0] += offset;
        deepEnds.set(pieceIndex, ends);
      }
    }
    for (const [pieceIndex, [start, end]] of deepEnds)
      if (start + end > general.sizes[pieceIndex]! - 1)
        return uncertain(
          "trim-window-unproven",
          `Piece ${pieceIndex}: its two deep trims overlap (a leaf removed by one end is trimmed or removed by the other).`,
          general.firstLeaf[pieceIndex]!,
          general.firstLeaf[pieceIndex]! + general.sizes[pieceIndex]! - 1,
        );
    for (const declaration of general.trims) {
      budget.operation(64);
      // One index space (review R5): the declared adjacency index.
      const { jointIndex } = declaration;
      const next = (jointIndex + 1) % pieceCount;
      // T08b-g5d: the chain-vertex leaves (H2, T7) and the trim leaves.
      const firstOffset = declaration.firstLeafOffset ?? 0;
      const secondOffset = declaration.secondLeafOffset ?? 0;
      const firstVertexEnd = terminal(jointIndex, true);
      const secondVertexEnd = terminal(next, false);
      const firstEnd = terminal(jointIndex, true, firstOffset);
      const secondEnd = terminal(next, false, secondOffset);
      /** The removed window leaves of one side, from the vertex inward. */
      const removedOf = (vertex: Terminal, offset: number) =>
        Array.from(
          { length: offset },
          (_, k) => vertex.leaf + (vertex.side === "end" ? -k : k),
        );
      const removedFirst = removedOf(firstVertexEnd, firstOffset);
      const removedSecond = removedOf(secondVertexEnd, secondOffset);
      const fail = (code: string, message: string, magnitude?: true) =>
        magnitude
          ? {
              ...uncertain(code, message, firstEnd.leaf, secondEnd.leaf),
              magnitude,
            }
          : uncertain(code, message, firstEnd.leaf, secondEnd.leaf);
      // U-B: a deep window lies inside the vertex leaf's source span.
      for (const [vertex, end, removed] of [
        [firstVertexEnd, firstEnd, removedFirst],
        [secondVertexEnd, secondEnd, removedSecond],
      ] as const) {
        if (removed.length === 0) continue;
        const anchor = tubes[vertex.leaf]!.source;
        if (
          [...removed, end.leaf].some(
            (leaf) =>
              tubes[leaf]!.source.splineId !== anchor.splineId ||
              tubes[leaf]!.source.spanIndex !== anchor.spanIndex,
          )
        )
          return fail(
            "trim-window-unproven",
            "A deep trim leaf lies beyond the terminal source span (U-B).",
          );
      }
      // T7: a trim inside ONE closed piece needs its positional closure.
      if (jointIndex === next) {
        const defect = authorityDefect(
          declaration.authority?.kind === "positional-closure"
            ? declaration.authority
            : undefined,
          jointIndex,
          jointIndex,
          firstVertexEnd,
          secondVertexEnd,
        );
        if (defect)
          return uncertain(
            KNOT_UNPROVEN,
            `Trim ${jointIndex}: ${defect}.`,
            firstEnd.leaf,
            secondEnd.leaf,
          );
      }
      const deep: DeepWindow | null =
        removedFirst.length > 0 || removedSecond.length > 0
          ? {
              firstVertex: firstVertexEnd,
              secondVertex: secondVertexEnd,
              removedFirst,
              removedSecond,
            }
          : null;
      const firstIsLine = lineData.has(firstEnd.leaf);
      // T08b-f Lemma T°: a seed-arc terminal on either side (own precharge).
      const seeded =
        seedLeaves.has(firstEnd.leaf) || seedLeaves.has(secondEnd.leaf);
      const graph = !seeded && !firstIsLine && !lineData.has(secondEnd.leaf);
      if (seeded) budget.operation(ARC_TRIM_PRECHARGE);
      // S2 cubic↔cubic: one fixed precharge before H2 or any conversion.
      if (graph) budget.operation(GRAPH_TRIM_PRECHARGE);
      // H2 gate: sgn(d)·cross(u_in, u_out) > 0 on exact source tangents
      // (T08b-g5d: at the TRUE vertex leaves, unchanged by a deep trim).
      const incoming = vertexTangent(firstVertexEnd);
      const outgoing = vertexTangent(secondVertexEnd);
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
      // A deep cubic window against a seed-arc leaf (Lemma T° on a deep
      // window) is out of g5d's scope: fail closed (the resolver never
      // builds one, review R1).
      if (seeded && deep)
        return fail(
          "trim-window-unproven",
          "A deep trim against a seed-arc leaf is not certified (Lemma T° on a deep window is not supported).",
        );
      if (seeded) {
        const failure = seedTrim(declaration, firstEnd, secondEnd, fail);
        if (failure) return failure;
        continue;
      }
      if (graph) {
        const retryable = new WeakSet<Failure>();
        const failure = graphTrim(
          declaration,
          firstEnd,
          secondEnd,
          fail,
          deep,
          false,
          retryable,
        );
        // T08b-g5d e fallback (design §3.4.6): deep S2 only (every pre-g5d
        // request keeps its verdict and charges), only after the raw chords
        // failed G1, G2 or Lemma V, once, with its own fixed precharge; any
        // binary64 e is sound. The raw failure is reported if it fails too.
        if (deep && failure && retryable.has(failure)) {
          budget.operation(GRAPH_TRIM_PRECHARGE);
          if (
            graphTrim(
              declaration,
              firstEnd,
              secondEnd,
              fail,
              deep,
              true,
              retryable,
            ) === null
          )
            continue;
        }
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
      // T08b-g5d Lemma T-W: the window cone, the same w·O′ > 0 on the true
      // O′ box of every removed leaf (one exact dot product each), so the
      // true offset meets the full support line of ℓ at most once on the
      // window; never a magnitude failure (review A1).
      const removedCurve = firstIsLine ? removedSecond : removedFirst;
      for (const leaf of removedCurve) {
        budget.operation(WINDOW_CONE_PRECHARGE);
        const removedBox = derivatives[leaf]!;
        const removedCorner: ExactPoint = [
          removedBox[0]![positive(w[0]) ? 0 : 1]!,
          removedBox[1]![positive(w[1]) ? 0 : 1]!,
        ];
        if (!positive(dot(w, removedCorner)))
          return fail(
            "trim-window-unproven",
            `The window cone s·rot(a)·O′ > 0 is not proved on removed leaf ${leaf}.`,
          );
      }
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
          ...(removedFirst.length > 0
            ? { firstLeafOffset: removedFirst.length }
            : {}),
          ...(removedSecond.length > 0
            ? { secondLeafOffset: removedSecond.length }
            : {}),
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
      // Removed leaves leave E and O* (every pair with them is K3-exempt).
      for (const leaf of removedCurve) removedLeaves.add(leaf);
    }

    // T°2 pairs (T08b-f): each line with an unexcluded other side must be
    // trimmed at BOTH ends against the same seed arc's exact circle K, the
    // two brackets on opposite sides of the foot (reference and emitted).
    for (const pair of linePairs) {
      const partner = linePairs.find(
        (other) =>
          other.leaf === pair.leaf &&
          other.side !== pair.side &&
          other.piece === pair.piece &&
          compareExact(other.radius, pair.radius, budget) === 0,
      );
      const opposite =
        partner &&
        pair.low.every(
          (low, index) =>
            low === undefined ||
            partner.low[index] === undefined ||
            low !== partner.low[index],
        );
      if (!opposite && !pair.wedgeClear()) {
        const [firstLeaf, secondLeaf] = [pair.leaf, pair.leaf];
        return {
          ...uncertain(
            "trim-classification-unproven",
            "A Lemma-T° line meets the implicit circle on its other monotone side, and that side is not the root of its other-end trim against the same circle (T°2).",
            firstLeaf,
            secondLeaf,
          ),
        };
      }
    }
    /**
     * One F1 arc (header T08b-e): admission, the R1 split, Lemma A ε (strict,
     * R3), the arc-entry/exit cones (Lemma E, R7), the bridge gates (E4′,
     * R2), G1 and the records. Writes nothing into the neighbours' ends.
     * Every failure is tagged with its `arcJoints`. Returns a failure, or null.
     */
    const certifyArc = (
      declaration: TubeChainArcDeclaration,
    ): Failure | null => {
      budget.operation(ARC_PRECHARGE);
      const index = declaration.jointIndex;
      const firstPiece = index;
      const secondPiece = (index + 1) % pieceCount;
      const firstEnd = terminal(firstPiece, true);
      const secondEnd = terminal(secondPiece, false);
      const entryLeaf = count + arcLeaves.length;
      const tagged = (failure: Failure): Failure => ({
        ...failure,
        arcJoints: [index],
      });
      const fail = (message: string) =>
        tagged(
          uncertain(
            KNOT_UNPROVEN,
            `Declared arc ${index}: ${message}`,
            firstEnd.leaf,
            secondEnd.leaf,
          ),
        );
      const defect = authorityDefect(
        declaration.authority,
        firstPiece,
        secondPiece,
        firstEnd,
        secondEnd,
      );
      if (defect) return fail(`${defect}.`);
      const p = endData(firstEnd);
      const q = endData(secondEnd);
      if (!samePoint(declaration.center, p.vertex))
        return fail(
          "the centre is not bitwise the incoming terminal source vertex.",
        );
      if (!Number.isFinite(declaration.radius) || !(declaration.radius > 0))
        return fail("the radius is not finite and positive.");
      if (distanceValue === 0) return fail("zero offset distance (no side).");
      // Exact classification on the traversal source tangents.
      const incoming = vertexTangent(firstEnd);
      const outgoing = vertexTangent(secondEnd);
      if (!incoming || !outgoing)
        return fail("the traversal source tangents are not proved nonzero.");
      const turnSign = compareExact(
        crossExact(incoming, outgoing, budget),
        zero,
        budget,
      );
      if (turnSign === 0)
        return fail("exactly parallel source tangents have no arc.");
      const sigma: 1 | -1 = turnSign > 0 ? 1 : -1;
      if (positive(distance) === sigma > 0)
        return fail("the vertex is not convex (sign(d)·X > 0).");
      if (declaration.sweep !== (sigma > 0 ? "counterClockwise" : "clockwise"))
        return fail("the sweep is not the exact source turn.");

      // Exact arc data: a = A′ − V, b = B′ − V, reference directions
      // nᵢ ∝ sign(d)·rot(uᵢ) (A − V = dN₁, B° − V = dN₂).
      const oriented = (value: ExactFraction) =>
        sigma > 0 ? value : negateExact(value, budget);
      const turn = (u: ExactPoint, v: ExactPoint) =>
        oriented(crossExact(u, v, budget));
      const rotated = (v: ExactPoint): ExactPoint => [
        negateExact(v[1], budget),
        v[0],
      ];
      const center = exactPoint(declaration.center);
      const radius = exactFromNumber(declaration.radius, budget);
      const start = exactPoint(p.emitted);
      const end = exactPoint(q.emitted);
      const a = difference(start, center);
      const b = difference(end, center);
      // (A1) orientation: excludes zero length, zero sweep and reversal.
      if (!positive(turn(a, b)))
        return fail(
          "the emitted arc ends are not in the exact turn orientation (zero length, zero sweep or reversed).",
        );
      const reference = (u: ExactPoint) =>
        positive(distance) ? rotated(u) : negated(rotated(u));
      const n1 = reference(incoming);
      const n2 = reference(outgoing);
      // (A2)/(A3) as exact direction signs (review A2): each end shift < π/2.
      if (!positive(dot(a, n1)) || !positive(dot(b, n2)))
        return fail(
          "an emitted arc end direction is not within a quarter turn of its reference normal.",
        );
      // Split rule (R1): one sub-arc iff a·b > 0 ∧ a·n₂ > 0 ∧ b·n₁ > 0.
      let split: ExactPoint | undefined;
      if (
        !positive(dot(a, b)) ||
        !positive(dot(a, n2)) ||
        !positive(dot(b, n1))
      ) {
        const s: ExactPoint = [
          addExact(a[0], b[0], budget),
          addExact(a[1], b[1], budget),
        ];
        // (A4): s inside the emitted wedge (both sub-sweeps < π/2) and the
        // reference wedge W(n₁, n₂).
        if (
          !positive(turn(a, s)) ||
          !positive(turn(s, b)) ||
          !positive(dot(a, s)) ||
          !positive(dot(s, b)) ||
          !positive(turn(n1, s)) ||
          !positive(turn(s, n2))
        )
          return fail(
            "the sub-arc split a + b is not inside both the emitted and the reference wedges.",
          );
        split = s;
      }

      // End bounds π ≥ |A′ − A|, |B′ − B| (T08b-c local split, capped by ε).
      const endBound = (end: Terminal) =>
        seedEndOf(end)?.bound ??
        lineData.get(end.leaf)?.endErrors[end.side === "end" ? 1 : 0] ??
        localBound(end.leaf, end.side, null) ??
        errors[end.leaf]!;
      const entryBound = endBound(firstEnd);
      const exitBound = endBound(secondEnd);
      const gap = difference(exactPoint(q.vertex), exactPoint(p.vertex));
      const gapZero =
        compareExact(gap[0], zero, budget) === 0 &&
        compareExact(gap[1], zero, budget) === 0;
      let bridge = zero;
      if (!gapZero) {
        const norm = squareRootUpper(dot(gap, gap));
        if (!norm) return fail(J2_MESSAGES.root);
        bridge = norm;
      }

      // Lemma A (exact, √-free but |g|⁺): concentric emitted and reference arcs.
      const absolute = (value: ExactFraction) =>
        negative(value) ? negateExact(value, budget) : value;
      const radiusAbs = absolute(distance);
      const distanceSquared = multiplyExact(distance, distance, budget);
      const radiusSquared = multiplyExact(radius, radius, budget);
      const aSquared = dot(a, a);
      const bSquared = dot(b, b);
      const radiusGap = absolute(subtractExact(radius, radiusAbs, budget));
      const shift = (squared: ExactFraction) =>
        divideExact(
          absolute(subtractExact(squared, distanceSquared, budget)),
          radiusAbs,
          budget,
        );
      const connector = (squared: ExactFraction) =>
        divideExact(
          absolute(subtractExact(radiusSquared, squared, budget)),
          radius,
          budget,
        );
      const entryConnector = connector(aSquared);
      const exitConnector = connector(bSquared);
      const entryError = maximum([
        addExact(
          addExact(radiusGap, shift(aSquared), budget),
          entryBound,
          budget,
        ),
        addExact(entryConnector, entryBound, budget),
      ]);
      const exitError = addExact(
        addExact(
          addExact(radiusGap, shift(bSquared), budget),
          exitBound,
          budget,
        ),
        bridge,
        budget,
      );
      const epsilon = split
        ? [entryError, exitError]
        : [maximum([entryError, exitError])];
      // R3: every arc leaf carries a collapsed radial connector, so its ε is
      // strictly below τ (the η reserve) and displacementBound = τ.
      for (const value of epsilon)
        if (compareExact(value, tolerance, budget) >= 0)
          return fail(
            "an arc leaf's Lemma-A error is not strictly below the modeling tolerance.",
          );

      // Lemma E cones (E1/E1′, R7): e_in = σ·rot(a), e_out = σ·rot(b); each
      // neighbour leaf's traversal emitted hodograph and O′ box corner (a
      // line's emitted step AND source direction) are strictly e-positive.
      const cone = (value: ExactPoint): ExactPoint =>
        sigma > 0 ? rotated(value) : negated(rotated(value));
      const entryCone = cone(a);
      const exitCone = cone(b);
      const boxAlong = (end: Terminal, e: ExactPoint) => {
        if (seedLeaves.has(end.leaf)) return seedReferenceAlong(end, e);
        const signed = end.reversed ? negated(e) : e;
        const box = derivatives[end.leaf]!;
        const corner: ExactPoint = [
          box[0]![positive(signed[0]) ? 0 : 1]!,
          box[1]![positive(signed[1]) ? 0 : 1]!,
        ];
        return dot(signed, corner);
      };
      const insideCone = (end: Terminal, e: ExactPoint) => {
        // T08b-f: a seed leaf's K1-wedge (emitted and reference wedges).
        if (seedLeaves.has(end.leaf)) return seedInsideCone(end, e);
        const signed = end.reversed ? negated(e) : e;
        return (
          hodographs[end.leaf]!.every((step) => positive(dot(signed, step))) &&
          positive(boxAlong(end, e))
        );
      };
      const exitLeaf = entryLeaf + (split ? 1 : 0);
      const coneFailure = (message: string, first: number, second: number) =>
        tagged(
          uncertain(
            "cubic-tube-cone-unproven",
            `Declared arc ${index}: ${message}`,
            first,
            second,
          ),
        );
      if (!insideCone(firstEnd, entryCone))
        return coneFailure(
          "the incoming terminal leaf is not proved inside the arc-entry cone.",
          firstEnd.leaf,
          entryLeaf,
        );
      if (!insideCone(secondEnd, exitCone))
        return coneFailure(
          "the outgoing terminal leaf is not proved inside the arc-exit cone.",
          exitLeaf,
          secondEnd.leaf,
        );
      // The bridge [B°, B]: e_out·g ≥ 0 (E4′), and against the reference parts
      // adjacent to its arc leaf (R2): O_P for one sub-arc, R₀ for two.
      if (!gapZero) {
        if (negative(dot(exitCone, gap)))
          return coneFailure(
            "backward declared gap at the arc exit (e_out·g < 0).",
            exitLeaf,
            secondEnd.leaf,
          );
        const covered = split
          ? !negative(dot(cone(split), gap))
          : positive(boxAlong(firstEnd, exitCone)) ||
            !negative(dot(entryCone, gap));
        if (!covered)
          return coneFailure(
            "the declared-gap bridge is not proved apart from the reference before it.",
            firstEnd.leaf,
            exitLeaf,
          );
      }
      // T08b-f Lemma W: next to a seed arc the two never-drawn connectors
      // are replaced by ONE segment between the consumer ends, rationalized
      // on the shared pole (review R4); steep in the arc-entry/-exit cone.
      const seedJunction = (
        terminalEnd: Terminal,
        entering: boolean,
      ): "vertical" | "steep" | Failure | undefined => {
        const seed = seedLeaves.get(terminalEnd.leaf);
        if (!seed) return undefined;
        const pole = entering ? start : end;
        const cone_ = entering ? entryCone : exitCone;
        const own: readonly [ExactPoint, ExactFraction] = [
          seed.arc.center,
          seed.arc.radius,
        ];
        const arc_: readonly [ExactPoint, ExactFraction] = [center, radius];
        const seedSlopes = wedgeSlopes(
          seed.arc.sigma,
          terminalEnd.reversed,
          seedWedges(seed)[0],
          cone_,
        );
        const arcWedge: readonly [ExactPoint, ExactPoint] = entering
          ? [a, split ?? b]
          : [split ?? a, b];
        const arcSlopes = wedgeSlopes(sigma, false, arcWedge, cone_);
        const kind =
          seedSlopes &&
          arcSlopes &&
          junction(
            pole,
            entering ? [own, arc_] : [arc_, own],
            cone_,
            entering ? [seedSlopes, arcSlopes] : [arcSlopes, seedSlopes],
          );
        if (!kind || (!kind.radial && seed.arc.start?.kind === "trim"))
          return coneFailure(
            `the realization segment between the seed arc and the arc ${entering ? "entry" : "exit"} is not proved steep (Lemma W).`,
            entering ? firstEnd.leaf : exitLeaf,
            entering ? entryLeaf : secondEnd.leaf,
          );
        if (!kind.radial) {
          seed.arc.nonRadial = true;
          const far = seedPointBox(center, radius, entering ? a : b);
          if (!far)
            return coneFailure(
              J2_MESSAGES.root,
              terminalEnd.leaf,
              terminalEnd.leaf,
            );
          seedHull(terminalEnd.leaf, terminalEnd.side, far);
        }
        return kind.kind;
      };
      const entryRealization = seedJunction(firstEnd, true);
      if (typeof entryRealization === "object") return entryRealization;
      const exitRealization = seedJunction(secondEnd, false);
      if (typeof exitRealization === "object") return exitRealization;

      // G1 [TECH E4]: tan α = |w·h|/|w×h| at each end (w×h ≠ 0 by the cones).
      const control = (end: Terminal, entering: boolean) => {
        const seedEnd = seedEndOf(end);
        if (seedEnd) {
          // The seed arc's traversal tangent at its emitted end direction.
          const natural =
            seedLeaves.get(end.leaf)!.arc.sigma > 0
              ? rotate(seedEnd.relative)
              : negated(rotate(seedEnd.relative));
          return end.reversed ? negated(natural) : natural;
        }
        const steps = hodographs[end.leaf]!;
        const natural = entering === end.reversed ? steps[2]! : steps[0]!;
        return end.reversed ? negated(natural) : natural;
      };
      const deviation = (w: ExactPoint, h: ExactPoint) =>
        up(
          divideExact(
            absolute(dot(w, h)),
            absolute(crossExact(w, h, budget)),
            budget,
          ),
        );
      const nearest = (value: ExactPoint): SplineVector => [
        exactToNumber(value[0], budget),
        exactToNumber(value[1], budget),
      ];
      const leaves = split ? [entryLeaf, entryLeaf + 1] : [entryLeaf];
      const wedge = { kind: "arc" as const, jointIndex: index, center, radius };
      if (split)
        arcLeaves.push(
          { ...wedge, sigma, from: a, to: split, start },
          { ...wedge, sigma, from: split, to: b, end },
        );
      else arcLeaves.push({ ...wedge, sigma, from: a, to: b, start, end });
      arcStars.push(...epsilon);
      arcNeighbours.set(
        `${Math.min(firstEnd.leaf, secondEnd.leaf)}:${Math.max(firstEnd.leaf, secondEnd.leaf)}`,
        index,
      );
      arcReports.push({
        kind: "arc-entry",
        jointIndex: index,
        first: firstEnd.leaf,
        second: entryLeaf,
        direction: nearest(entryCone),
        tangentDeviation: deviation(a, control(firstEnd, false)),
        ...(entryRealization ? { realization: entryRealization } : {}),
      });
      if (split)
        arcReports.push({
          kind: "arc-knot",
          jointIndex: index,
          first: entryLeaf,
          second: exitLeaf,
          direction: nearest(cone(split)),
        });
      arcReports.push({
        kind: "arc-exit",
        jointIndex: index,
        first: exitLeaf,
        second: secondEnd.leaf,
        direction: nearest(exitCone),
        tangentDeviation: deviation(b, control(secondEnd, true)),
        bridge: gapZero ? 0 : up(bridge),
        ...(exitRealization ? { realization: exitRealization } : {}),
      });
      arcRecords.push({
        jointIndex: index,
        authority: declaration.authority.kind,
        leaves,
        center: [declaration.center[0], declaration.center[1]],
        radius: declaration.radius,
        sweep: declaration.sweep,
        epsilon: epsilon.map(up),
        entryConnector: up(entryConnector),
        exitConnector: up(exitConnector),
      });
      return null;
    };
    for (const declaration of general.arcs) {
      const failure = certifyArc(declaration);
      if (failure) return failure;
    }
    // Closed chains need at least five leaves, arc leaves included (M0).
    // Conservative, not needed for soundness (T08b-e math review §3): when
    // every join's reference tangent set lies in an open half-plane
    // (vertices, natural joins, arcs), the four adjacent pairs of a closed
    // 4-leaf cycle turn by < 4π in total, while a simple closed O* turns by
    // ±2π and the pair sum counts each leaf twice (≥ 4π); such a chain is
    // therefore non-simple and K3 rejects it anyway (trims not covered).
    if (closed && general.arcs.length > 0 && count + arcLeaves.length < 5)
      return {
        ...uncertain(
          KNOT_UNPROVEN,
          "A closed chain with a declared arc needs at least five leaves, arc leaves included.",
        ),
        arcJoints: general.arcs.map((arc) => arc.jointIndex),
      };
  }

  /**
   * T08b-g5d Lemma-C glue fallback (design §3.4.3, review R14), on a deep
   * S2 side only and only after the reviewed ½ failed its collar: the dyadic glue fraction f = 1 − 2⁻ᵏ
   * (k = 2 … GLUE_DEPTH) from the trim leaf's vertex side, the first whose
   * EXACT emitted point E(f) clears the switch region with the same collar
   * quantity as ½ (`collared`, ε* of the leaf loop) while the retained
   * domain t_far + f < 1 holds. Writes the retained-domain fraction and the
   * report's glue; Lemma C is unchanged at any glue point beyond the collar.
   */
  const glueBeyondHalf = (
    index: number,
    side: NonNullable<ReturnType<typeof graphSides.get>>[number],
    collared: (value: ExactFraction) => boolean,
  ) => {
    const atStart = side.vertexSide === "start";
    for (let k = 2; k <= GLUE_DEPTH; k += 1) {
      budget.operation(GLUE_CANDIDATE_PRECHARGE);
      const fraction = subtractExact(
        one,
        exact(1n, 1n << BigInt(k), budget),
        budget,
      );
      const far = atStart ? trimEnd[index] : trimStart[index];
      if (
        far &&
        compareExact(addExact(far, fraction, budget), one, budget) >= 0
      )
        return false;
      const tau = atStart ? fraction : subtractExact(one, fraction, budget);
      const rest = subtractExact(one, tau, budget);
      const weights = [
        multiplyExact(multiplyExact(rest, rest, budget), rest, budget),
        multiplyExact(
          three,
          multiplyExact(multiplyExact(rest, rest, budget), tau, budget),
          budget,
        ),
        multiplyExact(
          three,
          multiplyExact(multiplyExact(rest, tau, budget), tau, budget),
          budget,
        ),
        multiplyExact(multiplyExact(tau, tau, budget), tau, budget),
      ];
      const value = weights.reduce(
        (sum, weight, pole) =>
          addExact(
            sum,
            multiplyExact(weight, side.poleX[pole]!, budget),
            budget,
          ),
        zero,
      );
      if (!collared(value)) continue;
      if (atStart) trimStart[index] = fraction;
      else trimEnd[index] = fraction;
      const report = trimReports[side.report] as TubeChainGraphTrimJoin;
      const glue = 1 - 2 ** -k;
      trimReports[side.report] = {
        ...report,
        glue:
          side.sideIndex === 0
            ? [glue, report.glue?.[1] ?? 0.5]
            : [report.glue?.[0] ?? 0.5, glue],
      };
      return true;
    }
    return false;
  };

  // Per-leaf composition (sums of both ends) and the K3 radii.
  budget.operation(4 * count);
  const stars: ExactFraction[] = [];
  const radii: ExactFraction[] = [];
  for (let index = 0; index < count; index += 1) {
    // T08b-g5d: a removed leaf carries no claim (not in E): its owner ε is
    // reported as its star and K3 radius, never composed.
    if (removedLeaves.has(index)) {
      stars.push(errors[index]!);
      radii.push(errors[index]!);
      continue;
    }
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
    const seed = seedLeaves.get(index);
    if (seed) {
      // T08b-f: ε (Lemma A-R) + vertex tails / correction paths + Lemma-T°
      // cut chords + the R12 family width, strictly below τ; every seed
      // leaf reports displacementBound = τ (its collapsed connectors and
      // step need the η reserve, T08b-e R3).
      const cuts = seedCuts.get(index);
      const oriented = (u: ExactPoint, v: ExactPoint) => {
        const value = crossExact(u, v, budget);
        return seed.arc.sigma > 0 ? value : negateExact(value, budget);
      };
      if (
        seed.stepInside &&
        [startTrim, endTrim].some(
          (fraction) => fraction && compareExact(fraction, half, budget) >= 0,
        )
      )
        return leafFailure(
          "retained domain does not keep the reference step inside the leaf",
        );
      if (
        cuts?.start &&
        cuts.end &&
        !positive(oriented(cuts.start.wedge[1], cuts.end.wedge[0]))
      )
        return leafFailure(
          "retained domain not proved nonempty between the two arc cuts",
        );
      let star = addExact(errors[index]!, seed.arc.family.width, budget);
      for (const correction of [
        correctionStart[index],
        correctionEnd[index],
        cuts?.start?.chord,
        cuts?.end?.chord,
      ])
        if (correction) star = addExact(star, correction, budget);
      if (compareExact(star, tolerance, budget) >= 0)
        return leafFailure(
          "corrected base error is not strictly below the modeling tolerance on a seed-arc leaf",
        );
      let radius = addExact(errors[index]!, seed.arc.family.width, budget);
      if (inflation[index])
        radius = addExact(radius, inflation[index]!, budget);
      stars.push(star);
      radii.push(radius);
      continue;
    }
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
        const collared = (value: ExactFraction) =>
          side.exiting
            ? compareExact(addExact(value, reach, budget), side.limit, budget) <
              0
            : compareExact(
                subtractExact(value, reach, budget),
                side.limit,
                budget,
              ) > 0;
        if (
          !collared(side.middle) &&
          !(side.deep && glueBeyondHalf(index, side, collared))
        )
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
  // F1 arc leaves: star = K3 radius = the Lemma-A ε (no neighbour inflation).
  for (const star of arcStars) {
    stars.push(star);
    radii.push(star);
  }

  // K3: exact hull clearance of every non-join pair.
  // Piece path: explicit adjacency (intra-piece natural joins, trims, wrap,
  // vertex pairs, arc-entry/knot/exit; never an arc's (P, Q) leaf pair).
  // T08b-f seed leaves: wedge items (with Lemma-W far-end hulls), their
  // natural knots and the F7 polar-graph exemption (review R9: the (first,
  // last) pair is still checked when a non-radial realization segment is
  // attached and the retained sweep is at least π).
  const seedWedgeItems = new Map<number, ArcWedge>();
  const seedKnots: TubeChainSeedKnotJoin[] = [];
  const exempt: string[] = [];
  for (const arc of seedArcs.values()) {
    const leaves = arc.leaves;
    for (const [position, leaf] of leaves.entries()) {
      const seed = seedLeaves.get(leaf)!;
      const hulls = seedHulls.get(leaf);
      seedWedgeItems.set(leaf, {
        kind: "arc",
        jointIndex: -1,
        center: arc.center,
        radius: arc.radius,
        sigma: arc.sigma,
        from: arc.emitted[seed.index]!,
        to: arc.emitted[seed.index + 1]!,
        ...(seed.startEnd && seed.startEnd.kind !== "trim"
          ? { start: seed.startEnd.pole }
          : {}),
        ...(seed.endEnd && seed.endEnd.kind !== "trim"
          ? { end: seed.endEnd.pole }
          : {}),
        ...(hulls?.start ? { startHull: hulls.start } : {}),
        ...(hulls?.end ? { endHull: hulls.end } : {}),
      });
      if (position > 0)
        seedKnots.push({
          kind: "seed-arc-knot",
          piece: arc.piece,
          first: leaves[position - 1]!,
          second: leaf,
        });
    }
    if (arc.kind === "circle")
      seedKnots.push({
        kind: "seed-arc-knot",
        piece: arc.piece,
        first: leaves.at(-1)!,
        second: leaves[0]!,
      });
    const from = arc.emitted[seedLeaves.get(leaves[0]!)!.index]!;
    const to = arc.emitted[seedLeaves.get(leaves.at(-1)!)!.index + 1]!;
    const turn = crossExact(from, to, budget);
    const wide =
      arc.kind === "arc" &&
      arc.nonRadial &&
      !positive(arc.sigma > 0 ? turn : negateExact(turn, budget));
    for (let i = 0; i < leaves.length; i += 1)
      for (let j = i + 1; j < leaves.length; j += 1)
        if (!(wide && i === 0 && j === leaves.length - 1))
          exempt.push(`${leaves[i]!}:${leaves[j]!}`);
  }
  // T08b-g5d: a removed leaf is in neither E nor O*, so its pairs are
  // exempt (Lemma T-W: the window cone covers the full support line of ℓ),
  // except that a deep S2 removed leaf keeps K3 against every retained
  // leaf of its partner piece outside the partner's window (review R13: on
  // a self-trim this partner rule wins over the own-piece exemption).
  for (const leaf of removedLeaves) {
    const partner = removedPartners.get(leaf);
    for (let other = 0; other < count + arcLeaves.length; other += 1) {
      if (other === leaf) continue;
      if (
        partner &&
        other < count &&
        general!.pieceOf[other] === partner.piece &&
        !partner.window.has(other) &&
        !removedLeaves.has(other)
      )
        continue;
      exempt.push(`${Math.min(leaf, other)}:${Math.max(leaf, other)}`);
    }
  }
  const adjacency =
    general &&
    new Set([
      ...[
        ...joins,
        ...[
          ...trimReports,
          ...vertexReports,
          ...arcReports,
          ...seedTrimReports,
          ...seedKnots,
        ].map((join) => [join.first, join.second]),
      ].map(([a, b]) => `${Math.min(a!, b!)}:${Math.max(a!, b!)}`),
      ...exempt,
    ]);
  const isJoin = (first: number, second: number) =>
    adjacency
      ? adjacency.has(`${first}:${second}`)
      : second === first + 1 || (closed && first === 0 && second === count - 1);
  const box = (cubic: ExactCubic) =>
    ([0, 1] as const).map((axis) => {
      const values = cubic.map((point) => point[axis]);
      return [minimum(values), maximum(values)] as const;
    });
  type K3Item = ExactCubic | ArcWedge;
  const isArc = (item: K3Item): item is ArcWedge => !Array.isArray(item);
  // Exact unit-direction enclosure per axis, one verified √ per distinct
  // wedge direction (cached by identity; bisection children share them).
  const units = new Map<ExactPoint, readonly ExactRange[] | null>();
  const unitOf = (direction: ExactPoint) => {
    const cached = units.get(direction);
    if (cached !== undefined) return cached;
    const length = squareRoot(dot(direction, direction));
    const result =
      length &&
      ([0, 1] as const).map((axis): ExactRange => {
        const near = divideExact(direction[axis], length[1], budget);
        const far = divideExact(direction[axis], length[0], budget);
        return compareExact(near, far, budget) <= 0 ? [near, far] : [far, near];
      });
    units.set(direction, result);
    return result;
  };
  const orientedCross = (wedge: ArcWedge, u: ExactPoint, v: ExactPoint) => {
    const value = crossExact(u, v, budget);
    return wedge.sigma > 0 ? value : negateExact(value, budget);
  };
  /** Strictly inside the σ-oriented wedge [from, to] (sweep < π). */
  const insideWedge = (wedge: ArcWedge, direction: ExactPoint) =>
    positive(orientedCross(wedge, wedge.from, direction)) &&
    positive(orientedCross(wedge, direction, wedge.to));
  /**
   * Exact box of a sub-arc wedge (sweep < π): V + ρ·U, U the per-axis hull
   * of both end-direction enclosures and ±1 wherever ±e_k lies inside the
   * wedge (each unit component is monotone there otherwise), hulled with
   * the connector end it carries. Null when a √ bound is not positive.
   */
  const arcBox = (wedge: ArcWedge) => {
    const from = unitOf(wedge.from);
    const to = from && unitOf(wedge.to);
    if (!from || !to) return null;
    return ([0, 1] as const).map((axis) => {
      const minusOne = negateExact(one, budget);
      const unit: ExactPoint = axis === 0 ? [one, zero] : [zero, one];
      const opposite: ExactPoint =
        axis === 0 ? [minusOne, zero] : [zero, minusOne];
      let low = minimum([from[axis]![0], to[axis]![0]]);
      let high = maximum([from[axis]![1], to[axis]![1]]);
      if (insideWedge(wedge, unit)) high = one;
      if (insideWedge(wedge, opposite)) low = minusOne;
      const values = [
        addExact(
          wedge.center[axis],
          multiplyExact(wedge.radius, low, budget),
          budget,
        ),
        addExact(
          wedge.center[axis],
          multiplyExact(wedge.radius, high, budget),
          budget,
        ),
        ...[wedge.start, wedge.end].flatMap((point) =>
          point ? [point[axis]] : [],
        ),
        ...[wedge.startHull, wedge.endHull].flatMap((box) =>
          box ? [box[axis]![0], box[axis]![1]] : [],
        ),
      ];
      return [minimum(values), maximum(values)] as const;
    });
  };
  /**
   * Binary64 near-bisector m of a wedge, admitted only when exactly inside
   * it; each connector end stays with the child containing its direction.
   */
  const splitArc = (wedge: ArcWedge) => {
    const approximate = (value: ExactPoint) => {
      const x = exactToNumber(value[0], budget);
      const y = exactToNumber(value[1], budget);
      const length = Math.hypot(x, y);
      return [x / length, y / length] as const;
    };
    const from = approximate(wedge.from);
    const to = approximate(wedge.to);
    const middle: SplineVector = [from[0] + to[0], from[1] + to[1]];
    if (!middle.every(Number.isFinite)) return null;
    const direction = exactPoint(middle);
    if (!insideWedge(wedge, direction)) return null;
    const base = {
      kind: "arc" as const,
      jointIndex: wedge.jointIndex,
      center: wedge.center,
      radius: wedge.radius,
      sigma: wedge.sigma,
    };
    return [
      {
        ...base,
        from: wedge.from,
        to: direction,
        start: wedge.start,
        startHull: wedge.startHull,
      },
      {
        ...base,
        from: direction,
        to: wedge.to,
        end: wedge.end,
        endHull: wedge.endHull,
      },
    ] as const;
  };
  /** Arc attribution of a K3 pair: its arc leaves' arcs and (P, Q) pairs. */
  const arcTag = (first: number, second: number) => {
    const joints = new Set<number>();
    for (const leaf of [first, second])
      if (leaf >= count) joints.add(arcLeaves[leaf - count]!.jointIndex);
    const neighbours = arcNeighbours.get(`${first}:${second}`);
    if (neighbours !== undefined) joints.add(neighbours);
    return joints.size > 0
      ? { arcJoints: [...joints].sort((left, right) => left - right) }
      : {};
  };
  const squaredLength = (vector: ExactPoint) => dot(vector, vector);
  const clearedPairs: (readonly [number, number])[] = [];
  let maxSplits = 0;
  const total = count + arcLeaves.length;
  const itemOf = (leaf: number): K3Item =>
    leaf < count
      ? (seedWedgeItems.get(leaf) ?? poles[leaf]!)
      : arcLeaves[leaf - count]!;
  // F9 (T08b-f0): each leaf's top-level exact box once per attempt, charged
  // before its work; the bisection's pops read it (pure memoization), and
  // its r-inflation [lo − r, hi + r] per axis feeds the broad phase. A leaf
  // without a box or with r < 0 stays out of the broad phase.
  const leafBoxes = new Map<K3Item, ReturnType<typeof arcBox>>();
  const inflated: (readonly ExactRange[] | null)[] = [];
  for (let leaf = 0; leaf < total; leaf += 1) {
    budget.operation(K3_LEAF_BOX_PRECHARGE);
    const item = itemOf(leaf);
    const bounds = isArc(item) ? arcBox(item) : box(item);
    leafBoxes.set(item, bounds);
    const radius = radii[leaf]!;
    inflated.push(
      bounds && compareExact(radius, zero, budget) >= 0
        ? bounds.map(
            ([low, high]): ExactRange => [
              subtractExact(low, radius, budget),
              addExact(high, radius, budget),
            ],
          )
        : null,
    );
  }
  const boxOf = (item: K3Item) => {
    const cached = leafBoxes.get(item);
    return cached !== undefined
      ? cached
      : isArc(item)
        ? arcBox(item)
        : box(item);
  };
  // Exact sweep over the inflated x-extents (sorted by exact lower end): a
  // non-join pair is a candidate iff its inflated boxes overlap (closed) on
  // both axes. Every other boxed pair is strictly disjoint on some axis.
  budget.operation(K3_SWEEP_PRECHARGE * total);
  const broadPairs = new Set<string>();
  let active: number[] = [];
  for (const leaf of mergeSort(
    [...inflated.keys()].filter((index) => inflated[index]),
    (a, b) =>
      compareExact(inflated[a]![0]![0], inflated[b]![0]![0], budget) <= 0,
  )) {
    const [x, y] = inflated[leaf]!;
    active = active.filter(
      (other) => compareExact(inflated[other]![0]![1], x![0], budget) >= 0,
    );
    for (const other of active) {
      const first = Math.min(leaf, other);
      const second = Math.max(leaf, other);
      if (isJoin(first, second)) continue;
      const otherY = inflated[other]![1]!;
      if (
        compareExact(otherY[1], y![0], budget) >= 0 &&
        compareExact(y![1], otherY[0], budget) >= 0
      )
        broadPairs.add(`${first}:${second}`);
    }
    active.push(leaf);
  }
  for (let first = 0; first < total; first += 1) {
    // This row's pair enumeration (join lookups, skipped pairs' records).
    budget.operation(total - first - 1);
    for (let second = first + 1; second < total; second += 1) {
      if (isJoin(first, second)) continue;
      if (
        inflated[first] &&
        inflated[second] &&
        !broadPairs.has(`${first}:${second}`)
      ) {
        clearedPairs.push([first, second]);
        continue;
      }
      const radius = addExact(radii[first]!, radii[second]!, budget);
      const radiusSquared = multiplyExact(radius, radius, budget);
      const stack: (readonly [K3Item, K3Item])[] = [
        [itemOf(first), itemOf(second)],
      ];
      const unproven = (message: string) => ({
        ...uncertain("cubic-tube-clearance-unproven", message, first, second),
        ...arcTag(first, second),
      });
      let splits = 0;
      while (stack.length > 0) {
        const [left, right] = stack.pop()!;
        const leftBox = boxOf(left);
        const rightBox = boxOf(right);
        if (!leftBox || !rightBox)
          return unproven(
            "An arc wedge box has no verified positive square-root bound.",
          );
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
        // Arc wedges: only their exact connector ends (A′, B′) are exact
        // on-curve points.
        const ends = (item: K3Item) =>
          isArc(item)
            ? [item.start, item.end].filter(
                (point): point is ExactPoint => point !== undefined,
              )
            : [item[0], item[3]];
        for (const u of ends(left))
          for (const v of ends(right))
            if (
              compareExact(
                squaredLength(difference(u, v)),
                radiusSquared,
                budget,
              ) <= 0
            )
              return unproven(
                "Certified error tubes overlap; true-offset separation not proved.",
              );
        budget.refinementStep();
        splits += 1;
        const width = (bounds: NonNullable<typeof leftBox>) => {
          const x = subtractExact(bounds[0]![1], bounds[0]![0], budget);
          const y = subtractExact(bounds[1]![1], bounds[1]![0], budget);
          return compareExact(x, y, budget) > 0 ? x : y;
        };
        const halves = (item: K3Item) =>
          isArc(item)
            ? splitArc(item)
            : ([
                restrict(item, zero, half),
                restrict(item, half, one),
              ] as const);
        const splitLeft =
          compareExact(width(leftBox), width(rightBox), budget) >= 0;
        const parts = halves(splitLeft ? left : right);
        if (!parts)
          return unproven(
            "An arc wedge has no exactly admitted binary64 bisector.",
          );
        if (splitLeft) stack.push([parts[0], right], [parts[1], right]);
        else stack.push([left, parts[0]], [left, parts[1]]);
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
      value === errors[index] && !lineData.has(index) && !seedLeaves.has(index)
        ? tube.certifiedError
        : up(value);
    const baseErrorStar = unchanged(stars[index]!);
    return {
      baseErrorStar,
      // τ on convex-END leaves (arc reserve), graph-trim leaves (glue
      // reserve), leaves with a declared-vertex reserve at EITHER end and
      // every seed-arc leaf (T08b-f).
      displacementBound:
        !seedLeaves.has(index) &&
        arcEnd[index] === undefined &&
        !graphSides.has(index) &&
        reserveStart[index] !== true &&
        reserveEnd[index] !== true
          ? baseErrorStar
          : modelingTolerance,
      clearanceRadius: unchanged(radii[index]!),
      ...(removedLeaves.has(index) ? { removed: true as const } : {}),
    };
  });
  if (arcLeaves.length > 0) {
    // F1 arc leaves (their records were bounded in their own metered step):
    // strict ε < τ with collapsed connectors, so displacementBound = τ (R3).
    budget.operation(3 * arcLeaves.length);
    for (let index = count; index < total; index += 1)
      leaves.push({
        baseErrorStar: up(stars[index]!),
        displacementBound: modelingTolerance,
        clearanceRadius: up(radii[index]!),
      });
  }
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
  certifiedJoins.push(...trimReports, ...vertexReports, ...arcReports);
  // T08b-f seed records (charged before they are built) and joins.
  const seedRecords: TubeChainSeedArcRecord[] = [];
  if (seedArcs.size > 0) {
    budget.operation(8 * seedArcs.size + 2 * seedLeaves.size);
    certifiedJoins.push(...seedTrimReports, ...seedKnots);
    for (const arc of seedArcs.values()) {
      const connector = (end: SeedEnd | undefined) =>
        end && !end.removed && end.kind !== "trim" ? up(end.connector) : 0;
      seedRecords.push({
        piece: arc.piece,
        kind: arc.kind,
        leaves: [...arc.leaves],
        center: [arc.centerValue[0], arc.centerValue[1]],
        radius: arc.radiusValue,
        radiusFamily: [arc.family.range[0], arc.family.range[1]],
        epsilon: arc.leaves.map((leaf) =>
          up(addExact(errors[leaf]!, arc.family.width, budget)),
        ),
        step: up(arc.step),
        radialGaps: [up(arc.gaps[0]), up(arc.gaps[1])],
        connectors: [connector(arc.start), connector(arc.end)],
        removed: [arc.removed[0], arc.removed[1]],
      });
    }
  }
  // Every declared arc produced its record and its one entry/exit join pair
  // (math review F2; uncharged). A skipped arc fails closed here.
  if (general) {
    const once = (kind: TubeChainArcJoin["kind"]) =>
      arcReports
        .filter((join) => join.kind === kind)
        .map((join) => join.jointIndex);
    const declared = general.arcs.map((arc) => arc.jointIndex);
    const matches = (indices: readonly number[]) =>
      indices.length === declared.length &&
      indices.every((value, position) => value === declared[position]);
    if (
      !matches(arcRecords.map((record) => record.jointIndex)) ||
      !matches(once("arc-entry")) ||
      !matches(once("arc-exit"))
    )
      return uncertain(
        "invalid-cubic-tube-chain",
        "A declared arc has no certified record or join: every declared arc needs exactly one.",
      );
    // T08b-f (F2-style, uncharged): every seed piece has exactly one record,
    // and every declared adjacency is covered by exactly one trim, vertex
    // or arc join.
    if (general.partitions.size > 0) {
      const pieces = [...general.partitions.keys()].sort((x, y) => x - y);
      const recorded = seedRecords.map((record) => record.piece);
      const adjacencyCount =
        general.pieces.length === 1 && general.pieces[0]!.kind === "circle"
          ? 0
          : closed
            ? general.pieces.length
            : general.pieces.length - 1;
      const covered = [
        ...trimReports,
        ...seedTrimReports,
        ...vertexReports,
        ...arcReports.filter((join) => join.kind === "arc-entry"),
      ]
        .map((join) => join.jointIndex)
        .sort((x, y) => x - y);
      if (
        recorded.length !== pieces.length ||
        recorded.some((piece, position) => piece !== pieces[position]) ||
        covered.length !== adjacencyCount ||
        covered.some((jointIndex, position) => jointIndex !== position)
      )
        return uncertain(
          "invalid-cubic-tube-chain",
          "A seed-arc record or a declared adjacency is missing or repeated: every seed piece and every adjacency needs exactly one.",
        );
    }
  }
  return {
    kind: "verified",
    certificate: {
      joins: certifiedJoins,
      ...(isolatedSpanDirection ? { isolatedSpanDirection } : {}),
      leaves,
      clearedPairs,
      maxSplits,
      ...(arcRecords.length > 0 ? { arcs: arcRecords } : {}),
      ...(seedRecords.length > 0 ? { seedArcs: seedRecords } : {}),
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
 * the whole emitted leaf, and so does an F1 arc end (T08b-e). Callers must
 * reject the other one-leaf pieces (the
 * offset-chain wrapper does) until the emitted-cone fix for single-leaf
 * pieces lands here.
 */
function certifyPieceChain(
  request: PieceTubeChainRequest,
  budget: ExactProofBudget,
  scale?: LeafScale,
): TubePieceChainResult {
  const { pieces, trims, closed, modelingTolerance, distance } = request;
  const vertices = request.vertices ?? [];
  const arcs = request.arcs ?? [];
  const only = pieces.length === 1 ? pieces[0] : undefined;
  if (
    only?.kind === "cubic" &&
    trims.length === 0 &&
    vertices.length === 0 &&
    arcs.length === 0
  ) {
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
      undefined,
      scale,
    );
  }
  budget.operation(
    pieces.length + trims.length + vertices.length + arcs.length,
  );
  if (pieces.length === 0)
    return {
      kind: "unsupported",
      code: "cubic-tube-chain-empty",
      message: "A cubic tube chain needs at least one emitted cubic.",
    };
  if (!Number.isFinite(distance))
    return invalidPieceChain("The chain distance must be finite.");
  // One index space (review R5): every declared adjacency is covered exactly
  // once by a trim, a vertex or an arc; each list strictly increasing. A
  // lone circle closes intrinsically (T08b-f [TECH] F11): no adjacency.
  const intrinsicCircle = pieces.length === 1 && pieces[0]!.kind === "circle";
  const adjacencies = intrinsicCircle
    ? 0
    : closed
      ? pieces.length
      : pieces.length - 1;
  const declaredOnly = vertices.length === 0 && arcs.length === 0;
  if (trims.length + vertices.length + arcs.length !== adjacencies)
    return invalidPieceChain(
      declaredOnly
        ? "One trim declaration is required per inter-piece adjacency."
        : arcs.length === 0
          ? "One trim or vertex declaration is required per adjacency."
          : "One trim, vertex or arc declaration is required per adjacency.",
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
      (declaredOnly && trim.jointIndex !== index) ||
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
  for (const [index, arc] of arcs.entries()) {
    if (
      !admissibleIndex(arc.jointIndex, arcs[index - 1]?.jointIndex ?? -1) ||
      !Array.isArray(arc.center) ||
      !finitePoint(arc.center)
    )
      return invalidPieceChain(`Arc ${index}: invalid declaration.`);
    covered.add(arc.jointIndex);
  }
  const tubes: (NeutralCubicPieceTube | undefined)[] = [];
  const lines: (NeutralLineTube | undefined)[] = [];
  const firstLeaf: number[] = [];
  const pieceOf: number[] = [];
  const sizes: number[] = [];
  const seeds: (SeedLeafRef | undefined)[] = [];
  const partitions = new Map<number, SeedPartition>();
  for (const [pieceIndex, piece] of pieces.entries()) {
    firstLeaf.push(tubes.length);
    const before = tubes.length;
    if (piece.kind === "line") {
      tubes.push(undefined);
      lines.push(piece.tube);
      seeds.push(undefined);
      pieceOf.push(pieceIndex);
      sizes.push(1);
      continue;
    }
    if (piece.kind === "arc" || piece.kind === "circle") {
      // T08b-f: precharged before the partition is chosen or data is read.
      budget.operation(
        piece.kind === "arc" ? ARC_SEED_PRECHARGE : CIRCLE_SEED_PRECHARGE,
      );
      // T08b-g7 P3: an arc with both natural ends declared adjacencies takes
      // at least two leaves (the owner's own structural predicate).
      const partition = seedPartition(
        piece,
        seedArcMinimumLeaves(closed, pieces.length, pieceIndex),
      );
      if (typeof partition === "string")
        return partition === "invalid"
          ? invalidPieceChain(`Piece ${pieceIndex}: invalid seed-arc tube.`)
          : uncertain(
              "arc-tube-partition-unproven",
              `Seed arc ${pieceIndex}: ${partition}.`,
            );
      partitions.set(pieceIndex, partition);
      const [head, tail] = partition.removed;
      for (let leaf = head; leaf < partition.count - tail; leaf += 1) {
        tubes.push(undefined);
        lines.push(undefined);
        seeds.push({ piece: pieceIndex, leaf });
        pieceOf.push(pieceIndex);
      }
      sizes.push(tubes.length - before);
      continue;
    }
    if (piece.kind !== "cubic" || piece.tubes.length === 0)
      return invalidPieceChain(`Piece ${pieceIndex}: no emitted leaves.`);
    budget.operation(piece.tubes.length);
    for (const tube of piece.tubes) {
      tubes.push(tube);
      lines.push(undefined);
      seeds.push(undefined);
      pieceOf.push(pieceIndex);
    }
    sizes.push(piece.tubes.length);
  }
  // [TECH] F12: every leaf above (and every declaration) is charged and
  // flattened; the core scales right after its own 64 + 16·count
  // precharge. Declared F1 arcs count one leaf each (their sub-arc split is
  // decided later by metered work).
  return certifyChain(
    {
      modelingTolerance,
      closed,
      // Line and seed leaves have no cubic tube; the core reads them
      // through `lines` / `seeds`.
      tubes: tubes as readonly NeutralCubicTube[],
    },
    budget,
    {
      distance,
      pieces,
      trims,
      vertices,
      arcs,
      firstLeaf,
      pieceOf,
      lines,
      sizes,
      seeds,
      partitions,
    },
    scale,
  );
}

/** The seed tube of an arc or circle piece (T08b-f); only called on those. */
function seedTubeOf(piece: TubeChainPiece): NeutralArcTube & NeutralCircleTube {
  return (piece as { readonly tube: unknown }).tube as NeutralArcTube &
    NeutralCircleTube;
}

/**
 * The partition of one seed piece (T08b-f), recomputed from its binary64
 * data by the shared rule-B′ helper (review A6: nothing carried is trusted;
 * the core re-proves every leaf). Bounded float and BigInt work covered by
 * the piece's precharge. "invalid" on malformed data, else a failure reason.
 */
function seedPartition(
  piece: Extract<TubeChainPiece, { kind: "arc" | "circle" }>,
  minimumLeaves: 1 | 2,
): SeedPartition | string {
  const tube = piece.tube as Partial<NeutralArcTube & NeutralCircleTube>;
  if (piece.kind === "circle")
    return piece.reversed === false &&
      finitePoint(tube.center) &&
      [tube.radius, tube.sourceRadius, tube.distance].every(Number.isFinite)
      ? {
          kind: "circle",
          splits: CIRCLE_DIRECTIONS,
          count: CIRCLE_DIRECTIONS.length,
          removed: [0, 0],
        }
      : "invalid";
  const arc = piece.tube;
  if (
    !finitePoint(arc.center) ||
    !Array.isArray(arc.emitted) ||
    !Array.isArray(arc.source) ||
    ![...arc.emitted, ...arc.source].every(finitePoint) ||
    ![arc.radius, arc.sourceRadius, arc.distance].every(Number.isFinite) ||
    (arc.sweep !== "clockwise" && arc.sweep !== "counterClockwise")
  )
    return "invalid";
  const splits = seedArcLeafSplits(
    arc.center,
    arc.emitted[0],
    arc.emitted[1],
    arc.sweep,
    arc.source[0],
    arc.source[1],
    minimumLeaves,
  );
  if (!splits)
    return "no rule-B′ partition of the arc is admitted (zero vector, full turn or no admitted bisector)";
  const count = splits.length + 1;
  const removed = arc.removed ?? [0, 0];
  if (
    !Array.isArray(removed) ||
    removed.length !== 2 ||
    !removed.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    removed[0] + removed[1] >= count
  )
    return "invalid";
  return { kind: "arc", splits, count, removed: [removed[0], removed[1]] };
}

/** Flattened leaves per production ceiling of one request ([TECH] F12). */
const LEAVES_PER_CEILING = 32;
/**
 * The cap on the leaf multiplier ([TECH] F12a): 128 = the adapter's
 * 4 096-leaf limit of one spline / 32. Larger requests get 128 × C and fail
 * closed by exhaustion if they need more.
 */
const MAX_LEAF_MULTIPLIER = 128;

/**
 * The leaf multiplier m = min(max(1, ⌈leaves / 32⌉), 128) of one request
 * ([TECH] F12, the D5 analogue; the cap is [TECH] F12a): the whole-request
 * additive ceilings (operations,
 * determinant terms, Euclidean, refinement and projection steps) become m ×
 * the production ceilings through `ExactProofBudget.raise`; the per-value
 * `integerBits` ceiling is never scaled and test lower limits stay absolute.
 * Charges are unchanged, so a request of ≤ 32 leaves (m = 1) is metered
 * exactly as before, and m can only turn an exhaustion into a result.
 *
 * m is applied ONCE, from counts charged before use, at the same point on
 * every path: in the core `certifyChain`, right after its `64 + 16·count`
 * admission precharge (no core work yet). On the legacy path (and the
 * single-piece delegate) leaves = count; on the piece path the precharged
 * flattening loop of `certifyPieceChain` has already run, and leaves = the
 * flattened leaves (cubic tubes, 1 per line, the 8 circle leaves, each seed
 * arc's rule-B′ partition minus its removed leaves) + 1 per declared F1 arc
 * (a lower bound: its sub-arc split is decided later by metered work).
 * Everything before that point, the core precharge included, runs under
 * m = 1 exactly as today, so a request that exhausts there (an oversized or
 * holey array, a precharge) exhausts as before, and a request failing
 * validation before it is never scaled. A staged request is scaled by its
 * attempt 1 only; later attempts are never rescaled (fail closed), and
 * m = 1 if attempt 1 stops before its scaling point.
 *
 * Worst-case fail-closed latency: a request may spend m × C ≤ 128 × C
 * before it exhausts, and a staged request attempts × m × C ≤ attempts ×
 * 128 × C (the SEL sizes attempts = 1 + flippable + switchable joints +
 * concave arc-side vertices, so the staged bound grows with the sketch).
 * At the T08b-a measured
 * rates (≈ 1.05 ops/µs, ≈ 0.30 Euclid/µs on adversarial cubic work) one C is
 * ≈ 5 s (Euclid-bound) to ≈ 9.5 s (ops-bound): ≈ 5–10 s per 32 leaves per
 * attempt, at most ≈ 11–20 min per attempt at the cap. Native chains
 * certify far faster (≈ 0.5–0.9 s per C measured on native zig-zag
 * splines, so ≈ 1–2 min per attempt at the cap; ≈ 2.2 s at 96 rounded
 * corners, 192 leaves, m = 6, where the adapter's solve dominates).
 */
function leafMultiplier(leaves: number): number {
  return Math.min(
    MAX_LEAF_MULTIPLIER,
    Math.max(1, Math.ceil(leaves / LEAVES_PER_CEILING)),
  );
}

/**
 * The production additive ceilings of `ExactProofBudget` (one request), per
 * attempt stage: the staged whole-request meter lets attempt k use at most
 * k × m times these in total (review R9; [TECH] F12, m fixed by attempt 1).
 * `integerBits` is per value, unscaled.
 */
const STAGE_CEILINGS = {
  operations: 10_000_000,
  determinantTerms: 1_536,
  euclideanSteps: 1_500_000,
  refinementSteps: 4_096,
  projectionAttempts: 2,
} as const;

/**
 * ONE budget over `attempts` certifications (ceilings × attempts × m, lower
 * limits absolute) whose cumulative additive meters are also capped at
 * stage k × m × the production ceilings while attempt k runs (m = 1 until
 * `scale`). Never reset, replaced or topped up; the stage only moves forward.
 */
class StagedProofBudget extends ExactProofBudget {
  readonly #attempts: number;
  #multiplier = 1;
  #stage = 1;
  #operations = 0;
  #determinantTerms = 0;
  #euclideanSteps = 0;
  #refinementSteps = 0;
  #projectionAttempts = 0;

  constructor(lowerLimits: LowerProofLimits | undefined, attempts: number) {
    super(lowerLimits, attempts);
    this.#attempts = attempts;
  }

  /** [TECH] F12: the one-shot leaf multiplier of the whole staged request. */
  scale(multiplier: number) {
    this.raise(this.#attempts * multiplier);
    this.#multiplier = multiplier;
  }

  advance() {
    this.#stage += 1;
  }

  #check(total: number, ceiling: number) {
    if (total > this.#stage * this.#multiplier * ceiling)
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

/** The one-shot F12 scaling of a certifier budget (staged or single). */
function scaleOf(budget: ExactProofBudget): LeafScale {
  return (leaves) => {
    const multiplier = leafMultiplier(leaves);
    if (budget instanceof StagedProofBudget) budget.scale(multiplier);
    else budget.raise(multiplier);
  };
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
    certify: (budget: ExactProofBudget, scale: LeafScale) => T,
  ): T | typeof EXHAUSTED => {
    const budget = new ExactProofBudget(lowerLimits);
    try {
      return certify(budget, scaleOf(budget));
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
      run(
        (budget, scale) =>
          certifyChain(
            request,
            budget,
            undefined,
            scale,
          ) as CubicTubeChainResult,
      ),
    certifyPieceChain: (request) =>
      run((budget, scale) => certifyPieceChain(request, budget, scale)),
    openRequest: (attempts) => {
      if (!Number.isSafeInteger(attempts) || attempts < 1)
        throw new RangeError(
          "A staged certifier request needs a positive integer attempt count.",
        );
      // attempts = 1 is exactly the single-request meter (scaled by m).
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
            // [TECH] F12: only attempt 1 scales the staged request.
            return certifyPieceChain(
              request,
              budget,
              issued === 1 ? scaleOf(budget) : undefined,
            );
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
 * Production certifier under the unchanged exact-proof ceilings, scaled per
 * request by the leaf multiplier ([TECH] F12, `leafMultiplier`). Its
 * `certifyPieceChain` is unsound on its own for one-leaf cubic pieces in a
 * multi-piece chain (see `certifyPieceChain`).
 */
export function createCertifiedCubicTubeChain(): CertifiedCubicTubeChain &
  CertifiedTubePieceChain &
  CertifiedTubePieceChainRequests {
  return createCertifier();
}

/**
 * Test-only lower ceilings; construction clamps every value to the (leaf-
 * scaled) production ceilings, so lower limits are absolute.
 */
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
