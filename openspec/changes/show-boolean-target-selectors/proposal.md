## Why

Boolean-capable feature forms currently let users choose merge/cut/intersect-style operations without consistently exposing the target body selector needed to make those operations explicit. Users need the target selector to appear only when the selected operation requires a boolean target, so standalone creation forms stay compact and boolean edits remain contract-valid.

## What Changes

- Show an explicit target body selector for boolean-capable feature sessions only while a non-standalone boolean operation is selected.
- Add the missing target body selector behavior for basic solid-producing features such as extrude, revolve, and shell.
- Preserve existing advanced feature behavior for sweep, loft, and thicken, where target bodies already appear only for non-create operation intents.
- Keep feature-specific visibility, validation, and patch semantics in feature authoring definitions while the generic inspector continues to render the declared form schema.

## Capabilities

### New Capabilities
- `boolean-target-selector`: Defines conditional target body selector behavior for boolean-capable feature forms.

### Modified Capabilities

## Impact

- Affected areas include feature authoring definitions for boolean-capable features, feature editor form schema usage, draft patch handling for `booleanScope`, and authoring tests.
- No new dependencies, public service APIs, or kernel adapter contracts are required.
