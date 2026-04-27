## ADDED Requirements

### Requirement: The toolbar SHALL have a single generic import button
The toolbar SHALL display an import button in part mode that triggers a file picker accepting all file types from all registered import providers.

#### Scenario: Import button visible in part mode
- **WHEN** the editor is in part mode
- **THEN** the toolbar displays an import button in the import tool group

#### Scenario: Import button opens file picker
- **WHEN** the user clicks the import button
- **THEN** the browser file picker opens with accept filters computed from all registered providers' accepted extensions

#### Scenario: Import button disabled during active session
- **WHEN** the editor has an active feature editing session or import session
- **THEN** the import button is disabled

### Requirement: The editor state machine SHALL track import sessions
The editor state machine SHALL include an `importing` state that tracks the active import provider, resolved source, review result, current selections, and form schema.

#### Scenario: File selection starts import session
- **WHEN** the user selects a file through the import file picker
- **THEN** the orchestrator resolves the source and matches providers
- **AND** the editor transitions to the `importing` state with the matched provider and review result

#### Scenario: Multiple providers match
- **WHEN** more than one provider accepts the selected file
- **THEN** the import session presents the matching providers to the user for selection
- **AND** the editor remains in the `importing` state until the user picks a provider

#### Scenario: No provider matches
- **WHEN** no registered provider accepts the selected file
- **THEN** the editor shows a diagnostic notification indicating no importer is available
- **AND** the editor remains in idle state

#### Scenario: Selection patch updates session
- **WHEN** the user changes a field in the import review form
- **THEN** the editor dispatches an `import.selectionPatched` event
- **AND** `applySelectionPatch()` updates the selections
- **AND** `getReviewFormSchema()` re-derives the form schema
- **AND** the `ImportInspector` re-renders with the updated schema

#### Scenario: Commit completes import session
- **WHEN** the user clicks commit in the import review panel
- **THEN** the editor dispatches `import.commitRequested`
- **AND** the orchestrator calls `provider.prepare()` with the final selections
- **AND** the orchestrator applies prepared actions through the adapter
- **AND** the editor transitions back to idle with a success notification

#### Scenario: Cancel aborts import session
- **WHEN** the user clicks cancel in the import review panel
- **THEN** the editor dispatches `import.cancelled`
- **AND** the editor transitions back to idle
- **AND** no document state is modified

#### Scenario: Commit fails
- **WHEN** the orchestrator fails to apply prepared actions (adapter rejection)
- **THEN** the editor shows diagnostics from the failure
- **AND** the import session remains active so the user can adjust selections or cancel

### Requirement: The ImportInspector SHALL render provider review forms generically
The `ImportInspector` component SHALL render in the sidebar when the editor is in the `importing` state. It SHALL display the provider's form schema using the existing `FeatureFormFieldRenderer` infrastructure.

#### Scenario: ImportInspector renders provider form schema
- **WHEN** the editor is in the `importing` state with an active provider
- **THEN** the sidebar displays the `ImportInspector` panel
- **AND** the panel header shows the provider label
- **AND** each form section and field is rendered by `FeatureFormFieldRenderer`
- **AND** the panel footer has Cancel and Commit buttons

#### Scenario: ImportInspector replaces FeatureInspector
- **WHEN** the editor is in the `importing` state
- **THEN** the `FeatureInspector` is not rendered
- **AND** the `ImportInspector` occupies the same sidebar position

#### Scenario: Reference picker activates viewport selection
- **WHEN** a `referencePicker` field in the import form requires user selection (e.g., pick a plane)
- **THEN** the viewport enters selection mode with the field's selection filter
- **AND** selecting geometry in the viewport patches the field value through `applySelectionPatch()`

#### Scenario: Commit button reflects readiness
- **WHEN** the provider's selections are incomplete (e.g., no plane selected for image import)
- **THEN** the commit button is disabled
- **AND** the form shows field-level error indicators for missing required values
