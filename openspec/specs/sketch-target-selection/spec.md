# sketch-target-selection Specification

## Purpose

Define how users start sketch sessions from selectable planar targets in the workbench viewport and feature tree.
## Requirements
### Requirement: Supported planar sketch targets are selectable
The system MUST expose selectable render geometry for every supported planar sketch start target, including origin planes, planar solid faces, and planar faces from other sketches.

#### Scenario: User targets a primary datum plane from the viewport
- **WHEN** the user activates `Sketch` and clicks the `XY`, `YZ`, or `XZ` datum plane in the viewport
- **THEN** the clicked plane is selectable as a valid sketch start target

#### Scenario: User targets another supported planar surface
- **WHEN** the user activates `Sketch` and clicks a planar solid face or a planar face from another sketch
- **THEN** that planar surface is selectable as a valid sketch start target

### Requirement: Construction planes provide reliable selectable surfaces
Construction planes exposed in the viewport MUST provide filled selectable surfaces with durable construction bindings rather than outline-only helpers.

#### Scenario: Viewport builds construction-plane renderables
- **WHEN** the viewport receives render exports for a construction plane
- **THEN** the renderables include a filled selectable area bound to the durable `construction` target

#### Scenario: Highlighting and picking a construction plane
- **WHEN** the user hovers or selects a construction plane in the viewport
- **THEN** the viewport resolves the durable construction reference from the plane renderable binding

### Requirement: Selecting a valid planar target opens sketch mode
The system MUST open a sketch session on the selected planar target after the user activates `Sketch` and either reuses a valid preselected target or selects a valid target from the viewport or feature tree. If the current selection is incompatible with sketch start rules, the system MUST clear that selection and remain in sketch-start target collection.

#### Scenario: Start sketch from the viewport
- **WHEN** the user activates `Sketch` and selects a valid planar target in the viewport
- **THEN** the editor opens a sketch session on that selected target

#### Scenario: Start sketch from the feature tree
- **WHEN** the user activates `Sketch` and selects a valid planar target from the feature tree
- **THEN** the editor opens a sketch session on that selected target

#### Scenario: Start sketch from a valid preselected planar target
- **WHEN** the user activates `Sketch` while exactly one valid planar sketch target is already selected
- **THEN** the editor opens a sketch session on that preselected target without requiring a second selection click

#### Scenario: Incompatible preselection is cleared for sketch start
- **WHEN** the user activates `Sketch` while the current selection contains unsupported targets or more than one target
- **THEN** the editor clears the current selection
- **AND** it remains in the sketch-start target-picking workflow until the user selects one valid target

