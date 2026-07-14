# onshape-import-provider Specification

## Purpose
Defines the Onshape capture-bundle import provider and its fidelity planning, translation, verification, and ordered-action behavior.
## Requirements
### Requirement: The Onshape provider SHALL import capture bundles through the standard provider pipeline
The system SHALL register an import provider accepting `.onshape-capture.json` sources that implements review, selections, form schema, and prepare per the import provider contract, producing a native cadara document from the bundle's parametric definition.

#### Scenario: Bundle is selected for import
- **WHEN** the user imports a file with the `.onshape-capture.json` extension
- **THEN** the Onshape provider is offered
- **AND** its review parses and validates the bundle envelope without mutating any document state

#### Scenario: Bundle envelope is invalid
- **WHEN** the file fails bundle envelope validation or declares an unsupported `formatVersion`
- **THEN** the review reports structured diagnostics identifying the failure
- **AND** no import session proceeds to prepare

#### Scenario: Multi-studio bundle
- **WHEN** the bundle contains multiple Part Studios
- **THEN** the review form lets the user select which studio to import

### Requirement: Translation SHALL be planned in fidelity tiers and reported before commit
The provider SHALL assign each Onshape history entry a translation tier — `parametric`, `baked`, or `geometryOnly` — and SHALL present the per-feature plan (tier, reason codes, diagnostics) in the review form before any commit.

#### Scenario: Fully supported feature
- **WHEN** a history entry maps to a cadara feature kind with all parameters supported and all references resolved
- **THEN** the plan marks it `parametric`

#### Scenario: Unsupported option or custom feature
- **WHEN** a history entry uses an unsupported option or a custom FeatureScript feature type
- **THEN** the plan marks it `baked` with a reason code identifying what was unsupported
- **AND** the feature is never silently dropped

#### Scenario: User demotes a feature
- **WHEN** the user changes a `parametric` entry to `baked` in the review form
- **THEN** prepare honors the demotion
- **AND** no selection can promote an entry beyond the tier the planner verified

#### Scenario: Import report is honest
- **WHEN** the import commits
- **THEN** the resulting diagnostics summarize counts per tier and every degradation reason
- **AND** no degraded feature appears as successfully parametric

### Requirement: Sketches SHALL import entities seeded from Onshape's solved state
The provider SHALL translate supported sketch entity kinds (line, circle, arc, point) into the cadara sketch contract, seed entity geometry from Onshape's captured solved positions (projected onto the target datum plane), and preserve construction flags.

> **v1 scope amendment (2026-07-06):** constraint and derivation (MIRROR/LINEAR_PATTERN/OFFSET) translation is **deferred**. v1 imports entities at their solved positions as the correctness floor (the sketch is geometrically correct but under-constrained). Carrying constraints/derivations across requires operand-reference resolution and is tracked as a fast-follow; until then the imported sketch's relationships are not reconstructed.

#### Scenario: Sketch entities translate at solved positions
- **WHEN** a captured sketch contains supported entity kinds
- **THEN** the committed sketch contains the corresponding cadara entities (including construction flags) with geometry seeded from Onshape's solved positions

#### Scenario: Solved state seeds the solver
- **WHEN** a translated sketch is committed and solved
- **THEN** entity geometry is initialized from Onshape's captured solved positions
- **AND** a solved-state deviation beyond tolerance is reported as a sketch diagnostic in the fidelity report

#### Scenario: Derivations deferred (v1)
- **WHEN** a captured sketch contains MIRROR/LINEAR_PATTERN/OFFSET records
- **THEN** their output geometry imports as plain entities at the captured solved positions (deferred: the associative relationship is not reconstructed in v1)

#### Scenario: Unsupported entity kind
- **WHEN** a captured sketch contains an entity kind outside the cadara vocabulary
- **THEN** the sketch imports without it, with a structured diagnostic naming the entity and kind

### Requirement: Variables and expressions SHALL translate with literal fallback
The provider SHALL import `assignVariable` features as document variables before dependent actions, and SHALL translate unit-bearing Onshape expressions into cadara's expression grammar, falling back to the captured evaluated literal with a diagnostic when translation is impossible.

