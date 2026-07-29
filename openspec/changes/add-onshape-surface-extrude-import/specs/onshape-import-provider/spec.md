## ADDED Requirements

### Requirement: Onshape surface extrudes SHALL translate to surface extrude features
The provider SHALL translate an Onshape extrude whose `bodyType` is `SURFACE` into a cadara extrude
feature definition with `resultBodyType: "surface"`, carrying only profiles, start extent, and
extent, and SHALL NOT emit boolean operation or boolean scope state for it. A surface extrude SHALL
NOT contribute to solid body lineage used for default boolean-scope inference.

#### Scenario: Surface extrude with resolvable open-curve profiles
- **WHEN** an Onshape `SURFACE` extrude's `surfaceEntities` queries resolve to durable sketch entity
  references and its extent translates
- **THEN** the plan marks the entry `parametric` (or `topology` while an up-to bound still needs live
  resolution) and prepare emits an extrude definition with `resultBodyType: "surface"`
- **AND** the prepared definition contains no `operation` and no `booleanScope`

#### Scenario: Surface extrude produces a sheet body
- **WHEN** a prepared surface extrude definition is applied through the modeling kernel
- **THEN** the resulting body is tracked with `bodyKind: "sheet"`

#### Scenario: Surface extrude does not seed solid boolean scope
- **WHEN** a later Onshape default-scope boolean extrude follows a translated surface extrude
- **THEN** the surface extrude is not counted as a prior body-producing feature for default-scope
  inference

### Requirement: Onshape open sketch-curve profile queries SHALL resolve to durable sketch entity refs
The provider SHALL resolve an Onshape surface extrude profile query to durable sketch entity
references of the translated solved sketch when the query is a compressed `SKETCH_ENTITY` edge query
naming one sketch entity, or a readable whole-sketch wire `qCreatedBy` query over a sketch that
derives no closed region. The prepared profile reference SHALL defer its sketch id to the sketch's
commit action, and the resolved entities SHALL form exactly one connected chain.

#### Scenario: Compressed sketch-entity edge queries resolve
- **WHEN** each `surfaceEntities` query decodes to one `SKETCH_ENTITY` edge of a parametric-tier
  sketch and the named entities form one connected chain
- **THEN** prepare emits one `sketchEntity` profile reference per query whose `sketchId` is a
  deferred `sketchIdOf` reference to that sketch's commit action

#### Scenario: Whole-sketch wire query resolves
- **WHEN** a `surfaceEntities` query names every non-construction wire edge created by one
  parametric-tier sketch and that sketch derives no closed region
- **THEN** prepare emits one `sketchEntity` profile reference for each non-construction entity of the
  translated sketch

#### Scenario: Whole-sketch wire query over a region-bearing sketch bakes
- **WHEN** a whole-sketch wire query names a sketch whose translated geometry derives at least one
  closed region
- **THEN** the feature plans `baked` with `extrude-surface-profile-unresolved`

#### Scenario: Disconnected or unreadable profile queries bake
- **WHEN** a `surfaceEntities` query cannot be decoded, names an entity absent from the translated
  sketch, or the resolved entities do not form one connected chain
- **THEN** the feature plans `baked` with `extrude-surface-profile-unresolved`

### Requirement: Unsupported Onshape surface extrude forms SHALL bake with explicit reasons
The provider SHALL bake an Onshape surface extrude whose authored form cannot be represented by the
surface extrude contract or executed by the modeling adapter, naming the specific unsupported input.

#### Scenario: Surface extrude with a boolean operation
- **WHEN** an Onshape surface extrude's surface operation is not `NEW`
- **THEN** the feature plans `baked` with `extrude-surface-operation-unsupported`

#### Scenario: Surface extrude with a draft angle
- **WHEN** an Onshape surface extrude authors a draft angle on any active side
- **THEN** the feature plans `baked` with `extrude-surface-draft-unsupported`

#### Scenario: Non-solid, non-surface body type
- **WHEN** an Onshape extrude's `bodyType` is neither `SOLID` nor `SURFACE`
- **THEN** the feature plans `baked` with `extrude-body-type-unsupported`

### Requirement: Onshape symmetric extrude extents SHALL translate as symmetric extents
The provider SHALL translate an Onshape extrude authoring the `symmetric` flag into a symmetric
cadara extent whose end distance is half the authored blind depth, so the imported result matches the
captured geometry instead of being displaced by the full depth.

#### Scenario: Symmetric blind extrude
- **WHEN** an Onshape extrude authors `endBound = BLIND`, a blind depth, and `symmetric = true`
- **THEN** the translated extent is `mode: "symmetric"` with a blind end distance of half the
  authored depth

#### Scenario: Symmetric through-all extrude
- **WHEN** an Onshape extrude authors `endBound = THROUGH_ALL` and `symmetric = true`
- **THEN** the translated extent is `mode: "symmetric"` with a through-all end
