# collaborative-authored-document Specification

## Purpose
TBD - created by archiving change prepare-document-repository-for-multiplayer-sync. Update Purpose after archive.
## Requirements
### Requirement: Concurrent authored records SHALL use stable durable identity
The authored document model SHALL identify sketches, features, variables, bodies, constructions, and labels by stable durable IDs rather than array index or current rendered order.

#### Scenario: Two peers insert features concurrently
- **WHEN** two peers create new features concurrently from the same base document state
- **THEN** each feature keeps a distinct durable feature ID after merge
- **AND** rebuild logic does not infer identity from the feature's current array position

#### Scenario: Peer deletes a referenced item
- **WHEN** a merged authored document contains a feature reference to an item deleted by another peer
- **THEN** the modeling boundary reports an invalid-reference diagnostic rather than silently remapping the reference

### Requirement: Concurrent feature order SHALL be deterministic
The authored document model SHALL define deterministic ordering behavior for concurrently inserted, moved, or deleted feature records so rebuild order is stable for all peers.

#### Scenario: Concurrent insertions target the same cursor
- **WHEN** two peers insert features at the same cursor position concurrently
- **THEN** all peers converge on the same deterministic feature order
- **AND** the ordering rule is independent of UI render timing

#### Scenario: Feature is moved and deleted concurrently
- **WHEN** one peer moves a feature while another peer deletes that same feature
- **THEN** the merged authored document does not keep an order entry for a missing feature
- **AND** any affected rebuild diagnostics identify the deleted feature reference

### Requirement: Concurrent scalar edits SHALL have explicit merge semantics
The authored document model SHALL define explicit semantics for concurrent scalar edits such as labels, variable names, variable value text, settings, and cursor state.

#### Scenario: Concurrent rename targets same feature
- **WHEN** two peers rename the same feature concurrently
- **THEN** the system converges on one deterministic stored label or surfaces a merge diagnostic that identifies the concurrent label conflict

#### Scenario: Concurrent cursor updates occur
- **WHEN** two peers move the feature cursor concurrently
- **THEN** the merged document has a deterministic cursor value
- **AND** the modeling boundary validates that the cursor target still exists before using it for rebuild

### Requirement: Semantic merge diagnostics SHALL be explicit
The system SHALL report diagnostics when a structurally merged authored document cannot be fully accepted by CAD rebuild semantics.

#### Scenario: Merged document fails rebuild validation
- **WHEN** peer-originated authored changes merge successfully but produce an invalid feature dependency, missing cursor target, unresolved variable cycle, or invalid durable reference
- **THEN** the modeling boundary reports explicit merge or rebuild diagnostics
- **AND** it does not silently delete, reorder, or retarget authored records to hide the conflict

