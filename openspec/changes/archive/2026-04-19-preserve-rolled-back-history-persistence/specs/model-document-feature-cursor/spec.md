## ADDED Requirements

### Requirement: Cursor persistence SHALL preserve future authored history
The system SHALL preserve every authored sketch and feature after the active document cursor whenever the cursor is saved, restored, or refreshed.

#### Scenario: Rolled-back cursor is saved without truncating history
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the document cursor is moved to `sketch2`
- **THEN** the durable document cursor references `sketch2`
- **AND** the durable document history still contains `revolve` after `sketch2`

#### Scenario: Restored cursor can advance to future history
- **WHEN** a document is restored with history `sketch - extrude - sketch2 - revolve`
- **AND** the restored cursor references `sketch2`
- **THEN** redo or next-cursor navigation can move the cursor to `revolve`
- **AND** `revolve` is not recreated as a new authored feature

#### Scenario: Rolled-back rebuild remains applied-only
- **WHEN** a document is restored with future authored items after the cursor
- **THEN** rebuild and render output are based only on authored items through the cursor
- **AND** future authored items remain stored for later cursor movement
