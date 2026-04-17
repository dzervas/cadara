## MODIFIED Requirements

### Requirement: Parts and objects menu SHALL include delete and export actions
The Parts & Objects context menu SHALL offer Delete and Export actions for each object row. Delete remains a placeholder until backed by modeling behavior, and Export SHALL open the document export modal for the selected object row.

#### Scenario: Invoke object delete placeholder action
- **WHEN** the user selects Delete from a Parts & Objects row context menu
- **THEN** the workbench shows an inline status message that Delete is not implemented yet

#### Scenario: Invoke object export action
- **WHEN** the user selects Export from a Parts & Objects row context menu
- **THEN** the workbench opens the export modal for the selected row
- **AND** the workbench does not show the export placeholder status message
