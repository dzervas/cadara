## ADDED Requirements

### Requirement: Prepared extrude actions SHALL support the surface parameter variant
The import contract SHALL allow a prepared extrude feature definition to carry either extrude
parameter variant: the solid variant with boolean operation and deferred boolean scope, or the
surface variant with no boolean fields whose profiles may include open sketch-curve references. An
open sketch-curve profile reference SHALL defer only its sketch id, through `sketchIdOf`, exactly like
the revolve axis reference. The orchestrator SHALL substitute that sketch id before applying the
feature and SHALL NOT require boolean scope for surface variants.

#### Scenario: Surface extrude with a deferred open sketch-curve profile
- **WHEN** an ordered sequence contains a sketch commit followed by an extrude action whose
  parameters use `resultBodyType: "surface"` and whose profile is a `sketchEntity` reference with a
  deferred `sketchIdOf` sketch id
- **THEN** validation accepts the prepared actions
- **AND** the orchestrator substitutes the committed sketch id into the profile before applying the
  feature

#### Scenario: Surface extrude omits boolean fields
- **WHEN** a prepared extrude definition uses `resultBodyType: "surface"`
- **THEN** validation rejects the definition if it carries `operation` or `booleanScope`
- **AND** materialization applies the feature without resolving any boolean scope

#### Scenario: Open sketch-curve profile defers through the wrong reference kind
- **WHEN** an open sketch-curve profile reference defers its sketch id through any deferred kind other
  than `sketchIdOf`
- **THEN** validation fails before any action applies
