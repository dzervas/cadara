## MODIFIED Requirements

### Requirement: Frontend durable modeling actions pass through a modeling service boundary
The system SHALL route durable modeling actions from frontend/editor code through a frontend-facing modeling service or adapter boundary instead of allowing UI components to call a kernel implementation directly, and durable sketch constraint or dimension create/update/delete flows SHALL be treated as modeling actions even when their authoring lifecycle begins with frontend-only preview state.

#### Scenario: Frontend commits a sketch constraint mutation
- **WHEN** the editor accepts a sketch constraint or dimension operation after target selection and any required value entry
- **THEN** the durable mutation is issued through the modeling service boundary rather than written directly by a React component or viewport renderer

#### Scenario: Frontend removes a committed constraint annotation
- **WHEN** the user deletes a selected committed constraint or dimension annotation from the viewport
- **THEN** the delete action resolves to a durable sketch mutation through the modeling service boundary instead of mutating document-owned constraint state directly in UI code

#### Scenario: Modeling flow needs sketch solving after constraint mutation
- **WHEN** a committed sketch constraint or dimension mutation changes the authored sketch graph
- **THEN** any resulting solve or validation behavior continues to execute through the dedicated solver boundary rather than being recomputed in frontend presentation code
