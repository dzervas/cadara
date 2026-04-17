# frontend-modeling-boundary Specification

## Purpose
TBD - created by archiving change formalize-kernel-adapter-boundary. Update Purpose after archive.
## Requirements
### Requirement: Frontend durable modeling actions pass through a modeling service boundary
The system SHALL route durable modeling actions from frontend/editor code through a frontend-facing modeling service or adapter boundary instead of allowing UI components to call a kernel implementation directly, and durable sketch constraint or dimension create/update/delete flows SHALL be treated as modeling actions even when their authoring lifecycle begins with frontend-only preview state.

#### Scenario: Frontend commits a sketch constraint mutation
- **WHEN** the editor accepts a sketch constraint or dimension operation after target selection and any required value entry
- **THEN** the durable mutation is issued through the modeling service boundary rather than written directly by a React component or viewport renderer

#### Scenario: Frontend removes a committed constraint annotation
- **WHEN** the user deletes a selected committed constraint or dimension annotation from the viewport
- **THEN** the delete action resolves to a durable sketch mutation through the modeling service boundary instead of mutating document-owned constraint state directly in UI code

#### Scenario: Modeling flow needs sketch solving after constraint mutation
- **WHEN** a committed sketch constraint or dimension mutation changes the authored sketch graph
- **THEN** any resulting solve or validation behavior continues to execute through the dedicated solver boundary rather than being recomputed in frontend presentation code

### Requirement: Editor interaction concerns remain outside the kernel contract
The system SHALL keep pointer interaction, tool activation, hover state, local drafting previews, and form state in the frontend editor layer rather than in the CAD kernel contract.

#### Scenario: User performs live sketch drafting
- **WHEN** the user drags or previews sketch geometry during an active editing session
- **THEN** the frontend editor layer owns that transient interaction state and the kernel contract is not used as the per-frame drafting mechanism

#### Scenario: User changes toolbar or selection state
- **WHEN** the user activates a tool, changes command phase, or updates hover and selection state
- **THEN** those state transitions are handled in frontend/editor logic without introducing toolbar or pointer semantics into the kernel contract

### Requirement: Kernel implementations remain replaceable behind the same frontend-facing boundary
The system SHALL treat the modeling service contract as the only frontend-facing durable boundary so different kernel implementations can be used without reshaping UI components.

#### Scenario: Kernel implementation is swapped
- **WHEN** the application changes from one modeling kernel implementation to another that satisfies the same public modeling contract
- **THEN** frontend components continue to use the same modeling service boundary instead of depending on implementation-specific kernel details

### Requirement: Direct sketch edits SHALL preserve editor and modeling boundary ownership
The system SHALL keep in-progress direct sketch drag state in the editor layer while routing accepted authored sketch changes through the frontend-facing modeling service boundary.

#### Scenario: User previews a sketch drag
- **WHEN** the user is dragging sketch geometry before accepting or completing the edit
- **THEN** the transient pointer state and preview remain editor-owned and are not written directly to the durable document by a React component

#### Scenario: User completes a valid sketch drag
- **WHEN** the user completes a valid direct sketch edit
- **THEN** the accepted authored sketch definition change is committed through the modeling service boundary

