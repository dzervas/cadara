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

## MODIFIED Requirements

### Requirement: Import capabilities SHALL offer a sandboxed history evaluation probe
`ImportCapabilities` SHALL provide a history evaluation probe that executes a candidate ordered action sequence in a sandboxed kernel session and returns per-step topology signatures and diagnostics, without mutating any document, history, or persistent state. Because each evaluation rebuilds its whole prefix in a fresh isolated session, the probe is a pure function of the prepared-action payload it runs, and a review SHALL evaluate each distinct payload at most once per plan — including a payload whose evaluation fails or throws, which SHALL be retained until the review's containment pass has run against a changed plan.

#### Scenario: Provider probes a candidate history during review
- **WHEN** a provider invokes the history probe with a candidate ordered action sequence during `review()` or `prepare()`
- **THEN** the probe rebuilds the sequence in an isolated kernel session on the existing kernel worker path
- **AND** returns, per step, the resulting topology signatures (entity class, geometry type, defining data, centroid, bounding box)
- **AND** no authored document, operation history, or undo state is affected

#### Scenario: Probe step fails to rebuild
- **WHEN** a step in the probed sequence fails in the kernel
- **THEN** the probe returns structured diagnostics for that step and the completed prefix results
- **AND** the failure is not thrown away or silently swallowed

#### Scenario: The same unbuildable prefix is probed by several consumers
- **WHEN** one review probes the identical prepared-action payload more than once within a single planning pass and its evaluation fails or throws
- **THEN** every later request for that payload is answered with the retained failure instead of rebuilding it in the kernel again

#### Scenario: The containment pass revisits a failed prefix
- **WHEN** the review's containment pass has run against a changed plan after a probe failure
- **THEN** the retained failures are released, so the contained plan reaches the kernel again even when it reproduces an identical payload
- **AND** successful evaluations stay retained for the whole review

#### Scenario: Probe is unavailable on the platform
- **WHEN** the injected capabilities do not support history probing
- **THEN** the capability is explicitly absent rather than a stub that fabricates signatures
- **AND** providers can detect the absence and degrade their planning accordingly
