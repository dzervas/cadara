## 1. Operation History Contract

- [x] 1.1 Add a versioned operation-history schema under `src/contracts/modeling/**`, including the top-level payload, closed operation-entry union, and runtime validation helpers for persisted/exported data.
- [x] 1.2 Define persistence-safe payload shapes for `commitSketch`, `createFeature`, `updateFeature`, `deleteFeature`, and `reorderFeature`, reusing authoritative modeling definitions while omitting transport-only request metadata.
- [x] 1.3 Add contract-level tests covering schema validation, version rejection, and representative operation-log examples for sketch and feature mutations.

## 2. Persistence And Replay Integration

- [x] 2.1 Add a modeling-history persistence module that reads and writes the operation-history payload from a stable `localStorage` key without leaking storage concerns into presentational components.
- [x] 2.2 Update committed sketch and feature mutation flows to append exactly one operation-history entry after successful kernel commits and to exclude previews, rejected requests, and transient editor state.
- [x] 2.3 Add bootstrap wiring that loads persisted history on startup, validates it, replays it through the modeling service/kernel into a fresh document basis, and only then exposes the rebuilt snapshot to the editor runtime.
- [x] 2.4 Surface explicit restore diagnostics or reset handling for invalid, unsupported, or unreplayable persisted histories instead of silently treating partial replay as success.

## 3. Verification

- [x] 3.1 Add replay-focused tests proving that persisted histories rebuild the same document state after refresh for sketches, feature create/update/delete, and feature reorder sequences.
- [x] 3.2 Add persistence integration coverage confirming that only committed mutations are stored, history order remains stable, and unsupported schema versions fail restore explicitly.
- [x] 3.3 Verify the workbench startup flow end to end so a refreshed session restores the recalculated model from `localStorage` through kernel replay rather than from an in-memory snapshot shortcut.
