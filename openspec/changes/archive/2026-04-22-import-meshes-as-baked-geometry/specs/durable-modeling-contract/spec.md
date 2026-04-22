## ADDED Requirements

### Requirement: Baked mesh imports SHALL expose durable body topology
The modeling contract SHALL expose accepted mesh import results as durable body topology derived from the baked geometry asset.

#### Scenario: Restore baked mesh import
- **WHEN** a document containing an accepted mesh import is restored
- **THEN** the snapshot contains durable body targets for the baked geometry result
- **AND** no durable target requires access to the original STL or 3MF source file
