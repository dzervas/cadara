## ADDED Requirements

### Requirement: Region-consuming solid features on parametric sketches SHALL plan parametric via deferred references
The provider SHALL plan an Onshape solid feature consuming sketch regions as `parametric` when its owning sketch is parametric-tier and each region's interior-point selector is verified against cadara's region extraction of the translated solved sketch during review; the prepared feature action SHALL express its profile as a deferred region reference.

#### Scenario: Extrude of a canonical-plane sketch region
- **WHEN** an Onshape extrude consumes a region of a parametric-tier sketch and the region's interior point selects exactly one region in review-time verification
- **THEN** the extrude plans `parametric`
- **AND** prepare emits the profile as a deferred region reference to the sketch's commit action

#### Scenario: Region selector cannot be verified
- **WHEN** review-time verification finds no region or ambiguous nesting resolution for the selector over the translated sketch
- **THEN** the feature plans `baked` with `needs-region-resolution`
- **AND** the diagnostic includes the selector that failed verification

#### Scenario: Interior point sourcing
- **WHEN** the capture bundle provides tessellation samples for the referenced Onshape region face
- **THEN** the selector's interior point derives from a tessellation sample
- **AND** absent samples, the provider computes an interior point from the translated 2D rings before giving up

### Requirement: Onshape boolean scope SHALL map narrowly and honestly
The provider SHALL map Onshape `NEW` operations to standalone results, and `ADD`/`REMOVE`/`INTERSECT` with Onshape default scope to a deferred body reference only when exactly one prior body-producing action exists in the plan; all other scopes remain probe-gated.

#### Scenario: New-body extrude
- **WHEN** an Onshape extrude has operation `NEW`
- **THEN** the prepared feature uses standalone boolean scope with no deferred body reference

#### Scenario: Default-scope cut with a single upstream body
- **WHEN** an Onshape `REMOVE` extrude uses default scope and the plan contains exactly one prior body-producing action
- **THEN** the cut plans `parametric` with a deferred body reference to that action

#### Scenario: Ambiguous or explicit scope
- **WHEN** default scope has zero or multiple prior body-producing candidates, or the Onshape feature carries explicit boolean-scope queries
- **THEN** the feature plans `baked` with `needs-history-probe`
- **AND** the reason code is not misreported as a region problem
