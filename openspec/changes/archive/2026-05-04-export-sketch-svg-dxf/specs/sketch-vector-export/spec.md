## ADDED Requirements

### Requirement: Sketch vector export providers SHALL produce SVG and DXF payloads
The system SHALL provide built-in SVG and DXF export providers for committed sketch targets. These providers SHALL generate non-empty vector payloads from the selected sketch definition using document units and sketch-local coordinates.

#### Scenario: Export SVG for a committed sketch
- **WHEN** the SVG export provider receives an export request for an existing committed sketch target
- **THEN** it produces a non-empty `.svg` payload representing the sketch geometry in sketch-local coordinates
- **AND** the payload includes a valid `<svg>` root with a viewBox that encloses the exported sketch geometry

#### Scenario: Export DXF for a committed sketch
- **WHEN** the DXF export provider receives an export request for an existing committed sketch target
- **THEN** it produces a non-empty `.dxf` payload representing the sketch geometry in sketch-local coordinates
- **AND** the payload can be identified as a DXF document by the exported section structure

#### Scenario: Reject non-sketch target
- **WHEN** a sketch vector export provider receives a target that is not a committed sketch
- **THEN** it returns a failure result with an unexportable-target diagnostic
- **AND** no file download is triggered

### Requirement: SVG sketch export SHALL preserve supported authored styles
SVG export SHALL serialize supported authored SVG sketch style data from Fill and Stroke tools into the exported SVG payload. Supported style data SHALL include stroke color, stroke width, stroke opacity, fill color, fill opacity, and supported gradient definitions.

#### Scenario: Export styled edge stroke
- **WHEN** a committed sketch edge has authored stroke style data
- **THEN** SVG export serializes the edge with corresponding SVG stroke attributes
- **AND** the exported SVG does not reduce the styled edge to the default sketch stroke

#### Scenario: Export styled filled region
- **WHEN** a committed sketch region has authored fill style data and a valid exportable boundary
- **THEN** SVG export serializes the region with corresponding SVG fill attributes or gradient references
- **AND** the exported SVG includes any needed gradient definitions for supported gradient fills

#### Scenario: Unsupported style field falls back with diagnostic
- **WHEN** a committed sketch contains authored style data that cannot be represented by the current SVG exporter
- **THEN** SVG export preserves the rest of the exportable sketch geometry
- **AND** returns a diagnostic describing the unsupported style fallback

### Requirement: Sketch vector export SHALL report unsupported geometry explicitly
Sketch vector export providers SHALL NOT silently drop unsupported sketch entities. If an entity cannot be serialized in the selected vector format, the provider SHALL either serialize a documented approximation or return a diagnostic that identifies the unsupported entity.

#### Scenario: Unsupported entity is encountered during SVG export
- **WHEN** SVG export encounters a supported sketch target containing an entity that the SVG provider cannot serialize
- **THEN** the provider returns a diagnostic for that entity
- **AND** any unrelated supported sketch geometry remains exportable

#### Scenario: Unsupported entity is encountered during DXF export
- **WHEN** DXF export encounters a supported sketch target containing an entity that the DXF provider cannot serialize
- **THEN** the provider returns a diagnostic for that entity
- **AND** any unrelated supported sketch geometry remains exportable
