## ADDED Requirements

### Requirement: Workbench SHALL expose STEP import
The workbench file menu or import surface SHALL allow users to select STEP files for exact solid import.

#### Scenario: User selects STEP import
- **WHEN** the user chooses Import and selects a `.step` or `.stp` file
- **THEN** the workbench starts the STEP import flow with file-type validation, progress feedback, settings review, and error reporting
