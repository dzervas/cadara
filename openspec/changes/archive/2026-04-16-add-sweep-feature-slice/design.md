## Context

The advanced-solid substrate already defines the common vocabulary needed for profile/path features: typed participants, feature-declared operation intent, role-specific diagnostics, and milestone-level e2e expectations. Sweep is the smallest useful proving slice for that family because it combines a profile and a path while staying easier to reason about than loft section ordering or wrap projection behavior.

The codebase already has registry-owned feature authoring modules for current features, a generic feature inspector, operation-history validation, modeling service normalization, OCC adapter preview/commit paths, and Playwright e2e coverage for extrude, revolve, fillet, shell, and plane. Sweep should follow those existing patterns instead of introducing a second advanced-feature UI path.

## Goals / Non-Goals

**Goals:**
- Add `sweep` as a selectable part-mode feature tool backed by the feature authoring registry.
- Represent sweep through the advanced-solid feature contract with role-specific `profile`, `path`, optional `guideCurve`, and boolean `targetBody` participants.
- Support exact authoring of at least one profile target and one path target, with clear missing-input and invalid-target diagnostics.
- Preserve sweep definitions through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the first supported sweep shape and explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add contract, authoring, adapter, and e2e coverage comparable to the existing basic feature flow coverage.

**Non-Goals:**
- Implement loft, wrap, or other profile/path features in this change.
- Support every sweep variant in the first implementation, such as multi-profile section sweeps, guide-curve networks, twist control, variable scaling, self-intersection repair, or open-surface sweeps.
- Redesign sketch tools or introduce a new path-authoring mode.
- Infer profiles or paths from whole sketches or incidental viewport order.
- Hide unsupported OCC sweep combinations behind fallback geometry.

## Decisions

Represent sweep as an advanced solid feature rather than a new bespoke `FeatureDefinition` branch. The substrate already has `sweep` in `AdvancedSolidFeatureKind`, role-specific participant payloads, and validation helpers. Reusing that shape proves the substrate and avoids duplicating another one-off typed contract path.

Use role-specific participants:

```text
sweep
  required profile: region | face, min 1
  required path: edge | sketchEntity, min 1, max 1 for initial support
  optional guideCurve: edge | sketchEntity, min 0
  boolean targetBody: body, required for add/subtract/intersect
```

The initial implementation should keep path cardinality to one path target. That is narrower than full CAD sweep capability, but it gives a concrete user flow and keeps OCC support realistic. Multi-segment path chains can be added later by extending the participant cardinality and adapter behavior after there is evidence from the first implementation.

Expose operation intent through the feature authoring definition, but gate non-create modes on explicit target-body selection. This follows the extrude/revolve boolean-scope pattern while using the advanced-solid substrate's `create`, `add`, `subtract`, and `intersect` terminology. The authoring definition should not infer boolean targets from the document.

Use the existing generic feature inspector. Sweep should add a `src/domain/feature-authoring/features/sweep.ts` module that owns defaults, patching, selection application, validation, form schema, preview labeling, and draft-to-definition translation. The inspector should only render the resulting form schema and reference picker fields.

Implement OCC support incrementally. The first supported path should be one closed profile region or planar face swept along one durable path edge when the adapter can reconstruct the needed profile and path wire. Contract-valid shapes that are not yet supported, such as guide curves or ambiguous profile/path orientation, should return structured unsupported diagnostics.

Make e2e coverage part of the feature slice. Unlike the substrate-only change, sweep is a user-visible implemented feature. It should add a Playwright flow that activates the tool, selects a profile and path, observes preview readiness or diagnostics, commits the feature, and verifies the document/timeline/geometry outcome.

## Risks / Trade-offs

- [OCC sweep APIs may need stricter wire/profile preconditions than the contract can express] -> Mitigate by supporting a narrow first shape and returning explicit unsupported diagnostics for unsupported valid payloads.
- [A sketch path may not yet round-trip as durable kernel geometry] -> Mitigate by accepting `sketchEntity` at the authoring contract level only when the modeling path can resolve it, otherwise test the diagnostic path and support durable body edges first.
- [Boolean sweep results may fail more often than standalone sweep] -> Mitigate by requiring explicit target bodies and testing unsupported diagnostics for non-create modes if OCC boolean composition is not ready.
- [Adding sweep can encourage one-off advanced feature plumbing] -> Mitigate by routing through advanced participant descriptors and the existing feature authoring registry.
- [E2e selection may be brittle if the path edge identity changes] -> Mitigate by extending the shared feature workbench harness with role-oriented selectors instead of hardcoding one topology id where possible.

## Migration Plan

1. Add sweep metadata, tool registration, authoring definition, and generic inspector schema wiring.
2. Add sweep modeling normalization, validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement the OCC adapter supported sweep path and unsupported-case diagnostics.
4. Add unit and integration coverage across contract, authoring, modeling service, mock adapter, and OCC adapter behavior.
5. Add a sweep e2e user flow to the shared feature harness and feature-flow spec.
6. Keep rollback scoped by removing the sweep authoring module, tool registration, adapter branch, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Should initial sweep path selection accept sketch entities immediately, or should the first user-visible flow require an existing durable body edge as the path?
- Should guide curves appear as disabled/unsupported form fields in the first implementation, or stay hidden until guide-curve kernel support exists?
- Should sweep expose all boolean operation intents on day one, or start with `create` and add boolean modes only after standalone sweep is stable?
