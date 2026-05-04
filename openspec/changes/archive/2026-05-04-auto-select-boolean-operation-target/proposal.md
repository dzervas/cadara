## Why

Boolean-capable feature operations currently make users choose operation intent and target bodies manually even when the preview placement makes the expected result obvious. This adds a lightweight defaulting step so common create/edit flows start closer to the user's likely intent without making the operation irreversible or hidden.

Assumption: this should be a UX-oriented preselection heuristic only. The committed feature definition must still store explicit operation and target-body choices, and users must be able to override them before commit.

## What Changes

- Add an automatic preselection pass for boolean-capable feature drafts that can evaluate preview geometry against existing visible bodies.
- Default to `cut` with the intersecting body selected when the preview result has volumetric overlap with another body.
- Default to `join` with the adjacent body selected when the preview result is coplanar with a face of another body and does not have stronger intersection evidence.
- Default to `newBody` when no reliable intersection or coplanar-face candidate exists.
- Keep the heuristic deliberately conservative: ambiguous, unsupported, or failed analysis falls back to `newBody` rather than blocking the feature workflow.
- Preserve manual user overrides once the user changes the operation or target body.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `boolean-target-selector`: Boolean-capable feature forms should preselect operation intent and target body from preview/body spatial relationships when the draft has not already been manually overridden.

## Impact

- Affected code likely includes feature-session creation and draft patching, feature authoring definitions for extrude/revolve and other boolean-capable features, preview evaluation result handling, body/face spatial query helpers, and boolean target selector form tests.
- No persistence format change is intended; persisted definitions should keep the same explicit operation and target-body fields already used by boolean-capable features.
- No new dependency is expected. Geometry classification should reuse existing modeling/OCC-derived preview and topology data where possible.
