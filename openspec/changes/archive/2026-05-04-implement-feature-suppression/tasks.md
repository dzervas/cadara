## 1. Contract And Schema

- [x] 1.1 Add explicit `suppressed: boolean` state to authored feature records and rebuilt feature snapshot records.
- [x] 1.2 Update runtime schemas, serialization, normalization, seeds, fixtures, and authored document export/restore paths to require and preserve suppression state.
- [x] 1.3 Add request/response contracts and runtime schemas for a dedicated feature suppression mutation.
- [x] 1.4 Add operation-history payload support for suppress/unsuppress so repository replay preserves suppression changes.

## 2. Modeling And Kernel Rebuild

- [x] 2.1 Implement the modeling service suppression mutation with base revision and repository-head conflict handling.
- [x] 2.2 Update OCC authored restore/rebuild so applied suppressed features are skipped during feature execution while their authored records remain present.
- [x] 2.3 Update mock adapter behavior to match OCC suppression semantics for snapshots, produced targets, diagnostics, and cursor preservation.
- [x] 2.4 Ensure downstream unsuppressed features that reference suppressed outputs remain authored and surface repairable rebuild diagnostics instead of being deleted or auto-suppressed.

## 3. Editor And Workbench Integration

- [x] 3.1 Route suppress/unsuppress commands through the editor/runtime document mutation path and accepted-mutation refresh flow.
- [x] 3.2 Replace the feature-history context-menu placeholder with Suppress/Unsuppress actions based on snapshot feature state.
- [x] 3.3 Update timeline/sidebar presentation to distinguish suppressed feature rows from rolled-back or active rows.
- [x] 3.4 Ensure Undo/Redo uses the durable document history boundary for accepted suppression changes and ignores no-op suppression requests.

## 4. Tests And Validation

- [x] 4.1 Read `docs/testing.md` before test edits and choose the correct lane for each new test.
- [x] 4.2 Add logic-lane coverage for authored document validation, suppression mutation contracts, cursor-preserving rebuild skipping, and downstream repairable diagnostics.
- [x] 4.3 Add focused UI or e2e coverage only if needed to prove the live context-menu action is reachable and no longer a placeholder.
- [x] 4.4 Run `bun run test:all` and fix residual failures.
