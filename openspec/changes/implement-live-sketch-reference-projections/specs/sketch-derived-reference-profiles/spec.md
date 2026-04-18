## ADDED Requirements

### Requirement: Region extraction SHALL consume live projected boundary geometry
The system SHALL derive sketch profile regions from a combination of local sketch geometry and successfully projected reference geometry when the live projected segments form closed loops.

#### Scenario: Local and projected segments form a region
- **WHEN** local sketch geometry and live projected reference line, circle, or arc segments form a closed profile loop in sketch space
- **THEN** region extraction emits a derived region whose boundary includes projected geometry segment sources
- **AND** those boundary segments reference projected geometry identity rather than copied local sketch entity identity

#### Scenario: Projected segment is not currently valid
- **WHEN** an authored projected boundary source has no valid projected geometry record for the active revision
- **THEN** region extraction reports explicit diagnostics for the invalid projected source
- **AND** it does not use stale cached coordinates or copied sketch geometry to close the region

### Requirement: Profile rebuild SHALL use active projection records for projected boundaries
The system SHALL build feature profile wires containing projected boundary segments from active projection records for the sketch revision being rebuilt.

#### Scenario: OCC builds mixed projected profile wire
- **WHEN** a profile-based OCC feature consumes a derived region whose loop contains local sketch segments and valid projected reference segments
- **THEN** the OCC profile builder constructs the wire from local solved geometry and active projected geometry records
- **AND** the authored sketch definition remains unchanged by the rebuild

#### Scenario: Projected profile source is unavailable during rebuild
- **WHEN** a profile-based feature rebuild encounters a projected boundary segment that cannot be resolved from the active projected reference records
- **THEN** the rebuild reports an explicit invalidation diagnostic
- **AND** the feature does not fall back to copied, stale, or silently remapped geometry
