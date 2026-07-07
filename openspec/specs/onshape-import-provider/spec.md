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
