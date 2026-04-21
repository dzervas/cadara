## 1. Diagnostic Contract

- [x] 1.1 Extend modeling diagnostics to carry owning feature identity, authored field id or path, and repair guidance for recoverable feature rebuild failures.
- [x] 1.2 Add diagnostic mapping helpers that convert low-level missing body, face, edge, vertex, sketch, and topology failures into feature-field messages.
- [x] 1.3 Add tests proving raw durable ids remain structured debug context while user-facing messages name the incorrect feature field.

## 2. Authored Document and Repository Restore

- [x] 2.1 Split authored document structural validation from repairable feature evaluation failures so structurally valid documents with broken feature fields still load.
- [x] 2.2 Update `DocumentRepository` restore paths to preserve semi-broken authored documents without seeding an empty replacement or invoking reset, clear, or delete recovery.
- [x] 2.3 Add repository/authored-document tests for invalid feature references, malformed top-level documents, and non-destructive restore behavior.

## 3. Dependency-Aware Rebuild and Replay

- [x] 3.1 Implement dependency-aware partial rebuilds that render every safely evaluable feature result, report failed features, and report dependency-blocked later features without fabricating geometry.
- [x] 3.2 Ensure reload discovers as many independent broken later features as possible in one pass, including cheap authored-field validation before geometry execution where practical.
- [x] 3.3 Update compatibility operation-history replay to preserve full authored history, render safe partial results, and report multiple independent feature errors.
- [x] 3.4 Add modeling service and replay tests with erroneous documents containing multiple independent broken features and dependent blocked features.

## 4. Editor Runtime Scene Preservation

- [x] 4.1 Update editor refresh sequencing so an in-session recoverable feature edit failure keeps the previously successful render records active.
- [x] 4.2 Swap viewport render data only after a corrected feature rebuild produces a successful replacement snapshot.
- [x] 4.3 Add editor/runtime tests proving failed edits preserve the rendered scene and fixed edits clear diagnostics and render the new scene.

## 5. Feature History Error Presentation

- [x] 5.1 Update the feature timeline view model to associate feature-scoped diagnostics with committed history items.
- [x] 5.2 Render each erroneous feature item with danger-red state and persistent tooltip or equivalent anchored repair guidance.
- [x] 5.3 Ensure activating an erroneous feature item opens or selects the feature repair context without clearing, deleting, resetting, or starting over the document.
- [x] 5.4 Remove destructive recovery copy or buttons from recoverable feature-scoped document error flows.
- [x] 5.5 Add timeline/component tests for one failed feature, multiple independent failed features, persistent guidance, and absence of destructive recovery actions.

## 6. Verification

- [x] 6.1 Run `bun run test` and address failures.
- [x] 6.2 Run `bun run lint` and address failures.
- [x] 6.3 Run `bun run build` and address failures.
