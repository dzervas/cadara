# feature-timeline-bar Specification

## Purpose
TBD - created by archiving change move-feature-tree-to-bottom-timeline. Update Purpose after archive.
## Requirements
### Requirement: Feature timeline SHALL replace the sidebar feature tree
The workbench SHALL render committed document features in a bottom feature timeline bar instead of rendering the feature tree as the top section of the left sidebar, while preserving the remaining sidebar sections.

#### Scenario: Sidebar keeps non-feature sections
- **WHEN** the workbench renders a document snapshot with features, objects, variables, references, and diagnostics
- **THEN** the left sidebar displays the parts and objects, document variables, and document diagnostic sections without the feature tree section
- **AND** the left sidebar does not display snapshot references as the standard middle section

#### Scenario: Features render in the bottom bar
- **WHEN** the workbench renders committed features from the current document snapshot
- **THEN** each committed feature is represented in the bottom feature timeline bar in document feature order

### Requirement: Timeline features SHALL be compact icon-only controls
The bottom feature timeline bar SHALL render each feature as a single icon-only control using the same icon sizing as toolbar tools and the shared tool icon definition for that feature when feature tool metadata exists.

#### Scenario: Feature icon renders without inline label
- **WHEN** the bottom feature timeline bar renders a feature
- **THEN** the visible timeline item contains one feature icon resolved from the shared tool icon definition source when the feature has tool icon metadata
- **AND** the visible timeline item does not render the feature label as inline timeline text

#### Scenario: Feature control remains accessible
- **WHEN** a screen reader or keyboard user focuses a feature timeline item
- **THEN** the control exposes an accessible label that identifies the feature

#### Scenario: Sketch history icon uses shared tool metadata
- **WHEN** the sketch history timeline renders a sketch dimension, constraint, or entity item that maps to an existing `ToolIconId`
- **THEN** the item icon is resolved from the shared tool icon definition source instead of a separate generic workbench icon mapping

### Requirement: Timeline feature details SHALL use shared tooltip mechanics
The bottom feature timeline bar SHALL use the same tooltip primitives and delay behavior as toolbar feature buttons to show feature information on hover or focus.

#### Scenario: Hovering a timeline feature shows details
- **WHEN** the user hovers or focuses a feature icon in the bottom feature timeline bar
- **THEN** a tooltip appears using the shared toolbar tooltip mechanics and includes the feature's available label and descriptive information

### Requirement: Timeline SHALL show the document cursor
The bottom feature timeline bar SHALL show a visible cursor at the current document feature cursor position.

#### Scenario: Cursor is at the feature tail
- **WHEN** the document cursor references the last committed feature in document order
- **THEN** the bottom feature timeline bar shows the cursor at the tail of the feature sequence

#### Scenario: Cursor is rolled back
- **WHEN** the document cursor references a feature before later stored features
- **THEN** the bottom feature timeline bar shows the cursor at that feature position and indicates that later features are after the current applied position

### Requirement: Timeline selection SHALL preserve feature target behavior
The bottom feature timeline bar SHALL preserve feature-row selection and visibility behavior that was previously available through the sidebar feature tree.

#### Scenario: Selecting a timeline feature
- **WHEN** the user activates a selectable feature icon in the bottom feature timeline bar
- **THEN** the workbench dispatches the same target selection request that the corresponding sidebar feature row would have dispatched

#### Scenario: Hidden feature remains visible as timeline state
- **WHEN** a feature target is hidden from the viewport
- **THEN** the bottom feature timeline bar keeps the feature item present and indicates its hidden state without allowing hidden geometry to be selected

### Requirement: Sidebar diagnostics SHALL remain compact
The left sidebar SHALL constrain the Document Diagnostics section so its maximum height equals the current normal diagnostics section height, and diagnostics overflow SHALL scroll inside that section.

#### Scenario: Diagnostics exceed the compact section height
- **WHEN** the document has more diagnostics than fit inside the compact diagnostics section
- **THEN** the Document Diagnostics section remains no taller than its configured maximum height
- **AND** the diagnostics list scrolls internally

#### Scenario: Diagnostics are empty
- **WHEN** the document has no diagnostics
- **THEN** the Document Diagnostics section remains visible in its compact position and shows the empty diagnostics state

