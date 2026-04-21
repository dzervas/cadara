## Context

The workbench now persists authored model documents through `DocumentRepository` and derives render exports, presentation rows, diagnostics, and object state from rebuilds. That split is the right foundation, but recoverable feature failures can still behave like document-level failures: the render path can collapse, and the visible recovery path can push the user toward starting over.

This change treats a broken feature as a repairable authored state, not as an invalid document, when the document envelope and history are still structurally readable. The modeling layer owns partial rebuild and diagnostic attribution; the editor owns scene swap timing; the timeline owns feature-local error presentation.

## Goals / Non-Goals

**Goals:**

- Keep authored documents loadable and editable when one feature contains a recoverable invalid reference or parameter.
- Preserve the last successfully rendered scene after an in-session edit introduces a rebuild failure.
- On reload, render every feature that can be safely evaluated and preserve the complete authored history for repair.
- Discover as many independent broken later features as possible during reload.
- Attach recoverable rebuild errors to the owning feature and authored field with user-facing repair guidance.
- Remove destructive recovery guidance for this class of problem.
- Cover erroneous documents and edit failures with focused `bun:test` coverage.

**Non-Goals:**

- Do not make malformed top-level documents valid. Unsupported schema versions, invalid discriminants, missing required collections, and unreadable storage still fail explicitly.
- Do not persist derived render exports or diagnostics into the authored document.
- Do not add a new CAD recovery subsystem outside the existing repository, modeling service, editor runtime, and timeline surfaces.
- Do not hide errors by skipping broken features without diagnostics.

## Decisions

1. Keep structural document validation separate from feature evaluation.

   `DocumentRepository` continues to validate the authored document envelope, ids, history containers, schema version, and other structural invariants before exposing records. Feature parameters and durable references that can be repaired by editing the feature become rebuild diagnostics instead of load blockers. This preserves repository safety without turning ordinary CAD dependency breakage into data loss.

   Alternative considered: loosen all authored document validation. Rejected because it would let malformed storage reach runtime code and make failures harder to diagnose.

2. Add feature-field diagnostic attribution at the modeling boundary.

   Recoverable rebuild diagnostics should include the owning `featureId`, a stable authored field id or field path, a user-facing summary, and repair guidance. Low-level topology ids may remain in structured debug context, but primary UI copy should describe the field the user can fix, such as "Merge bodies target is incorrect."

   Alternative considered: let the timeline parse existing diagnostic messages. Rejected because message parsing would be brittle and would duplicate feature semantics in UI components.

3. Rebuild documents sequentially with dependency-aware continuation for recoverable feature failures.

   The rebuild path should apply history in order, record diagnostics for each recoverable feature failure, and continue evaluating later features whose inputs do not depend on failed outputs. Later features that depend on missing outputs from an earlier failed feature should receive dependency-blocked diagnostics rather than being silently skipped. The generated snapshot should contain every feature result that can be safely produced without fabricating missing geometry. The complete authored document stays in the snapshot so all broken features can be selected and edited.

   Alternative considered: stop at the first failed feature. Rejected because reload should surface multiple independent broken later features in one pass. Another alternative was to keep evaluating every later feature as if failed outputs did not exist; that is rejected because dependent features need explicit dependency-blocked diagnostics instead of misleading geometry.

4. Swap viewport render data only after a successful replacement render is available.

   During an in-session edit, the editor runtime should accept or surface the authored change and diagnostics without replacing the viewport render records with an empty or failed rebuild result. The current rendered scene remains visible and the feature timeline shows the error. Once the user fixes the feature and rebuild succeeds, the editor swaps to the new snapshot render records.

   Alternative considered: render the partial prefix immediately for every edit failure. Rejected because it can erase important visual context while the user is correcting a just-introduced mistake.

5. Make destructive recovery unavailable for recoverable document state.

   Reset, clear, delete, or start-over copy must not be presented as the fix for a feature-scoped document error. The repair path is to edit the marked feature or its invalid field. Repository reset may still exist as a separate explicit user command for unrelated workflows, but error recovery must not use it.

## Risks / Trade-offs

- Partial snapshot shape may blur the difference between authored history and applied render state. Mitigation: expose explicit diagnostics and keep generated render data separate from authored records.
- Dependency-aware continuation may classify a later feature as blocked when a deeper independent validation error also exists. Mitigation: run cheap authored-field validation for all later features before geometry execution where possible.
- Some low-level errors may not initially map cleanly to a field. Mitigation: add a fallback feature-level diagnostic with repair guidance, then extend mappings feature by feature.
- Preserving the previous scene can make the viewport temporarily stale. Mitigation: pair stale render preservation with visible feature timeline errors and avoid claiming the scene reflects the broken feature.
- Tests with real OpenCascade rebuilds may be expensive. Mitigation: cover the contract in unit tests around document restore, modeling service, editor refresh sequencing, and timeline rendering, with targeted OCC tests only where field mapping depends on OCC behavior.

## Migration Plan

1. Extend diagnostic contracts and helpers before changing UI presentation.
2. Update repository/modeling restore so existing repairable documents load without destructive fallback.
3. Add dependency-aware partial rebuild behavior and tests for invalid feature references.
4. Update editor snapshot swap rules for failed in-session rebuilds.
5. Update the feature timeline and error messaging.
6. Remove reset/start-over recovery copy from recoverable modeling error flows.

No persistent authored document migration is expected because diagnostics and render data remain generated state.

## Open Questions

- Which exact diagnostic field id format should be exposed to UI: existing form field ids, authored definition paths, or both?
