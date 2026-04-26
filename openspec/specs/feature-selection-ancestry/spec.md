# feature-selection-ancestry Specification

## Purpose
TBD - created by archiving change highlight-history-from-geometry-selection. Update Purpose after archive.
## Requirements
### Requirement: Selectable body topology SHALL expose contributing feature ancestry
The rebuilt snapshot SHALL expose, for each selectable body, face, edge, and vertex target, an authored-order list of committed feature ids that contributed to that specific topology so selection-driven history highlighting does not rely on coarse body ownership alone.

#### Scenario: Inner shell face exposes shell and extrude ancestry
- **WHEN** a cube is created by `Extrude` and later hollowed by `Shell`
- **AND** the rebuilt snapshot surfaces a selectable inner shell face
- **THEN** that face's contributor ancestry includes the base `Extrude` feature and the later `Shell` feature in authored-history order

#### Scenario: Preserved back face remains extrude-only
- **WHEN** a cube is created by `Extrude` and later hollowed by `Shell`
- **AND** the selected back face survives the shell operation as a unique successor without becoming shell-created topology
- **THEN** that face's contributor ancestry includes the `Extrude` feature
- **AND** it does not include the `Shell` feature

#### Scenario: Reload preserves contributor ancestry
- **WHEN** a document containing applied `Extrude` and `Shell` features is reloaded and rebuilt from authored history
- **THEN** the same selectable topology targets expose the same contributor ancestry as before reload

