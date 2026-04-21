## Why

Broken or partially invalid document state can currently collapse into an empty render path, leaving the user with a destructive reset as the only visible recovery option. CAD documents need to remain inspectable and repairable even when a feature fails, with the failure attached to the feature and field the user can fix.

## What Changes

- Treat semi-broken authored documents as valid documents when their top-level structure can still be loaded.
- Preserve the last successfully rendered scene during an in-session edit or rebuild failure, and defer re-rendering until the user fixes the blocking feature error.
- On reload, rebuild and render every feature that can be safely evaluated, while preserving the full authored history for repair.
- Discover and report as many independent broken later features as possible in one reload pass instead of stopping diagnostics at the first failure.
- Attach rebuild and validation errors to the feature history item that caused them.
- Mark erroneous feature history items with error styling and a persistent tooltip that explains what went wrong and how to fix the authored field.
- Map low-level missing-reference messages into user-actionable feature-field diagnostics, for example "Merge bodies target is incorrect" instead of exposing raw topology ids such as `faceXYZ`.
- Remove reset/start-over/clear-document affordances as recovery guidance for broken document state; deleting or clearing the document is never a valid fix for this class of error.
- Add tests with erroneous authored documents and edit failures that validate partial rendering, scene preservation, feature-local diagnostics, and non-destructive recovery UI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authored-model-document`: Semi-broken feature records remain part of a valid authored document when the document envelope and history can be parsed.
- `document-repository`: Repository restore must preserve broken authored documents and must not replace or reset them as recovery.
- `durable-modeling-contract`: Rebuilds must produce partial snapshots, feature-scoped diagnostics, and field-oriented user messages for recoverable feature failures.
- `frontend-modeling-boundary`: Editor-facing snapshot refresh after edit failures must preserve the currently rendered scene until a valid replacement snapshot is available.
- `feature-timeline-bar`: Feature history items must display feature-attached errors with red state and persistent repair guidance tooltips.
- `application-error-pipeline`: User-visible recovery messaging must route recoverable modeling failures to feature diagnostics and must not recommend clearing, deleting, resetting, or starting over.
- `modeling-operation-history`: Reload and compatibility replay must preserve authored history while rendering the valid prefix when a later feature cannot rebuild.

## Impact

- Affected domain/runtime code: authored document validation, repository restore, modeling service rebuild/replay, snapshot diagnostics, editor refresh sequencing, and feature diagnostic mapping.
- Affected UI: bottom feature timeline/history, persistent tooltip/error affordance, document diagnostics, and any reset/start-over fallback shown for recoverable modeling errors.
- Affected tests: `bun:test` coverage for invalid feature documents, partial rebuild snapshots, edit-failure scene preservation, diagnostic-to-field mapping, and timeline error presentation.
- No new runtime dependencies are expected.
