## ADDED Requirements

### Requirement: Import providers SHALL expose UI hooks for schema-driven review forms
The `ImportProvider` interface SHALL include `getReviewFormSchema()` and `applySelectionPatch()` methods that enable generic UI rendering without provider-specific form components.

#### Scenario: Provider implements getReviewFormSchema
- **WHEN** the orchestrator needs to render a review UI for a matched provider
- **THEN** it calls `provider.getReviewFormSchema(review, selections)` with the current review result and selections
- **AND** the provider returns a `FeatureEditorFormSchema` describing the fields the user should see

#### Scenario: Provider implements applySelectionPatch
- **WHEN** the user changes a field value in the import review form
- **THEN** the orchestrator calls `provider.applySelectionPatch(review, selections, patch)`
- **AND** the provider returns an updated `TSelections` object reflecting the change

### Requirement: Import providers SHALL expose accepted file extensions for file picker construction
The `ImportProvider` interface SHALL include an `acceptedFileTypes` property that lists file extensions and optional media types the provider handles. The orchestrator uses this to construct the file picker's accept filter.

#### Scenario: Provider declares accepted extensions
- **WHEN** the orchestrator builds the file picker accept filter
- **THEN** it reads `acceptedFileTypes` from each registered provider
- **AND** combines all extensions into the file picker's accept options

### Requirement: Import providers SHALL expose a default selections factory
The `ImportProvider` interface SHALL include a `createDefaultSelections(review)` method that returns the initial `TSelections` value used when the review form first appears.

#### Scenario: Default selections for image import
- **WHEN** the image import provider's review completes
- **THEN** `createDefaultSelections()` returns selections with no plane selected
- **AND** the form renders with the plane picker field empty and the commit button disabled

#### Scenario: Default selections for geometry import
- **WHEN** a geometry import provider's review discovers selectable solids
- **THEN** `createDefaultSelections()` returns selections with all solids selected by default
- **AND** the form renders with all items checked
