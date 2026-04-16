## Context

The advanced-solid substrate already covers body-operation participant roles, diagnostics, and milestone-level e2e expectations. Thicken is a good next slice because it exercises face- or sheet-driven solid generation without introducing the larger semantic surface of enclose. It also complements the existing feature set by adding a feature that starts from topology targets rather than sketch profiles.

The codebase already has the feature authoring registry, generic inspector, modeling service normalization, operation-history validation, OCC adapter rebuild paths, and Playwright feature-flow coverage used by the current features. Thicken should follow those paths rather than creating special-purpose advanced-feature infrastructure.

## Goals / Non-Goals

**Goals:**
- Add `thicken` as a selectable part-mode feature tool backed by the feature authoring registry.
- Represent thicken through the advanced-solid feature contract with explicit face/body participants and positive thickness options.
- Support exact authoring of at least one valid thicken target with clear missing-input and invalid-target diagnostics.
- Preserve thicken definitions through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the first supported thicken shape and explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add contract, authoring, adapter, and e2e coverage comparable to the existing feature-flow coverage.

**Non-Goals:**
- Implement enclose, split, delete-solid, or other advanced features in this change.
- Support every thicken variant in the first implementation, such as variable thickness, bidirectional offset on arbitrary target sets, automatic gap healing, or complex mixed-surface shelling semantics.
- Infer thickening targets from hidden adjacency rules or viewport order.
- Hide unsupported OCC thicken combinations behind guessed geometry or silent fallbacks.

## Decisions

Represent thicken as an advanced solid feature rather than a bespoke feature-definition branch. The substrate already has `thicken` in `AdvancedSolidFeatureKind`, typed participants, option validation, and unsupported-case diagnostics. Reusing that path keeps the family coherent.

Use explicit thicken participants and options:

```text
thicken
  required face: face, min 1, max many for initial selection model
  optional targetBody: body, required only if boolean intents are enabled
  options.thickness: positive number
  options.side: oneSide | symmetric
```

The first implementation should stay conservative. A reasonable initial path is one or more compatible face targets with a positive thickness and a single direction model. If boolean operation intent is not proven in the adapter yet, the first user-visible implementation should expose only `create`.

Use the existing generic feature inspector. Thicken should add a `src/domain/feature-authoring/features/thicken.ts` module that owns defaults, target patching, selection application, diagnostics, preview labeling, and draft-to-definition translation. The inspector should only render the resulting form schema.

Implement OCC support incrementally. The first supported path should build a solid from compatible face targets or supported sheet-like topology when the adapter can reconstruct the needed shell/body context. Contract-valid shapes that are not yet supported should return structured unsupported diagnostics.

Make e2e coverage part of the feature slice. Thicken is user-visible, so completion requires a Playwright flow that activates the tool, selects a valid target, enters a thickness, observes preview readiness or diagnostics, commits, and verifies the resulting document/timeline/geometry outcome.

## Risks / Trade-offs

- [The set of topologies that OCC can thicken reliably may be narrower than the contract shape] -> Mitigate by keeping the first supported target set conservative and returning explicit unsupported diagnostics for unsupported valid payloads.
- [Face-only target selection may not map cleanly onto every desired thicken workflow] -> Mitigate by scoping the first slice narrowly and leaving broader body/sheet target semantics for follow-up refinement.
- [Boolean thicken may add more complexity than the first slice needs] -> Mitigate by exposing only `create` if adapter support for boolean composition is not already proven.
- [E2e fixtures may require a specially prepared source shape] -> Mitigate by extending the shared feature harness with a reusable thicken-ready fixture rather than hardcoding per-test setup.

## Migration Plan

1. Add thicken metadata, tool registration, authoring definition, and generic inspector schema wiring.
2. Add thicken modeling normalization, validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement the OCC adapter supported thicken path and unsupported-case diagnostics.
4. Add unit and integration coverage across contract, authoring, modeling service, mock adapter, and OCC adapter behavior.
5. Add a thicken e2e user flow to the shared feature harness and feature-flow spec.
6. Keep rollback scoped by removing the thicken authoring module, tool registration, adapter branch, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Should the first thicken implementation accept only face targets, or also support explicit sheet/body targets immediately?
- Should the first thicken UI expose only `create`, or support boolean intents if the adapter path is already viable?
- What is the smallest stable thicken-ready fixture for e2e coverage in the current harness?
