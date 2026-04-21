## ADDED Requirements

### Requirement: Timeline document items SHALL support drag reordering
The bottom feature timeline bar SHALL allow committed document history items to be dragged to reorder authored sketches and features without using the cursor handle.

#### Scenario: Drag feature before another item
- **WHEN** the user drags a committed feature item before another visible document history item and releases it
- **THEN** the workbench requests a document-history reorder for the moved feature and the target insertion anchor
- **AND** the document cursor is not moved by the item drag

#### Scenario: Drag sketch after a feature
- **WHEN** the user drags a committed sketch item to a valid position after a committed feature item and releases it
- **THEN** the workbench requests a document-history reorder for the moved sketch and the target insertion anchor
- **AND** the next rendered timeline uses the accepted authored document order

#### Scenario: Drop item at existing position
- **WHEN** the user releases a dragged document history item at its existing effective position
- **THEN** no document-history reorder mutation is requested

#### Scenario: Reorder unavailable during pending history mutation
- **WHEN** a document cursor mutation, document-history reorder mutation, or required follow-up snapshot refresh is pending
- **THEN** timeline item drag reorder cannot commit another document-history mutation

### Requirement: Timeline item drag SHALL preserve normal item actions
The bottom feature timeline bar SHALL preserve existing selection, reopen, tooltip, and context-menu behavior for document history items when no reorder drag is committed.

#### Scenario: Click item without dragging
- **WHEN** the user clicks a document history item without crossing the reorder drag threshold
- **THEN** the item selection behavior remains unchanged
- **AND** no document-history reorder mutation is requested

#### Scenario: Open item context menu
- **WHEN** the user opens a document history item context menu
- **THEN** the menu remains available for that item
- **AND** no document-history reorder mutation is requested
