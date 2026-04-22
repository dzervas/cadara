# sketch-history-navigation Specification

## Purpose
TBD - created by archiving change surface-sketch-history-navigation. Update Purpose after archive.
## Requirements
### Requirement: Committed sketches SHALL appear in document navigation
The workbench SHALL surface every committed sketch as a first-class document item in both `Parts & Objects` and the normal document history view.

#### Scenario: Show sketches in Parts & Objects
- **WHEN** the workbench renders a snapshot containing committed sketches
- **THEN** `Parts & Objects` includes one row for each committed sketch with the sketch label and a sketch-specific icon
- **AND** the row target resolves to the durable sketch reference

#### Scenario: Show sketches in document history
- **WHEN** the normal document history renders committed authored items
- **THEN** the history includes committed sketches and solid features in authored document order
- **AND** sketch items remain visible when the document is not actively editing a sketch

### Requirement: Sketch visibility SHALL be toggleable
The workbench SHALL allow committed sketches to be hidden and shown from the same object navigation surface used for body and construction visibility.

#### Scenario: Hide a committed sketch
- **WHEN** the user activates the visibility control for a visible committed sketch
- **THEN** sketch-owned viewport geometry for that sketch is excluded from render, hover, and selection output
- **AND** the sketch row remains visible in `Parts & Objects` with hidden-state treatment

#### Scenario: Show a hidden committed sketch
- **WHEN** the user activates the visibility control for a hidden committed sketch
- **THEN** sketch-owned viewport geometry for that sketch is restored to render, hover, and selection output
- **AND** the sketch row returns to visible-state treatment

### Requirement: Document history SHALL preserve cursor behavior across sketches and features
The normal document history SHALL expose valid cursor anchors for committed sketches and solid features so rollback, replay, and cursor placement remain coherent when sketches are present.

#### Scenario: Cursor is placed on a sketch item
- **WHEN** the document cursor is moved to a committed sketch item in document history
- **THEN** authored items after that sketch are treated as after the current cursor
- **AND** the cursor handle is displayed at the sketch item anchor

#### Scenario: Select and reopen from document history
- **WHEN** the user selects or double-clicks a sketch item in normal document history
- **THEN** selection and edit-reentry use the same durable sketch target as the matching `Parts & Objects` row

### Requirement: Sketch edit mode SHALL expose sketch-local history
While a sketch is being edited, the history area SHALL show ordered durable sketch authoring operation rows for the active sketch instead of the normal document history items.

#### Scenario: Render sketch-local history
- **WHEN** an active sketch edit session is present
- **THEN** the history area shows sketch authoring operation rows for that sketch in operation order
- **AND** the normal document history items are not interactive during the sketch edit session
- **AND** individual operation child geometry rows are not shown

#### Scenario: Move sketch history cursor
- **WHEN** the user moves the sketch history cursor to an earlier sketch-local operation
- **THEN** sketch-local operations after that cursor are treated as after the current cursor
- **AND** the displayed sketch geometry and annotations reflect the flat sketch graph reconstructed through the active operation cursor

#### Scenario: Insert after sketch cursor
- **WHEN** the user authors new sketch geometry, constraints, or dimensions while the sketch cursor is rolled back
- **THEN** the new sketch-local authoring operation is inserted after the current sketch cursor
- **AND** the sketch cursor advances to the new operation

### Requirement: Sketch history SHALL group inferred constraints with their accepted authoring action
The sketch-local history model SHALL preserve user-facing undo and redo behavior for authoring operations that create geometry together with inferred constraints.

#### Scenario: Undo after inferred constraint commit
- **WHEN** the latest sketch authoring operation created geometry and inferred constraints from accepted snap intent
- **THEN** a single Undo action moves the visible sketch state before both the new geometry and the inferred constraints

### Requirement: Reopened sketch editing SHALL preserve document rollback and sketch-local history
While an existing committed sketch is reopened for editing, the document cursor SHALL remain at the rollback position before that sketch, and the history area SHALL continue to expose durable sketch authoring operation rows for the active sketch session.

#### Scenario: Reopened sketch shows sketch-local history after document rollback
- **WHEN** the user reopens a committed sketch whose document history position has later authored items
- **THEN** the normal document history is rolled back to the item immediately before the sketch
- **AND** the history area shows sketch authoring operation rows for the active sketch instead of interactive document history items

#### Scenario: Sketch-local cursor changes do not overwrite restore cursor
- **WHEN** a reopened sketch edit session captures an entry document cursor
- **AND** the user moves the sketch-local history cursor during the edit
- **THEN** the captured document restore cursor remains unchanged

#### Scenario: Exiting reopened sketch restores document cursor
- **WHEN** a reopened sketch edit session exits by finish sketch or abort sketch
- **THEN** the document cursor is restored to the cursor captured before the sketch edit session began
- **AND** the workbench leaves sketch-local history mode

### Requirement: Committed sketches SHALL participate in document history reordering
The normal document history SHALL treat committed sketches and committed features as reorderable authored document items in one shared order.

#### Scenario: Move sketch across feature boundary
- **WHEN** the user reorders a committed sketch before or after a committed feature in normal document history
- **THEN** the authored document history order contains the sketch at the accepted position
- **AND** the sketch remains addressable by the same durable sketch target from document history and `Parts & Objects`

#### Scenario: Reorder feature across sketch boundary
- **WHEN** the user reorders a committed feature before or after a committed sketch in normal document history
- **THEN** the authored document history order contains the feature at the accepted position
- **AND** the feature remains addressable by the same durable feature target from document history

#### Scenario: Active sketch edit keeps sketch-local history isolated
- **WHEN** an active sketch edit session is showing sketch-local history
- **THEN** document history item reordering is unavailable
- **AND** sketch-local history cursor movement remains the active history interaction

### Requirement: Document cursor SHALL remain target-based after history reordering
Document history reordering SHALL preserve the document cursor as a durable sketch, feature, or empty target instead of preserving only its previous visual index.

#### Scenario: Reorder item before cursor target
- **WHEN** the document cursor targets an authored item
- **AND** another document history item is reordered before that cursor target
- **THEN** the cursor still targets the same durable sketch or feature item
- **AND** applied history is recalculated from the target's accepted position in the new order

#### Scenario: Reorder cursor target
- **WHEN** the document cursor targets an authored item that is reordered
- **THEN** the cursor still targets that same durable sketch or feature item
- **AND** applied history is recalculated from the target's accepted position in the new order

