## Why

The Parts & Objects export action is currently a placeholder, so users cannot download modeled geometry or the native document state from the workbench. Export needs a small, explicit flow because supported file types have different option requirements and cadara must preserve the raw JSON document exactly enough for future restore/import work.

## What Changes

- Replace the Parts & Objects export placeholder with an export modal opened from the existing export context action.
- Let users choose STL, STEP, 3MF, or cadara before downloading.
- Provide format-specific export options, including mesh accuracy controls for tessellated formats.
- Export cadara as the raw JSON document payload.
- Route export generation through a typed domain/service boundary so UI state does not own kernel or serialization details.
- Report unavailable geometry, export failures, and unsupported option states in the modal without silently downloading invalid files.

## Capabilities

### New Capabilities
- `document-export`: Defines exportable formats, modal behavior, format options, file generation, and download outcomes for document/object export.

### Modified Capabilities
- `workbench-context-menus`: The Parts & Objects Export action opens the export modal instead of showing the placeholder status message.

## Impact

- Affected UI: Parts & Objects context menu export handler, Mantine modal form, status/error feedback, and download trigger wiring.
- Affected domain/contracts: export request/option types for STL, STEP, 3MF, and cadara plus validation of format-specific options.
- Affected modeling/kernel boundary: document/object export service methods, with OpenCascade-backed serialization for geometry formats and raw JSON serialization for cadara.
- Affected tests: `bun:test` coverage for export option defaults/validation, context-menu behavior, modal state transitions, cadara JSON output, and failure handling.
