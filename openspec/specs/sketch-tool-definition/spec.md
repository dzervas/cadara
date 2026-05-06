# sketch-tool-definition Specification

## Purpose
TBD - created by archiving change sketch-tool-authoring-spec. Update Purpose after archive.
## Requirements
### Requirement: Each sketch tool SHALL be defined by its own tool module
The system SHALL define each sketch drawing tool in its own authoring file, and that file MUST be the authoritative source for the tool's identity, behavior, and sketch-session integration metadata.

#### Scenario: Runtime resolves a tool from a registry
- **WHEN** the sketch session runtime needs behavior for a tool such as `line`, `rectangle`, or `circle`
- **THEN** it resolves that behavior through the registered sketch tool definition for that tool ID rather than a shared tool-kind switch

#### Scenario: Adding a new sketch tool
- **WHEN** a new sketch tool is introduced
- **THEN** the implementation MUST add a new sketch tool module and register it without requiring unrelated sketch tools to be edited in a shared behavior switch

### Requirement: Sketch tool definitions SHALL own sketch-tool metadata
Each sketch tool definition SHALL declare the metadata needed by the workbench and sketch runtime, including stable tool identity, human-readable name, icon metadata, toolbar grouping metadata, and allowed mode.

#### Scenario: Toolbar renders sketch tool metadata
- **WHEN** the toolbar or command system needs to display or activate a sketch tool
- **THEN** it uses metadata declared by the sketch tool definition rather than duplicated tool metadata in a separate UI-only mapping

#### Scenario: Runtime checks sketch-mode availability
- **WHEN** the editor determines whether a sketch tool is available in the current mode
- **THEN** it uses the mode metadata declared by that sketch tool definition

### Requirement: Sketch tool definitions SHALL own activation and pointer lifecycle behavior
Each sketch tool definition SHALL define how the tool activates, how pointer events are interpreted, and how those events update the staged sketch draft.

#### Scenario: Activating a drawing tool
- **WHEN** the user activates a sketch tool while a sketch session is open
- **THEN** the runtime initializes that tool through its sketch tool definition

#### Scenario: Processing pointer movement and release
- **WHEN** the user moves or releases the pointer during an active sketch tool interaction
- **THEN** the active sketch tool definition interprets those events into staged draft updates according to tool-specific rules

### Requirement: Sketch tool definitions SHALL own staged geometry and validation behavior
Each sketch tool definition SHALL define the staged geometry, live measurements, validation messages, and completion readiness associated with its current draft interaction.

#### Scenario: Producing staged geometry
- **WHEN** a sketch tool is mid-interaction
- **THEN** the active sketch tool definition provides the staged geometry and related overlay state needed to present the in-progress result

#### Scenario: Rejecting incomplete or invalid input
- **WHEN** a sketch tool lacks the required points, dimensions, or valid geometry to complete an action
- **THEN** the active sketch tool definition returns validation state that prevents invalid staged results from being committed

### Requirement: Sketch tool definitions SHALL contribute to sketch commit preparation without importing solver or kernel implementations
Each sketch tool definition SHALL translate its staged interaction into sketch draft updates or staged entities consumable by the shared sketch session runtime, and this behavior MUST depend only on shared contracts and runtime-owned sketch state rather than solver or kernel implementation modules.

#### Scenario: Completing a tool interaction
- **WHEN** a sketch tool interaction is completed successfully
- **THEN** the sketch tool definition produces the staged entities or draft mutations needed for the shared sketch session to include that result in the next commit

#### Scenario: Preserving boundary separation
- **WHEN** a sketch tool definition is implemented
- **THEN** it MUST NOT import solver implementation modules or kernel-specific modeling modules to perform its authoring behavior

### Requirement: Sketch tool definitions SHALL integrate with a generic sketch tool presentation contract
Each sketch tool definition SHALL describe its prompts, controls, and transient presentation through the shared sketch tool editor schema and MUST be consumable by generic runtime/UI surfaces unless it uses an approved extension point from that schema.

#### Scenario: Rendering standard sketch tool prompts
- **WHEN** the active sketch tool uses only standard prompt and control elements
- **THEN** the sketch UI renders those elements from the declarative schema without tool-specific UI branching

#### Scenario: Using an approved extension point
- **WHEN** a sketch tool has presentation needs not covered by the standard schema
- **THEN** it may use a documented extension point without forcing the generic sketch surfaces to import tool-specific business logic

### Requirement: Sketch tool commits SHALL honor construction authoring context
Sketch drawing tool definitions SHALL receive construction authoring context when producing commit contributions and SHALL mark newly authored geometry construction-only when that context is active.

