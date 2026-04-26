## ADDED Requirements

### Requirement: Consumed committed sketches SHALL auto-hide by default
The workbench SHALL treat a committed sketch as hidden by default when the current applied document state includes a profile-based feature that consumes one or more profiles owned by that sketch.

#### Scenario: Successful profile-based feature commit auto-hides the source sketch
- **WHEN** a profile-based feature commit is accepted and the applied result consumes one or more profiles owned by a committed sketch
- **THEN** that sketch's viewport geometry is excluded from render, hover, and selection output
- **AND** the sketch row remains present in `Parts & Objects` with hidden-state treatment

#### Scenario: Reload auto-hides a previously consumed sketch again
- **WHEN** the workbench reloads or rebuilds a document whose applied history already contains a profile-based feature that consumes a committed sketch
- **THEN** that sketch is again treated as hidden by default in both the viewport and `Parts & Objects`

### Requirement: Auto-hidden sketches SHALL remain manually showable
The workbench SHALL allow the user to show an auto-hidden committed sketch again from `Parts & Objects` without editing or removing the consuming feature.

#### Scenario: User shows an auto-hidden consumed sketch
- **WHEN** the user activates the visibility control for an auto-hidden committed sketch row in `Parts & Objects`
- **THEN** that sketch's viewport geometry is restored to render, hover, and selection output
- **AND** the row returns to visible-state treatment

#### Scenario: Reload reapplies auto-hide after a manual show
- **WHEN** the user previously showed an auto-hidden consumed sketch during the session
- **AND** the document is later reloaded from authored state
- **THEN** the consumed sketch is treated as hidden by default again
