## ADDED Requirements

### Requirement: Rebuilds SHALL produce feature-scoped partial snapshots for repairable failures
The modeling contract SHALL return a generated snapshot containing every feature result that can be safely rebuilt when repairable feature failures are present, while preserving the complete authored document history and attaching diagnostics to failed features and authored fields.

#### Scenario: Reload renders all safe feature results
- **WHEN** startup rebuilds an authored document whose feature history contains one or more repairable feature failures
- **THEN** the returned snapshot renders geometry from every feature that can be safely evaluated without depending on failed outputs
- **AND** rebuild does not fabricate geometry for failed or dependency-blocked features
- **AND** the complete authored feature history remains available in the snapshot for repair

#### Scenario: Reload reports independent later failures
- **WHEN** startup rebuilds a document with multiple broken later features whose invalid fields can be evaluated independently
- **THEN** the returned diagnostics include each independently discoverable feature error in one reload pass
- **AND** diagnostics are not limited to the first failed feature

#### Scenario: Failed feature receives field diagnostic
- **WHEN** a feature rebuild fails because one authored reference or parameter is invalid
- **THEN** the modeling diagnostic identifies the owning feature
- **AND** the diagnostic identifies the authored field or field path that must be corrected
- **AND** the primary message describes the incorrect feature field rather than a raw topology or storage id

#### Scenario: Dependent later feature is blocked
- **WHEN** a later feature depends on geometry or topology that a failed earlier feature did not produce
- **THEN** rebuild reports that later feature as dependency-blocked with an owning feature diagnostic
- **AND** it does not report successful geometry for the blocked feature

#### Scenario: Low-level reference remains debug context only
- **WHEN** a low-level failure includes a missing body, face, edge, vertex, sketch entity, or other durable id
- **THEN** that id may be retained in structured diagnostic context
- **AND** the user-facing summary and repair guidance describe the feature field to fix

#### Scenario: Repair replaces partial snapshot
- **WHEN** the user fixes the failed feature field and rebuild succeeds
- **THEN** the modeling contract returns a normal generated snapshot for the current authored history
- **AND** stale repair diagnostics for the fixed feature are removed
