## 1. Geometry Classification

- [x] 1.1 Identify the feature preview result and committed-body data available at the feature-session/application seam, including body ids, face ids, tolerances, and mesh or topology data.
- [x] 1.2 Add a small domain helper that classifies one preview result against candidate bodies as `intersects`, `coplanarContact`, `none`, or `unknown`.
- [x] 1.3 Implement conservative candidate ranking: prefer reliable intersection, then reliable coplanar contact, and return `unknown` or `none` for ambiguous ties.

## 2. Feature Draft Preselection

- [x] 2.1 Add a shared preselection function that maps classification results to basic feature operations (`cut`, `join`, `newBody`) and advanced feature intents (`subtract`, `add`, `create`).
- [x] 2.2 Populate the target-body draft field or `booleanScope` using the selected candidate body while preserving the existing explicit persisted feature-definition shapes.
- [x] 2.3 Track manual operation and target-body changes on feature edit sessions so later preview updates do not overwrite user choices.
- [x] 2.4 Wire successful preview updates for boolean-capable create flows through the preselection function without changing commit-time kernel semantics.

## 3. Feature Coverage

- [x] 3.1 Apply the shared preselection path to extrude and revolve create sessions.
- [x] 3.2 Apply the same path to other boolean-capable feature definitions that already expose supported operation intent and target-body controls.
- [x] 3.3 Keep unsupported or non-previewable feature families on the existing explicit-selection behavior.

## 4. Tests And Validation

- [x] 4.1 Read `docs/testing.md` before adding or moving tests, then choose the smallest owning lane for the behavior under that policy.
- [x] 4.2 Add behavior coverage for intersecting preview -> cut with target body, coplanar preview -> merge with target body, no reliable relationship -> new with no target, and intersection priority over coplanar contact.
- [x] 4.3 Add behavior coverage proving manual operation or target-body overrides survive later preview classification changes.
- [x] 4.4 Run focused lane tests for the changed seams, then run `bun run test:all`.
