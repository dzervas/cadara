## ADDED Requirements

### Requirement: Sweep SHALL support profile control options
The sweep feature SHALL preserve and execute profile control options for none, keep profile orientation, lock profile faces, and lock profile direction.

#### Scenario: No profile control is selected
- **WHEN** a sweep definition uses profile control `none`
- **THEN** the sweep executes using the default path-driven profile orientation behavior

#### Scenario: Keep profile orientation is selected
- **WHEN** a sweep definition uses profile control `keepProfileOrientation`
- **THEN** the sweep maintains the profile's orientation relationship along the path

#### Scenario: Lock profile faces is selected
- **WHEN** a sweep definition uses profile control `lockProfileFaces`
- **THEN** the definition preserves one or more selected durable face references
- **AND** validation rejects the feature if no face reference is selected or if any selected lock target is not a face

#### Scenario: Lock profile direction is selected
- **WHEN** a sweep definition uses profile control `lockProfileDirection`
- **THEN** the definition preserves exactly one selected durable edge or construction reference as the direction reference
- **AND** validation rejects the feature if the direction reference is missing or has any other target kind

### Requirement: Sweep SHALL support discriminated twist options
The sweep feature SHALL represent twist as an optional discriminated option with turns, angle, and pitch variants.

#### Scenario: Turns twist is authored
- **WHEN** a sweep definition uses twist type `turns`
- **THEN** the durable definition stores only the authored revolutions value for the active twist variant

#### Scenario: Angle twist is authored
- **WHEN** a sweep definition uses twist type `angle`
- **THEN** the durable definition stores only the authored angle value for the active twist variant

#### Scenario: Pitch twist is authored
- **WHEN** a sweep definition uses twist type `pitch`
- **THEN** the durable definition stores only the authored pitch value for the active twist variant

#### Scenario: Twist is disabled
- **WHEN** a sweep definition disables twist
- **THEN** no inactive turns, angle, or pitch values affect preview, commit, rebuild, or operation-history replay

### Requirement: Sweep SHALL support end scale
The sweep feature SHALL support an optional positive end scale factor that proportionally transforms the profile size at the end of the sweep path.

#### Scenario: End scale is authored
- **WHEN** a sweep definition contains a scale factor greater than zero
- **THEN** the sweep profile transitions from its starting size to the requested proportional end size along the sweep path

#### Scenario: Scale is one
- **WHEN** a sweep definition has scale factor `1`
- **THEN** geometry execution treats the feature equivalently to an unscaled sweep

### Requirement: Advanced sweep controls SHALL execute through OCC
Advanced sweep profile control, twist, and scale options SHALL be implemented in the OpenCascade-backed modeling adapter for supported profile/path combinations.

#### Scenario: Advanced sweep preview runs
- **WHEN** preview receives a valid sweep with advanced controls
- **THEN** the adapter returns transient geometry reflecting the requested controls and no unsupported-case diagnostic

#### Scenario: Advanced sweep commit runs
- **WHEN** commit receives a valid sweep with advanced controls
- **THEN** the adapter commits the sweep feature and persisted snapshots hydrate the same advanced control values for editing

### Requirement: Sweep SHALL define a minimum supported advanced geometry matrix
The sweep implementation SHALL treat each profile control option, each twist variant, and non-1 end scale as required geometry paths in at least one representative profile/path case.

#### Scenario: Minimum profile control matrix is tested
- **WHEN** the OCC sweep adapter test suite runs
- **THEN** it includes successful preview or commit coverage for default profile control, keep profile orientation, lock profile faces, and lock profile direction

#### Scenario: Minimum twist and scale matrix is tested
- **WHEN** the OCC sweep adapter test suite runs
- **THEN** it includes successful preview or commit coverage for twist by turns, twist by angle, twist by pitch, and end scale with a factor other than `1`
