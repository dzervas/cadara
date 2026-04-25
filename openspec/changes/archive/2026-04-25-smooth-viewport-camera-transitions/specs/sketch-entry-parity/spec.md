## ADDED Requirements

### Requirement: Sketch camera transitions SHALL stay consistent across entry points
The system MUST use the same camera-capture and animated framing contract whether a sketch session starts from a construction plane, a planar face, the feature tree, or a reopen interaction for an existing sketch.

#### Scenario: Compare viewport and feature-tree sketch entry
- **WHEN** the user opens equivalent sketch sessions from the viewport and from the feature tree
- **THEN** each session captures the current viewport camera pose before reframing
- **AND** each session animates to the same plane-aligned framed outcome for that sketch target

#### Scenario: Reopen an existing sketch from a committed entry
- **WHEN** the user reopens an existing sketch through a supported direct interaction
- **THEN** the session uses the same camera-capture and animated framing contract as any other supported sketch entry path
- **AND** the resulting camera framing uses the sketch's stored plane definition and visible sketch geometry

### Requirement: Sketch exit camera restoration SHALL stay consistent across exit paths
The system MUST restore the captured pre-entry viewport camera pose through the same animated transition whenever a sketch session exits through a supported path.

#### Scenario: Finish sketch after editing
- **WHEN** the user exits a sketch edit session through `Finish Sketch`
- **THEN** the viewport animates back to the same pre-entry camera pose that was captured when the session opened

#### Scenario: Exit sketch through a non-commit path
- **WHEN** the user exits a sketch session through `Cancel`, abort, or sketch-mode `Escape`
- **THEN** the viewport animates back to the same pre-entry camera pose that was captured when the session opened
