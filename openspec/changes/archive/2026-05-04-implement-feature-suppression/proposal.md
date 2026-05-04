## Why

The workbench already exposes `Suppress` as a feature-history action, but the current contract only allows a placeholder message. Real suppression is needed so users can bypass a committed feature during rebuild without deleting its authored inputs, moving the document cursor, or rewriting dependent history.

## What Changes

- Add durable feature suppression state to authored feature records and rebuilt feature snapshots.
- Add a dedicated modeling mutation for setting a committed feature's suppressed state, including repository-backed history/undo behavior.
- Change geometry generation so suppressed features are skipped by replay while remaining present in authored history, feature order, history rows, and edit targets.
- Keep suppression out of `FeatureDefinition`; feature definitions remain pure kernel operation inputs, while suppression is authored replay metadata owned by the modeling/document contract.
- Surface suppressed state in timeline/sidebar presentation and replace the existing context-menu placeholder with real suppress/unsuppress actions.
- **BREAKING**: Authored feature records and runtime feature snapshots require explicit suppression state; no compatibility alias or implicit missing-field behavior is required.

## Capabilities

### New Capabilities
- `feature-suppression`: Durable feature suppression semantics, mutation behavior, rebuild skipping, dependency fallout, and presentation state.

### Modified Capabilities
- `authored-model-document`: Authored feature records persist explicit suppression state while excluding derived suppressed geometry.
- `model-document-feature-cursor`: Cursor-applied history and suppression combine so applied suppressed rows remain authored but are skipped during rebuild.
- `workbench-context-menus`: The feature-history `Suppress` action becomes a real suppress/unsuppress mutation instead of a placeholder status.
- `durable-document-history`: Suppress/unsuppress is a repository-backed document mutation with undo/redo parity.

## Impact

- Contracts: `src/contracts/modeling/schema.ts`, `src/contracts/modeling/authored-document.ts`, runtime schemas, serialization, and operation-history contracts.
- Modeling service: mutation API, normalization, repository persistence, operation-history replay, mock/OCC adapter parity.
- Kernel/rebuild: OCC authoring-state rebuild and snapshot generation must skip suppressed features while preserving authored records and diagnostics.
- Editor/workbench: context-menu routing, timeline/sidebar row state, runtime effects, status/diagnostic refresh after accepted suppression mutations.
- Tests: logic-lane coverage for authored contract/rebuild semantics and UI or e2e coverage only where necessary for exposed context-menu behavior.
