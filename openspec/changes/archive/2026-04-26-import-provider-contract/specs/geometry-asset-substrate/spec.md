## MODIFIED Requirements

### Requirement: Authored documents SHALL reference immutable geometry assets
The system SHALL represent imported or generated geometry bytes as immutable content-addressed assets referenced by the authored model document. Asset provenance records for imported assets SHALL optionally carry import binding metadata describing the external source origin, fingerprint, and refresh policy.

#### Scenario: Asset manifest references geometry bytes
- **WHEN** an authored document contains geometry-backed imported or baked bodies
- **THEN** the document includes asset manifest records with stable asset id, content hash, byte length, format, media type, and provenance
- **AND** raw geometry bytes are not stored directly in feature definitions, render records, or OCC runtime state fields

#### Scenario: Imported asset carries binding metadata
- **WHEN** a geometry asset is created through the import provider pipeline from a source that supports refresh
- **THEN** the asset's provenance record includes an optional `importBinding` field with the source origin kind, fingerprint, display path hint or URL, and refresh policy
- **AND** the binding metadata is persisted as part of the asset provenance in the authored document

#### Scenario: Imported asset without binding
- **WHEN** a geometry asset is created through the import provider pipeline from a one-shot source with no refresh support
- **THEN** the asset's provenance record has no `importBinding` field
- **AND** the asset is treated identically to any other imported asset for restore and validation purposes
