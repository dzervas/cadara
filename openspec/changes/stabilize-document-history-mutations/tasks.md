## 1. Mutation Basis Contract

- [ ] 1.1 Add a frontend-facing snapshot mutation basis type that carries `baseRevisionId` and optional repository heads from the caller's loaded snapshot.
- [ ] 1.2 Thread the mutation basis through editor runtime effects for feature commit, sketch commit, and document cursor movement without leaking repository metadata into kernel adapter request contracts unnecessarily.
- [ ] 1.3 Update modeling-service mutation inputs to accept the optional repository basis while preserving current non-repository call sites.
- [ ] 1.4 Add modeling-service tests proving stale repository heads reject deterministically and matching repository heads allow accepted mutations.

## 2. Editor-Owned Document Cursor Path

- [ ] 2.1 Add an editor event for document history cursor requests and route it to the existing `document.moveHistoryCursor` effect path.
- [ ] 2.2 Update timeline drag, document Undo, and document Redo flows to dispatch editor cursor requests instead of calling `modelingService.setFeatureCursor` directly from Workbench UI code.
- [ ] 2.3 Preserve edit-entry rollback and edit-exit restore behavior on the same cursor effect path, including `persistHistory: false` for transient edit orchestration.
- [ ] 2.4 Remove or narrow Workbench helper code that directly applies document cursors so variable undo/redo remains local but document-history movement is editor-owned.

## 3. Cursor Sequencing and Refresh Recovery

- [ ] 3.1 Ensure accepted document cursor mutations update the editor's active revision and trigger a required authoritative snapshot refresh.
- [ ] 3.2 Disable document-level history actions and timeline cursor commits while a cursor mutation or its follow-up snapshot refresh is pending.
- [ ] 3.3 Convert stale document cursor mutation conflicts into refresh recovery by clearing pending cursor state and requesting a fresh snapshot before retry.
- [ ] 3.4 Keep validation, unsupported cursor, and repository write failures surfaced as diagnostics instead of silently refreshing them away.

## 4. Repository Freshness

- [ ] 4.1 Replace service-global repository freshness inference for mutations with comparison against the request's supplied repository basis when present.
- [ ] 4.2 Preserve the existing revision-only behavior for non-repository documents and snapshots without repository provenance.
- [ ] 4.3 Ensure accepted cursor movement persists the complete authored document timeline, including future sketches/features after the active cursor.
- [ ] 4.4 Add repository-backed regression coverage for rollback, refresh, redo, refresh, and rollback again without repeated authored-document-changed notifications.

## 5. Regression Coverage

- [ ] 5.1 Add editor runtime coverage proving timeline cursor requests emit one document cursor effect, accept, update revision, and fetch a snapshot before another cursor move is available.
- [ ] 5.2 Add Workbench structural coverage proving document timeline drag and document Undo/Redo no longer call `modelingService.setFeatureCursor` directly.
- [ ] 5.3 Add history availability coverage proving document Undo/Redo and timeline cursor commits are unavailable while cursor mutation refresh is pending and are recomputed after snapshot load.
- [ ] 5.4 Add repository freshness tests proving stale `baseRepositoryHeads` produce `repository-head-conflict` and fresh heads accept the mutation.
- [ ] 5.5 Keep or extend edit-session regression coverage proving feature edit commit refreshes before restoring the captured cursor and does not surface the authored-document-changed notification.

## 6. Verification

- [ ] 6.1 Run `bun run test`.
- [ ] 6.2 Run `bun run lint`.
- [ ] 6.3 Run `bun run build`.
