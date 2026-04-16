## Context

The advanced-solid substrate already defines the shared vocabulary for profile-family features, and sweep has established the first vertical slice for that family. Loft is the next useful step because it stresses a different part of the same substrate: ordered profile sections rather than a profile plus a path. That makes it a good proving slice before wrap, which is likely to involve different surface-target and projection semantics.

The codebase already has the feature authoring registry, generic inspector, modeling service normalization, operation-history validation, OCC adapter rebuild paths, and e2e harnesses used by the current feature set. Loft should reuse those mechanisms rather than adding a second advanced-feature workflow.

## Goals / Non-Goals

**Goals:**
- Add `loft` as a selectable part-mode feature tool backed by the feature authoring registry.
- Represent loft through the advanced-solid feature contract with ordered `profile` participants, optional `guideCurve` participants, and boolean `targetBody` participants where supported.
- Support exact authoring of at least two ordered profile targets with clear missing-input, ordering, and invalid-target diagnostics.
- Preserve loft definitions through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the first supported loft shape and explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add contract, authoring, adapter, and e2e coverage comparable to the existing feature-flow coverage.

**Non-Goals:**
- Implement sweep, wrap, or other advanced features in this change.
- Support every loft variant in the first implementation, such as arbitrary guide-curve networks, centerline lofts, tangent/curvature constraints, closed periodic lofts, or mixed open-surface workflows.
- Infer section ordering from sketch names, creation order, or hidden viewport state.
- Accept whole-sketch references instead of explicit derived regions or planar faces.
- Hide unsupported OCC loft combinations behind guessed geometry or silently reordered sections.

## Decisions

Represent loft as an advanced solid feature instead of a new bespoke feature-definition branch. The substrate already has `loft` in `AdvancedSolidFeatureKind`, typed participants, option validation, and unsupported-case diagnostics. Reusing that path keeps the advanced feature family coherent.

Use ordered profile participants as the core input:

```text
loft
  required profile: region | face, min 2, max many
  optional guideCurve: edge | sketchEntity, min 0
  boolean targetBody: body, required for add/subtract/intersect if those intents are enabled
```

The first implementation should support two or more ordered profile sections and preserve that order through form bindings, snapshots, and operation history. Reordering should be explicit in the authoring UI state rather than inferred from selection timestamps. That is the primary semantic difference from sweep.

Keep guide curves optional and initially diagnostic-driven. The contract should allow `guideCurve` participants so the feature shape can evolve without a breaking change, but the first OCC-backed implementation may reject guide curves as unsupported until there is evidence they can be built reliably.

Expose operation intent only if the initial kernel path can support it cleanly. If standalone loft is the only realistic initial implementation, the authoring definition should expose only `create`. If boolean loft is implemented, it must require explicit `targetBody` participants and follow the same no-inference rule as sweep.

Use the existing generic feature inspector. Loft should add a `src/domain/feature-authoring/features/loft.ts` module that owns defaults, ordered section patching, selection application, diagnostics, preview labeling, and draft-to-definition translation. The inspector should only render the resulting schema, including ordered profile collection controls.

Implement OCC support incrementally. The first supported path should be a solid loft between compatible closed profile regions or planar faces. Contract-valid shapes that are not yet supported, such as guide curves, incompatible mixed sections, or boolean compositions that the adapter cannot rebuild, should return structured unsupported diagnostics.

Make e2e coverage part of the feature slice. Loft is user-visible, so completion requires a Playwright flow that activates the tool, selects at least two profiles in order, observes preview readiness or diagnostics, commits, and verifies the resulting document/timeline/geometry outcome.

## Risks / Trade-offs

- [Compatible loft section geometry may be narrower than the contract can describe] -> Mitigate by supporting a conservative initial shape and returning explicit unsupported diagnostics for unsupported valid payloads.
- [Ordered section editing adds more UI state than sweep] -> Mitigate by keeping ordering explicit and local to the loft authoring module instead of extending generic inspector logic with loft-specific rules.
- [Guide curves may complicate the first implementation disproportionately] -> Mitigate by permitting them in the contract shape but diagnosing them as unsupported until the adapter path is ready.
- [Boolean loft may be less stable than standalone loft] -> Mitigate by starting with `create` only unless adapter support is already proven.
- [E2e fixture creation may be more involved because loft needs multiple sections] -> Mitigate by extending the shared feature harness with helper methods for building two-profile fixtures rather than hardcoding per-test setup.

## Migration Plan

1. Add loft metadata, tool registration, authoring definition, and generic inspector schema wiring.
2. Add loft modeling normalization, validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement the OCC adapter supported loft path and unsupported-case diagnostics.
4. Add unit and integration coverage across contract, authoring, modeling service, mock adapter, and OCC adapter behavior.
5. Add a loft e2e user flow to the shared feature harness and feature-flow spec.
6. Keep rollback scoped by removing the loft authoring module, tool registration, adapter branch, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Should the first loft implementation allow only `create`, or should it expose boolean operation intents immediately if the adapter path is ready?
- Should guide curves be visible but disabled in the first UI, or omitted until implemented?
- What is the smallest reliable two-profile fixture for e2e coverage in the current harness: two sketch regions on parallel planes, two planar faces, or one of each?
