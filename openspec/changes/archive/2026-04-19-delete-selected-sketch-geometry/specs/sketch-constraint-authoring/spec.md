## ADDED Requirements

### Requirement: Geometry deletion SHALL remove dependent sketch constraints and dimensions
The system SHALL remove committed sketch constraints and dimensions that reference sketch geometry deleted from an active sketch session.

#### Scenario: Deleting an entity removes constraints that reference it
- **WHEN** the user deletes a selected sketch entity that is referenced by one or more committed constraints or dimensions
- **THEN** the deleted entity is removed from the active sketch definition
- **AND** every committed constraint or dimension that references the deleted entity is removed from the active sketch definition
- **AND** committed constraints and dimensions that do not reference the deleted entity remain present

#### Scenario: Deleting a point removes constraints that reference it
- **WHEN** the user deletes a selected sketch point that is referenced by one or more committed constraints or dimensions
- **THEN** the deleted point is removed from the active sketch definition
- **AND** every committed constraint or dimension that references the deleted point is removed from the active sketch definition
- **AND** committed constraints and dimensions that do not reference the deleted point remain present

#### Scenario: Dependency cleanup leaves no dangling sketch references
- **WHEN** selected sketch geometry is deleted from an active sketch
- **THEN** the resulting authored sketch definition contains no committed constraint or dimension record that references the deleted local point or entity IDs
