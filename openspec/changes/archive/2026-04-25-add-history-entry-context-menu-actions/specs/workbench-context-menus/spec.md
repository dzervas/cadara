## MODIFIED Requirements

### Requirement: Feature history menu SHALL include edit, suppress, cursor, and delete actions
The Feature Timeline/history context menu SHALL offer Edit, Rename, Roll History Here, Roll To End, and Delete for supported committed document history items. Feature-only actions such as Suppress SHALL remain available only for committed feature items.

#### Scenario: Edit history item from menu
- **WHEN** the user selects Edit from a committed sketch or feature history context menu
- **THEN** the workbench uses the same reopen flow as double-clicking that history item

#### Scenario: Rename history item from menu
- **WHEN** the user selects Rename from a committed sketch or feature history context menu
- **THEN** the workbench uses the existing rename flow for that history item target
- **AND** the refreshed history bar shows the accepted label when the mutation succeeds

#### Scenario: Roll history here from menu
- **WHEN** the user selects Roll History Here from a committed sketch or feature history context menu
- **THEN** the workbench requests the document cursor position immediately after that history item through the existing document cursor mutation path

#### Scenario: Roll to end from menu
- **WHEN** the user selects Roll To End from a committed sketch or feature history context menu
- **AND** the current document cursor is not already at the authored-history tail
- **THEN** the workbench requests the current authored-history tail cursor through the existing document cursor mutation path

#### Scenario: Roll to end is disabled at tail
- **WHEN** the user opens a committed sketch or feature history context menu while the current document cursor is already at the authored-history tail
- **THEN** the Roll To End action is disabled

#### Scenario: Delete history item from menu
- **WHEN** the user selects Delete from a committed sketch or feature history context menu
- **THEN** the workbench requests generic deletion for that document history item through the modeling service
- **AND** the refreshed history bar no longer shows the deleted history item when the mutation is accepted

#### Scenario: Suppress feature placeholder
- **WHEN** the user selects Suppress from a feature history context menu
- **THEN** the workbench shows an inline status message that feature suppression is not implemented yet
