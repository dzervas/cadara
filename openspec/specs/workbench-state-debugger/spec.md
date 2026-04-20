# workbench-state-debugger Specification

## Purpose
TBD - created by archiving change unify-state-debugger-overlay. Update Purpose after archive.
## Requirements
### Requirement: Unified debugger owns workbench state readouts
The system SHALL present current workbench state in a single bottom-left viewport debugger overlay, including active mode, machine state, active command, command phase, selection count, selection detail, snapshot revision, snapshot diagnostic count, sketch session state, sketch plane, feature edit session state, preview state, active selection filter label, selection requirement descriptions, and selection requirement slot counts.

#### Scenario: User inspects active workbench state
- **WHEN** the workbench renders with editor state, selection state, and a document snapshot
- **THEN** the bottom-left debugger overlay displays the current mode, command, selection, snapshot, sketch, feature, preview, selection filter, and requirement state from the existing editor state sources

#### Scenario: Selection filter requirements are active
- **WHEN** an active command installs a selection filter with one or more requirements
- **THEN** the bottom-left debugger overlay displays each requirement description and the number of target slots associated with that requirement

#### Scenario: No selection filter is active
- **WHEN** no active selection filter exists
- **THEN** the bottom-left debugger overlay displays that no selection filter and no active target rule are present

### Requirement: Debugger is collapsible
The system SHALL allow the unified state debugger to collapse and expand without changing editor, document, command, selection, sketch, or feature edit state. In test mode (indicated by a `cadTestMode` query parameter or `import.meta.env.TEST` flag), the debugger overlay SHALL apply `pointer-events: none` so it does not intercept viewport clicks, eliminating the need for tests to toggle collapse/expand state before viewport interactions.

#### Scenario: User collapses the debugger
- **WHEN** the user activates the debugger collapse control
- **THEN** the overlay hides the detailed state rows while preserving an affordance to expand it again

#### Scenario: User expands the debugger
- **WHEN** the user activates the debugger expand control
- **THEN** the overlay restores the detailed state rows using the current editor state

#### Scenario: Test mode disables pointer interception
- **WHEN** the application runs with the test mode flag active
- **THEN** the state debugger overlay has `pointer-events: none` and does not intercept clicks on the underlying viewport surface

### Requirement: Duplicate debugger readouts are removed from other layout surfaces
The system SHALL remove debugger-only readouts for editor session, active mode, selection filter, and inspector contract/revision state from the feature sidebar and feature inspector while preserving navigation and feature editing behavior.

#### Scenario: Feature tree header renders
- **WHEN** the feature sidebar renders the feature tree header
- **THEN** it displays the feature tree title without the active mode or selection filter readouts

#### Scenario: Sidebar navigation renders
- **WHEN** the feature sidebar renders feature tree, parts, objects, references, and diagnostics
- **THEN** those navigation and diagnostic sections remain available without the editor session footer

#### Scenario: Feature inspector renders
- **WHEN** a feature edit session is active
- **THEN** the feature inspector preserves the editable form, diagnostics, commit control, and cancel control without duplicating debugger-only contract or revision readouts

### Requirement: Debugger remains presentational
The system MUST keep the unified debugger as a presentational UI surface that reads existing workbench state and does not introduce modeling, kernel, tool dispatch, or editor state-machine contract changes.

#### Scenario: Debugger renders state
- **WHEN** the unified debugger reads current workbench state
- **THEN** it derives display text from existing editor, selection, sketch, feature, and snapshot values without dispatching state changes other than local collapse or expand UI state

#### Scenario: User interacts with viewport outside the debugger
- **WHEN** the user selects, hovers, pans, rotates, or uses sketch interactions outside the debugger overlay
- **THEN** the existing viewport interactions continue to use the current editor and tool contracts unchanged

