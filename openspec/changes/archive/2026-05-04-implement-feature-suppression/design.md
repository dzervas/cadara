## Context

Feature suppression is currently visible only as a placeholder context-menu action. The real behavior crosses the authored document contract, modeling mutation API, repository-backed history, adapter replay, and derived workbench presentation. It is not a kernel operation like extrude or fillet; it is authored replay state that decides whether a feature record participates in geometry generation for a given rebuild.

The existing modeling contract already has the right separation for this: `FeatureDefinition` carries exact kernel rebuild inputs, while `AuthoredFeatureRecord`, `FeatureSnapshotRecord`, document history order, and cursor state describe how authored features participate in the document. Suppression belongs on the authored feature record and snapshot record, not inside individual feature definitions.

## Goals / Non-Goals

**Goals:**
- Persist explicit suppression state for every authored feature and expose that state on rebuilt feature snapshots and document-history presentation.
- Add a dedicated suppress/unsuppress modeling mutation that updates only suppression metadata and rebuilds the current applied model.
- Make OCC and mock rebuilds skip suppressed features when those features are inside the applied cursor range.
- Preserve suppressed features in authored feature order, document history rows, feature edit targets, and serialization.
- Surface downstream failures from unsuppressed dependent features as normal repairable rebuild diagnostics.

**Non-Goals:**
- Do not add suppression to sketches in this change.
- Do not encode suppression inside `FeatureDefinition` or feature-specific parameters.
- Do not invent compatibility defaults for old authored documents; this pre-alpha change can require the current explicit schema.
- Do not auto-suppress dependent features or rewrite downstream references when a source feature is suppressed.
- Do not implement configuration suppression, multi-state feature variants, or branch-like history.

## Decisions

### Suppression is authored feature metadata

Add `suppressed: boolean` to the authored feature record and rebuilt feature snapshot record. Runtime validation requires the field. Snapshot/presentation builders use the same field to show row state and context-menu labels.

Alternative considered: add `suppressed` to `FeatureDefinition`. That makes every kernel feature variant carry a non-geometric control flag and weakens the contract that definitions are pure operation inputs. Keeping suppression beside the definition makes rebuild scheduling explicit and keeps feature-specific schemas smaller.

### Use a dedicated mutation

Add a modeling boundary operation such as `setFeatureSuppression` with `{ featureId, suppressed, baseRevisionId, baseRepositoryHeads? }`, returning the standard mutation/rebuild envelope. The mutation updates the authored feature record in place, records a repository-backed operation-history entry, and refreshes the snapshot. Reapplying the same value is a `noOp` rebuild result.

Alternative considered: overload `updateFeature` with a suppression field. That couples feature-editor commits with timeline state toggles and risks running validation for a definition that did not change. A dedicated mutation keeps command routing and tests focused.

### Rebuild skips, history preserves

During replay, the applied sequence is still selected by `historyOrder` plus `cursor`. Suppression is applied after that: any applied feature with `suppressed === true` is omitted from `applyOccFeatureToAuthoringState` / mock rebuild execution, but remains in `state.features`, `featureOrder`, and `historyOrder`. Its `producedTargets` becomes empty for the rebuilt revision.

Downstream unsuppressed features are not hidden automatically. If they reference geometry produced by a suppressed feature, they fail through existing invalid-reference or rebuild-failure diagnostics and remain authored/editable.

Alternative considered: treat a suppressed feature like moving the document cursor before it. That would also hide every later feature and would make suppression indistinguishable from rollback. Suppression must be per-feature and non-destructive.

### UI routes through existing document mutation orchestration

The feature-history context menu switches between `Suppress` and `Unsuppress` based on snapshot row state. Selecting the action emits a runtime/application command that calls the modeling suppression mutation, uses current revision/repository basis, and refreshes through the same accepted-mutation path as other document changes.

Alternative considered: call the modeling service directly from the context-menu component. That would bypass the editor/runtime mutation sequencing and repeat earlier split-ownership problems in history/cursor flows.

## Risks / Trade-offs

- [Risk] Suppressing a source feature can make later features invalid and noisy. -> Mitigation: preserve downstream authored rows and surface normal repairable diagnostics instead of deleting or auto-suppressing dependents.
- [Risk] Snapshot rows for suppressed features could look applied while their geometry is absent. -> Mitigation: expose explicit `suppressed` row state in snapshots/presentation so timeline/sidebar rendering can distinguish "applied but bypassed" from rollback.
- [Risk] Rebuild code may accidentally remove suppressed rows from `features` while skipping execution. -> Mitigation: tests must assert authored feature order/history preservation separately from generated bodies/renderables.
- [Risk] Mock and OCC adapters can drift. -> Mitigation: define adapter-neutral contract tests at the modeling boundary, then add narrow OCC/mock parity cases around replay skipping.
- [Risk] The dedicated mutation adds another operation-history entry type. -> Mitigation: keep the payload minimal and use the existing standard mutation envelope and durable-history grouping.

## Migration Plan

1. Update contract types and runtime schemas to require `suppressed: boolean` on authored and snapshot feature records.
2. Update seeds, fixtures, import/export serialization, mock adapter, and OCC authored restore/export to write explicit `suppressed: false` for active features.
3. Add the suppression mutation, repository operation-history entry, and adapter methods.
4. Update rebuild paths to skip suppressed applied features while preserving records and row state.
5. Wire the context-menu action and snapshot presentation state.
6. Run `bun run test:all`.
