## MODIFIED Requirements

### Requirement: Prepared actions MAY carry deferred output references resolved at apply time
The import contract SHALL support typed deferred references inside prepared actions that stand in for apply-time outputs of earlier actions in the ordered sequence: the sketch id allocated by an earlier sketch commit, a region of that committed sketch selected by an interior-point selector, a body created by an earlier feature action, and a construction created by an earlier feature action. The orchestrator SHALL substitute concrete values before applying each consuming action. Providers that emit no deferred references SHALL observe no behavior change.

#### Scenario: Extrude consumes a region of an earlier sketch commit
- **WHEN** an ordered sequence contains a sketch commit followed by a feature action whose profile is a deferred region reference to that commit with an interior-point selector
- **THEN** the orchestrator applies the sketch commit, extracts regions from the committed solved state through the same region-extraction seam interactive authoring uses, selects the region containing the interior point (innermost on nested containment)
- **AND** applies the feature action with the concrete `{ sketchId, regionId }` substituted

#### Scenario: Boolean scope consumes an earlier created body
- **WHEN** a feature action's boolean scope is a deferred body reference to an earlier feature action in the sequence
- **THEN** the orchestrator substitutes the body id that action's application created before applying the consumer

#### Scenario: Sketch plane support consumes an earlier created construction
- **WHEN** a sketch commit's plane support is a deferred construction reference to an earlier feature action that produces a construction target
- **THEN** the orchestrator substitutes the construction id that action's application created before applying the sketch commit

#### Scenario: Invalid deferred reference is rejected before any mutation
- **WHEN** a deferred reference points forward in the sequence, at an action of the wrong kind, or out of bounds
- **THEN** validation fails before any action applies
- **AND** no partial import is committed

#### Scenario: Deferred reference fails to resolve at apply time
- **WHEN** a deferred reference cannot be resolved during the apply walk (no region contains the selector point, or the referenced action produced no such output)
- **THEN** the import fails atomically through the existing rollback
- **AND** the diagnostic names the consuming action, the reference, and the selector
- **AND** no substitute value is guessed

#### Scenario: Provider emits no deferred references
- **WHEN** prepared actions contain only fully-formed requests
- **THEN** application proceeds exactly as before this capability existed