#### Scenario: Variable-referencing dimension
- **WHEN** a feature parameter or sketch dimension uses an expression referencing an Onshape variable
- **THEN** the imported value is an expression referencing the imported document variable
- **AND** changing the variable in cadara re-drives the imported value

#### Scenario: Untranslatable expression
- **WHEN** an expression uses constructs cadara's grammar does not support
- **THEN** the value imports as the captured evaluated literal
- **AND** a diagnostic records the original expression and the lost parametricity

### Requirement: Topological references SHALL resolve by signature matching or degrade explicitly
The provider SHALL resolve captured deterministic-ID signatures against staged-rebuild topology via the history evaluation probe, walking history in order; ambiguous or failed matches SHALL degrade the consuming feature to `baked` with a reason code and SHALL NOT guess.

#### Scenario: Unique signature match
- **WHEN** a captured signature matches exactly one probe entity within tolerance at the relevant history step
- **THEN** the reference resolves to that entity's durable reference and the feature stays `parametric`

#### Scenario: Ambiguous match
- **WHEN** multiple probe entities match within tolerance
- **THEN** the consuming feature degrades to `baked` with an ambiguity reason code naming the candidates

#### Scenario: Bundle-side unresolved reference
- **WHEN** the bundle records a deterministic ID as unresolved at capture time
- **THEN** the consuming feature is planned as `baked` without invoking the probe for that reference

#### Scenario: Probe unavailable
- **WHEN** the platform capabilities lack the history probe
- **THEN** features requiring topological reference resolution plan as `baked` with a capability reason code
- **AND** features without topological references still plan as `parametric`

### Requirement: Imported results SHALL be verified against captured ground truth
The provider SHALL compare the staged rebuild of the planned import against the bundle's captured tessellation and report the deviation in the review form before commit, when the platform provides the sandboxed history evaluation capability; when it does not, the review SHALL state that verification is unavailable rather than implying it passed.

#### Scenario: Rebuild matches ground truth
- **WHEN** the staged rebuild deviates from captured tessellation within tolerance
- **THEN** the review reports the deviation summary as passing

#### Scenario: Rebuild deviates
- **WHEN** the staged rebuild deviates beyond tolerance or a feature fails to rebuild
- **THEN** the review identifies the diverging features and their deviation
- **AND** the user can demote them to `baked` or abort before any commit

#### Scenario: Verification capability unavailable
- **WHEN** the platform capabilities lack the sandboxed history evaluation probe
- **THEN** the review reports ground-truth verification as explicitly unavailable
- **AND** no deviation result is fabricated or implied as passing

### Requirement: Onshape imports SHALL emit history-ordered actions and standard bindings
The provider SHALL emit prepared actions in Onshape history order using the ordered action sequence, preserve suppression state, and attach a standard local-file binding with the bundle fingerprint and capture provenance.

#### Scenario: Interleaved history preserved
- **WHEN** the Onshape history interleaves sketches, features, and variables
- **THEN** the ordered action sequence reproduces that order
- **AND** the committed cadara feature tree lists entries in the same order as Onshape's

#### Scenario: Suppressed features
- **WHEN** a captured feature is suppressed in Onshape
- **THEN** it imports suppressed rather than being dropped or activated

#### Scenario: Refresh from re-captured bundle
- **WHEN** the user refreshes the import and selects a newer capture bundle of the same document
- **THEN** the standard fingerprint comparison and provider pipeline re-run applies
- **AND** the binding records the new capture provenance

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

### Requirement: Bake cascades SHALL propagate along real dependencies only
The planner SHALL mark a feature `downstream-of-baked` only when at least one of its resolved inputs — owning sketch, profile region source, deferred body lineage, or explicit upstream reference — is baked-tier or belongs to a baked lineage; features on independent branches SHALL keep their own tier.

#### Scenario: Independent branch stays parametric
- **WHEN** a history contains a baked branch followed by a parametric sketch whose consuming extrude references only that sketch and a standalone scope
- **THEN** the sketch and extrude plan `parametric`
- **AND** carry no `downstream-of-baked` reason

#### Scenario: True dependent still bakes
- **WHEN** a feature's owning sketch, region source, or body lineage is baked
- **THEN** it plans `baked` with `downstream-of-baked`

