## ADDED Requirements

### Requirement: Section view SHALL start from one explicit planar seed
The system SHALL require `Section View` to begin from one explicit planar seed and SHALL accept only a planar face, a closed profile region, or a construction-plane reference as that seed.

#### Scenario: Select a planar face seed
- **WHEN** the user activates `Section View` and selects a planar face
- **THEN** the system accepts that face as the section seed
- **AND** it derives the initial section plane from that face

#### Scenario: Select a closed profile region seed
- **WHEN** the user activates `Section View` and selects a closed sketch/profile region
- **THEN** the system accepts that region as the section seed
- **AND** it derives the initial section plane from the owning sketch plane

#### Scenario: Select a plane reference seed
- **WHEN** the user activates `Section View` and selects a construction plane or authored plane reference that surfaces as a construction-plane target
- **THEN** the system accepts that reference as the section seed
- **AND** it uses that plane as the initial section plane

#### Scenario: Select an unsupported seed
- **WHEN** the user activates `Section View` and selects a target that is not one of the accepted planar seed types
- **THEN** the system keeps section view in seed-collection mode
- **AND** it does not activate clipping for the model

### Requirement: Active section view SHALL expose one-dimensional plane manipulation
Once a valid seed is accepted, the system SHALL activate a temporary section plane that can be moved only along its normal and whose retained side can be flipped independently from its offset.

#### Scenario: Seed acceptance initializes retained side away from the camera
- **WHEN** the user accepts a valid section seed
- **THEN** the active section keeps the half-space away from the current camera by default
- **AND** the exposed cut is immediately visible to the user

#### Scenario: User drags the section handle forward or backward
- **WHEN** the user drags the active section handle in the viewport
- **THEN** the section plane moves only along its section normal
- **AND** the user can move it in either direction from the initial seed plane

#### Scenario: User flips the retained side
- **WHEN** the user invokes the section flip control while a section is active
- **THEN** the system keeps the current section-plane position
- **AND** it inverts which half of the model is retained

### Requirement: Section view SHALL clip the whole visible model temporarily
An active section view SHALL clip the whole currently visible model, including visible durable and preview solids, as a temporary viewport effect without mutating durable authored geometry.

#### Scenario: Visible document and preview solids are clipped
- **WHEN** section view is active
- **THEN** the viewport clips all currently visible model solids against the active section plane
- **AND** the clipping scope is not limited to the seed owner

#### Scenario: Section view is cancelled or cleared
- **WHEN** the user exits the active section view
- **THEN** the viewport removes the temporary clipping effect
- **AND** the underlying document, feature definitions, and saved geometry remain unchanged

### Requirement: Section view SHALL distinguish cut faces from retained uncut surfaces
The system SHALL render newly exposed cut faces with a flat filled section treatment and diagonal hatch lines, while retained surfaces that were not cut SHALL keep their existing shading treatment.

#### Scenario: Render a cut face
- **WHEN** the active section plane cuts through a visible solid
- **THEN** the newly exposed section surface renders with flat solid fill
- **AND** diagonal hatch lines are rendered over that cut surface

#### Scenario: Render an uncut retained surface
- **WHEN** a visible surface remains on the retained half without being intersected by the active section plane
- **THEN** that surface keeps the shading treatment it had before section view was activated
- **AND** it does not receive the section hatch overlay
