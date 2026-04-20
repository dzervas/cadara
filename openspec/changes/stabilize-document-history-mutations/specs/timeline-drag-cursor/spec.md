## ADDED Requirements

### Requirement: Timeline cursor drag SHALL commit through editor runtime
The timeline cursor drag interaction SHALL commit document cursor changes by dispatching an editor document cursor request for the snapped target position.

#### Scenario: Drag completes at a new cursor position
- **WHEN** the user releases the timeline cursor handle at a snapped valid cursor position different from the current cursor
- **THEN** the timeline dispatches an editor document cursor request for that cursor
- **AND** it does not directly call the modeling service cursor mutation

#### Scenario: Drag completes at the existing cursor position
- **WHEN** the user releases the timeline cursor handle at the current cursor position
- **THEN** no document cursor mutation is requested

### Requirement: Timeline cursor SHALL not issue overlapping cursor mutations
The timeline SHALL avoid issuing another document cursor request while a previous document cursor mutation or its required follow-up snapshot refresh is pending.

#### Scenario: Drag starts while cursor move is pending
- **WHEN** a document cursor mutation is pending
- **THEN** the timeline cursor handle is not available for a second committed cursor mutation

#### Scenario: Refresh completes after cursor move
- **WHEN** the follow-up snapshot for an accepted cursor move has loaded
- **THEN** the timeline cursor handle can again request a document cursor move based on the refreshed history state
