## ADDED Requirements

### Requirement: Profile-based features use explicit profile collections
The system SHALL represent profile-based feature inputs as ordered, non-empty collections of explicit durable profile references.

#### Scenario: Extrude carries multiple profiles
- **WHEN** an extrude feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `profiles` with one or more explicit region or planar-face references

#### Scenario: Revolve carries multiple profiles
- **WHEN** a revolve feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `profiles` with one or more explicit region or planar-face references and a separate explicit axis reference

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
The feature authoring layer SHALL build and hydrate extrude and revolve drafts using profile collections so multi-instance form selections can flow into durable feature definitions.

#### Scenario: Multi-profile extrude draft is committed
- **WHEN** the extrude form contains multiple selected profile references and the user commits the feature
- **THEN** the feature authoring definition builds an extrude contract payload whose `parameters.profiles` entries match the selected references

#### Scenario: Multi-profile revolve draft is committed
- **WHEN** the revolve form contains multiple selected profile references, an axis reference, and valid numeric parameters
- **THEN** the feature authoring definition builds a revolve contract payload whose `parameters.profiles` entries match the selected references and whose axis remains a separate `parameters.axis`

#### Scenario: Existing multi-target feature contracts remain collection shaped
- **WHEN** fillet edge targets or shell removable-face targets are authored
- **THEN** those feature definitions continue to use their existing collection-shaped target fields and are validated consistently with collection-based feature inputs
