## Context

The current authored document contract already includes `sketches`, `features`, `featureOrder`, optional `historyOrder`, and `cursor`. The repository path persists accepted modeling mutations by calling `createAuthoredModelDocumentFromSnapshot(snapshot)` after the kernel accepts the mutation.

Rollback changes the kernel's active cursor and rebuilds the applied model through that cursor. In the OCC path, the active snapshot may expose only applied features after rebuild/restore, even though the authoring state needs to retain all future authored records. If repository persistence derives the next durable authored document from an applied-only snapshot, moving the cursor backward can overwrite storage with a truncated document. Refresh then restores only the truncated timeline, which makes later steps such as `revolve` disappear.

## Goals / Non-Goals

**Goals:**

- Make cursor movement a durable document mutation that round-trips through repository save/load.
- Ensure repository writes preserve all authored sketches, features, feature order, and history order after the cursor.
- Keep rolled-back viewport, render, body, and applied-feature output based only on the cursor-applied prefix.
- Add a regression test for `sketch - extrude - sketch2 - revolve`, rollback to `sketch2`, repository reload, and redo/reachability of `revolve`.

**Non-Goals:**

- Changing the user-facing semantics of rollback, redo, or inserting a new feature after the cursor.
- Persisting derived render/export data in the authored document.
- Replacing the existing `DocumentRepository` boundary or introducing another persistence dependency.

## Decisions

### Persist From Complete Authoring State, Not Applied Snapshot Prefix

Repository writes must use a complete authored-document source that includes future items after the active cursor. This can be implemented by adding a kernel/service method that exports the authored document from the complete authoring state, or by extending snapshot data with a clearly separated authored timeline that is not confused with applied presentation data.

Alternative considered: make `DocumentSnapshot.document.features` always include future features. That risks changing rebuild/render consumers that currently expect applied output and would broaden the blast radius. Keeping authored persistence separate is smaller and matches the existing contract split between durable authored data and derived presentation data.

### Keep Cursor-Applied Rebuilds Applied-Only

The viewport and snapshot-derived bodies/render records should continue to represent only what is applied through the cursor. Future authored steps must remain available for history navigation and persistence, but they must not contribute geometry while the cursor is before them.

Alternative considered: always rebuild all features and hide future results in the UI. That would do unnecessary kernel work and weaken rollback semantics for downstream references.

### Regression Coverage at the Repository/Service Boundary

The required regression should exercise the modeling service with `DocumentRepository`, not only a pure parser test. The test must perform real accepted mutations, set the cursor to a middle sketch, inspect the saved authored document for all steps, create a fresh service with the same repository, and assert the cursor and future `revolve` survive. A browser-level test can supplement this, but the service test is the smallest reliable guard against the data-loss path.

Alternative considered: only test `parseAuthoredModelDocument` with a hand-written document. That proves the schema permits the shape, but not that the app saves the right document after rollback.

## Risks / Trade-offs

- Existing code may rely on `createAuthoredModelDocumentFromSnapshot` for persistence from applied snapshots -> Introduce a narrow persistence/export path and update repository writes to use it, while keeping snapshot conversion for debug/export cases that intentionally serialize the exposed snapshot.
- Cursor restore with future references can still fail if future feature inputs depend on geometry unavailable at the cursor -> Preserve future authored inputs in storage, but keep rebuild diagnostics explicit when a future item is applied again and cannot resolve.
- The mock adapter and OCC adapter may model rolled-back snapshots differently -> Add coverage that uses the adapter/service path closest to production persistence, and keep mock-only tests focused on contract shape.
