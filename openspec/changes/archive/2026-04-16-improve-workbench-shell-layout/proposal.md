## Why

The current workbench shell wastes space and fights the viewport during editing. The left sidebar is fixed-width, the right inspector expands the page and forces scrolling when opened, and the timeline cursor uses step controls where direct manipulation would be clearer.

## What Changes

- Make the left sidebar resizable through a bounded drag handle while preserving the compact CAD-style navigation content.
- Render the right inspector as an overlay on top of the viewport with internal scrolling instead of pushing the page layout wider or taller.
- Replace timeline back and forward cursor buttons with a draggable vertical-bar cursor handle using the requested two-arrow Unicode glyph.
- Make the timeline cursor snap only to valid rollback positions while dragging.

## Capabilities

### New Capabilities
- `workbench-sidebar-layout`: Resizable left navigation and overlayed right inspector behavior for the workbench shell.
- `timeline-drag-cursor`: Draggable, snapped timeline cursor behavior for document rollback and replay.

### Modified Capabilities

## Impact

- Affected code includes workbench layout composition, sidebar and inspector containers, pointer-drag resize handling, timeline cursor UI, and rollback interaction tests.
- Does not require kernel changes unless timeline cursor interaction currently depends on UI-only assumptions that need normalization.
