# feature-timeline-bar Specification

## Purpose
TBD - created by archiving change move-feature-tree-to-bottom-timeline. Update Purpose after archive.
## Requirements
### Requirement: Feature timeline SHALL replace the sidebar feature tree
The workbench SHALL render committed document features in a bottom feature timeline bar instead of rendering the feature tree as the top section of the left sidebar, while preserving the remaining sidebar sections.

#### Scenario: Sidebar keeps non-feature sections
- **WHEN** the workbench renders a document snapshot with features, objects, variables, references, and diagnostics
- **THEN** the left sidebar displays the parts and objects, document variables, and document diagnostic sections without the feature tree section
- **AND** the left sidebar does not display snapshot references as the standard middle section

#### Scenario: Features render in the bottom bar
- **WHEN** the workbench renders committed features from the current document snapshot
- **THEN** each committed feature is represented in the bottom feature timeline bar in document feature order

### Requirement: Timeline features SHALL be compact icon-only controls
The bottom feature timeline bar SHALL render each feature as a single icon-only control using the same icon sizing as toolbar tools and the shared tool icon definition for that feature when feature tool metadata exists.

#### Scenario: Feature icon renders without inline label
- **WHEN** the bottom feature timeline bar renders a feature
- **THEN** the visible timeline item contains one feature icon resolved from the shared tool icon definition source when the feature has tool icon metadata
- **AND** the visible timeline item does not render the feature label as inline timeline text

#### Scenario: Feature control remains accessible
- **WHEN** a screen reader or keyboard user focuses a feature timeline item
- **THEN** the control exposes an accessible label that identifies the feature

#### Scenario: Sketch history icon uses shared tool metadata
- **WHEN** the sketch history timeline renders a sketch dimension, constraint, or entity item that maps to an existing `ToolIconId`
- **THEN** the item icon is resolved from the shared tool icon definition source instead of a separate generic workbench icon mapping

### Requirement: Timeline feature details SHALL use shared tooltip mechanics
The bottom feature timeline bar SHALL use the same tooltip primitives and delay behavior as toolbar feature buttons to show feature information on hover or focus.

#### Scenario: Hovering a timeline feature shows details
- **WHEN** the user hovers or focuses a feature icon in the bottom feature timeline bar
- **THEN** a tooltip appears using the shared toolbar tooltip mechanics and includes the feature's available label and descriptive information

### Requirement: Timeline SHALL show the document cursor
The bottom feature timeline bar SHALL show a visible cursor at the current document feature cursor position.

#### Scenario: Cursor is at the feature tail
- **WHEN** the document cursor references the last committed feature in document order
- **THEN** the bottom feature timeline bar shows the cursor at the tail of the feature sequence

#### Scenario: Cursor is rolled back
- **WHEN** the document cursor references a feature before later stored features
- **THEN** the bottom feature timeline bar shows the cursor at that feature position and indicates that later features are after the current applied position

### Requirement: Timeline selection SHALL preserve feature target behavior
The bottom feature timeline bar SHALL preserve feature-row selection and visibility behavior that was previously available through the sidebar feature tree.

#### Scenario: Selecting a timeline feature
- **WHEN** the user activates a selectable feature icon in the bottom feature timeline bar
- **THEN** the workbench dispatches the same target selection request that the corresponding sidebar feature row would have dispatched

#### Scenario: Hidden feature remains visible as timeline state
- **WHEN** a feature target is hidden from the viewport
- **THEN** the bottom feature timeline bar keeps the feature item present and indicates its hidden state without allowing hidden geometry to be selected

### Requirement: Sidebar diagnostics SHALL remain compact
The left sidebar SHALL constrain the Document Diagnostics section so its maximum height equals the current normal diagnostics section height, and diagnostics overflow SHALL scroll inside that section.

#### Scenario: Diagnostics exceed the compact section height
- **WHEN** the document has more diagnostics than fit inside the compact diagnostics section
- **THEN** the Document Diagnostics section remains no taller than its configured maximum height
- **AND** the diagnostics list scrolls internally

