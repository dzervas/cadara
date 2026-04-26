## ADDED Requirements

### Requirement: Import providers SHALL describe their review UI through form schemas
Each import provider SHALL implement a `getReviewFormSchema()` method that returns a `FeatureEditorFormSchema` computed from the current review result and user selections. The schema describes what fields the user sees — the generic renderer handles layout and interaction.

#### Scenario: Provider returns form schema with plane picker
- **WHEN** an image import provider's `getReviewFormSchema()` is called with review data containing pixel dimensions
- **THEN** the returned schema contains a section with a `referencePicker` field configured for plane/face selection
- **AND** the returned schema contains a `summary` field showing the image dimensions

#### Scenario: Provider returns form schema with selectable items
- **WHEN** a geometry import provider's `getReviewFormSchema()` is called with review data containing discovered solids
- **THEN** the returned schema contains a section with a `referenceCollection` field listing the selectable items

#### Scenario: Provider returns form schema with diagnostics
- **WHEN** a provider's review includes warnings or errors
- **THEN** the returned schema contains a diagnostics section with the review diagnostics

#### Scenario: Schema updates when selections change
- **WHEN** the user changes a field value (e.g., selects a plane, toggles a solid)
- **THEN** `applySelectionPatch()` returns updated selections
- **AND** `getReviewFormSchema()` is called again with the updated selections
- **AND** the schema reflects the new state (e.g., conditional fields appear/disappear)

### Requirement: Import providers SHALL update selections through patches
Each import provider SHALL implement an `applySelectionPatch()` method that receives the current review, selections, and a field patch, and returns updated selections.

#### Scenario: Plane selection patch updates selections
- **WHEN** the user picks a plane through a `referencePicker` field
- **THEN** `applySelectionPatch()` receives a patch with the selected plane reference
- **AND** returns updated selections with the plane, planeTarget, and planeKey resolved

#### Scenario: Toggle patch updates selections
- **WHEN** the user toggles an item in a `referenceCollection` field
- **THEN** `applySelectionPatch()` receives a patch with the toggled item
- **AND** returns updated selections with the item added or removed

### Requirement: Import review form schemas SHALL use the same field types as feature editor forms
The `getReviewFormSchema()` return type SHALL be `FeatureEditorFormSchema` from the feature authoring form schema module. Providers SHALL use the same field kinds (numeric, enum, referencePicker, referenceCollection, optionGroup, discriminatedOptionGroup, summary, diagnostics, custom) available to feature definitions.

#### Scenario: Renderer handles import form fields identically to feature form fields
- **WHEN** the `ImportInspector` renders a provider's form schema
- **THEN** each field is rendered by the same `FeatureFormFieldRenderer` component used for feature editing
- **AND** numeric fields support expression bindings, enum fields show dropdowns, reference pickers activate viewport selection mode

### Requirement: Import providers SHALL declare accepted file extensions for the file picker
Each import provider SHALL expose a list of accepted file extensions and media types so the orchestrator can compute the file picker's accept filter.

#### Scenario: File picker combines extensions from all providers
- **WHEN** the user clicks the import button and the file picker opens
- **THEN** the accept filter includes all file extensions from all registered providers
- **AND** the user can select any file type that at least one provider accepts
