## MODIFIED Requirements

### Requirement: Parts and objects menu SHALL include delete and export actions
The Parts & Objects context menu SHALL offer Delete and Export actions for each exportable object row. Delete SHALL request generic durable deletion for supported parts and objects, and Export SHALL open the document export modal for the selected row with file types filtered to that row's target.

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

#### Scenario: Sketch object export shows sketch formats only
- **WHEN** the user selects Export from a committed sketch row in Parts & Objects
- **THEN** the workbench opens the export modal for that sketch target
- **AND** the modal offers SVG and DXF as the available file types
- **AND** the modal omits body-only export formats for that sketch target

### Requirement: Feature history menu SHALL include edit, suppress, cursor, and delete actions
The Feature Timeline/history context menu SHALL offer Edit, Rename, Roll History Here, Roll To End, and Delete for supported committed document history items. Committed sketch history items SHALL also offer Export and, when eligible, `Change Sketch Plane`. Feature-only actions such as Suppress and Unsuppress SHALL remain available only for committed feature items and SHALL route to the modeling suppression mutation.

#### Scenario: Edit history item from menu
- **WHEN** the user selects Edit from a committed sketch or feature history context menu
- **THEN** the workbench uses the same reopen flow as double-clicking that history item

#### Scenario: Export sketch history item from menu
- **WHEN** the user selects Export from a committed sketch history context menu
- **THEN** the workbench opens the same export modal used by Parts & Objects export
- **AND** the modal is scoped to that sketch target
- **AND** the modal offers the same SVG and DXF file type choices as Parts & Objects sketch export

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