#### Scenario: Diagnostics are empty
- **WHEN** the document has no diagnostics
- **THEN** the Document Diagnostics section remains visible in its compact position and shows the empty diagnostics state

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

### Requirement: Timeline SHALL show feature-scoped rebuild errors
The bottom feature timeline SHALL mark document history items that own recoverable rebuild errors and SHALL provide persistent repair guidance without requiring the user to reset the document.

#### Scenario: Failed feature item is marked
- **WHEN** the current snapshot contains an error diagnostic attached to a committed feature
- **THEN** the corresponding feature history item renders with danger styling that is visually red
- **AND** the item remains present in its authored history position even if its geometry did not rebuild

#### Scenario: Multiple failed feature items are marked
- **WHEN** reload discovers errors on multiple independent committed features
- **THEN** each corresponding feature history item renders its own error state
- **AND** the timeline does not collapse those errors into one document-level message

#### Scenario: Failed feature shows persistent guidance tooltip
- **WHEN** a feature history item has an attached error diagnostic
- **THEN** the timeline shows a persistent tooltip or equivalent always-visible popover anchored to that feature item
- **AND** the tooltip explains what went wrong and how to repair the authored field
- **AND** the tooltip text does not use raw missing topology ids as its primary user-facing message

#### Scenario: Error item opens repair context
- **WHEN** the user activates an erroneous feature history item
- **THEN** the workbench selects or opens the feature editing context needed to correct the invalid field
- **AND** the action does not clear, delete, reset, or start over the document

### Requirement: History bar document items SHALL expose context menu parity
The bottom document history bar SHALL expose context-menu Rename, Edit, Roll History Here, Roll To End, and Delete actions for every supported committed document history item without requiring item-kind-specific presentation code. Feature-only actions such as Suppress SHALL remain available only for committed feature items.

#### Scenario: Feature history item menu includes shared history actions
- **WHEN** the user opens the context menu for a committed feature history item
- **THEN** the menu includes Rename, Edit, Roll History Here, Roll To End, and Delete for that item

#### Scenario: Sketch history item menu includes shared history actions
- **WHEN** the user opens the context menu for a committed sketch history item
- **THEN** the menu includes Rename, Edit, Roll History Here, Roll To End, and Delete for that item

#### Scenario: Roll to end is disabled at the current tail
- **WHEN** the user opens the context menu for a committed document history item while the current document cursor is already at the history tail
- **THEN** the menu renders Roll To End as disabled

#### Scenario: Failed feature can be deleted
- **WHEN** the user opens the context menu for a feature history item with a repairable rebuild error
- **THEN** the menu includes Delete for that authored feature history item
- **AND** selecting Delete requests generic deletion instead of requiring the user to repair the feature first

#### Scenario: Opening context menu does not reorder item
- **WHEN** the user opens a document history item context menu by right-click or keyboard
- **THEN** no document-history reorder mutation is requested
- **AND** the existing selection, cursor, drag, and tooltip behavior remains available when the menu is closed

### Requirement: Timeline SHALL highlight contributor features for selected geometry
The bottom feature timeline bar SHALL render a derived highlighted state for every committed feature whose id appears in the current selected geometry target's contributor ancestry.

#### Scenario: Selecting an inner shell face highlights shell and extrude
- **WHEN** the current selection is an inner face created by a `Shell` feature from an earlier `Extrude`
- **THEN** the timeline highlights the `Extrude` history item
- **AND** the timeline highlights the `Shell` history item

#### Scenario: Selecting an unrelated back face highlights only extrude
- **WHEN** the current selection is a preserved back face on that same shelled cube
- **THEN** the timeline highlights the `Extrude` history item
- **AND** it does not highlight the `Shell` history item

#### Scenario: Clearing selection removes derived highlights without moving history
- **WHEN** the user clears the current viewport selection
- **THEN** the timeline removes any derived contributor highlight state
- **AND** the document cursor remains at its existing history position

