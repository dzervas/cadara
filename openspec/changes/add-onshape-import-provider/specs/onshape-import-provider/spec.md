## ADDED Requirements

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

### Requirement: Sketches SHALL import with entities, constraints, derivations, and Onshape's solved state
The provider SHALL translate sketch entities and constraints into the cadara sketch contract, map MIRROR/LINEAR_PATTERN/OFFSET records onto sketch derivations, and seed entity geometry from Onshape's solved positions.

#### Scenario: Sketch entities and constraints translate
- **WHEN** a captured sketch contains supported entities and constraints
- **THEN** the committed sketch contains the corresponding cadara entities (including construction flags) and constraint definitions with correctly parsed operand references

#### Scenario: Solved state seeds the solver
- **WHEN** a translated sketch is committed and solved
- **THEN** entity geometry is initialized from Onshape's captured solved positions
- **AND** a solved-state deviation beyond tolerance is reported as a sketch diagnostic in the fidelity report

#### Scenario: Offset derivation unavailable
- **WHEN** an OFFSET record is translated before the offset sketch derivation capability exists
- **THEN** the offset outputs import as plain entities at their captured solved positions
- **AND** a structured diagnostic records the lost associativity

#### Scenario: Unsupported entity kind
- **WHEN** a captured sketch contains an entity kind outside the cadara vocabulary
- **THEN** the sketch imports without it, with a structured diagnostic naming the entity and kind
- **AND** constraints referencing it are dropped with linked diagnostics rather than left dangling

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
The provider SHALL compare the staged rebuild of the planned import against the bundle's captured tessellation and report the deviation in the review form before commit.

#### Scenario: Rebuild matches ground truth
- **WHEN** the staged rebuild deviates from captured tessellation within tolerance
- **THEN** the review reports the deviation summary as passing

#### Scenario: Rebuild deviates
- **WHEN** the staged rebuild deviates beyond tolerance or a feature fails to rebuild
- **THEN** the review identifies the diverging features and their deviation
- **AND** the user can demote them to `baked` or abort before any commit

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
