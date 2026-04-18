## ADDED Requirements

### Requirement: SVG style toolbar controls SHALL reflect sketch style availability
The toolbar SHALL present SVG/style controls with active and disabled states that reflect whether the current sketch selection can receive local style edits.

#### Scenario: Style target is selected
- **WHEN** the user is editing a sketch and has selected a local styleable sketch point or entity
- **THEN** SVG/style toolbar controls are available and can focus the relevant style controls

#### Scenario: No style target is selected
- **WHEN** the user is editing a sketch without a styleable local target selected
- **THEN** SVG/style toolbar controls do not imply that a style mutation has already been applied