#### Scenario: Drawing tool commits normal geometry
- **WHEN** a sketch drawing tool completes while construction authoring context is inactive
- **THEN** the committed points and entities are authored with `isConstruction` set to false

#### Scenario: Drawing tool commits construction geometry
- **WHEN** a sketch drawing tool completes while construction authoring context is active
- **THEN** the committed points and entities created by that tool are authored with `isConstruction` set to true

#### Scenario: Future drawing tool uses shared commit context
- **WHEN** a new sketch drawing tool is registered
- **THEN** it can author construction geometry through the shared sketch tool commit context without adding a duplicate construction-specific tool definition

### Requirement: The Construction toolbar tool SHALL act as a sketch authoring modifier
The system SHALL expose Construction as a sketch-mode tool that can remain selected as a modifier while another sketch drawing tool is active.

#### Scenario: Construction is picked before a drawing tool
- **WHEN** the user activates Construction and then activates a sketch drawing tool before selecting viewport geometry
- **THEN** Construction remains selected as an active modifier
- **AND** the drawing tool becomes the active geometry creation tool

#### Scenario: Construction modifier is toggled off
- **WHEN** Construction is selected as an active modifier and the user activates Construction again
- **THEN** construction authoring context becomes inactive
- **AND** subsequent drawing tool commits create normal geometry

#### Scenario: Sketch editing ends
- **WHEN** an active sketch editing session ends
- **THEN** construction authoring context is cleared

### Requirement: Sketch style tools SHALL have explicit activation behavior
Sketch style toolbar tools SHALL have explicit domain-level activation behavior that preserves active sketch editing state and routes to style control presentation instead of generic command selection state.

#### Scenario: Runtime activates a style tool
- **WHEN** the editor activates a sketch SVG/style tool while a sketch session is open
- **THEN** the runtime keeps the active sketch session open
- **AND** it resolves the requested style focus or target guidance through sketch-domain logic

### Requirement: Sketch tool definitions SHALL support multi-point curve authoring
Sketch drawing tool definitions SHALL support tools whose valid interaction requires more than two points and whose staged geometry changes after each accepted point.

#### Scenario: Spline tool collects multiple points
- **WHEN** a registered spline tool receives repeated valid point placements
- **THEN** its tool definition updates staged spline preview geometry after each placement
- **AND** it reports when the spline has enough points to complete

### Requirement: Sketch edit tools SHALL have explicit domain definitions
Sketch edit tools that mutate existing geometry SHALL have domain-level definitions for metadata, activation, activation-time selection adoption, selection requirements, validation, preview, and accepted draft mutation behavior.

#### Scenario: Runtime activates an edit tool
- **WHEN** the editor activates `trim` or `offset` while a sketch session is open
- **THEN** the runtime resolves an explicit edit-tool behavior instead of falling through to generic selection-command state

#### Scenario: Runtime seeds an edit tool from compatible current selection
- **WHEN** the editor activates a selection-driven sketch edit tool while the current sketch selection already contains targets compatible with that tool's selection rules
- **THEN** the runtime initializes the edit-tool state with those selected targets
- **AND** any staged preview or validation feedback is derived from the edit tool's existing domain logic

#### Scenario: Runtime clears incompatible current selection for an edit tool
- **WHEN** the editor activates a selection-driven sketch edit tool while the current sketch selection contains unsupported or mixed incompatible targets
- **THEN** the runtime clears the current selection
- **AND** it initializes the edit tool in an empty target-collection state

### Requirement: Point and Collinear SHALL use domain tool definitions
Point drawing behavior and Collinear constraint behavior SHALL be declared through the existing domain-level sketch tool and sketch constraint definition registries rather than through presentational UI branches.

#### Scenario: Runtime resolves Point
- **WHEN** the sketch runtime activates the Point tool
- **THEN** it resolves the behavior through the registered Point sketch tool definition
- **AND** the implementation does not add a duplicate Point tool ID or a tool-specific React branch

#### Scenario: Runtime resolves Collinear
- **WHEN** the sketch runtime activates `constraintCollinear`
- **THEN** it resolves metadata, selection steps, preview behavior, validation, and commit contribution behavior through the registered Collinear constraint definition

### Requirement: Collinear metadata SHALL be toolbar-ready
The Collinear constraint definition SHALL declare stable metadata for tool ID, group, display name, tooltip, icon, and sketch-mode availability.

#### Scenario: Toolbar consumes Collinear metadata
- **WHEN** the toolbar or command search builds sketch-mode constraint tools
- **THEN** it can display and activate Collinear using metadata from the constraint definition registry

