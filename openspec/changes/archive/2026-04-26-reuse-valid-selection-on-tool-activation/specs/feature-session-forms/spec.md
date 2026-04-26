## MODIFIED Requirements

### Requirement: Feature sessions support create and edit flows for supported solid features
The system SHALL provide feature-session forms for the supported solid feature types instead of limiting the workbench session UI to extrude-only editing. Supported create flows SHALL seed their initial draft from a compatible current selection context, and SHALL clear incompatible current selections when activation begins.

#### Scenario: Start a create session for a supported feature
- **WHEN** the user starts a create flow for extrude, revolve, fillet, shell, or plane
- **THEN** the workbench opens a feature-session form seeded with defaults appropriate for that feature type and the current selection context

#### Scenario: Start a create session from compatible preselection
- **WHEN** the user starts a supported feature create flow while the current selection is compatible with that feature's selection contract
- **THEN** the workbench seeds the feature-session draft from that current selection context before the user makes any additional picks

#### Scenario: Incompatible preselection is cleared before feature create
- **WHEN** the user starts a supported feature create flow while the current selection is incompatible with that feature's selection contract
- **THEN** the workbench clears the current selection
- **AND** it opens the feature-session form with only that feature type's default draft state

#### Scenario: Hydrate an edit session from a committed feature
- **WHEN** the user opens an existing supported feature for editing
- **THEN** the workbench hydrates the feature-session form from the committed feature definition and preserves the feature type, revision context, and draft values needed for preview/update
