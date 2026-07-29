## MODIFIED Requirements

### Requirement: Profile-based features use explicit profile collections
The system SHALL represent profile-based feature inputs as ordered, non-empty collections of explicit durable profile references whenever the feature accepts multiple profiles, with profile ref eligibility determined by the feature's active result body type.

#### Scenario: Solid extrude carries multiple profiles
- **WHEN** a solid extrude feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `resultBodyType: "solid"` and `profiles` with one or more explicit region or planar-face references
- **AND** the definition preserves the existing solid extrude operation and boolean-scope semantics

#### Scenario: Surface extrude carries multiple profiles
- **WHEN** a surface extrude feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `resultBodyType: "surface"` and `profiles` with one or more explicit region, planar-face, or open sketch-curve references
- **AND** the definition does not contain `operation` or `booleanScope`

#### Scenario: Solid revolve carries multiple profiles
- **WHEN** a solid revolve feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `resultBodyType: "solid"`, `profiles` with one or more explicit region or planar-face references, and a separate explicit axis reference
- **AND** the definition preserves the existing solid revolve operation and boolean-scope semantics

#### Scenario: Surface revolve carries multiple profiles
- **WHEN** a surface revolve feature definition is submitted for preview, create, update, rebuild, or operation-history replay
- **THEN** its parameters contain `resultBodyType: "surface"`, `profiles` with one or more explicit region, planar-face, or open sketch-curve references, and a separate explicit axis reference
- **AND** the definition does not contain `operation` or `booleanScope`

#### Scenario: Profile-family feature carries multiple profiles
- **WHEN** an authored feature declares a profile input that accepts multiple profile references
- **THEN** its submitted feature definition preserves those references as an ordered profile collection or ordered profile participant targets according to that feature's contract

#### Scenario: Single profile is represented as a collection
- **WHEN** an extrude or revolve uses exactly one profile seed
- **THEN** the feature definition stores that seed as the only entry in `parameters.profiles`

### Requirement: Invalid profile collections produce explicit failures
The system SHALL fail profile-based feature requests explicitly when a profile collection is empty, contains invalid references, contains duplicates according to the feature contract, contains refs that are illegal for the active result body type, or contains a profile group the adapter cannot model.

#### Scenario: Empty profile collection
- **WHEN** an extrude or revolve feature definition contains `parameters.profiles` with no entries
- **THEN** the contract-facing validation rejects the definition with a profile-specific diagnostic

#### Scenario: Invalid profile reference
- **WHEN** a profile collection entry references a missing sketch region, missing planar face, or missing sketch entity
- **THEN** preview, create, update, rebuild, or replay returns an explicit invalid-reference diagnostic without silently remapping the profile

#### Scenario: Open curve is used in solid mode
- **WHEN** a solid extrude or solid revolve definition contains an open sketch-curve profile reference
- **THEN** contract-facing validation rejects the definition before geometry execution

#### Scenario: Surface boolean fields are submitted
- **WHEN** a surface extrude or surface revolve definition contains `operation` or `booleanScope`
- **THEN** contract-facing validation rejects the definition before geometry execution

#### Scenario: Unsupported profile group
- **WHEN** every profile entry is individually valid but the profile group cannot be modeled by the active adapter
- **THEN** the adapter returns an explicit unsupported-profile-group diagnostic and preserves the submitted profile collection in the failed request context

### Requirement: Feature authoring emits profile collections
The feature authoring layer SHALL build and hydrate profile-capable drafts using profile collections so multi-instance form selections and result-body variants can flow into durable feature definitions.

#### Scenario: Solid extrude draft is committed
- **WHEN** the extrude form has `resultBodyType: "solid"`, selected profile references, valid extents, and valid boolean operation fields
- **THEN** the feature authoring definition builds an extrude contract payload whose `parameters.profiles` entries match the selected solid-valid references
- **AND** the payload includes `operation` and `booleanScope`

#### Scenario: Surface extrude draft is committed
- **WHEN** the extrude form has `resultBodyType: "surface"`, selected profile references, and valid extents
- **THEN** the feature authoring definition builds an extrude contract payload whose `parameters.profiles` entries match the selected surface-valid references
- **AND** the payload omits `operation` and `booleanScope`

#### Scenario: Solid revolve draft is committed
- **WHEN** the revolve form has `resultBodyType: "solid"`, selected profile references, an axis reference, valid extents, and valid boolean operation fields
- **THEN** the feature authoring definition builds a revolve contract payload whose `parameters.profiles` entries match the selected solid-valid references and whose axis remains a separate `parameters.axis`
- **AND** the payload includes `operation` and `booleanScope`

