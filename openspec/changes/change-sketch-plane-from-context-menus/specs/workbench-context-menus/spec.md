## ADDED Requirements

### Requirement: Parts and objects sketch menus SHALL expose plane reassignment for eligible sketches
The `Parts & Objects` context menu SHALL expose `Change Sketch Plane` for committed sketch rows that participate in the origin-plane reassignment capability.

#### Scenario: Eligible sketch row shows change-plane action
- **WHEN** the user opens the context menu for an eligible committed sketch row in `Parts & Objects`
- **THEN** the menu includes `Change Sketch Plane`
- **AND** selecting that action opens the dedicated sketch-plane edit flow for that sketch

#### Scenario: Non-sketch or unsupported sketch row omits change-plane action
- **WHEN** the user opens the context menu for a non-sketch row or a committed sketch row that does not participate in origin-plane reassignment
- **THEN** the `Parts & Objects` menu does not expose `Change Sketch Plane` as an enabled action

## MODIFIED Requirements

### Requirement: Feature history menu SHALL include edit, suppress, cursor, and delete actions
The Feature Timeline/history context menu SHALL offer Edit, Rename, Roll History Here, Roll To End, and Delete for supported committed document history items. Committed sketch items that participate in origin-plane reassignment SHALL also offer `Change Sketch Plane`. Feature-only actions such as Suppress SHALL remain available only for committed feature items.

#### Scenario: Edit history item from menu
- **WHEN** the user selects Edit from a committed sketch or feature history context menu
- **THEN** the workbench uses the same reopen flow as double-clicking that history item

#### Scenario: Change sketch plane from menu
- **WHEN** the user selects `Change Sketch Plane` from the context menu for an eligible committed sketch history item
- **THEN** the workbench opens the dedicated sketch-plane edit flow for that sketch
- **AND** it does not reopen the full sketch authoring session

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
