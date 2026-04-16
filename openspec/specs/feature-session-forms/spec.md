# feature-session-forms Specification

## Purpose
TBD - created by archiving change implement-occ-basic-feature-sessions. Update Purpose after archive.
## Requirements
### Requirement: Feature sessions support create and edit flows for supported solid features
The system SHALL provide feature-session forms for the supported solid feature types instead of limiting the workbench session UI to extrude-only editing.

#### Scenario: Start a create session for a supported feature
- **WHEN** the user starts a create flow for extrude, revolve, fillet, shell, or plane
- **THEN** the workbench opens a feature-session form seeded with defaults appropriate for that feature type and the current selection context

#### Scenario: Hydrate an edit session from a committed feature
- **WHEN** the user opens an existing supported feature for editing
- **THEN** the workbench hydrates the feature-session form from the committed feature definition and preserves the feature type, revision context, and draft values needed for preview/update

### Requirement: Dimensional parameters use numeric inputs
The system SHALL use numeric inputs for dimensional feature parameters and SHALL not use slider controls for length-like values in feature-session forms.

#### Scenario: Edit an extrude depth
- **WHEN** the user changes an extrude depth in a feature-session form
- **THEN** the control is a numeric input that accepts direct typed values in document units rather than a slider

#### Scenario: Edit another dimensional parameter
- **WHEN** the user changes a fillet radius, shell thickness, or plane-related numeric offset in a feature-session form
- **THEN** each dimensional control uses numeric input semantics consistent with the contract-owned parameter type

### Requirement: Feature sessions preserve typed reference inputs per feature
The system SHALL show and preserve the durable references required by each supported feature type so preview and commit requests can be built without guessing.

#### Scenario: Revolve session keeps profile and axis references
- **WHEN** the user configures a revolve feature session
- **THEN** the draft preserves both the selected profile reference and the selected axis reference in the typed draft state used for preview and commit

#### Scenario: Fillet or shell session keeps topology references
- **WHEN** the user configures a fillet or shell feature session
- **THEN** the draft preserves the exact selected edge or face references required by the feature contract instead of collapsing them into presentation-only labels

### Requirement: Feature sessions emit contract-valid previews and diagnostics
The system SHALL evaluate previews from the active feature-session draft and SHALL surface contract diagnostics in the session UI before commit.

#### Scenario: Valid draft evaluates successfully
- **WHEN** the active feature-session draft is complete and valid for its feature type
- **THEN** the workbench issues a preview request derived from that draft and displays the resulting preview renderables and revision state

#### Scenario: Invalid draft surfaces diagnostics
- **WHEN** the active feature-session draft is incomplete or invalid for its feature type
- **THEN** the workbench surfaces the returned diagnostics in the feature-session UI and does not fabricate missing contract values

### Requirement: Boolean-capable feature sessions expose explicit operation scope
The system SHALL expose operation controls for boolean-capable solid-producing features and SHALL preserve explicit boolean scope state needed by the modeling contract.

#### Scenario: User selects a standalone operation
- **WHEN** the user chooses `newBody` for a boolean-capable feature session
- **THEN** the resulting draft uses `booleanScope.kind: standalone`

#### Scenario: User selects a merge or subtract operation
- **WHEN** the user chooses a join, cut, or intersect operation for a boolean-capable feature session
- **THEN** the resulting draft preserves the explicit target body selection state required to build a contract-valid feature definition

