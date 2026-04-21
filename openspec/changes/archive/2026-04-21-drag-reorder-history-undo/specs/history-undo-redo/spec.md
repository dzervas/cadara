## ADDED Requirements

### Requirement: Document history reorder undo and redo SHALL restore accepted orders
Accepted document history reorder mutations SHALL create workbench undo-stack entries that restore the previous and next authored document history order.

#### Scenario: Undo accepted reorder
- **WHEN** a document history reorder mutation is accepted
- **AND** the user activates Undo before another higher-priority undo context applies
- **THEN** the workbench requests restoration of the previous authored document history order
- **AND** the reorder entry moves from the undo stack to the redo stack only after the restoration is accepted

#### Scenario: Redo accepted reorder
- **WHEN** a document history reorder has been undone successfully
- **AND** the user activates Redo before another higher-priority redo context applies
- **THEN** the workbench requests restoration of the next authored document history order
- **AND** the reorder entry moves from the redo stack to the undo stack only after the restoration is accepted

#### Scenario: Reorder undo rejected
- **WHEN** restoring a previous or next document history order is rejected or conflicts
- **THEN** the workbench keeps the undo and redo stacks unchanged
- **AND** it reports the returned diagnostic through existing workbench feedback

#### Scenario: Sketch edit mode has priority
- **WHEN** a sketch edit session is active
- **AND** a document history reorder entry exists on the workbench undo stack
- **THEN** toolbar Undo and Redo continue to operate on sketch-local history availability
- **AND** they do not apply the document history reorder entry until sketch edit mode exits
