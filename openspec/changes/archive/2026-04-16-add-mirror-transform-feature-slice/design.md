## Context

The advanced-solid substrate identifies mirror and transform as a transform-family group that should be handled together because they both operate over existing model state rather than creating solids from profiles or faces. The main architectural question is scope: whether these transforms apply only to bodies in the first slice or also to higher-level timeline features and sketches. A single proposal is the right place to answer that once.

The codebase already has feature authoring registry patterns, generic inspector rendering, modeling service normalization, operation-history validation, OCC adapter rebuild paths, and feature-flow e2e harnesses. Mirror and transform should follow those same mechanisms while staying conservative in first-slice semantics.

## Goals / Non-Goals

**Goals:**
- Add `mirror` and `transform` as part-mode feature tools backed by the feature authoring registry.
- Represent both features through the advanced-solid feature contract using explicit target bodies and explicit transform references.
- Make a first-slice decision that mirror and transform are body-only operations unless later proposals expand that scope.
- Preserve both features through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the first supported mirror and transform paths and explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add contract, authoring, adapter, and e2e coverage for both features.

**Non-Goals:**
- Transform sketches, constructions, or timeline features in this change.
- Implement every transform variant in the first slice, such as arbitrary matrix transforms, non-uniform scaling, associative patterning, or mixed body/feature transforms.
- Infer mirror planes or transform frames from incidental camera state or selection order.
- Hide unsupported OCC transform combinations behind silent fallbacks.

## Decisions

Make the first slice body-only. Mirror and transform will operate on explicit durable body targets, not on sketches or existing features. That keeps snapshot/history semantics clearer and avoids a premature decision about timeline-level transform ownership.

Use explicit participants:

```text
mirror
  required body: body, min 1
  required plane: plane or construction, min 1, max 1
  options.copy: boolean-like first-slice policy represented through feature-owned options

transform
  required body: body, min 1
  optional transformReference: plane or axis or construction, depending on the supported first-slice transform mode
  options: typed first-slice transform values such as translation distance(s) or rotation angle
```

The first transform implementation should be conservative. A reasonable initial path is body translation and/or rotation around one explicit reference family. If the adapter cannot support a broader transform set reliably, the proposal should preserve the shape for expansion while diagnosing unsupported options explicitly.

Mirror should also stay narrow. The first implementation should support mirroring one or more bodies across one explicit plane-like reference. If copy/replace semantics are both needed later, the first slice should choose one clear default and make any alternate behavior an explicit follow-up.

Use the existing generic feature inspector. Add `src/domain/feature-authoring/features/mirror.ts` and `src/domain/feature-authoring/features/transform.ts` modules that own defaults, participant patching, option handling, diagnostics, preview labeling, and draft-to-definition translation.

Make e2e coverage part of the slice. Completion requires at least one Playwright flow for mirror and one for transform, or a single chained flow that proves body-only transform behavior through tool activation, explicit reference selection, preview/commit, and resulting body state.

## Risks / Trade-offs

- [Transform scope can expand quickly if the first slice is not disciplined] -> Mitigate by making body-only scope explicit in the proposal and specs.
- [Mirror copy/replace semantics may be contentious] -> Mitigate by choosing one narrow first-slice behavior and documenting any alternate semantics as follow-up work.
- [Transform references may vary by supported mode] -> Mitigate by limiting the first adapter-backed transform mode and diagnosing unsupported reference families explicitly.
- [Pairing mirror and transform increases scope] -> Mitigate by keeping each feature narrow and pairing them only because they share body-transform semantics and reference-frame questions.

## Migration Plan

1. Add mirror/transform metadata, tool registration, authoring definitions, and generic inspector schema wiring.
2. Add mirror/transform modeling normalization, validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement the OCC adapter supported mirror/transform paths and unsupported-case diagnostics.
4. Add unit and integration coverage across contract, authoring, modeling service, mock adapter, and OCC adapter behavior.
5. Add mirror and transform e2e user flows to the shared feature harness and feature-flow spec.
6. Keep rollback scoped by removing the mirror/transform authoring modules, tool registration, adapter branches, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Which first-slice transform mode is the best fit for the current adapter path: translation only, rotation only, or a small translation-plus-rotation set?
- Should mirror default to creating copied bodies, replacing bodies, or preserving both through an explicit option?
- Is one chained mirror-then-transform e2e flow sufficient, or should the two features each get an independent dedicated e2e scenario?
