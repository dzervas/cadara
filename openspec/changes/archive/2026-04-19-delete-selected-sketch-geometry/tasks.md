## 1. Domain Deletion

- [x] 1.1 Add sketch-session domain logic to delete selected local sketch points and entities from the cursor-truncated sketch definition.
- [x] 1.2 Add shared reference-detection helpers for constraints and dimensions that target deleted local point or entity IDs.
- [x] 1.3 Remove dependent constraints and dimensions during geometry deletion while preserving unrelated sketch records.
- [x] 1.4 Rebuild visible sketch state, `fullDefinition`, `historyCursor`, draft entities, active edit state, and `commitRequest` after deletion.

## 2. Editor And Shortcut Routing

- [x] 2.1 Broaden `editor.deleteSelection` enablement so selected sketch points and entities are eligible while a sketch session is active.
- [x] 2.2 Route Delete and Backspace through the editor state machine to the geometry deletion domain path for local sketch geometry selections.
- [x] 2.3 Preserve existing deletion behavior for selected sketch annotations and projected reference targets.
- [x] 2.4 Clear deleted geometry selection, hover, active edit target, and drag state after a successful geometry deletion.

## 3. Tests

- [x] 3.1 Add domain tests proving selected entity deletion removes the entity and only constraints or dimensions that reference it.
- [x] 3.2 Add domain tests proving selected point deletion removes the point and dependent constraints or dimensions without leaving dangling references.
- [x] 3.3 Add editor/history tests proving one toolbar Undo activation restores deleted geometry and dependent constraints in an active sketch session.
- [x] 3.4 Update shortcut tests proving Delete and Backspace dispatch the delete-selection path for selected sketch geometry while preserving annotation delete behavior.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
