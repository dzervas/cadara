## MODIFIED Requirements

### Requirement: Viewport renderables SHALL use role-appropriate authoring styling
The workbench viewport SHALL render authoring geometry with styling derived from renderable role so solids, sketch-owned regions, sketch edges, sketch lines, and sketch vertices read consistently during editing. Active and committed sketch-owned geometry MUST render as flat, unlit authoring graphics and MUST source its default colors from existing theme tokens.

#### Scenario: Render a solid object
- **WHEN** the viewport renders an opaque solid body or face
- **THEN** that solid renders with an opaque off-white surface treatment

#### Scenario: Render a selectable sketch-owned region
- **WHEN** the viewport renders a region owned by an active or committed sketch
- **THEN** that region renders with a deeper neutral gray fill treatment sourced from an existing dark/workbench gray theme token such as `--workbench-shell-border`
- **AND** the region fill remains visually subordinate to wire geometry
- **AND** the region does not use reflective or light-dependent material treatment

#### Scenario: Render sketch wire geometry
- **WHEN** the viewport renders sketch edges or lines for an active or committed sketch
- **THEN** those edges or lines render with flat, unlit material treatment
- **AND** their default color is resolved from the owning sketch's constraint state using existing theme tokens

#### Scenario: Render a sketch vertex marker
- **WHEN** the viewport renders a vertex marker for active or committed sketch geometry
- **THEN** the marker is smaller than the prior default marker size and uses the same constraint-state color family as rendered sketch lines or edges when it belongs to a sketch
- **AND** sketch vertex markers do not use reflective or light-dependent material treatment

## ADDED Requirements

### Requirement: Sketch constraint-state colors SHALL come from the theme
The workbench viewport SHALL color active and committed sketch edges, vertices, and constraint annotations by sketch constraint state using only existing theme-defined colors. Authored or selected colors SHALL remain visible except where overconstrained affected geometry requires a thin diagnostic/error overlay.

#### Scenario: Render a fully constrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `wellConstrained`
- **THEN** its default sketch edges, vertices, and constraint annotations use `--workbench-tooltip-description`

#### Scenario: Render an underconstrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `underConstrained` or `unknown`
- **THEN** its default sketch edges, vertices, and constraint annotations use `--mantine-color-blue-9`

#### Scenario: Render an overconstrained sketch
- **WHEN** a sketch's solved status reports `constraintState` as `overConstrained` or `inconsistent`
- **THEN** affected sketch edges, vertices, and constraint annotations use a thin diagnostic/error treatment colored by `--workbench-shell-danger-text`
- **AND** unaffected sketch geometry keeps its normal default, authored, or selected color

#### Scenario: Render a failed constrained solve
- **WHEN** a sketch's solved status reports a failed or partially solved state with known unsatisfied affected geometry
- **THEN** affected sketch edges, vertices, and constraint annotations use the same thin diagnostic/error treatment colored by `--workbench-shell-danger-text`
- **AND** unaffected sketch geometry keeps its normal default, authored, or selected color

#### Scenario: Preserve authored SVG style overrides
- **WHEN** SVG rendering is enabled for a sketch and a sketch edge, point, or region has supported authored style data
- **THEN** the viewport renders that authored style data according to the SVG sketch style behavior contract
- **AND** overconstrained affected edges render only a thin predefined diagnostic line in the error color instead of recoloring the full authored stroke width
- **AND** no new non-theme color is introduced for the default constraint-state palette
