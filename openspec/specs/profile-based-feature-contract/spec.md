# profile-based-feature-contract Specification

## Purpose
TBD - created by archiving change allow-multiple-feature-profiles. Update Purpose after archive.
## Requirements
### Requirement: Profile-based features use explicit profile collections
The system SHALL represent profile-based feature inputs as ordered, non-empty collections of explicit durable profile references whenever the feature accepts multiple profiles.

#### Scenario: Extrude carries multiple profiles
- **WHEN** an extrude feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `profiles` with one or more explicit region or planar-face references

#### Scenario: Revolve carries multiple profiles
- **WHEN** a revolve feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `profiles` with one or more explicit region or planar-face references and a separate explicit axis reference

#### Scenario: Profile-family feature carries multiple profiles
- **WHEN** an authored feature declares a profile input that accepts multiple profile references
- **THEN** its submitted feature definition preserves those references as an ordered profile collection or ordered profile participant targets according to that feature's contract

#### Scenario: Single profile is represented as a collection
- **WHEN** an extrude or revolve uses exactly one profile seed
- **THEN** the feature definition stores that seed as the only entry in `parameters.profiles`

### Requirement: Singular profile parameters are removed
The system MUST reject extrude and revolve feature definitions that rely on a singular `profile` parameter instead of the `profiles` collection.

#### Scenario: Legacy extrude shape is submitted
- **WHEN** an extrude feature definition contains `parameters.profile` and does not contain a valid non-empty `parameters.profiles` collection
- **THEN** the contract-facing validation rejects the definition before preview, create, update, rebuild, or operation-history replay succeeds

#### Scenario: Legacy revolve shape is submitted
- **WHEN** a revolve feature definition contains `parameters.profile` and does not contain a valid non-empty `parameters.profiles` collection
- **THEN** the contract-facing validation rejects the definition before preview, create, update, rebuild, or operation-history replay succeeds

### Requirement: Profile collections preserve durable explicitness
The system MUST keep every profile collection entry as an explicit durable profile reference and MUST NOT infer profile membership from whole sketches, transient UI selections, or side-band generic reference arrays.

#### Scenario: Whole sketch is used as a profile source
- **WHEN** a profile-based feature definition supplies a whole-sketch target instead of explicit region or planar-face profile entries
- **THEN** the contract-facing validation rejects the definition

#### Scenario: Side-band references disagree with profiles
- **WHEN** a profile-based feature request contains unrelated generic reference arrays or transient selection state
- **THEN** preview, create, update, rebuild, and operation-history replay use only `parameters.profiles` as the authoritative profile seed collection

### Requirement: Invalid profile collections produce explicit failures
The system SHALL fail profile-based feature requests explicitly when a profile collection is empty, contains invalid references, contains duplicates according to the feature contract, or contains a profile group the adapter cannot model.

#### Scenario: Empty profile collection
- **WHEN** an extrude or revolve feature definition contains `parameters.profiles` with no entries
- **THEN** the contract-facing validation rejects the definition with a profile-specific diagnostic

#### Scenario: Invalid profile reference
- **WHEN** a profile collection entry references a missing sketch region or missing planar face
- **THEN** preview, create, update, rebuild, or replay returns an explicit invalid-reference diagnostic without silently remapping the profile

#### Scenario: Unsupported profile group
- **WHEN** every profile entry is individually valid but the profile group cannot be modeled by the active adapter
- **THEN** the adapter returns an explicit unsupported-profile-group diagnostic and preserves the submitted profile collection in the failed request context

### Requirement: Feature authoring emits profile collections
The feature authoring layer SHALL build and hydrate profile-capable drafts using profile collections so multi-instance form selections can flow into durable feature definitions.

#### Scenario: Multi-profile extrude draft is committed
- **WHEN** the extrude form contains multiple selected profile references and the user commits the feature
- **THEN** the feature authoring definition builds an extrude contract payload whose `parameters.profiles` entries match the selected references

#### Scenario: Multi-profile revolve draft is committed
- **WHEN** the revolve form contains multiple selected profile references, an axis reference, and valid numeric parameters
- **THEN** the feature authoring definition builds a revolve contract payload whose `parameters.profiles` entries match the selected references and whose axis remains a separate `parameters.axis`

#### Scenario: Multi-profile feature draft is committed
- **WHEN** any profile-consuming feature whose authoring definition accepts multiple profile references is committed
- **THEN** the feature authoring definition builds a contract payload whose profile collection or profile participant targets match the selected references in order

#### Scenario: Existing multi-target feature contracts remain collection shaped
- **WHEN** fillet edge targets or shell removable-face targets are authored
- **THEN** those feature definitions continue to use their existing collection-shaped target fields and are validated consistently with collection-based feature inputs

### Requirement: Multi-profile support has regression coverage
The system SHALL include focused `bun:test` coverage proving that profile-consuming feature authoring preserves multiple selected profile references.

#### Scenario: Multi-profile authoring test builds expected payload
- **WHEN** the test creates or patches a profile-capable feature draft with at least two selected profile references
- **THEN** the built feature definition contains both selected references in the expected profile collection or profile participant target list

### Requirement: Profile-based features SHALL preserve projected-boundary invalidation semantics
Profile-based feature rebuilds SHALL preserve live-derived projected profile references and report invalidation explicitly when referenced projected boundaries cannot be resolved.

#### Scenario: Feature rebuilds projected-boundary profile
- **WHEN** a profile-based feature references a sketch region containing projected boundary segments
- **THEN** feature replay rebuilds the profile from live-derived projected geometry for the active revision

#### Scenario: Projected-boundary profile is invalidated
- **WHEN** one or more projected boundary segments cannot be resolved during feature replay
- **THEN** the feature reports explicit invalidation diagnostics instead of silently changing the profile or using copied geometry

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
