# Design: Sketch Offset Derivation

## Context

- Existing derivations (`mirror`, `linearPattern`, `circularPattern`, `transform`) live in `SketchDerivationDefinition` and are recomputed from seed geometry post-solve in `src/contracts/sketch/derived-geometry.ts`. Offset fits this model exactly: masters in, derived outputs out, structured diagnostics when unsatisfiable.
- The slot edit-operator already offsets curves two-sidedly: `OffsetCurveDescriptor` (line/circle/arc/spline) and `TrimIntersection` joint math exist in `src/domain/sketch-editing/operations.ts`. This change factors that math into a shared offset module instead of duplicating it.
- OCCT is deliberately not involved: the sketch loop is synchronous pure TS, and OCCT's exact 2D offset curves (`Geom2d_OffsetCurve`) would need re-approximation into sketch entity kinds anyway, paying a worker round-trip for no representational gain.
- External motivation, not a driver of the contract: Onshape encodes sketch offset as master→derived with per-entity `halfSpace` side flags; the import provider (separate change) will map onto this derivation.

## Decision 1: Offset is a derivation, not a constraint

Outputs are recomputed from masters after each solve, like mirror/pattern. The offset distance is a parameter of the relationship (dimensionable, expression-capable via the existing sketch-dimension-expressions path), not a solver unknown. Consequences accepted: users cannot back-drive masters by dragging offset outputs in v1; constraining onto offset outputs has the same support level as constraining onto other derived geometry.

## Decision 2: Contract shape

```
{
  kind: "offset",
  seeds: ordered connected chain of seed entity references,
  distance: dimension value/expression (signed; sign encodes side
            relative to chain traversal orientation),
  jointPolicy: "trimExtendArcFallback" (closed enum, single v1 member),
  outputs: stable derived entity/point identities per seed segment
           and per generated joint arc
}
```

- Side semantics: one signed distance per relationship. Chain traversal orientation is normalized at authoring time; per-entity mixed sides are not representable in v1 (the `jointPolicy`/future fields are the extension point if real models demand it).
- Output identity stability: each seed segment maps to a stable output id; joint arcs get ids derived from the adjacent seed pair, so downstream references survive recompute (same durability contract as pattern instances).

## Decision 3: Curve mathematics

- Lines, circles, arcs: closed-form (translate line; r ± d for circles/arcs). Arc collapse (d ≥ r for the shrinking side) is a structured diagnostic, not a silent skip.
- Splines/beziers: exact offsets do not exist in the entity vocabulary (the offset of a Bézier is not a Bézier). Sample the seed at curvature-adaptive parameters, displace along normals, refit as a spline through the offset samples, and verify deviation against a fixed relative tolerance; exceeding tolerance increases sampling density up to a bound, then fails with a diagnostic.
- Joints: intersecting neighbors are trimmed/extended to their intersection; non-intersecting convex corners get an arc join centered on the shared seed vertex with radius |d|.

## Decision 4: Degeneracy policy

Fail loudly, keep the relationship: when the distance makes any segment degenerate (arc collapse, spline fit failure, chain self-intersection), the derivation reports a structured diagnostic and the outputs keep their last resolvable state, mirroring the existing "Derived relationship cannot be maintained" requirement. No auto-culling of self-intersection loops in v1 (open question in proposal.md); no silent conversion to static copies, ever.

## Decision 5: Tool workflow

Offset registers as a sketch-mode operator tool alongside Mirror/Patterns/Transform: select a connected chain → live preview follows the pointer side/distance → numeric input commits. Chain selection reuses target-selection semantics; validation rejects disconnected selections and unsupported entity kinds (profile text) before mutation, consistent with `sketch-edit-operator-tools` validation behavior. v1 boundary: the tool commits a plain numeric distance; the contract/recompute layer accepts authored expression distances (used by importer-authored payloads), and a post-commit UI to rebind the distance to an expression is a follow-up (tasks.md 6.1).

## Decision 6: Testing (per docs/testing.md)

Lane: **logic**. Seams: the factored offset math module (closed-form curves, spline tolerance conformance, joint trim/extend/arc cases, degeneracy diagnostics) and derivation recompute through `derived-geometry.ts` (seed edit propagation, distance expression changes, output identity stability). `bun:test` `.spec.ts` colocated with the code. The slot tool's existing specs guard the factoring refactor. Tool presentation is covered by the existing generic sketch-tool presentation contract; no new UI-lane tests unless the preview needs bespoke presentation logic. No e2e.

## Risks

- Refactoring slot math into a shared module regresses slot behavior → mitigated by keeping slot's specs green through the refactor and adding characterization cases before moving code.
- Spline offset quality (wiggly refits at tight curvature) → mitigated by curvature-adaptive sampling and the deviation check; tolerance is a single named constant so tuning is not archaeology.
- Chain orientation normalization surprising users on ambiguous selections (e.g. closed loops) → mitigated by deterministic orientation rules and side preview before commit.
