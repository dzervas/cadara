## 1. Define authoritative ownership paths

- [x] 1.1 Add runtime-facing request and replacement handoff APIs for the workbench flows covered by this change.
- [x] 1.2 Document and enforce the shell/controller/runtime/service ownership split in the workbench integration layer.
- [x] 1.3 Add or update architecture tests that fail when covered workbench flows use direct mutation plus ad hoc refresh repair from shell or controller code.

## 2. Migrate covered workbench flows

- [x] 2.1 Rework rename and document-variable update flows to sequence accepted document changes through the authoritative runtime-owned path.
- [x] 2.2 Rework shared history coordination so it dispatches through authoritative history owners without maintaining competing document-state ownership.
- [x] 2.3 Rework generic part import commit completion and sketch reopen follow-up to reconcile through the authoritative document-state owner.
- [x] 2.4 Isolate whole-document replacement flows behind an explicit replacement handoff distinct from ordinary incremental mutations.

## 3. Reduce shell-local document repair logic

- [x] 3.1 Remove ordinary document-facing repair logic from `CadWorkbench` and keep only UI-local presentation state in the shell.
- [x] 3.2 Simplify application controllers so they coordinate browser-facing work and notifications without mirroring authoritative document state.
- [x] 3.3 Delete transitional snapshot-patching and refresh-bridge paths once the authoritative ownership routes are in place.

## 4. Verify behavioral parity

- [x] 4.1 Add or update tests covering rename and variable-update sequencing through the authoritative owner.
- [x] 4.2 Add or update tests covering history trigger parity across toolbar and shortcuts under the new ownership model.
- [x] 4.3 Add or update tests covering generic import completion and whole-document replacement behavior under the explicit handoff rules.
