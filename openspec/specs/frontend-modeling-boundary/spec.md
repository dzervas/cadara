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

### Requirement: Construction geometry mutations SHALL preserve frontend/modeling ownership
The system SHALL keep transient construction tool state in the frontend editor layer and SHALL route accepted construction flag changes through the frontend-facing modeling service boundary.

#### Scenario: Construction modifier changes before commit
- **WHEN** the user activates or deactivates construction authoring context during sketch editing
- **THEN** that transient modifier state remains editor-owned and is not written directly to the durable document

#### Scenario: Existing geometry construction toggle is accepted
- **WHEN** the user toggles an existing sketch point or entity to or from construction status
- **THEN** the accepted authored sketch definition change is committed through the modeling service boundary

#### Scenario: New construction geometry is committed
- **WHEN** a drawing tool creates geometry while construction authoring context is active
- **THEN** the accepted sketch commit containing construction flags is routed through the modeling service boundary

### Requirement: Sketch reference mutations SHALL preserve frontend and modeling ownership
The system SHALL keep transient sketch reference picking and preview state in the frontend editor layer and SHALL route accepted durable sketch reference changes through the frontend-facing modeling boundary.

#### Scenario: Reference picking is in progress
- **WHEN** the user is selecting external geometry to reference from an active sketch
- **THEN** hover, preview, and target-collection state remains editor-owned and is not written directly to the durable document

#### Scenario: Reference is accepted
- **WHEN** the user accepts an external reference for an active sketch
- **THEN** the accepted reference mutation is committed through the modeling boundary rather than written directly by a React component or viewport renderer

#### Scenario: Reference is removed
- **WHEN** the user removes an authored external sketch reference
- **THEN** the removal is routed through the modeling boundary and updates the authoritative sketch definition

### Requirement: Reference-targeted constraint mutations SHALL use the modeling boundary
The system SHALL route accepted durable constraints that target projected reference geometry through the frontend-facing modeling boundary.

#### Scenario: User commits reference-targeted constraint
- **WHEN** the editor accepts a constraint operation involving projected reference geometry
- **THEN** the durable mutation is issued through the modeling boundary
- **AND** the viewport does not directly mutate sketch constraint records

### Requirement: Trim and offset sketch mutations SHALL preserve frontend and modeling ownership
The system SHALL keep transient Trim and Offset selection, preview, and validation state in the frontend editor layer while routing accepted durable sketch definition changes through the frontend-facing modeling boundary.

#### Scenario: Trim preview is in progress
- **WHEN** the user previews a trim operation before accepting it
- **THEN** the transient preview remains editor-owned and is not written directly to the durable document by a React component

#### Scenario: Offset is accepted
- **WHEN** the user accepts a valid offset operation
- **THEN** the accepted sketch definition change is committed through the modeling boundary

### Requirement: Combine preview and commit SHALL use the modeling boundary
The frontend SHALL route Combine preview and commit requests through the modeling service boundary and SHALL NOT mutate body snapshots directly from toolbar, form, or viewport code.

#### Scenario: Combine preview reaches modeling service
- **WHEN** a valid Combine draft is previewed
- **THEN** the frontend sends a typed feature preview request through the modeling service boundary
- **AND** presentation components consume the returned preview renderables

#### Scenario: Combine commit reaches modeling service
- **WHEN** a valid Combine draft is committed
- **THEN** the frontend sends a typed feature create or update request through the modeling service boundary
- **AND** the committed snapshot comes from the modeling service response

#### Scenario: Combine toolbar activation remains editor-owned
- **WHEN** the user activates the Combine toolbar tool
- **THEN** editor runtime state opens or focuses a Combine feature session
- **AND** kernel execution does not occur until preview or commit is requested through the modeling boundary

### Requirement: Snapshot-based modeling mutations SHALL carry an explicit mutation basis
Frontend-facing modeling mutations initiated from a document snapshot SHALL carry the snapshot revision and, when available, repository provenance for the authored document basis used by the caller.

#### Scenario: Document cursor move from repository-backed snapshot
- **WHEN** the editor requests a document cursor move from a repository-backed snapshot
- **THEN** the modeling service receives the snapshot's `baseRevisionId`
- **AND** it receives the repository heads from that snapshot as the mutation's repository basis

#### Scenario: Feature commit from repository-backed snapshot
- **WHEN** the editor commits a feature draft from a repository-backed snapshot
- **THEN** the modeling service receives the snapshot's `baseRevisionId`
- **AND** it receives the repository heads from that snapshot as the mutation's repository basis

#### Scenario: Mutation from non-repository snapshot
- **WHEN** the editor requests a modeling mutation from a snapshot without repository provenance
- **THEN** the modeling service evaluates the mutation against the snapshot revision
- **AND** it does not require repository heads to be present

### Requirement: UI components SHALL not bypass editor/runtime mutation sequencing
React UI components SHALL not call modeling-service document cursor mutation APIs directly for document history navigation.

#### Scenario: Timeline cursor moves
- **WHEN** a timeline component needs to move the document cursor
- **THEN** it dispatches an editor event or callback that is handled by editor runtime sequencing

#### Scenario: Toolbar document history moves
- **WHEN** toolbar Undo or Redo falls back to document history cursor navigation
- **THEN** Workbench routes the request through editor runtime sequencing instead of invoking the modeling service cursor mutation directly

### Requirement: Editor refresh SHALL preserve the last rendered scene during recoverable edit failures
The editor-facing modeling flow SHALL keep the currently rendered scene active after an in-session edit introduces a recoverable rebuild failure, and SHALL swap render data only after a successful replacement snapshot is available.

#### Scenario: Feature edit causes rebuild failure
- **WHEN** a user edit changes a feature field to an invalid reference or parameter
- **THEN** the authored change and feature diagnostics are surfaced through the editor state
- **AND** the viewport continues to display the previously successful render records
- **AND** the editor does not replace the viewport with an empty or failed render result

#### Scenario: User fixes failed field
- **WHEN** the user corrects the invalid feature field and the next rebuild succeeds
- **THEN** the editor swaps the viewport to the newly generated render records
- **AND** the feature error state is cleared from the editor-facing presentation

#### Scenario: Reload uses partial rebuild output
- **WHEN** the application reloads and no previous in-session render is available
- **THEN** the editor displays the partial rebuild snapshot supplied by the modeling service
- **AND** it exposes all independently discovered failed feature diagnostics for repair

