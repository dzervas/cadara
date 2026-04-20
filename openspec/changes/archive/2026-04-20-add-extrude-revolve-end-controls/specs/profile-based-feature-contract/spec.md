## ADDED Requirements

### Requirement: Profile-based extents SHALL use explicit extent modes
Extrude and revolve feature definitions SHALL represent extent directionality with an explicit mode of `oneSide`, `symmetric`, or `twoSide`.

#### Scenario: One-side extent is submitted
- **WHEN** an extrude or revolve feature definition uses `oneSide`
- **THEN** the definition contains exactly one authored end condition for the feature's forward direction

#### Scenario: Symmetric extent is submitted
- **WHEN** an extrude or revolve feature definition uses `symmetric`
- **THEN** the definition contains one authored end condition that is mirrored about the profile plane or revolve start position
- **AND** the definition does not contain a second independent end

#### Scenario: Symmetric extent is invalid for the end type
- **WHEN** an extrude definition uses `symmetric` with an end condition other than `blind` or `throughAll`
- **THEN** validation rejects the feature before geometry execution
- **AND** when a revolve definition uses `symmetric` with an end condition other than blind angular extent
- **THEN** validation rejects the feature before geometry execution

#### Scenario: Two-side extent is submitted
- **WHEN** an extrude or revolve feature definition uses `twoSide`
- **THEN** the definition contains first and second authored end conditions that are preserved independently through preview, commit, history replay, and edit hydration

### Requirement: Extrude SHALL support advanced end conditions
Extrude feature definitions SHALL support blind, up to next, up to face, up to part, up to vertex, and through all end conditions for eligible extent modes.

#### Scenario: Blind extrude end is authored
- **WHEN** an extrude end uses `blind`
- **THEN** the end contains an expression-capable positive depth and direction owned by the extent mode

#### Scenario: Up-to-next extrude end is authored
- **WHEN** an extrude end uses `upToNext`
- **THEN** the end does not require selected target geometry
- **AND** validation leaves terminating geometry discovery to the modeling adapter

#### Scenario: Up-to target extrude end is authored
- **WHEN** an extrude end uses `upToFace`, `upToPart`, or `upToVertex`
- **THEN** the end contains the corresponding durable face, body, or vertex target and preserves it through history and hydration

#### Scenario: Through-all extrude end is authored
- **WHEN** an extrude end uses `throughAll`
- **THEN** the end requires no depth and represents piercing through all geometry in front of the profile along the extrude direction

#### Scenario: Up-to extrude offset is authored
- **WHEN** an extrude end uses `upToNext`, `upToFace`, `upToPart`, or `upToVertex` with an offset
- **THEN** the end preserves an expression-capable offset distance and offset direction through preview, commit, history replay, and edit hydration

### Requirement: Extrude draft SHALL be authored per active end
Extrude draft angle SHALL be expression-capable and SHALL belong to each active end condition, with symmetric extents mirroring the authored draft automatically.

#### Scenario: Symmetric draft is authored
- **WHEN** a symmetric extrude contains a draft angle
- **THEN** the draft is applied to both mirrored ends from the same authored value

#### Scenario: Two-side draft is authored
- **WHEN** a two-side extrude contains first and second draft angles
- **THEN** each end preserves its own authored draft value through preview, commit, history replay, and edit hydration

### Requirement: Revolve SHALL support full and advanced angular end conditions
Revolve feature definitions SHALL support full revolve and non-full end conditions including blind, up to next, up to face, up to part, and up to vertex.

#### Scenario: Full revolve is authored
- **WHEN** a revolve definition uses full revolve
- **THEN** the profile revolves 360 degrees around the explicit axis without requiring a separate angle value

#### Scenario: Blind revolve is authored
- **WHEN** a revolve definition uses blind
- **THEN** the definition contains an expression-capable angle value and sweep direction

#### Scenario: Up-to revolve end is authored
- **WHEN** a revolve definition uses up to next, up to face, up to part, or up to vertex
- **THEN** the feature preserves the requested angular termination mode through preview, commit, history replay, and edit hydration
- **AND** `upToNext` does not require selected target geometry
- **AND** `upToFace`, `upToPart`, and `upToVertex` preserve the corresponding durable face, body, or vertex target

#### Scenario: Up-to revolve offset is authored
- **WHEN** a revolve definition uses up to next, up to face, up to part, or up to vertex with an offset
- **THEN** the feature preserves an expression-capable angular offset and offset direction through preview, commit, history replay, and edit hydration

### Requirement: Existing extrude and revolve definitions SHALL migrate to explicit extent modes
Existing blind extrude and angular revolve definitions SHALL remain replayable and editable after explicit extent modes are introduced.

#### Scenario: Existing blind extrude is hydrated
- **WHEN** a stored extrude definition uses the previous blind `endExtent` shape
- **THEN** hydration treats it as a `oneSide` blind extent with the same direction, distance, operation, and boolean scope

#### Scenario: Existing angular revolve is hydrated
- **WHEN** a stored revolve definition uses the previous angular `extent` shape
- **THEN** hydration treats it as a `oneSide` blind angular extent with the same direction, angle, operation, and boolean scope

#### Scenario: Operation history replays legacy extents
- **WHEN** operation history replays an existing blind extrude or angular revolve entry
- **THEN** replay preserves the original modeling result by mapping the legacy extent shape into the new explicit extent contract before execution
