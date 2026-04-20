## Why

Document history cursor movement is fragile because normal timeline rollback and document undo/redo mutate the modeling service directly while edit-session rollback uses the editor runtime. Repository-backed documents can then surface stale authored-document conflicts repeatedly, and refreshing may expose an older cursor state that makes redo/rollback loops unreliable.

This needs to be fixed before more feature editing and collaborative repository behavior builds on top of cursor rollback, because cursor movement is the shared basis for timeline navigation, edit re-entry, and recovery after refresh.

## What Changes

- Route every document history cursor move through the editor runtime instead of calling the modeling service directly from Workbench UI code.
- Add an explicit mutation basis that includes both `baseRevisionId` and repository provenance from the snapshot that initiated the mutation.
- Make document cursor mutations serialize with editor effects, refresh the authoritative snapshot after acceptance, and keep history controls disabled until the refreshed snapshot is loaded.
- Treat repository-head conflicts during document cursor movement as a refreshable stale-snapshot condition, not a loop where the same notification can reappear after refresh.
- Preserve existing edit-session rollback semantics, including transient cursor moves that do not append authored operation-history entries.
- Add regression coverage for timeline drag, document undo/redo, repository-backed rollback/redo loops, stale repository provenance, and edit-session restore.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-document-feature-cursor`: Document cursor moves must use a single serialized editor/runtime mutation path and remain stable across rollback, refresh, redo, and edit-session restore.
- `history-undo-redo`: Document-level undo/redo must request cursor moves through the editor runtime and must not issue another document cursor move before the refreshed snapshot is loaded.
- `timeline-drag-cursor`: Timeline drag cursor changes must use the same editor-owned document cursor request path as undo/redo and edit rollback.
- `frontend-modeling-boundary`: Modeling mutations initiated from snapshots must carry an explicit snapshot mutation basis, including repository provenance when available.
- `document-repository`: Repository-backed freshness checks must compare against the mutation basis from the caller's snapshot rather than an inferred service-global last-snapshot value.
- `editor-runtime-orchestration`: The editor runtime must own sequencing for document cursor mutation effects and their follow-up snapshot refreshes.

## Impact

- Affected code: `src/contracts/editor/state-machine.ts`, `src/contracts/editor/runtime-machine.ts`, `src/hooks/editor-provider.tsx`, `src/app/cad-workbench.tsx`, `src/app/workbench-history.ts`, `src/domain/modeling/modeling-service.ts`, and focused tests under `src/contracts/editor/`, `src/app/`, and `src/domain/modeling/`.
- Public modeling-service inputs for committed mutations may gain an optional repository-basis field; adapter request contracts should remain focused on kernel revision semantics unless repository provenance is needed below the service boundary.
- No new runtime dependency is expected.
