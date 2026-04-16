## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Multi-profile support has regression coverage
The system SHALL include focused `bun:test` coverage proving that profile-consuming feature authoring preserves multiple selected profile references.

#### Scenario: Multi-profile authoring test builds expected payload
- **WHEN** the test creates or patches a profile-capable feature draft with at least two selected profile references
- **THEN** the built feature definition contains both selected references in the expected profile collection or profile participant target list
