## ADDED Requirements

### Requirement: Direct constrained drag SHALL use warm-started interactive solves
The editor SHALL use warm-started interactive solve sessions for constrained direct sketch drags when the active sketch has supported constraints or dimensions.

#### Scenario: Constrained drag begins
- **WHEN** the user begins dragging a constrained editable sketch point
- **THEN** the editor starts an interactive solve session using the current active sketch definition, projected references, tolerances, and most recent compatible solved state

#### Scenario: Constrained drag moves
- **WHEN** the user moves the pointer during an active constrained sketch drag
- **THEN** the editor submits the latest projected sketch-plane target to the active interactive solve session
- **AND** accepted solved point positions update the sketch draft without rebuilding unrelated solver components

#### Scenario: Constrained drag ends
- **WHEN** the user releases the pointer after an active constrained sketch drag
- **THEN** the editor finalizes the latest accepted interactive solve result or leaves the draft unchanged if the final target is blocked
- **AND** the interactive solve session is no longer updated after the drag lifecycle ends

### Requirement: Unaffected sketch components SHALL remain stable during direct drag
Direct sketch drag editing SHALL preserve solved values for independent unaffected sketch components while solving the component affected by the drag.

#### Scenario: User drags one of two independent constrained profiles
- **WHEN** the active sketch contains two independent constrained profiles and the user drags a point in one profile
- **THEN** the dragged profile updates through the solver-backed direct edit path
- **AND** points and entities in the independent profile keep their previous solved positions

#### Scenario: Drag is blocked by affected component only
- **WHEN** a direct drag target cannot be satisfied because of constraints in the affected component
- **THEN** the editor shows constrained-movement feedback
- **AND** independent unaffected components are not re-solved or moved

### Requirement: Live region extraction SHALL be deferred during active drag movement
Active sketch editing SHALL defer live region extraction during rapid direct drag movement and SHALL refresh regions after the sketch becomes static, at drag end, or before profile-dependent workflows consume regions.

#### Scenario: Drag updates arrive rapidly
- **WHEN** direct sketch drag updates continue arriving before the live-region debounce interval elapses
- **THEN** the editor updates solved sketch geometry for accepted drag frames
- **AND** it does not run region extraction for every accepted drag frame

#### Scenario: Drag becomes static
- **WHEN** the sketch has no new accepted drag update for the configured live-region debounce interval
- **THEN** the editor refreshes live derived regions from the latest solved sketch state

#### Scenario: Profile workflow needs current regions
- **WHEN** a profile-dependent workflow such as feature selection or sketch commit requires current derived regions while a debounced refresh is pending
- **THEN** the editor derives regions immediately from the latest solved sketch state before that workflow consumes them

### Requirement: Deferred region diagnostics SHALL remain available after refresh
The editor SHALL preserve live region diagnostics from deferred region extraction once the refresh runs.

#### Scenario: Open profile remains after drag settles
- **WHEN** a direct sketch drag leaves an open boundary and live region extraction runs after the debounce interval or drag end
- **THEN** the editor exposes the corresponding region diagnostic for viewport feedback

#### Scenario: Blocked drag leaves prior region state intact
- **WHEN** a direct sketch drag update is blocked and the sketch draft does not change
- **THEN** the editor does not replace current live regions with diagnostics from invalid unaccepted geometry
