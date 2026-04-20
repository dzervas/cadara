## Context

The toolbar is rendered by `WorkspaceToolbar`, with tool definitions staying in `src/domain/tools/` and shell-level behavior coordinated by `CadWorkbench`. Object-scoped export already exists through the Parts & Objects context menu and `DocumentExportModal`, but that flow requires a selected geometry target and is not a document-level file action. The modeling service already has authored document export/restore hooks for repository persistence, which are the narrowest boundary for document-level import/export.

## Goals / Non-Goals

**Goals:**
- Add an icon-only file button at the far left of the top toolbar with Mantine menu semantics and accessible labels.
- Provide New, Import, and Export commands for the active document.
- Reuse the authored document JSON contract and existing validation when importing.
- Keep UI menu behavior in presentation components and document mutation/export behavior in the modeling service/workbench orchestration.
- Cover the menu and file behavior with focused component/domain tests plus an e2e path.

**Non-Goals:**
- Add cloud storage, save-as paths, native filesystem handles, or browser-specific file system access APIs.
- Replace object-scoped STL/STEP/3MF export.
- Add unsaved-change prompts or multi-document tab management.

## Decisions

- **Use a dedicated toolbar file menu component/props rather than registering file commands as CAD tools.** File actions are document/application commands, not modeling tools, so keeping them outside `src/domain/tools/` avoids mixing tool action bus events with document lifecycle actions. Alternative considered: add a `file` tool to the registry. That would make left placement easy but would incorrectly dispatch tool group/tool events for non-tool behavior.
- **Export document-level `.cadara` as authored document JSON.** Authored JSON is already the persistence contract that preserves rebuild inputs, document history, cursor, variables, and body labels without presentation-only state. Alternative considered: reuse target-scoped cadara export from `exportDocument`; that API requires a durable target and currently serves object export, not top-level document replacement.
- **Import through runtime validation before restoring.** The selected file is parsed and validated as an authored model document before the modeling service restores it and persists it through the repository boundary. Invalid files surface a workbench status and are not silently ignored.
- **Create New by restoring the initial seeded authored document.** The modeling service captures the seed authored document before repository/history replay and uses that seed for a new document action. This matches existing repository reset semantics and avoids constructing a second document seed path in UI code.

## Risks / Trade-offs

- Imported documents may carry a different root document ID → normalize to the active document ID before restore so existing single-document service assumptions hold.
- Restore may fail in the kernel adapter for unsupported or stale authored content → let the exception bubble to the existing error reporting/workbench status path instead of swallowing it.
- Browser download and file input APIs are awkward in unit tests → isolate them behind small handler functions and cover the full browser path with Playwright.
