## Why

The current workbench rebuilds document state in memory, but it does not preserve the exact sequence of user modeling operations across refreshes. If operation history is going to back local persistence and future export/import, the format needs a tightly specified contract that can represent sketches, feature mutations, and ordering changes without relying on incidental UI state.

## What Changes

- Add a versioned modeling operation history contract that records the authoritative sequence of committed document mutations, including sketch commits, feature create/update/delete operations, and feature reordering.
- Persist the operation history in `localStorage` and restore the active document by replaying the recorded operations through the modeling kernel on application startup.
- Define deterministic replay, validation, and failure behavior so persisted histories either rebuild the same document state or surface explicit diagnostics when an operation payload is invalid or no longer supported.
- Define stable export-facing payload rules, including schema versioning and explicit operation kinds, so the same history format can be used for local persistence and future file export.

## Capabilities

### New Capabilities
- `modeling-operation-history`: Defines the versioned operation-log contract, persistence behavior, and kernel replay requirements for all committed sketch and feature mutations.

### Modified Capabilities

## Impact

- Affected code includes modeling contracts under `src/contracts/modeling/**`, modeling service/kernel adapters under `src/domain/modeling/**`, editor/runtime startup and mutation flows, and any persistence hooks that load or save document state.
- Introduces a new durable payload contract that must stay stable enough for export/import and strict enough for deterministic replay.
- Requires tests for round-tripping committed operations through persistence and rebuilding snapshots from replayed history.
