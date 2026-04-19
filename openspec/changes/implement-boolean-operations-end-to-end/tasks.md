## 1. Contract and Schema

- [x] 1.1 Add `combine` to authored/advanced feature kind types, runtime schemas, operation-history schemas, and feature authored-value helpers.
- [x] 1.2 Define Combine participant and operation validation for target bodies, tool bodies, and `add`/`subtract`/`intersect` intents.
- [x] 1.3 Extend modeling kernel capability declarations and snapshot hydration so Combine definitions round-trip through persisted documents.
- [x] 1.4 Add contract tests for valid Combine payloads, malformed participants, unsupported operation intents, operation-history serialization, and replay validation.

## 2. Feature Authoring and UI Wiring

- [x] 2.1 Add `combineAuthoringDefinition` with toolbar metadata, draft creation/hydration, patch handling, selection filters, missing-input diagnostics, and draft-to-definition conversion.
- [x] 2.2 Add Combine form schema fields for target-body collection, tool-body collection, and operation mode using existing generic inspector field types.
- [x] 2.3 Register Combine in the feature authoring registry and remove the standalone static toolbar-only `combine` definition.
- [x] 2.4 Ensure activating the Combine toolbar tool opens or focuses a Combine feature session rather than only logging tool events.
- [x] 2.5 Add authoring and toolbar tests that cover Combine activation, explicit role selection, operation changes, preview readiness, commit blocking, and edit hydration.

## 3. Modeling Service and Adapters

- [x] 3.1 Route Combine preview, create, and update through existing modeling service feature mutation paths with no UI-owned snapshot mutation.
- [x] 3.2 Implement mock adapter Combine behavior that accepts contract-valid inputs, changes visible output, and returns structured diagnostics for invalid inputs.
- [x] 3.3 Implement OCC Combine execution for add/fuse, subtract/cut, and intersect/common using explicit target/tool body participants.
- [x] 3.4 Apply deterministic result identity, consumed-tool-body removal, empty-result diagnostics, and topology invalidation handling for Combine rebuilds.
- [x] 3.5 Add modeling service and adapter tests for preview non-mutation, commit persistence, refresh/rebuild replay, stale references, and empty boolean results.

## 4. Viewport, Trees, and E2E Coverage

- [x] 4.1 Ensure render exports, object tree rows, and feature tree rows reflect post-Combine bodies instead of unchanged consumed tool bodies.
- [x] 4.2 Add or update Playwright harness helpers for selecting Combine target/tool bodies and asserting changed body output after commit.
- [x] 4.3 Add a Combine e2e flow that creates deterministic bodies, runs at least one boolean operation, commits it, and verifies persisted rebuild output.
- [x] 4.4 Run `bun run test`, `bun run lint`, and `bun run build` after implementation and fix any regressions.
