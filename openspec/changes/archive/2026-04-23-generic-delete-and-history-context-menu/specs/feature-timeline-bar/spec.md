## ADDED Requirements

### Requirement: History bar document items SHALL expose context menu parity
The bottom document history bar SHALL expose context-menu Rename and Delete actions for every supported committed document history item without requiring item-kind-specific presentation code.

#### Scenario: Feature history item menu includes rename and delete
- **WHEN** the user opens the context menu for a committed feature history item
- **THEN** the menu includes Rename and Delete actions for that item

#### Scenario: Sketch history item menu includes rename and delete
- **WHEN** the user opens the context menu for a committed sketch history item
- **THEN** the menu includes Rename and Delete actions for that item

#### Scenario: Failed feature can be deleted
- **WHEN** the user opens the context menu for a feature history item with a repairable rebuild error
- **THEN** the menu includes Delete for that authored feature history item
- **AND** selecting Delete requests generic deletion instead of requiring the user to repair the feature first

#### Scenario: Opening context menu does not reorder item
- **WHEN** the user opens a document history item context menu by right-click or keyboard
- **THEN** no document-history reorder mutation is requested
- **AND** the existing selection, cursor, drag, and tooltip behavior remains available when the menu is closed
