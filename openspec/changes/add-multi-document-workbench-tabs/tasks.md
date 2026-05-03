## 1. Extend the durable document contract

- [ ] 1.1 Add a durable document-level `name` field to the authored-document types, schemas, seed document creation, and serialization/validation paths.
- [ ] 1.2 Add a document rename mutation path through the modeling/document ownership seam so tab rename updates the durable document instead of only workbench UI metadata.
- [ ] 1.3 Update document import/export and snapshot-building paths so the durable document name round-trips through whole-document flows.

## 2. Introduce document-scoped active session composition

- [ ] 2.1 Refactor application/workbench bootstrap so the active `documentId` composes a document-scoped `ModelingService`, sketch solver, and editor/runtime provider tree.
- [ ] 2.2 Replace the current no-op tab activation path and singleton-document assumptions with active-session switching keyed by the selected tab's `documentId`.
- [ ] 2.3 Keep shell-local layout/presentation state outside the active document session host so tab switching does not become shell-owned document repair logic.

## 3. Wire tab behavior and whole-document flows

- [ ] 3.1 Rework workbench tab persistence so open tabs, tab order, and active tab restore after reload using the new canonical workspace payload.
- [ ] 3.2 Seed tab titles from durable document names and route tab rename through the real document rename path.
- [ ] 3.3 Derive per-tab `storageKind` from document-scoped repository and local-file-binding state without overloading it with transient sync phases.
- [ ] 3.4 Change authored-document import to create and activate a new document tab instead of replacing the current active tab.
- [ ] 3.5 Change local-file open to create and activate a new document tab, then bind that tab's document to the selected file handle.

## 4. Verify architecture and behavior

- [ ] 4.1 Add or update logic-lane tests for durable document naming, tab state persistence, and document-scoped storage/binding derivation.
- [ ] 4.2 Add or update UI and/or e2e coverage for tab rename syncing, tab switching, and reload restoration of the active tab workspace.
- [ ] 4.3 Add or update architecture/static guards so workbench tab switching does not regress into singleton-session mutation or shell-local document repair.
- [ ] 4.4 Run the relevant verification commands, including `bun run test:all` and any needed build validation, and fix resulting regressions.
