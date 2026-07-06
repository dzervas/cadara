## ADDED Requirements

### Requirement: Offset SHALL use a domain tool definition
The sketch Offset operator SHALL be defined by its own domain tool module owning toolbar metadata, activation and pointer lifecycle, staged chain selection with side/distance preview, and pre-commit validation, consistent with the existing sketch tool definition contract.

#### Scenario: Offset tool is activated
- **WHEN** the user activates the Offset tool in sketch mode
- **THEN** the tool module drives chain selection and staged preview through the generic sketch tool presentation contract
- **AND** no offset-specific behavior lives in presentational components

#### Scenario: Offset preview follows pointer side
- **WHEN** a valid connected chain is selected and the pointer moves across the chain
- **THEN** the staged preview shows the derived chain on the pointer's side at the current distance before any commit

#### Scenario: Invalid selection is rejected before mutation
- **WHEN** the selection is disconnected or contains unsupported entity kinds
- **THEN** the tool reports the validation failure
- **AND** the sketch definition is not mutated
