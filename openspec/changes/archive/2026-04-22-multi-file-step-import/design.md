## Context

The current STEP import flow accepts one `.step` or `.stp` file, stores its bytes as a geometry asset, and rebuilds exact bodies by reading that single asset through OCC. Some SolidWorks assembly exports, including the observed `Progress Bar Full Assembly.STEP`, contain only assembly placements plus `DOCUMENT_FILE` references to sibling STEP files. OCC transfers the assembly root, but the resulting shape has no embedded solids unless the referenced files are also available in the virtual filesystem.

The workbench already has a Mantine STEP import modal and exact STEP import feature. The geometry asset substrate already stores immutable STEP bytes in self-contained `.cadara` packages, but the feature contract currently assumes one source STEP asset per import.

## Goals / Non-Goals

**Goals:**

- Import external-reference STEP assemblies when the user provides the root assembly file and referenced sibling STEP part files.
- Review discovered exact solids before commit in a Mantine modal with per-solid checkboxes and a global all-on/all-off control.
- Commit only selected solids as exact STEP import bodies with deterministic labels and durable topology refs.
- Persist every STEP source file required to rebuild the accepted import inside the document package.
- Preserve the existing single-file STEP import path for monolithic files.
- Produce explicit diagnostics for missing references, ambiguous sibling matches, unreadable referenced files, unsupported referenced content, and empty selection.

**Non-Goals:**

- Automatically read arbitrary local files that the user did not select.
- Preserve a full assembly/product tree in the object browser.
- Support non-STEP referenced documents.
- Add a new geometry kernel, STEP parser dependency, or mesh fallback for this flow.

## Decisions

1. Use an explicit multi-file file selection contract.
   - The import picker will allow selecting multiple files. The first STEP file chosen by the user is treated as the root assembly when multiple STEP files are present.
   - The review step matches `DOCUMENT_FILE` references from the root file against the selected sibling files by normalized basename.
   - Alternative considered: ask for a directory handle and recursively search for referenced names. That would make the browser permissions story larger and is unnecessary for a first implementation.

2. Store each STEP source file as an immutable geometry asset.
   - The accepted import records the root asset id plus referenced asset ids and their original STEP document names.
   - Save/open remains self-contained because every required source byte is packaged like existing STEP assets.
   - Alternative considered: concatenate or rewrite the STEP assembly into one derived file. That would create a generated STEP source that is harder to audit and may lose vendor-specific reference semantics.

3. Extend STEP import feature parameters with selection metadata.
   - Add a new STEP import feature schema version for multi-file imports while keeping the existing single-file version readable.
   - Parameters will include selected solid keys and labels. Rebuild imports the full resolved assembly then tracks only selected solids.
   - Solid keys should be deterministic from the resolved STEP traversal, using source document name plus solid ordinal/name data available from OCC. If a selected key is missing on rebuild, the feature reports a structured stale-selection diagnostic rather than silently importing a different body.

4. Perform review preparation before committing the feature.
   - The workbench will read selected file bytes, call a modeling-service preparation method, and show discovered solids in the modal.
   - The preparation method writes the root and referenced STEP bytes into the OCC filesystem using the document file names expected by the assembly, transfers roots, extracts supported solids, and returns review rows.
   - Alternative considered: commit all files first and let document diagnostics drive the UI. That would create repairable history entries for an import the user has not accepted.

5. Keep the modal Mantine-first and dense.
   - Use Mantine `Modal`, `Stack`, `Group`, `Checkbox`, `Table` or compact list rows, `ScrollArea`, `Button`, `Text`, `Badge`, `Alert`, and `Loader`.
   - The top checkbox controls all enabled solids and shows an indeterminate state when only some solids are selected.
   - Rows show solid label, source file, status, and any simple metadata available without expensive tessellation. Import is disabled when no supported solids are selected.

6. Rebuild resolves external references through virtual OCC files.
   - During rebuild, the OCC adapter writes the root source file and all referenced source files into the virtual filesystem with stable import-scoped paths. The root file is rewritten in memory only if needed to point document references at those stable virtual paths.
   - The adapter cleans up all temporary virtual files after import, matching current single-file cleanup behavior.

## Risks / Trade-offs

- [Risk] STEP external document references can use relative paths or duplicate basenames. -> Mitigation: normalize basenames for the common export case, report ambiguity instead of guessing, and keep the matching function isolated for later directory-handle support.
- [Risk] OCC may expose weak names for solids from referenced files. -> Mitigation: use deterministic source-file plus ordinal keys and fail selected-key mismatch explicitly on rebuild.
- [Risk] Large assemblies can make review slow. -> Mitigation: run preparation through the existing modeling/OCC boundary, surface progress state, and keep the first implementation focused on metadata extraction rather than preview tessellation.
- [Risk] Feature schema changes can break existing STEP imports. -> Mitigation: keep the current single-asset schema version valid and add upgrade/branching logic only for multi-file imports.
- [Risk] Users may select an assembly root but omit part files. -> Mitigation: modal shows missing referenced file diagnostics and disables import until required files for selected solids are available.

## Migration Plan

Existing documents with single-file STEP imports continue to rebuild through the current feature schema. New multi-file imports use the extended schema and asset manifest records. Rollback is limited to not creating new multi-file import features; existing single-file imports and mesh imports are unaffected.
