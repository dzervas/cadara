## ADDED Requirements

### Requirement: Sheet bodies SHALL be first-class tracked bodies
The system SHALL represent sheet bodies as first-class bodies with explicit `solid` or `sheet` kind in kernel tracking and persisted body snapshots.

#### Scenario: Solid body is tracked
- **WHEN** a feature produces a solid result body
- **THEN** the OCC tracking state records the body with kind `solid`
- **AND** the corresponding `BodySnapshotRecord` persists `bodyKind: "solid"`

#### Scenario: Sheet body is tracked
- **WHEN** a feature produces a sheet result body
- **THEN** the OCC tracking state records the body with kind `sheet`
- **AND** the corresponding `BodySnapshotRecord` persists `bodyKind: "sheet"`

#### Scenario: Body kind is missing
- **WHEN** a body snapshot or tracked-body payload is validated without an explicit body kind
- **THEN** contract-facing validation rejects the payload before snapshot hydration or operation-history replay succeeds

### Requirement: Sheet bodies SHALL have kind-aware presentation
The system SHALL present body rows and snapshot descriptions according to body kind rather than assuming all bodies are solids.

#### Scenario: Solid body row is rendered
- **WHEN** the object tree renders a body snapshot with `bodyKind: "solid"`
- **THEN** the row uses a solid-body label such as `Solid body`

#### Scenario: Sheet body row is rendered
- **WHEN** the object tree renders a body snapshot with `bodyKind: "sheet"`
- **THEN** the row uses a sheet-body label such as `Sheet body`

#### Scenario: Snapshot description is generated
- **WHEN** snapshot presentation metadata is generated for a body
- **THEN** the description is derived from the body's persisted kind instead of a hardcoded solid-body string

### Requirement: Sheet bodies SHALL preserve shape-agnostic render and export behavior
Sheet bodies SHALL participate in tessellation, picking, viewport rendering, and STEP export through the existing shape-agnostic paths.

#### Scenario: Sheet body is tessellated
- **WHEN** a sheet body contains one or more faces
- **THEN** tessellation emits render geometry for each face using the same snapshot path as solid body faces

#### Scenario: Sheet body is picked
- **WHEN** the user picks tessellated geometry belonging to a sheet body
- **THEN** picking resolves durable body and topology targets using the sheet body's persisted identifiers

#### Scenario: Sheet body is exported to STEP
- **WHEN** STEP export includes a sheet body
- **THEN** the exporter submits the shape through the existing `STEPControl_AsIs` path without requiring solid conversion

### Requirement: Solid-only features SHALL reject sheet bodies explicitly
Features and operations that require solid bodies SHALL reject sheet bodies with structured unsupported diagnostics before kernel execution.

#### Scenario: Sheet body is selected for fillet
- **WHEN** a fillet request targets topology owned by a sheet body
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic
- **AND** it does not crash, skip the target, or coerce the sheet body into a solid

#### Scenario: Sheet body is selected for shell
- **WHEN** a shell request uses a sheet body as its source body
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic
- **AND** it does not run solid shelling against sheet topology

#### Scenario: Sheet body is selected for boolean operation
- **WHEN** a boolean operation uses a sheet body as a target or tool body
- **THEN** the adapter rejects the operation with an explicit unsupported-sheet-body diagnostic
- **AND** it does not silently drop that participant from the operation

#### Scenario: Sheet body is selected for split or other solid-only feature
- **WHEN** a solid-only feature receives a sheet body participant
- **THEN** the adapter rejects the request with an explicit unsupported-sheet-body diagnostic before topology mutation

### Requirement: Sheet topology source keys SHALL be shape-typed
Surface-producing features SHALL use sheet-specific topology source keys for boundary edges and SHALL NOT reuse solid cap-face source keys for edge results.

#### Scenario: Surface extrude creates boundary edges
- **WHEN** a surface extrude produces first or last boundary edges from a swept wire
- **THEN** topology naming records sheet-specific source keys such as `profile:first-boundary-edge` and `profile:last-boundary-edge`

#### Scenario: Surface revolve creates boundary edges
- **WHEN** a surface revolve produces first or last boundary edges from a revolved wire
- **THEN** topology naming records sheet-specific source keys such as `profile:first-boundary-edge` and `profile:last-boundary-edge`

#### Scenario: Solid cap key is requested for a sheet result
- **WHEN** topology provenance for a sheet result would require a face-typed cap key such as `profile:first-face` or `profile:last-face`
- **THEN** the adapter records an explicit unsupported-provenance diagnostic instead of binding edge topology to a face key
