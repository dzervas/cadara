## 1. Contract and Modeling Boundary

- [x] 1.1 Add or update runtime normalization for authored sketch reference records without changing the public `SketchReferenceDefinition` shape unnecessarily.
- [x] 1.2 Add modeling-boundary operations or commit paths for adding and removing sketch external references from an active sketch definition.
- [x] 1.3 Preserve reference records through sketch commit, document snapshot rebuild, persistence, and reload.
- [x] 1.4 Add tests for sketch reference persistence, duplicate reference rejection, and explicit invalid reference diagnostics.

## 2. Editor Authoring Flow

- [x] 2.1 Add a sketch-mode reference/project authoring tool state for selecting supported external sources.
- [x] 2.2 Resolve accepted model or existing-sketch selections into `SketchReferenceDefinition` records with stable reference IDs and labels.
- [x] 2.3 Route accepted reference mutations through the modeling boundary instead of viewport or React direct writes.
- [x] 2.4 Add sketch session tests for activating, accepting, cancelling, and deleting reference geometry authoring.

## 3. Projection and Display

- [x] 3.1 Call the solver projection boundary for active sketch references and store projection results in editor/session display state.
- [x] 3.2 Render projected point, line, circle, and arc geometry with read-only reference styling during active sketch editing.
- [x] 3.3 Make projected reference geometry hoverable/selectable while preventing direct drag and construction toggles.
- [x] 3.4 Surface unsupported, missing, ambiguous, and out-of-plane projection statuses in existing sketch feedback/diagnostic surfaces.

## 4. Verification

- [x] 4.1 Add focused `bun:test` coverage for projection routing, reference renderable composition, and selection behavior.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
