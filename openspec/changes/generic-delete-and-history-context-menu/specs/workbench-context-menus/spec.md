## MODIFIED Requirements

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

### Requirement: Feature history menu SHALL include edit, suppress, cursor, and delete actions
The Feature Timeline/history context menu SHALL offer Edit, Rename, Roll cursor here, and Delete for supported committed document history items. Feature-only actions such as Suppress SHALL remain available only for committed feature items.

#### Scenario: Edit feature from menu
- **WHEN** the user selects Edit from a feature history context menu
- **THEN** the workbench uses the existing feature reopen flow for that feature target

#### Scenario: Rename history item from menu
- **WHEN** the user selects Rename from a committed sketch or feature history context menu
- **THEN** the workbench uses the existing rename flow for that history item target
- **AND** the refreshed history bar shows the accepted label when the mutation succeeds

#### Scenario: Roll cursor from menu
- **WHEN** the user selects Roll cursor here from a feature history context menu
- **THEN** the workbench requests the document cursor position for that history item through the existing feature cursor mutation path

#### Scenario: Delete history item from menu
- **WHEN** the user selects Delete from a committed sketch or feature history context menu
- **THEN** the workbench requests generic deletion for that document history item through the modeling service
- **AND** the refreshed history bar no longer shows the deleted history item when the mutation is accepted

#### Scenario: Suppress feature placeholder
- **WHEN** the user selects Suppress from a feature history context menu
- **THEN** the workbench shows an inline status message that feature suppression is not implemented yet
