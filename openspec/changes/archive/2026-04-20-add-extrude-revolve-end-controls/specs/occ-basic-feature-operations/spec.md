## ADDED Requirements

### Requirement: OCC-backed extrude SHALL execute advanced end conditions
The OpenCascade adapter SHALL preview, commit, and rebuild extrude features using advanced end conditions and explicit extent modes.

#### Scenario: OCC executes up-to-next extrude
- **WHEN** an extrude preview or commit uses `upToNext`
- **THEN** the adapter determines the next terminating face or faces in the extrude direction and builds the resulting geometry
- **AND** if the feature cannot completely terminate, the adapter returns structured diagnostics instead of committing a partial result

#### Scenario: OCC executes up-to extrude with offset
- **WHEN** an extrude preview or commit uses an up-to end condition with an offset
- **THEN** the adapter terminates against the requested up-to geometry and applies the authored offset in the requested offset direction
- **AND** if the offset makes the result impossible or ambiguous, the adapter returns structured diagnostics instead of committing a partial result

#### Scenario: OCC executes through-all extrude
- **WHEN** an extrude preview or commit uses `throughAll`
- **THEN** the adapter builds an extent that pierces all applicable geometry in front of the profile along the extrude direction

#### Scenario: OCC executes drafted two-side extrude
- **WHEN** an extrude preview or commit uses `twoSide` with draft on one or both ends
- **THEN** the adapter builds both extents with their own authored end and draft values

### Requirement: OCC-backed revolve SHALL execute advanced end conditions
The OpenCascade adapter SHALL preview, commit, and rebuild revolve features using full, blind, and up-to angular end conditions.

#### Scenario: OCC executes full revolve
- **WHEN** a revolve preview or commit uses full revolve
- **THEN** the adapter revolves the selected profile 360 degrees around the explicit axis

#### Scenario: OCC executes up-to revolve
- **WHEN** a revolve preview or commit uses an up-to end condition
- **THEN** the adapter computes angular termination around the explicit axis and either builds the resulting geometry or returns a structured diagnostic for ambiguous or impossible termination

#### Scenario: OCC executes up-to revolve with offset
- **WHEN** a revolve preview or commit uses an up-to end condition with angular offset
- **THEN** the adapter computes angular termination around the explicit axis and applies the authored offset before building the result

### Requirement: Advanced extent results SHALL preserve durable modeling behavior
Advanced extrude and revolve previews, commits, rebuilds, snapshots, and edit hydration SHALL preserve feature identity, produced targets, boolean scope behavior, and topology diagnostics consistently with existing basic feature operations.

#### Scenario: Advanced extent feature is edited
- **WHEN** the user edits an existing advanced extrude or revolve feature
- **THEN** the editor hydrates the original extent mode, end conditions, draft values, targets, operation, and boolean scope from the durable feature definition

#### Scenario: Advanced extent feature rebuilds after history replay
- **WHEN** operation history replays an advanced extrude or revolve feature
- **THEN** the adapter rebuilds from the authored extent contract rather than inferred UI state
