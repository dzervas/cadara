## Context

Feature form selection can now express multi-instance reference pickers, but the durable modeling contract still models profile-based features with singular profile fields. `ExtrudeFeatureParameters.profile` and `RevolveFeatureParameters.profile` each accept exactly one region or planar-face reference, while other multi-target features already use collection-shaped fields such as `FilletFeatureParameters.edgeTargets` and `ShellFeatureParameters.faceTargets`.

This creates a contract mismatch: the inspector and editor can collect multiple extrude or revolve profiles, but preview, commit, operation history, snapshot hydration, and adapter rebuild paths cannot represent them without losing intent. Backward compatibility is explicitly out of scope, so the implementation can replace the singular field shape instead of carrying transitional aliases.

## Goals / Non-Goals

**Goals:**
- Replace singular profile parameters for extrude and revolve with ordered, non-empty profile collections.
- Keep each profile entry as an explicit durable region or planar-face reference.
- Make empty arrays, duplicates, invalid references, and unsupported profile groupings fail through contract validation or adapter diagnostics.
- Update feature authoring drafts and form bindings so multi-instance picker selections flow into the contract without feature-specific UI branches.
- Update operation-history samples, snapshot hydration, preview, commit, rebuild, and tests for the breaking contract shape.
- Confirm existing collection-shaped feature parameters for fillet and shell remain aligned with the new validation expectations.

**Non-Goals:**
- Preserve or read legacy `parameters.profile` payloads for extrude or revolve.
- Add whole-sketch profile inference or side-band generic reference arrays.
- Add new profile seed kinds beyond the existing region and planar-face references.
- Require the generic feature inspector to validate geometric compatibility between selected profiles.
- Change the boolean operation or boolean-scope contract.

## Decisions

Replace `profile` with `profiles` on extrude and revolve parameters. The new field is the single authoritative source of selected profile seeds and MUST contain at least one entry. This is cleaner than adding a second optional collection field beside the old singular field, because compatibility is not required and dual shapes would invite ambiguous precedence rules.

Keep `ExtrudeProfileRef` and `RevolveProfileRef` as the entry types for the arrays. The entry-level contract already captures the required durable references, so the change is structural rather than semantic. This avoids widening the contract to whole sketches or loosely typed primitive references.

Treat array order as stable authoring order, not as an implicit modeling rule unless a specific feature later defines order-sensitive behavior. Adapters may normalize duplicate detection and group validation internally, but snapshots and operation history should preserve the caller-provided order for deterministic edit hydration and UI display.

Reject empty profile arrays at the earliest contract-facing boundary used by preview, create, update, operation-history validation, and adapter rebuild. Geometry-specific cases such as non-coplanar extrude regions, self-intersecting profile groups, or kernel-unsupported profile mixtures should return structured diagnostics instead of being filtered out by the generic inspector.

Update feature authoring drafts to use profile arrays for extrude and revolve, with the form schema using multi-instance reference picker bindings where the feature semantics allow it. The existing `improve-feature-form-selection` work remains the UI mechanism for selecting, displaying, clearing, and removing multiple references; this change supplies the durable contract target for that selected state.

Do not reshape fillet or shell parameters as part of this change. Their contract fields are already collection based (`edgeTargets` and `faceTargets`), so implementation work there should be limited to validation and regression tests that keep behavior consistent with the collection rules applied to profile-based features.

## Risks / Trade-offs

- [Breaking payload shape touches many layers] -> Mitigate by updating contract tests, operation-history fixtures, feature authoring hydration/builders, and adapter tests in the same implementation pass.
- [Adapters may support one profile before they support all valid multi-profile groups] -> Mitigate by accepting the contract shape while returning explicit diagnostics for unsupported group geometry.
- [Duplicate references can cause confusing preview behavior] -> Mitigate by contract validation that rejects or de-duplicates only through an explicit feature-owned rule, with tests for the chosen behavior.
- [Single-profile authoring could become more verbose] -> Mitigate by treating one selected profile as a one-item array everywhere rather than preserving a special singular path.

## Migration Plan

1. Update the TypeScript modeling contract so extrude and revolve parameters use `profiles: readonly <ProfileRef>[]` and remove singular/deprecated profile aliases for these feature families.
2. Update validators, fixtures, operation-history examples, and schema-version expectations to reject old singular shapes and empty profile arrays.
3. Update feature authoring drafts, hydration, patching, primary-selection helpers, and form schemas for extrude and revolve to use profile arrays and multi-instance picker bindings.
4. Update modeling service and OCC adapter preview/commit/rebuild paths to iterate profile arrays, preserve ordered profile references in snapshots, and return diagnostics for unsupported profile groups.
5. Add focused tests for contract validation, feature authoring selection/clearing, operation-history replay, and adapter behavior for one-profile and multi-profile inputs.

Rollback is not a compatibility requirement. If the implementation must be reverted during development, revert the contract and dependent code together rather than supporting both shapes.

## Open Questions

- Whether duplicate profile references should be rejected strictly at validation time or normalized by feature authoring before contract submission.
- Which specific multi-profile mixtures the initial OCC adapter will support immediately versus diagnose as unsupported while preserving the new contract shape.
