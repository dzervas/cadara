## ADDED Requirements

### Requirement: Repository freshness SHALL compare against the mutation basis
For repository-backed documents, the modeling service SHALL detect authored-document freshness conflicts by comparing current repository metadata with the repository heads supplied by the mutation basis.

#### Scenario: Mutation basis heads are stale
- **WHEN** a modeling mutation supplies repository heads from an older snapshot
- **AND** the repository's current heads differ from those basis heads
- **THEN** the modeling service rejects the mutation with a repository-head conflict diagnostic
- **AND** it does not persist stale authored document state

#### Scenario: Mutation basis heads are current
- **WHEN** a modeling mutation supplies repository heads that match the repository's current heads
- **THEN** repository freshness does not reject the mutation

#### Scenario: Repository provenance is absent
- **WHEN** a modeling mutation does not include repository heads because the snapshot was not repository-backed
- **THEN** repository freshness checks do not reject the mutation solely because no heads were supplied

### Requirement: Repository cursor conflict recovery SHALL preserve authored history
After a stale cursor mutation is rejected and the editor refreshes, retrying cursor movement SHALL preserve the complete authored document timeline.

#### Scenario: Refresh after stale cursor mutation
- **WHEN** a stale document cursor mutation is rejected for a repository-head conflict
- **AND** the editor refreshes the document snapshot
- **THEN** the refreshed snapshot exposes the complete authored history order
- **AND** future authored sketches and features after the cursor remain available for redo navigation

#### Scenario: Retried cursor mutation after refresh
- **WHEN** the user retries document cursor movement after the refreshed snapshot is loaded
- **THEN** the cursor mutation uses the refreshed repository heads
- **AND** the mutation does not overwrite future authored history with an applied-only snapshot prefix
