## Context

The advanced-solid substrate identifies local topology modifiers as one of the feature families that should land after the shared participant model is in place. The current codebase already has a mature `fillet` path for edge selection, form rendering, preview/commit, OCC rebuild, and e2e coverage. Chamfer should reuse that shape where appropriate while remaining a distinct feature with its own parameter semantics and diagnostics.

Chamfer is also lower semantic risk than hole or external thread. It modifies selected edges with distance parameters and can validate many of the same durable topology concerns as fillet: explicit edge targets, positive dimensions, invalid-reference reporting, snapshot hydration, and visible preview/commit behavior.

## Goals / Non-Goals

**Goals:**
- Add `chamfer` as a part-mode feature registered through the existing tool and feature authoring registries.
- Represent chamfer through the advanced-solid feature contract with explicit `edge` participants and numeric chamfer parameters.
- Support an initial constant-distance chamfer on one or more durable body edges.
- Preserve chamfer definitions through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the initial supported chamfer shape and explicit unsupported-case diagnostics for unsupported chamfer variants.
- Add contract, authoring, adapter, and e2e coverage comparable to the existing fillet and extrude feature-flow coverage.

**Non-Goals:**
- Implement face blend, hole, external thread, or other local topology modifiers in this change.
- Implement variable-distance chamfer, asymmetric two-distance chamfer, angle-distance chamfer, setback/chordal variants, or per-edge parameter overrides in the first slice.
- Infer edge targets from face selection or viewport order.
- Change the existing fillet feature contract or behavior.
- Hide unsupported OCC chamfer combinations behind fallback fillet or bevel-like mesh-only rendering.

## Decisions

Represent chamfer as an advanced solid feature rather than cloning fillet's bespoke contract shape. Fillet already predates the advanced-solid substrate, but chamfer is a new feature and should prove that topology modifiers can use `AdvancedSolidFeatureDefinition` with role-specific participants and `options` for feature-owned parameters.

Use a constant-distance parameter for the first slice:

```text
chamfer
  required edge: edge, min 1, max many
  options.distance: positive number
```

This is intentionally narrower than full CAD chamfer support. It gives a useful first implementation, matches the existing fillet authoring complexity, and avoids committing to richer chamfer variant naming before there is a working baseline.

Keep chamfer selection behavior parallel to fillet. The authoring definition should accept durable edge targets, append unique selections, expose a reference collection field, show a numeric distance field, and report missing-edge or non-positive-distance diagnostics. This keeps the UI predictable while preserving feature-specific logic in `src/domain/feature-authoring/features/chamfer.ts`.

Add OCC support only for the initial supported edge chamfer shape. If OpenCascade support requires body-local edge grouping or fails for some edge/topology combinations, the adapter should return structured unsupported-case diagnostics rather than silently dropping edges or returning a mesh-only preview.

Make e2e coverage part of the feature slice. Chamfer is user-visible, so completion requires a Playwright flow that creates a base body, activates chamfer, selects at least one edge, enters a distance, observes preview readiness or expected diagnostics, commits, and verifies resulting document/timeline/geometry state.

## Risks / Trade-offs

- [OCC chamfer APIs may require more target context than a bare durable edge reference] -> Mitigate by deriving owning body context from each edge target and returning invalid-reference or unsupported-case diagnostics when the edge cannot be resolved.
- [Users may expect angle-distance or asymmetric chamfer variants immediately] -> Mitigate by naming the first parameter clearly as constant distance and leaving richer variants to follow-up changes.
- [Chamfer and fillet authoring could diverge unnecessarily] -> Mitigate by following the existing fillet module and shared form primitives while keeping the feature definitions separate.
- [E2e coverage can become brittle around exact generated edge IDs] -> Mitigate by using the shared feature harness's pattern-based edge selection where possible.

## Migration Plan

1. Add chamfer metadata, tool registration, authoring definition, and generic inspector schema wiring.
2. Add chamfer modeling validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement mock and OCC adapter behavior for the initial supported constant-distance edge chamfer.
4. Add explicit unsupported diagnostics for contract-valid but unimplemented chamfer variants or unresolved topology.
5. Add unit, integration, adapter, and Playwright e2e coverage for chamfer.
6. Keep rollback scoped by removing the chamfer authoring module, tool registration, adapter branch, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Should the first chamfer UI expose only `distance`, or include a hidden/typed variant field defaulted to `equalDistance` for future expansion?
- Should face selection be accepted later as a convenience for all boundary edges, or should chamfer remain edge-only until a separate selection-expansion proposal exists?
- Should chamfer support boolean operation intent at all, or should it remain a pure topology modifier without `create/add/subtract/intersect` modes?
