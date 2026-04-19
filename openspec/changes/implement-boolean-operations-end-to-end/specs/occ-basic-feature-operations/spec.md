## ADDED Requirements

### Requirement: OCC-backed Combine SHALL execute body boolean operations
The OpenCascade-backed adapter SHALL preview, commit, and rebuild Combine add, subtract, and intersect operations against explicit durable body participants.

#### Scenario: OCC previews Combine add
- **WHEN** a Combine preview requests `add` with valid target and tool bodies
- **THEN** the adapter returns transient fused geometry and no failed diagnostic

#### Scenario: OCC commits Combine subtract
- **WHEN** a Combine commit requests `subtract` with valid target and tool bodies
- **THEN** the adapter rebuilds the owning body result by cutting the tool bodies from the target bodies
- **AND** the committed result is visible in the returned snapshot

#### Scenario: OCC commits Combine intersect
- **WHEN** a Combine commit requests `intersect` with valid target and tool bodies
- **THEN** the adapter rebuilds the result from the common volume of the selected bodies
- **AND** empty intersections are reported as diagnostics instead of successful no-op commits

#### Scenario: OCC rebuilds committed Combine after refresh
- **WHEN** a persisted document containing a committed Combine feature is rebuilt
- **THEN** the OCC adapter re-executes the Combine feature from its durable participant references and operation intent
- **AND** the rebuilt body output matches the committed feature order

