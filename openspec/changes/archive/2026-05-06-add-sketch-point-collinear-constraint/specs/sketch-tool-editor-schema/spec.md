## ADDED Requirements

### Requirement: Schema SHALL express Point placement guidance
The sketch tool editor schema SHALL express Point placement prompts, cursor guidance, completion hints, validation, and transient point preview without a Point-specific UI component branch.

#### Scenario: Point waits for placement
- **WHEN** the Point tool is active before a point location is accepted
- **THEN** the generic sketch tool presentation can render its prompt and cursor guidance from the schema

#### Scenario: Point previews placement
- **WHEN** the Point tool has a hovered or pending sketch-plane location
- **THEN** the schema can describe a transient point marker anchored at that location

### Requirement: Schema SHALL express Collinear target feedback
The sketch tool editor schema SHALL express Collinear selection steps, reference-target state, hover feedback, invalid-target messages, and preview annotation descriptors through generic constraint presentation.

#### Scenario: Collinear waits for a reference
- **WHEN** Collinear is active with no valid reference target selected
- **THEN** the generic sketch tool presentation can render guidance for selecting a line reference or point/line target

#### Scenario: Collinear has partial targets
- **WHEN** Collinear has a selected reference line and is waiting for editable targets
- **THEN** the schema can describe the partial target state and preview relationship without requiring a Collinear-specific React branch

#### Scenario: Collinear rejects a target
- **WHEN** Collinear receives an unsupported target
- **THEN** the schema exposes validation feedback that the generic presentation surface can render
