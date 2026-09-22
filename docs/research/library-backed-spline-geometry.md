# Library-backed ordinary-spline geometry

Research for [issue12](../../.scratch/sketch-product-readiness/issues/12-library-backed-spline-geometry.md), informing the still-open [issue08](../../.scratch/sketch-product-readiness/issues/08-spline-geometry-and-topology.md). Investigated 2026-09-20. **Research, not a product or architecture decision.**

The research skill was reviewed and the delegated worker performed the investigation directly. This single artifact is retained in the active checkout: no authorization was given to create a research branch, bookmarks, commits, or other Jujutsu history changes. No production code, repository tests, tickets, or map were edited. External sources/packages and throwaway probes were held under `/tmp/cadara-spline-research`.

## Findings that change the decision

1. **Explicit cubic Bézier spans can express the approved local interpolating behavior exactly without OCC or solver objects in the data.** This does not select the automatic tangent formula, parameterization, ownership location, or library. All investigated routes still need that small behavioral policy. Representation agreement, rather than a shared kernel implementation, can preserve independent solver/kernel replacement (§2).
2. **No investigated library removes all custom numerical/topological work.** Bézier.js is small but its projection and intersections are unsuitable as an unqualified modeling authority: an on-curve projection probe missed by `7.2494657e-4` model units, and its intersection code truncates returned parameters to increments of `1e-5`. Paper.js has substantially more planar path machinery, but its fixed tolerances, stopping limits, circular-arc approximation, and graphics-oriented topology must not silently redefine CAD geometry. OCC offers richer native queries, but the app's current custom WASM exports none of the required curve constructors; the underlying OCCT capability is a different fact (§3–§6).
3. **Crossing behavior and the current spec need explicit reconciliation.** Issue08 approves bounded regions from authored crossings, including self-crossing splines. The solver spec says “Region extraction SHALL reject self-intersecting rings.” A *proposed reconciliation* is to split authored curves into parameter-trimmed edges, derive simple bounded rings, and continue rejecting invalid final rings. This is not an approved implementation or permission to mutate authored curves. See [issue08, “Gap feedback and crossing regions approved”](../../.scratch/sketch-product-readiness/issues/08-spline-geometry-and-topology.md#gap-feedback-and-crossing-regions-approved) and the [exact existing requirement](../../openspec/specs/sketch-constraint-solver/spec.md#requirement-region-extraction-shall-reject-self-intersecting-rings).
4. **A library's `dC/dt` is not the solver's Jacobian with respect to authored variables.** Existing point-on-spline constraints already need correct spline residuals and solver-variable derivatives; current code instead measures distance to the fit-point polyline and uses numerical differentiation. General spline-to-curve tangency is not established current support and must not be smuggled into this scope. Automatic-tangent/parameter chain rules remain integration work under every route (§4).

**Bounded comparison:** three viable building-block approaches, one early-rejected interpolation alternative, and the pure-math baseline. No whole-solver or kernel replacement survey was performed.

## 1. Requirements and verified local baseline

### Approved behavior, not algorithm choices

Sources: [consistency contract](../../.scratch/sketch-product-readiness/issues/03-state-and-geometry-contract.md#answer), [dragging contract](../../.scratch/sketch-product-readiness/issues/05-predictable-dragging.md#answer), [issue08 decisions](../../.scratch/sketch-product-readiness/issues/08-spline-geometry-and-topology.md).

- Ordinary splines pass through every authored fit point. Spans are local-influence cubics; moving a point must not change distant spans. Continuous curvature is not required.
- Every fit point has an automatic tangent until explicitly adjusted. One interior authored tangent controls a shared direction and magnitude, not independent incoming/outgoing handles or a corner.
- Moving a fit point translates its authored handle by the same delta, preserving its vector. A handle drag leaves fit points fixed; a body drag requests translation of all fit points and handles. Existing hard constraints still govern accepted motion.
- Explicit **Close spline** wraps smoothly. Joining the ends of an open spline gives positional closure only; it must not silently impose tangent continuity. Both may bound regions.
- Intersections, self-crossings, tangent contacts, overlap ambiguity, and near-coincident endpoints need deliberate handling. Deriving profiles must not mutate authored geometry. Construction curves are excluded. Ambiguous overlap or failed intersection gets a geometry-linked diagnostic, not a guessed region.
- One zoom-independent modeling tolerance policy covers endpoint matching, intersections, and OCC handoff. `1e-6` model units is only a candidate. Screen proximity may prompt a gap warning but cannot establish closure. Offered repair is **merge two points**, carrying references; it is not a connector, new coincidence constraint, silent healing, or discarded constraints.
- Editable, finished, picked, solved, consumed, and reopened curves must have the same meaning. Display tessellation is not modeling geometry. Invalid authored edits persist with diagnostics; stale last-valid geometry is not consumable current geometry.

**Still unknown/undecided:** automatic tangent formula, span parameterization and handle units/scaling, endpoint tangent policy, degenerate/coincident fit-point handling, zero-length tangent handling, exact tolerance budget, ownership mechanism, topology library/algorithm, and conflict behavior for point merging. Choosing a library does not answer these by default.

### Architectural constraints

The [solver spec](../../openspec/specs/sketch-constraint-solver/spec.md) requires a standalone sketch-only solver consuming contract data/numeric helpers, analytical evaluation for supported authored constraints, sketch-owned region extraction outside kernel-specific adapters, explicit solve/derive separation, even-parity nesting, diagnostics, and content-stable region identity. The [frontend boundary spec](../../openspec/specs/frontend-modeling-boundary/spec.md) requires replaceable kernels without reshaping UI. The [editing spec](../../openspec/specs/sketch-geometry-editing/spec.md) keeps interactive solving warm-started and permits deferred region extraction, not stale profile consumption.

The [layering ADR](../architecture/layering-adr.md#dependency-rules) forbids `contracts → core/application/infrastructure`. Existing solver and extractor live in `contracts/sketch`; putting a new implementation in `core` and importing it backward is not an acceptable shortcut. A numeric dependency or narrowly changed service seam must be checked against these actual boundaries; no broad migration is justified by this report.

### Issue08's key implementation claims rechecked

| Current path | Verified interpretation / consequence |
| --- | --- |
| [schema.ts](../../src/contracts/sketch/schema.ts), spline authored/solved variants, lines 359–373 and 1247–1256 | Fit/control-point ambiguity, degree `2 | 3`; no ordinary-spline tangent override or smooth-closure representation in those variants. |
| [display.ts](../../src/domain/editor/sketch-session/display.ts), `sampleSplinePoints`, line 65; call near 728 | Separate edit-time sampler. |
| [snapshot.ts](../../src/domain/modeling/occ/snapshot.ts), lines 2053–2054 | Finished spline rendering uses `entity.fitPoints` directly. |
| [interaction geometry.ts](../../src/domain/sketch-interaction/geometry.ts), `sampleSplinePoints`, line 518 | Few points are interpreted as Bézier controls; larger sets use sampled Catmull–Rom spans. |
| [solver-core.ts](../../src/contracts/sketch/solver-core.ts), `pointSplineDistance`, line 767 | Distance to fit-point polyline, including projected spline operands. |
| [snap-candidates.ts](../../src/domain/sketch-snapping/snap-candidates.ts), `nearestPointOnSpline`, line 1066 | Nearest point on the fit-point polyline. |
| [offset-geometry.ts](../../src/contracts/sketch/offset-geometry.ts), comment/function near 469, trim handling near 1241 | Offset interprets fit-point polylines; spline join/trim handling is not exact trimmed-cubic geometry. |
| [region-extraction.ts](../../src/contracts/sketch/region-extraction.ts), `buildSegments`, near 562–682 | Ordinary spline boundaries are not admitted as curve segments. Existing traversal/nesting/diagnostics cannot simply be assumed sufficient for arbitrary crossings. |
| [sketch-profile.ts](../../src/domain/modeling/occ/sketch-profile.ts), spline rejection near 287, 1085, 1394 | Local and projected spline profile consumption is rejected. |
| [custom recipe](../../opencascade-recipe.yaml), [custom declarations](../../public/cadara-occ.d.ts) | Required constructors are not bound. Runtime export check confirms absence (§6); references to spline handle types in declarations are not constructible bindings. |

This verifies the central mismatch rather than relying only on the [prior audit](../../.scratch/sketch-product-readiness/evidence.md). Other consumers, including measurement and derived geometry, still require a call-site inventory during implementation; this is not a claim that every interpretation was exhaustively traced.

## 2. Neutral representation and exact OCC conversion

**Mathematical inference, independently checkable from the cubic Bernstein basis:** for span endpoints `P_i`, `P_(i+1)`, parameter interval length `h_i > 0`, and derivatives `T_i`, `T_(i+1)` with respect to that parameter, the cubic Bézier poles are:

```text
B0 = P_i
B1 = P_i     + h_i T_i / 3
B2 = P_(i+1) - h_i T_(i+1) / 3
B3 = P_(i+1)
C(u) = (1-u)^3 B0 + 3(1-u)^2 u B1 + 3(1-u)u^2 B2 + u^3 B3
0 <= u <= 1
```

It follows directly that `C(0)=P_i`, `C(1)=P_(i+1)`, `dC/ds` at the endpoints is the prescribed `T`. Equal tangent vectors across adjacent spans give C1 continuity in `s`; with unequal span intervals, equal raw Bézier handle lengths alone do **not** establish equal `dC/ds`. Uniform versus chord-length parameterization therefore affects handle semantics and Jacobians. No particular choice is recommended as approved.

**Possible small data seam, not a schema decision:** authored fit-point IDs, optional relative tangent vectors/auto state, closure intent; solved cubic poles plus span identity and parameter interval; derived boundary references `{source entity/reference, span, u0, u1, orientation}`; geometry validity/diagnostics and revision basis alongside results. Preserve analytic line/arc/circle records instead of converting everything to polynomial cubic paths. Persist enough authored policy/version information for deterministic same-version reopen; do not persist Paper/OCC instances.

OCCT's [`Geom_BezierCurve`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKG3d/Geom/Geom_BezierCurve.hxx) accepts explicit poles and supplies derivative and segmentation operations. A non-rational cubic is also exactly a degree-3 clamped B-spline with endpoint multiplicities four, unit weights, and four poles; [`Geom_BSplineCurve`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKG3d/Geom/Geom_BSplineCurve.hxx) documents explicit poles/knots/multiplicities. Mapping the poles affinely from the sketch plane into 3D preserves the curve. Per-span exact edges avoid needing to approve a composite B-spline knot scheme now.

[`BRepBuilderAPI_MakeEdge`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepBuilderAPI/BRepBuilderAPI_MakeEdge.hxx) has curve-plus-parameter-bound constructors. These or exact de Casteljau subspans can represent crossing-to-crossing boundaries without polyline approximation or refitting endpoints. Reversed traversal, shared vertices, curve-parameter mapping, and tolerance-consistent wire construction remain adapter obligations. A geometrically smooth wrapped spline need not use an OCC *periodic* representation: matching endpoint derivatives of explicit spans can express the same geometry.

**Important limit:** these are mathematical/native API capabilities, not proof that the current WASM has bindings or that its edge/wire/face/extrusion pipeline succeeds. Current custom exports fail that first gate (§6). Explicit reconstruction is preferable to re-interpolating independently in OCC if exact agreement is required; independent interpolation may select a different curve.

## 3. Bounded comparison

### Baseline — shared pure numeric cubic implementation

The existing project does **not** already have one coherent cubic implementation; §1 lists incompatible interpretations. A pure implementation would keep contract records, standalone solving, region ownership and OCC adapters, but replace those interpretations with canonical spans. Evaluating/splitting cubics is small. Robust closest-point isolation, curve/curve and self-intersection classification, coincident intervals, mixed analytic curves, and arrangement extraction are the large maintenance obligations. No dependency/WASM cost, but highest ownership of numerical correctness. This baseline is not approved and should not be described as “just a sampler.”

### A. Bézier.js numeric spans + sketch-owned topology

**Verified:** [Bézier.js 6.1.4 source](https://github.com/Pomax/bezierjs/blob/4e767299184ab4079dc8d7c970020103db14f431/src/bezier.js) has explicit cubic construction, evaluation, first/second derivatives, split, projection, line/curve intersections and self-intersections. [Utilities](https://github.com/Pomax/bezierjs/blob/4e767299184ab4079dc8d7c970020103db14f431/src/utils.js), `pairiteration`, use bounding-box subdivision, default threshold `0.5`, and truncate parameter pairs at `1e-5`. `project` is LUT plus local sampling, not a certified global distance minimizer. §6 reproduces a projection miss on a point already on the curve.

- **Covers:** evaluation, derivatives in curve parameter, exact cubic subdivision. No automatic fit-point policy with the approved all-point tangent semantics, constraint solver, general region extraction, or trustworthy coincident-interval classification is established.
- **Mixed primitives:** supports lines; polynomial cubics cannot represent general circular arcs exactly. Retain analytic circles/arcs and supply mixed intersections elsewhere. Library `overlaps` bounding-box tests are not proof of overlapping geometric intervals.
- **Deployment:** [package manifest](https://github.com/Pomax/bezierjs/blob/4e767299184ab4079dc8d7c970020103db14f431/package.json) is MIT, JS ESM/CJS, no declared runtime dependencies. Offline execution needs no WASM or server. Published package unpacked size is 119,160 bytes, not measured application bundle size.
- **Maintenance evidence:** inspected branch commit is 2023-11-17; repository API `pushed_at` was 2024-08-04, not archived. These are activity observations, not a support guarantee.
- **Keep/replace/delete:** keep numeric solver and sketch topology owner; replace duplicated evaluators/sampling with library evaluation; delete superseded interpretations only after all consumers migrate. Do **not** replace solver/profile distance/intersection authority with unqualified `project`/`intersects`. Refinement/root solving and topology remain custom or need another backend.
- **Feasibility verdict:** viable as a small evaluation/subdivision dependency; **not demonstrated as the requested robust geometry/topology solution**. Its modest code savings must be weighed against wrapping or replacing its riskiest methods.
- **Smallest next probe:** on-curve projection and returned intersection residual checks at varied scale, plus coincident/tangent/self-crossing cases. Existing failure already means adopting it wholesale requires explicit refinement or another query backend, not just setting tolerance.

### B. Paper.js cubic paths + sketch-owned topology policy

**Verified:** [`Curve.js`](https://github.com/paperjs/paper.js/blob/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70/src/path/Curve.js) implements cubic evaluation/derivatives, nearest locations, self/curve intersections, overlap handling, and fat-line clipping. [`PathItem.Boolean.js`](https://github.com/paperjs/paper.js/blob/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70/src/path/PathItem.Boolean.js) contains boolean operations, crossing resolution, splitting/tracing, and winding/reorientation. `resolveCrossings` may modify/replace its path and removes overlap ranges: it must operate on disposable derived copies, and its overlap policy must not substitute for required diagnostics.

- **Covers:** more of the planar cubic path problem than A. Explicit segment points and paired handles can encode approved spans, but the app must enforce one authored interior tangent and its scaling. Do not call a generic smoothing operation and assume its influence/handles match the contract.
- **Not established:** extraction of *all* bounded regions from an arbitrary open CAD curve network with branches; stable source-span parameter provenance through booleans; CAD-grade tangency/overlap classification; shared tolerance fidelity. A closed bowtie probe produced two paths (§6), not proof of any of those properties.
- **Numerics:** [`Numerical.js`](https://github.com/paperjs/paper.js/blob/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70/src/util/Numerical.js) fixes `GEOMETRIC_EPSILON=1e-7`, `CURVETIME_EPSILON=1e-8`. `Curve.js` stops intersection recursion at 40 levels or 4096 calls. There is no demonstrated public model-space tolerance/error-result contract matching this project. Scaling coordinates does not automatically reconcile parameter and geometric tolerances or expose exhausted searches.
- **Mixed primitives:** its polynomial cubic path representation is not an exact replacement for CAD circular arcs. Using approximated circles for topology but exact circles in OCC risks different intersections/closure. Retaining exact primitives plus a mixed-query backend reduces the apparent advantage of an all-Paper arrangement.
- **Deployment/license:** [manifest](https://github.com/paperjs/paper.js/blob/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70/package.json), [MIT license](https://github.com/paperjs/paper.js/blob/92775f5279c05fb7f0a743e9e7fa02cd40ec1e70/LICENSE.txt). Browser JS with scope/project graphics state; `paper-core` avoids PaperScript, not all graphics architecture. No declared runtime dependencies in this manifest; the headless Node geometry probe ran without installing canvas. Worker/bundler isolation and avoiding DOM/Three dependencies in the standalone solver still need verification. Published package unpacked size is 12,321,041 bytes including more than runtime code; not the shipped bundle estimate.
- **Maintenance:** inspected develop commit 2024-07-17; API last push 2024-07-23, not archived. Large existing source/test surface is evidence of implemented algorithms, not evidence of active CAD support.
- **Keep/replace/delete:** keep authored data/constraints and sketch diagnostics/parity/identity policy. Replace numeric path queries and possibly portions of split/traverse logic on derived copies. Delete old approximations and traversal only where equivalent behavior/provenance is proved. Do not keep a shadow Paper document as a second authored authority.
- **Smallest next probe:** mixed line/arc/cubic network with one self-crossing, tangent touch and overlapping pair; demand source parameters for every output edge, diagnostic on ambiguity, and stable ring/hole identity across harmless re-solves. Repeat across coordinate scales and offline worker execution. If this requires forking core tolerances/booleans, include that maintenance cost before selection.

### C. Neutral cubics and standalone numeric solving + OCC geometric queries outside the solver

**Verified native facilities:** [`Geom2dAPI_InterCurveCurve`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKGeomAlgo/Geom2dAPI/Geom2dAPI_InterCurveCurve.hxx) supports two-curve and self-intersections with a tolerance, reporting points and tangential intersection segments. [`Geom2dAPI_ProjectPointOnCurve`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKGeomAlgo/Geom2dAPI/Geom2dAPI_ProjectPointOnCurve.hxx) exposes projection solutions and parameters. Endpoint comparison and trimmed-boundary restrictions still need caller handling. Tangential segments are tolerance-defined neighborhoods, not automatically proof of mathematically identical overlaps; inspect lower-level parameter results and failure state before assigning topology.

- **Covers:** promising native query machinery for exact lines/arcs/cubics, plus exact downstream edges. Does not automatically own approved local tangent generation, custom constraint Jacobians, all bounded-region extraction, parity, identities or diagnostics.
- **Independence condition:** the standalone solver must not load OCC or require its objects/execution, even behind a conveniently named helper. It needs independent numeric evaluation/constraint geometry. Sketch-owned region logic could consume an explicit numeric query service implemented by an OCC adapter; swapping kernels then requires replacing that optional service too, or deliberately retaining OCC as a separate geometry dependency. That is a visible dependency cost, not full independence by declaration. Native ring/face extraction buried inside the modeling adapter would contradict current sketch ownership.
- **Two ways to agree:** share neutral poles and run conforming evaluators, or retain a small numeric evaluator and use OCC only for noninteractive region queries/handoff. Neither requires OCC inside the solver. Neither makes alternate geometry providers free to implement.
- **Bindings/deployment:** custom exports lack constructors (§6). Add verified bindings or a narrow native numeric-in/numeric-out query shim; both require rebuilding the WASM and validating handle lifetimes/errors. Current recipe starts with `100MB` memory and permits growth to `4GB`; current WASM is approximately 16 MiB. Incremental bundle/startup/heap cost remains unmeasured. The project already has [offline OCC asset caching](../../src/infrastructure/occ/asset-cache.ts), but cache availability, cold startup and new bindings must be checked; no network service is inherently needed.
- **License/maintenance:** OCCT has [LGPL 2.1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/LICENSE_LGPL_21.txt) with the [OCCT exception](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/OCCT_LGPL_EXCEPTION.txt); the local OpenCascade.js package is `2.0.0-beta.b5ff984`, declares `LGPL-2.1-only` and peer dependency `ws`. Distribution/source/relinking obligations need review for custom WASM; the header exception is not a blanket removal of LGPL duties. Inspected upstream OCCT commit is dated 2026-08-24, but it is **not** the pinned native version proven inside this app's custom build. Modern headers establish candidates, not exact ABI compatibility.
- **Keep/replace/delete:** keep standalone solver, frontend service contract and sketch region policy. Replace intersection/projection backend and spline OCC rejection once runtime gates pass; delete parallel approximate topology paths rather than leaving alternate answers. Keep numeric solver support even if region queries use OCC. Native query shim and conformance fixtures become maintained surface.
- **Smallest next probe:** build only explicit cubic/2D query/trim-edge facilities, then exercise neutral poles → exact trimmed edges → wire/face/extrusion and mixed intersections; return numeric source parameters and diagnostics. Separately run the solver with the OCC import/init disabled. No such custom build was made here.

### Early rejection: verb-nurbs interpolation as a drop-in

[verb 3.0.3](https://github.com/pboyer/verb/blob/f3ba23cdccbab77102b686021460cf9779df240f/package.json) is MIT, Haxe-generated JS with `web-worker` dependency. Its [README](https://github.com/pboyer/verb/blob/f3ba23cdccbab77102b686021460cf9779df240f/README.md) advertises NURBS evaluation, derivatives, tessellation and intersections; [`Make.rationalInterpCurve`](https://github.com/pboyer/verb/blob/f3ba23cdccbab77102b686021460cf9779df240f/src/verb/eval/Make.hx), near line 631, constructs a chord-length basis matrix and solves for controls globally, with optional **endpoint** tangents. That implementation does not establish local fit-point influence or authored tangents at every fit point. Inspected commit/last push: 2025-04-02, not archived.

Reject that interpolation entrypoint for this contract, not NURBS mathematics or the entire library. Explicit per-span NURBS could encode the cubics, but would still need the same tangent policy, solver integration and topology work while bringing broader machinery. It does not justify a fourth runtime integration trial now. Similarly, native [`GeomAPI_Interpolate`](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKGeomAlgo/GeomAPI/GeomAPI_Interpolate.hxx) supports point/tangent constraints and periodic interpolation but does not document the approved local-influence guarantee; tangent scaling is also an API choice. Its existence is not grounds to replace explicit spans with independent OCC interpolation.

## 4. What solving still needs

**Verified current seam:** [solver-core.ts](../../src/contracts/sketch/solver-core.ts), `pointSplineDistance` (767), `createNumericalScalarConstraint` (near 970–1011), `pointOnCurve` construction (1755–1790), local/projected spline residual branches (1165–1213), and tangent handling (2093 onward). Point-on-local-spline already accepts splines and differentiates residual losses numerically over affected variables. Tangency implementations handle line/circle/arc combinations, not a demonstrated general spline tangency system. The [analytical-gradient requirement](../../openspec/specs/sketch-constraint-solver/spec.md#requirement-sketch-solver-shall-support-analytical-least-squares-evaluation-for-supported-authored-constraints) must not be claimed satisfied merely because a library has `derivative(t)`; the observed numerical path is an existing discrepancy, not a new design approval.

- Existing point, coincidence, fix/distance and drag objectives operate on fit-point variables without needing a closest point on the spline. Preserve their minimum-motion and continuity behavior; library geometry does not replace the solver.
- Existing point-on-spline residuals need the **actual curve**, global closest-point/endpoints handling or another explicitly justified residual formulation, and derivatives with respect to the constrained point and editable spline variables. Projected read-only spline operands need no derivatives with respect to projected poles, but still need correct curve geometry and derivatives with respect to the editable point.
- If `C(u,x)=Σ b_k(u) B_k(x)`, then at fixed `u`, `∂C/∂x = Σ b_k(u) ∂B_k/∂x`. For local auto tangents, `B_k(x)` includes neighboring fit points; if intervals depend on chord lengths, their derivatives matter too. Authored relative handles need the correct point/vector variable coupling. These chain rules remain custom integration even when `C`, `C'`, `C''`, subdivision and projection come from a library.
- Closest-point parameters solve `(C(u)-Q)·C'(u)=0` within each span, with endpoints and all competing spans considered. Differentiating a minimized squared distance can avoid differentiating the minimizing parameter at a unique regular interior optimum; multiple minima, endpoints, self-crossings and singular tangents need explicit treatment. This is a mathematical observation, **not** a chosen solver formulation. A sampled closest point is not proof of either convergence or analytic gradients.
- Handle dragging as approved requires encoding the authored vector and respecting existing applicable constraints; it does not itself approve every possible spline tangent/curvature constraint. If general spline tangency constraints are later added, residuals involving `C'`, possible contact parameters and derivatives of `C'` with respect to authored variables are additional work. Curvature constraints are not part of this investigation.

A minimal integration probe should compare analytical derivatives against independent finite differences away from degeneracies, then exercise existing point-on-spline dragging continuously through span joins. Finite differences here would be a verification oracle, not a substitute for the solver contract.

## 5. Topology and tolerance obligations remaining under every route

A bounded-region implementation needs more than intersection coordinates:

1. Enumerate curve pairs and same-curve/same-span self-intersections, including adjacent spans without mistaking their common endpoint for a crossing. Preserve both source parameters.
2. Classify transverse crossings, tangent contacts and overlap intervals. An intersection failure is not “no intersection.” Library stopping limits/failures must lead to diagnostics, not missing boundaries.
3. Split **derived** geometry at parameters; retain source entity/projected-reference identity, span and orientation. Shared crossing vertices are not authored point merges.
4. Extract bounded faces/rings from the resulting graph, correctly handling branches, tangent ordering, repeated/degenerate edges and open tails. Apply required nesting parity for holes/islands and maintain region identity. Proposed split-then-simple-ring validation still needs issue08 approval/spec clarification.
5. Hand exactly those trimmed curves to OCC. Validate endpoint/edge/wire/face consistency and downstream consumption; do not show a selectable region based solely on a polygon fill that OCC cannot reproduce.

**Tolerance is a policy with multiple dimensions, not one constant pasted into unrelated APIs.** Use a model-space geometric budget and explicitly derive parameter/angle/solver tolerances as necessary. A small parameter error can be a large geometric error where `|C'|` is large; near singular derivatives the converse conversion is ill-conditioned. Recheck candidate intersections on both original curves, deduplicate consistently, and ensure tolerance handling does not silently bridge a meaningful gap. Avoid scale/zoom-dependent healing. OCC's `1e-6` default is not proof the app's candidate `1e-6` is safe. Paper's internal epsilon and Bézier.js's parameter truncation demonstrate why a wrapper alone is insufficient.

**Minimal shared adversarial corpus before commitment:** two-point spline, uneven fit spacing, moved interior point, authored interior/end tangents, smooth wrapped seam, positional-only closure, same-span loop and multi-span crossing, line/cubic and circle/cubic crossing, tangent touch, coincident/reversed overlap and partial overlap, near-gap on either side of policy, zero/near-zero spans, nested hole/island, projected/construction curves, and invalid/stale input. Repeat a small subset at multiple model scales and large coordinate offsets; zoom must not affect model results. Verify source-parameter residuals, ring topology, error classification and OCC face/extrusion—not just screenshots. No library's marketing claim discharges these checks.

## 6. Executed feasibility probes and reproduction

These are throwaway **logic-seam investigations**, not repository tests, benchmarks, tolerance acceptance or browser validation. `docs/testing.md` was reviewed. No test files were added. Node was `v24.18.1`, Bun `1.3.13`; commands ran from the repository root. Inputs use abstract **sketch/model length units**, not assumed millimeters; `u` is dimensionless. All coordinates below are planar.

### Published-package setup (outside the checkout)

Exact packages: `bezier-js@6.1.4`, `paper@0.12.18`, downloaded from the npm registry tarballs, no project manifest/lock changes. Equivalent reproducible setup:

```sh
mkdir -p /tmp/cadara-spline-research/{bezier-js,paper}
curl -fLsS https://registry.npmjs.org/bezier-js/-/bezier-js-6.1.4.tgz \
  | tar -xz -C /tmp/cadara-spline-research/bezier-js
curl -fLsS https://registry.npmjs.org/paper/-/paper-0.12.18.tgz \
  | tar -xz -C /tmp/cadara-spline-research/paper
```

Metadata sources: [Bézier.js 6.1.4](https://registry.npmjs.org/bezier-js/6.1.4), [Paper 0.12.18](https://registry.npmjs.org/paper/0.12.18). Retrieved tarball sizes were 36,023 and 3,263,404 bytes respectively; neither measures application bundle size. Repository activity observations came from the first-party APIs for [Bézier.js](https://api.github.com/repos/Pomax/bezierjs), [Paper.js](https://api.github.com/repos/paperjs/paper.js), and [verb](https://api.github.com/repos/pboyer/verb); commit-pinned source links above are the reproducible code evidence.

### Cubic evaluation, projection and crossing

```sh
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Bezier } = require('/tmp/cadara-spline-research/bezier-js/package/dist/bezier.cjs');
const c = new Bezier(0,0, 1,1, 2,1, 3,0);
const p = c.get(.371234), q = c.project(p);
console.log(JSON.stringify({
  start:c.get(0), end:c.get(1), derivative:c.derivative(0),
  trimStart:c.split(.2,.8).get(0),
  projection:{target:.371234, actual:q.t, error:Math.hypot(p.x-q.x,p.y-q.y)},
  cross:c.intersects(new Bezier(0,.5, 1,.5, 2,.5, 3,.5),1e-6)
}));
JS
```

Observed: endpoints `(0,0)`, `(3,0)`; derivative at zero `(3,3)` model units per unit `u`; trimmed start `(0.6,0.48000000000000004)`. Projection returned `u=0.371`, with Euclidean error `0.0007249465699716858` **from an exactly on-curve query point**. Crossing returned strings `0.21132/0.21132` and `0.78867/0.78867` despite requesting threshold `1e-6`. For this cubic `y=3u(1-u)`, so the true horizontal intersections are `(1 ± sqrt(1/3))/2`; source truncation, not merely the probe, establishes the parameter quantization. These results disqualify an unqualified precision claim, not every use of the library.

### Paper nearest location and simple crossing resolution

```sh
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const paper = require('/tmp/cadara-spline-research/paper/package/dist/paper-core.js');
paper.setup(new paper.Size(100,100));
const c = new paper.Curve(0,0, 1,1, 2,1, 3,0);
const p = c.getPointAtTime(.371234), near = c.getNearestLocation(p);
const path = new paper.Path({
  segments:[[0,0],[2,2],[0,2],[2,0]], closed:true, insert:false
});
const resolved = path.resolveCrossings();
console.log(JSON.stringify({
  nearestTime:near.time, error:near.point.getDistance(p),
  derivative:c.getWeightedTangentAtTime(0).toString(),
  resolvedClass:resolved.className, children:resolved.children?.length,
  areas:resolved.children?.map(c=>c.area)
}));
JS
```

Observed: `u=0.3712339973449707`, Euclidean error `8.224981088483612e-9` model units, derivative `(3,3)`, `CompoundPath` with two children and signed areas approximately `-1` and `+1` square model units. This proves one headless cubic query and a **line-segment bowtie**, not spline self-crossing robustness, mixed CAD topology, parity correctness, or a tolerance guarantee. An initial probe incorrectly called instance `getNearestTime`; that API is not an instance method. The command above uses the working public `getNearestLocation` API.

### Actual app OCC export availability

Custom assets probed (SHA-256, reproducible with `sha256sum public/cadara-occ.js public/cadara-occ.wasm`):

- `public/cadara-occ.js`: `bbf678650ca7ea7d8f7a9e35e19f1fd14bf1553db2aedb2e64bda263e52843b2`
- `public/cadara-occ.wasm`: `dcfaa219494850ced274138912126a138728b9a529095a069ef01d8d43b681a7`

```sh
bun -e 'import init from "./public/cadara-occ.js";
const oc = await init({wasmBinary: new Uint8Array(
  await Bun.file("./public/cadara-occ.wasm").arrayBuffer())});
for (const name of ["Geom_BezierCurve", "Geom_BezierCurve_1",
  "Geom_BSplineCurve_1", "TColgp_Array1OfPnt_1",
  "GeomAPI_Interpolate_1", "Geom2dAPI_InterCurveCurve_1",
  "BRepBuilderAPI_MakeEdge_24"]) console.log(name, typeof oc[name]);
console.log("spline constructors", Object.keys(oc).filter(k =>
  /^(Geom_BezierCurve|Geom_BSplineCurve|TColgp_Array1OfPnt|Geom2dAPI_InterCurveCurve|GeomAPI_Interpolate)/.test(k)));'
```

Observed: every listed curve/interpolation/array/intersection constructor was `undefined`; `BRepBuilderAPI_MakeEdge_24` was `function`; filtered constructor list `[]`. Thus WASM initialized successfully and lacks those **JavaScript exports**. This does not mean OCCT lacks these algorithms, that no native code for them is linked, or that full-package `.d.ts` declarations prove custom-build availability. No custom-build extension, exact spline edge construction, browser/offline worker run, memory-leak test or extrusion probe was performed.

## 7. Decision handoff and remaining gates

The human can now compare concrete trade-offs without reopening approved spline behavior:

- **Small JS numeric dependency:** A reduces simple curve arithmetic, but projection/intersection/topology still need substantial ownership. Do not choose it expecting the complete problem to disappear.
- **Broader JS path machinery:** B may reduce planar topology code, conditional on exact mixed primitives, tolerance/error exposure, provenance and standalone deployment probes. If those require a fork, price the fork explicitly.
- **Reuse native geometric queries:** C has the closest documented exact mixed-curve facilities, conditional on new bindings and keeping it out of the standalone solver. Region-query dependency replacement must be explicit, not hidden behind the kernel-replaceability claim.

Before ownership is selected, settle tangent/parameter semantics and approve a tolerance policy; choose only the smallest relevant probe(s) above. Require separate evidence that (a) solver runs without OCC, (b) an alternate kernel consumes the same neutral span/trim data without UI changes, and (c) region extraction remains sketch-owned. Shared conformance fixtures can establish agreement between independent implementations; they are not a second product geometry definition.

This report does not recommend substituting global interpolation, polyline profiles, graphics-only boolean fills, silent endpoint snapping, or a whole solver/kernel rewrite. It does not settle issue08. Local Markdown link existence and trailing whitespace checks passed. The parent separately ran `bun run test:all`: lint/typecheck/build passed, then the logic lane failed (798 passed, 7 failed across Onshape apply-pipeline and OCC features/snapshot specs). UI, static, and E2E lanes were not reached. Results and the temporary log path are recorded in the [research ticket's validation section](../../.scratch/sketch-product-readiness/issues/12-library-backed-spline-geometry.md#validation). No production behavior is claimed fixed.
