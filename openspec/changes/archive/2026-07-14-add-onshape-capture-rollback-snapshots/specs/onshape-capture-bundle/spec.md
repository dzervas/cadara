## ADDED Requirements

### Requirement: References SHALL resolve at their consuming history point when final-state resolution fails
The capture CLI SHALL re-evaluate deterministic IDs that fail final-state resolution with the rollback bar positioned immediately before the consuming feature, on a temporary branch, recording `evaluatedAt: "historyPoint"` with the feature id; only IDs unresolvable at both states SHALL remain `unresolved`.

#### Scenario: Mid-history-consumed face resolves
- **WHEN** a chamfer references a face that a later feature destroys
- **THEN** final-state resolution fails but history-point resolution records the face's signature as of the chamfer's position
- **AND** the record carries `evaluatedAt: "historyPoint"` and the consuming feature id

#### Scenario: Genuinely unresolvable ID
- **WHEN** an ID resolves at neither the final state nor its consuming history point
- **THEN** it is recorded `unresolved` with both attempts' structured reasons

### Requirement: Rollback captures SHALL never mutate the user's workspace
All rollback-bar movement SHALL occur on a temporary branch created from the captured microversion and deleted after capture; failures SHALL abort with cleanup, and a cleanup failure SHALL be reported loudly with the branch id.

#### Scenario: Capture completes
- **WHEN** a v2 capture finishes
- **THEN** the source workspace's rollback bar, history, and microversion are untouched
- **AND** the temporary branch is deleted

#### Scenario: Capture aborts mid-rollback
- **WHEN** a request fails while the temporary branch's rollback bar is moved
- **THEN** the CLI attempts branch deletion, reports the failure per the no-partial-output policy
- **AND** if deletion also fails, the error output names the leftover branch id

#### Scenario: Branch rights unavailable
- **WHEN** the credentials cannot create a branch on the document
- **THEN** capture degrades to v1 behavior (final-state resolution only) with an explicit diagnostic in the bundle
- **AND** the capture still succeeds

### Requirement: Bundles MAY carry per-feature rollback snapshots under format version 2
With the opt-in flag, the CLI SHALL populate `rollbackSnapshots` with per-solid-feature tessellated geometry (and STEP when available) captured on the temporary branch, and the bundle SHALL declare `formatVersion: 2`; consumers reading v1 bundles SHALL be unaffected.

#### Scenario: Opt-in snapshot capture
- **WHEN** the user passes the rollback-snapshots flag
- **THEN** each solid feature's post-feature geometry is embedded with its feature id and tolerance

#### Scenario: Default capture stays cheap
- **WHEN** the flag is absent
- **THEN** `rollbackSnapshots` stays null and request volume matches v1 plus only failure-triggered history-point resolutions

#### Scenario: Version negotiation
- **WHEN** a consumer validates a bundle
- **THEN** `formatVersion` 1 and 2 both validate against their respective schemas
- **AND** unknown future versions are rejected with a structured error
