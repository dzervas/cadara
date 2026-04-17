## ADDED Requirements

### Requirement: Sketch profiles SHALL support live-derived projected boundary segments
The system SHALL allow derived sketch profile regions to include boundary segments sourced from projected reference geometry while preserving the projected geometry as live-derived data.

#### Scenario: Projected line closes a region
- **WHEN** local sketch geometry and valid projected reference geometry form a closed boundary in sketch space
- **THEN** region extraction may emit a derived region whose loop includes projected geometry boundary segments
- **AND** those segments reference projected geometry identity rather than copied local sketch entities

#### Scenario: Projected boundary source changes
- **WHEN** source topology for a projected profile boundary changes at a later revision
- **THEN** the profile boundary is rebuilt from live projected reference data for that revision or reports explicit invalidation

### Requirement: Referenced profile geometry MUST NOT be copied into local sketch geometry
The system MUST NOT convert projected reference geometry into sketch-owned points, entities, or construction geometry to support projected profile boundaries.

#### Scenario: Projected profile boundary is committed
- **WHEN** a sketch region uses projected reference geometry as a boundary segment
- **THEN** the sketch definition preserves authored references and projected geometry identifiers
- **AND** no new local sketch point or entity is created as a copy of that projected boundary segment

#### Scenario: Live projection is unavailable
- **WHEN** projected profile boundary geometry cannot be resolved during rebuild
- **THEN** the feature reports invalidation diagnostics
- **AND** the system does not fall back to copied, stale, or silently remapped geometry

### Requirement: Profile rebuild SHALL resolve projected boundaries live
The system SHALL rebuild profiles containing projected boundary segments by resolving authored references through the solver or projection boundary for the active document revision.

#### Scenario: OCC rebuild consumes projected segment
- **WHEN** an OCC-backed feature rebuilds a profile region containing a projected line, circle, or arc segment
- **THEN** the OCC adapter constructs the profile wire from live projected geometry supplied for the active revision
- **AND** the adapter does not author or persist copied sketch geometry for that segment
