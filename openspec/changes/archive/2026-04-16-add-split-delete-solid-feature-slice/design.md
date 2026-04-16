## Context

The advanced-solid substrate identifies body and region operations as a distinct family separate from profile/path features and local topology modifiers. Split and delete-solid are the cleanest body-operation pair to implement next because they both act on existing bodies and exercise explicit body lifecycle, object-tree updates, snapshot persistence, and invalid-reference handling.

The codebase already has feature authoring registry patterns, generic inspector rendering, modeling service normalization, operation-history validation, OCC adapter rebuild paths, and feature-flow e2e harnesses. Split and delete-solid should follow those same paths while staying narrowly scoped for the first slice.

## Goals / Non-Goals

**Goals:**
- Add `split` and `deleteSolid` as part-mode feature tools backed by the feature authoring registry.
- Represent split through the advanced-solid feature contract with explicit `targetBody` participants and one supported split-tool participant family such as `toolBody` or `plane`.
- Represent delete-solid through the advanced-solid feature contract with explicit `body` participants identifying the solids to remove.
- Preserve both features through preview, commit, operation history, snapshot hydration, and edit-session hydration.
- Add OCC-backed preview/commit for the first supported split and delete-solid paths and explicit unsupported-case diagnostics for valid but unsupported combinations.
- Add contract, authoring, adapter, and e2e coverage for both features.

**Non-Goals:**
- Implement enclose or other body-operation features in this change.
- Support every split variant in the first implementation, such as arbitrary multi-tool splitting, complex trim/keep-side policies, or mixed face/profile-based split tools unless they are explicitly part of the first supported path.
- Infer which resulting bodies to keep or delete from hidden heuristics.
- Hide unsupported OCC split combinations or delete-solid edge cases behind silent fallbacks.

## Decisions

Keep split and delete-solid in one change because they share body-targeting semantics and document-body lifecycle effects. Splitting bodies creates or changes body ownership; deleting solids removes bodies and invalidates references. Reviewing those rules together is more coherent than treating them as unrelated features.

Use explicit participants:

```text
split
  required targetBody: body, min 1
  required split tool: plane or toolBody, min 1, max 1 for initial support

deleteSolid
  required body: body, min 1, max many
```

The first split implementation should support one conservative split-tool family. If plane-based splitting is the most stable kernel path, the first slice should use `plane`; if tool-body splitting is more mature, it should use `toolBody`. Other contract-valid tool families can return structured unsupported diagnostics.

Delete-solid should remain explicit and simple. The authoring definition should collect one or more durable body targets, provide a clear preview label and diagnostics, and commit a feature that removes those bodies without guessing substitute targets.

Use the existing generic feature inspector. Add `src/domain/feature-authoring/features/split.ts` and `src/domain/feature-authoring/features/delete-solid.ts` modules that own defaults, participant patching, selection handling, diagnostics, preview labeling, and draft-to-definition translation.

Make e2e coverage part of the slice. Completion requires at least one Playwright flow for split and one for delete-solid, or a single chained flow that proves split creates a usable body-management outcome and delete-solid removes an explicit body while the timeline/object tree remain consistent.

## Risks / Trade-offs

- [Split-tool semantics may be broader than the first kernel-backed path can support] -> Mitigate by choosing one conservative split-tool family and returning explicit unsupported diagnostics for other valid contract shapes.
- [Delete-solid changes durable references aggressively] -> Mitigate by testing invalid-reference reporting and object-tree/render binding updates as part of the slice.
- [Pairing two features increases scope] -> Mitigate by keeping each feature behavior narrow and by pairing them only because they share body-lifecycle concerns.
- [E2e body assertions can be brittle if body ids vary] -> Mitigate by extending the shared harness with body-oriented helpers instead of hardcoding incidental topology names.

## Migration Plan

1. Add split and delete-solid metadata, tool registration, authoring definitions, and generic inspector schema wiring.
2. Add split/delete-solid modeling normalization, validation, operation-history fixtures, and snapshot/edit hydration coverage.
3. Implement the OCC adapter supported split/delete-solid paths and unsupported-case diagnostics.
4. Add unit and integration coverage across contract, authoring, modeling service, mock adapter, and OCC adapter behavior.
5. Add split and delete-solid e2e user flows to the shared feature harness and feature-flow spec.
6. Keep rollback scoped by removing the split/delete-solid authoring modules, tool registration, adapter branches, fixtures, and tests without changing the advanced-solid substrate.

## Open Questions

- Should the first split implementation support plane tools or tool-body tools first?
- Should delete-solid allow multi-body deletion immediately, or start with one body per feature for simpler hydration and e2e assertions?
- Is one chained split-then-delete e2e flow sufficient, or should the two features each get an independent dedicated e2e scenario?
