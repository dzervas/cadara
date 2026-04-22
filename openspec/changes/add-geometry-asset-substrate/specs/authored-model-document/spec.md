## ADDED Requirements

### Requirement: Authored documents SHALL carry a geometry asset manifest
The authored model document contract SHALL include a versioned geometry asset manifest for immutable imported or generated geometry assets.

#### Scenario: Parse document without assets
- **WHEN** an existing authored model document has no geometry asset manifest
- **THEN** migration normalizes it with an empty asset manifest
- **AND** existing sketches, features, history order, cursor, variables, and body labels are preserved

#### Scenario: Parse document with asset manifest
- **WHEN** an authored model document includes geometry asset records
- **THEN** runtime validation accepts only records with valid ids, hashes, byte lengths, formats, and provenance values
- **AND** validation rejects duplicate asset ids with conflicting content metadata
