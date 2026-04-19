## Why

Rolling the document history cursor back and refreshing can permanently lose authored steps after the cursor, for example `sketch - extrude - sketch2 - revolve` rolled back to `sketch2` can reload without `revolve`. This is data loss: cursor movement must change only the active/applied position, never the complete durable authored document timeline.

## What Changes

- Persist cursor moves as authored document state while preserving every sketch and feature record after the cursor.
- Ensure repository-backed refresh restores both the complete authored history order and the saved cursor position.
- Separate persisted authored timeline data from applied snapshot/render data when the cursor is rolled back, so a rolled-back rebuild cannot overwrite future authored steps.
- Add a regression test that builds `sketch - extrude - sketch2 - revolve`, moves the cursor to `sketch2`, reloads from the document repository, and proves `revolve` is still present after the cursor and can be reached again.
- Add focused coverage around snapshot-to-authored-document persistence so the saved document cannot be derived from an applied-only feature prefix.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `model-document-feature-cursor`: Cursor movement must be durable and must not delete or omit authored sketches/features after the cursor across save/load.
- `document-repository`: Repository persistence must store and restore the complete authored timeline plus the active cursor, even when the active snapshot is rolled back.

## Impact

- Affected contracts: authored model document generation/parsing, document history order, and document cursor validation.
- Affected runtime paths: `createModelingService` repository persistence, kernel adapter authored-document restore/export behavior, and snapshot/authored-document conversion.
- Affected tests: modeling service repository regression coverage, authored document contract coverage, and possibly a browser-level repository refresh regression using the existing Playwright repository harness.
