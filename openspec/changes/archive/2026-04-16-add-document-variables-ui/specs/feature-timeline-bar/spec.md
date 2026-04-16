## MODIFIED Requirements

### Requirement: Feature timeline SHALL replace the sidebar feature tree
The workbench SHALL render committed document features in a bottom feature timeline bar instead of rendering the feature tree as the top section of the left sidebar, while preserving the remaining sidebar sections.

#### Scenario: Sidebar keeps non-feature sections
- **WHEN** the workbench renders a document snapshot with features, objects, variables, references, and diagnostics
- **THEN** the left sidebar displays the parts and objects, document variables, and document diagnostic sections without the feature tree section
- **AND** the left sidebar does not display snapshot references as the standard middle section

#### Scenario: Features render in the bottom bar
- **WHEN** the workbench renders committed features from the current document snapshot
- **THEN** each committed feature is represented in the bottom feature timeline bar in document feature order

## ADDED Requirements

### Requirement: Sidebar diagnostics SHALL remain compact
The left sidebar SHALL constrain the Document Diagnostics section so its maximum height equals the current normal diagnostics section height, and diagnostics overflow SHALL scroll inside that section.

#### Scenario: Diagnostics exceed the compact section height
- **WHEN** the document has more diagnostics than fit inside the compact diagnostics section
- **THEN** the Document Diagnostics section remains no taller than its configured maximum height
- **AND** the diagnostics list scrolls internally

#### Scenario: Diagnostics are empty
- **WHEN** the document has no diagnostics
- **THEN** the Document Diagnostics section remains visible in its compact position and shows the empty diagnostics state
