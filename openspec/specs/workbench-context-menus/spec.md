# workbench-context-menus Specification

## Purpose
Defines custom workbench context menus for navigation rows, including object actions, reference and diagnostic target actions, and feature history commands.
## Requirements
### Requirement: Workbench rows SHALL expose custom context menus
The workbench SHALL render a custom right-click context menu for visible navigation rows in Parts & Objects, Snapshot References, Document Diagnostics, and the Feature Timeline/history.

#### Scenario: Right-click a supported row
- **WHEN** the user right-clicks a supported workbench row
- **THEN** the browser context menu is suppressed
- **AND** a workbench-styled context menu opens at the interaction point

#### Scenario: Open menu from keyboard
- **WHEN** a supported focusable row receives the Context Menu key or Shift+F10
- **THEN** the workbench opens the same context menu for that row

### Requirement: Parts and objects menu SHALL include delete and export actions
The Parts & Objects context menu SHALL offer Delete and Export actions for each object row. Delete SHALL request generic durable deletion for supported parts and objects, and Export SHALL open the document export modal for the selected object row.

#### Scenario: Invoke object delete action
- **WHEN** the user selects Delete from a Parts & Objects row context menu for a supported part or object
- **THEN** the workbench requests generic deletion for that row target through the modeling service
- **AND** the refreshed Parts & Objects tree no longer shows the deleted target when the mutation is accepted

#### Scenario: Unsupported object delete is rejected
- **WHEN** the user selects Delete from a Parts & Objects row context menu for an unsupported target
- **THEN** the workbench surfaces the modeling rejection message
- **AND** the Parts & Objects tree remains unchanged

#### Scenario: Invoke object export action
- **WHEN** the user selects Export from a Parts & Objects row context menu
- **THEN** the workbench opens the export modal for the selected row
- **AND** the workbench does not show the export placeholder status message

### Requirement: Body and part rename SHALL persist to the document
The Parts & Objects context menu SHALL offer Rename for body/part rows and commit accepted body labels through the modeling document mutation path.

#### Scenario: Rename a body row
- **WHEN** the user renames a body/part row from the Parts & Objects context menu
- **THEN** the modeling document stores the new body label
- **AND** the refreshed Parts & Objects tree shows the persisted body label
- **AND** operation-history restore preserves the body label

### Requirement: Snapshot and diagnostic menus SHALL support target-oriented actions
Snapshot Reference and Document Diagnostic context menus SHALL offer target selection when a row has an allowed target, plus a placeholder inspection action.

#### Scenario: Select a reference target from menu
- **WHEN** the user selects the target action for an allowed Snapshot Reference row
- **THEN** the workbench dispatches the same target selection request as left-click selection

#### Scenario: Select a diagnostic target from menu
- **WHEN** the user selects the target action for an allowed Document Diagnostic row that has a target
- **THEN** the workbench dispatches the same target selection request for that diagnostic target

#### Scenario: Invoke inspection placeholder
- **WHEN** the user selects an inspection action from a Snapshot Reference or Document Diagnostic context menu
- **THEN** the workbench shows an inline status message that inspection is not implemented yet

### Requirement: Feature history menu SHALL include edit, suppress, cursor, and delete actions
The Feature Timeline/history context menu SHALL offer Edit, Rename, Roll History Here, Roll To End, and Delete for supported committed document history items. Committed sketch items that participate in support-plane reassignment SHALL also offer `Change Sketch Plane`. Feature-only actions such as Suppress and Unsuppress SHALL remain available only for committed feature items and SHALL route to the modeling suppression mutation.

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

#### Scenario: Suppress active feature
- **WHEN** the user selects Suppress from an unsuppressed feature history context menu
- **THEN** the workbench routes a suppress request through the editor/runtime document mutation path
- **AND** the refreshed history bar marks the feature as suppressed when the mutation is accepted
- **AND** the action no longer shows the placeholder status message

#### Scenario: Unsuppress suppressed feature
- **WHEN** the user selects Unsuppress from a suppressed feature history context menu
- **THEN** the workbench routes an unsuppress request through the editor/runtime document mutation path
- **AND** the refreshed history bar marks the feature as active when the mutation is accepted
- **AND** the action no longer shows the placeholder status message

### Requirement: Parts and objects sketch menus SHALL expose plane reassignment for eligible sketches
The `Parts & Objects` context menu SHALL expose `Change Sketch Plane` for committed sketch rows that participate in the support-plane reassignment capability.

#### Scenario: Eligible sketch row shows change-plane action
- **WHEN** the user opens the context menu for an eligible committed sketch row in `Parts & Objects`
- **THEN** the menu includes `Change Sketch Plane`
- **AND** selecting that action opens the dedicated sketch-plane edit flow for that sketch

#### Scenario: Non-sketch or unsupported sketch row omits change-plane action
- **WHEN** the user opens the context menu for a non-sketch row or a committed sketch row that does not participate in support-plane reassignment
- **THEN** the `Parts & Objects` menu does not expose `Change Sketch Plane` as an enabled action