#### Scenario: Baked branch does not distort boolean candidate counting
- **WHEN** a default-scope boolean's upstream could include a body from a baked lineage
- **THEN** the consumer remains probe-gated rather than resolving against the only visible parametric candidate
- **AND** the reason code reflects the scope ambiguity, not a region problem

### Requirement: Baked-tier plans SHALL materialize ground-truth geometry
When a studio plan contains baked-tier features, the provider SHALL bake the bundle's ground-truth tessellation through `bakeGeometry` and emit a `bakedBody` feature action so the imported document contains the correct final geometry, while degraded source features remain listed with their reason codes.

#### Scenario: Complex model imports with visible geometry
- **WHEN** a bundle whose plan requires a studio bake is imported on a platform with baking support
- **THEN** the committed document contains only the baked body set for the imported final studio geometry, rather than duplicate live parametric outputs
- **AND** parametric-tier features remain in history for editability and fidelity reporting
- **AND** the `onshape-bake-unavailable` diagnostic is not emitted

#### Scenario: Baking capability absent
- **WHEN** the platform cannot bake the available ground-truth formats
- **THEN** the provider falls back to the previous behavior: suppressed features plus an explicit bake-unavailable diagnostic

#### Scenario: Bake provenance is recorded
- **WHEN** a baked body is emitted
- **THEN** its label and provenance identify the source Onshape studio and the feature span it stands in for

### Requirement: Final-studio bakes SHALL explicitly supersede imported body outputs
When Onshape emits a whole-studio final tessellation bake, the prepared `bakedBody` action SHALL declare a deferred replacement scope over prior `createFeature` outputs in that import's ordered action span. Apply-time materialization SHALL resolve that scope to durable body IDs; it SHALL NOT predict IDs, infer correspondence from geometry, or target bodies outside the import span.

#### Scenario: Ground-truth body membership is preserved
- **GIVEN** captured tessellation provides multiple `bodies[]` groups
- **WHEN** the provider bakes the studio geometry
- **THEN** the baked asset contains one explicit, ordered triangle range per captured body group
- **AND** body membership is not reconstructed from mesh geometry

### Requirement: Onshape construction planes SHALL translate to parametric plane features
The provider SHALL translate an Onshape `cPlane` history entry into a cadara `plane` feature at the `parametric` tier when the plane's geometry is recoverable from the bundle (captured reference signature, supported offset/coplanar parameters) or from probe-rebuilt topology, and SHALL record a reason code naming the recovery source. A `cPlane` whose geometry cannot be recovered SHALL stay `baked` with the existing degradation reporting.

#### Scenario: cPlane with a captured planar reference translates
- **WHEN** a `cPlane` entry's defining reference resolves to a captured planar face signature with origin and normal
- **THEN** the plan marks the entry `parametric` and prepare emits a `plane` feature action whose definition reproduces the captured frame
- **AND** the reason code identifies the captured-frame recovery source

#### Scenario: Unrecoverable cPlane stays baked
- **WHEN** a `cPlane` entry's defining geometry cannot be recovered from capture or probe
- **THEN** the plan marks it `baked` with a reason code identifying the unrecoverable input
- **AND** its dependent sketches degrade through the existing bake cascade

### Requirement: Sketch supports on translated planes SHALL resolve through deferred construction references
The provider SHALL make a sketch placed on a translated Onshape construction plane reference that plane through a deferred construction reference to the plane feature's prepared action, resolved by the orchestrator at apply time. The provider SHALL NOT emit any sketch-plane support that does not resolve to a construction or face the prepared-action sequence creates or the document already contains.

#### Scenario: Sketch on a translated cPlane commits parametrically
- **WHEN** the ordered actions contain a translated `plane` feature followed by a sketch commit whose plane support is a deferred construction reference to it
- **THEN** the orchestrator substitutes the construction id the plane feature produced before applying the sketch commit
- **AND** the committed sketch's support resolves in the kernel authoring state

#### Scenario: No fabricated construction supports ship
- **WHEN** prepare completes for any studio
- **THEN** no prepared sketch commit carries a construction support id that no prepared action produces
- **AND** a sketch whose plane cannot be legitimately referenced degrades to `baked` instead