#### Scenario: Surface revolve draft is committed
- **WHEN** the revolve form has `resultBodyType: "surface"`, selected profile references, an axis reference, and valid extents
- **THEN** the feature authoring definition builds a revolve contract payload whose `parameters.profiles` entries match the selected surface-valid references and whose axis remains a separate `parameters.axis`
- **AND** the payload omits `operation` and `booleanScope`

#### Scenario: Multi-profile feature draft is committed
- **WHEN** any profile-consuming feature whose authoring definition accepts multiple profile references is committed
- **THEN** the feature authoring definition builds a contract payload whose profile collection or profile participant targets match the selected references in order

#### Scenario: Existing multi-target feature contracts remain collection shaped
- **WHEN** fillet edge targets or shell removable-face targets are authored
- **THEN** those feature definitions continue to use their existing collection-shaped target fields and are validated consistently with collection-based feature inputs

## ADDED Requirements

### Requirement: Extrude and revolve parameters SHALL discriminate solid and surface results
Extrude and revolve feature parameters SHALL use `resultBodyType` as a required discriminant so solid-producing payloads preserve boolean fields and surface-producing payloads cannot encode boolean operation state.

#### Scenario: Solid variant is submitted
- **WHEN** an extrude or revolve definition uses `resultBodyType: "solid"`
- **THEN** validation requires the same fields and semantics as the previous solid-only parameter shape plus the discriminant
- **AND** `operation` and `booleanScope` remain required for the solid variant

#### Scenario: Surface variant is submitted
- **WHEN** an extrude or revolve definition uses `resultBodyType: "surface"`
- **THEN** validation requires the shared profile, extent, and revolve-axis fields for that feature
- **AND** validation rejects `operation` and `booleanScope` as inactive variant fields

#### Scenario: Discriminant is missing
- **WHEN** an extrude or revolve definition omits `resultBodyType`
- **THEN** contract-facing validation rejects the definition before preview, create, update, rebuild, or operation-history replay succeeds

### Requirement: Open sketch curves SHALL be surface-only profile refs
Extrude and revolve surface variants SHALL allow open sketch curves through durable sketch-entity profile refs, and solid variants SHALL reject those refs.

#### Scenario: Surface profile references a sketch entity
- **WHEN** a surface extrude or surface revolve profile entry has `kind: "sketchEntity"` with a durable `sketchId` and `entityId`
- **THEN** validation treats that entry as one open-curve profile seed for the surface feature

#### Scenario: Profile ref names multiple entities
- **WHEN** a surface profile entry attempts to reference more than one sketch entity in a single ref
- **THEN** validation rejects the entry before geometry execution

#### Scenario: Open curves form a connected chain
- **WHEN** surface extrude or surface revolve receives multiple open sketch-curve refs whose resolved entities are connected
- **THEN** the modeling adapter groups them into a wire using `BRepBuilderAPI_MakeWire`
- **AND** the connected chain yields one sheet body when the sweep operation succeeds

#### Scenario: Open curves are disconnected
- **WHEN** surface extrude or surface revolve receives open sketch-curve refs that cannot be grouped into one connected wire for the requested result
- **THEN** the modeling adapter returns an explicit unsupported-profile-group diagnostic without attempting hidden sewing

### Requirement: Surface authoring SHALL expose result type through generic form schema
Extrude and revolve authoring definitions SHALL expose Solid/Surface selection as a form-schema enum field and SHALL build variant-specific durable definitions without feature-specific inspector branching.

#### Scenario: User switches from solid to surface
- **WHEN** an extrude or revolve draft changes `resultBodyType` from `solid` to `surface`
- **THEN** the draft preserves shared values such as profiles, extents, axis, and start values where valid
- **AND** the durable definition built from the draft omits boolean operation fields

#### Scenario: User switches from surface to solid
- **WHEN** an extrude or revolve draft changes `resultBodyType` from `surface` to `solid`
- **THEN** the draft restores default standalone `newBody` boolean operation state
- **AND** solid-mode validation rejects or removes open sketch-curve profile refs before commit

#### Scenario: Surface form schema is rendered
- **WHEN** the generic feature inspector renders a surface extrude or surface revolve draft
- **THEN** boolean operation fields and draft/tapered-cap-irrelevant fields are absent from the active schema
