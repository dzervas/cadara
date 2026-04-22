## Why

Some STEP assemblies contain only placement metadata and references to sibling STEP part files. The current single-file STEP import can read those assemblies but cannot resolve the external part geometry, so users see a no-solids failure even when the complete exported folder contains valid solid bodies.

## What Changes

- Add a multi-file STEP assembly import flow that accepts an assembly `.step`/`.stp` file plus referenced sibling STEP files.
- Resolve external STEP document references during import review so supported exact solids from referenced files can be discovered before commit.
- Show a Mantine modal listing all discovered solid bodies with per-solid checkboxes and a global enable/disable all toggle at the top.
- Commit only the selected solids as imported exact bodies while retaining the required STEP source bytes as geometry assets.
- Preserve the existing single-file STEP import path for monolithic STEP files.
- Report structured diagnostics when referenced files are missing, unreadable, unresolved, unsupported, or when the user selects no importable solids.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `step-exact-solid-import`: Extend STEP exact import from single embedded-solid files to multi-file external-reference assemblies with selectable discovered solids.
- `workbench-document-file-menu`: Extend the workbench import flow with a Mantine STEP import review modal for external-reference assemblies and solid selection.
- `geometry-asset-substrate`: Extend retained STEP source assets to include the set of source files required to rebuild a selected multi-file STEP assembly import.

## Impact

- Affected code includes STEP import preparation and commit paths in `src/app/cad-workbench.tsx`, STEP import feature contracts and runtime schemas under `src/contracts/modeling/`, geometry asset records and asset store helpers, OpenCascade STEP reading in `src/domain/modeling/occ/features.ts`, modeling service import helpers, document save/open packaging, and focused `bun:test` coverage.
- UI work should use Mantine modal, checkbox, scroll, table/list, button, text, alert, and progress primitives with existing workbench theme tokens.
- No new runtime dependency is expected; use the installed OpenCascade.js runtime and existing Mantine stack.
