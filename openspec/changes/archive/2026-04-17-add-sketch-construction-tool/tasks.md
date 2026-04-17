## 1. Construction Tool State

- [x] 1.1 Add a sketch-mode Construction toolbar/tool definition with icon metadata, tooltip text, and selected-state support for modifier use.
- [x] 1.2 Extend sketch session state to track construction target-picking mode separately from the persistent construction authoring modifier.
- [x] 1.3 Implement Construction activation behavior: first activation waits for a supported target, drawing-tool activation converts it into a persistent modifier, and a second Construction activation clears the modifier.
- [x] 1.4 Clear construction target-picking and modifier state when sketch editing ends or the active sketch session is replaced.

## 2. Authored Sketch Mutations

- [x] 2.1 Add editor-domain helpers that toggle `isConstruction` on selected sketch point/point-entity and entity records without changing unrelated shared endpoint records.
- [x] 2.2 Route accepted existing-geometry construction toggles through the sketch commit/modeling boundary instead of writing durable document state from viewport or React components.
- [x] 2.3 Extend sketch tool commit context/factories so line, rectangle, circle, and future drawing tools can create construction points and entities from shared context.
- [x] 2.4 Preserve default normal-geometry behavior when construction context is inactive.

## 3. Viewport Rendering and Picking

- [x] 3.1 Extend renderable composition or styling metadata with the smallest contract needed to represent dashed construction sketch wires.
- [x] 3.2 Render construction sketch geometry as dashed editable feedback while the owning sketch is being edited.
- [x] 3.3 Omit construction-only sketch geometry from non-editing document viewport renderables.
- [x] 3.4 Keep visible construction edges and vertices hoverable/selectable for direct edits, constraints, and Construction toggles.

## 4. Profile Behavior

- [x] 4.1 Verify region/profile extraction ignores construction line, arc, and circle entities.
- [x] 4.2 Ensure construction geometry crossing or contained inside a normal closed profile does not split, remove, or create profile regions.

## 5. Tests and Verification

- [x] 5.1 Add sketch session tests for Construction selection mode, persistent modifier mode, toggle-off behavior, and sketch-end cleanup.
- [x] 5.2 Add authored mutation tests covering normal-to-construction and construction-to-normal toggles for edges and vertices, including shared endpoint preservation.
- [x] 5.3 Add drawing tool commit tests proving new geometry is authored with `isConstruction: true` only when construction context is active.
- [x] 5.4 Add viewport/renderable tests proving construction geometry is edit-only, dashed while visible, and pickable while editing.
- [x] 5.5 Add profile extraction tests proving construction geometry is excluded from derived profile regions.
- [x] 5.6 Run `bun run test` and `bun run lint`.
