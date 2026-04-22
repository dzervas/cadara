## ADDED Requirements

### Requirement: Feature authoring SHALL define STEP import settings
Feature authoring SHALL expose a typed STEP import definition containing the STEP asset reference and resolved import settings.

#### Scenario: Build STEP import definition
- **WHEN** the user accepts a STEP import
- **THEN** the authoring layer builds a feature definition with file asset id, unit/scale decision, orientation, placement transform, and label
- **AND** the definition does not embed STEP bytes directly
