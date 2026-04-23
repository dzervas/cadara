## 1. Dimension Annotation Descriptor Contract

- [x] 1.1 Extend committed dimension annotation descriptors and formatting helpers to expose compact visible value text while preserving verbose accessible/detail metadata.
- [x] 1.2 Update committed dimension descriptor generation in `src/domain/editor/sketch-session.ts` so dimension annotations no longer surface verbose visible text such as entity-role phrases.
- [x] 1.3 Separate committed dimension annotation drag metadata from committed overlay drag metadata so committed placement updates can start from the annotation chip without rewriting draft preview placement.

## 2. Viewport Annotation Interactions

- [x] 2.1 Update `src/components/cad/sketch-constraint-annotations.tsx` to render committed dimensions as compact `icon + value` chips while leaving non-dimension constraint annotations on the existing generic path.
- [x] 2.2 Add committed dimension annotation drag plumbing through `src/components/cad/three-cad-viewport.tsx` so dragging the annotation chip routes to `setDimensionAnnotationPlacement`.
- [x] 2.3 Preserve committed dimension click, hover, selection, and double-click edit behavior while preventing committed overlay line/arc geometry from acting as a second durable drag handle.

## 3. Angular Witness Geometry

- [x] 3.1 Extend the committed and preview angle-dimension overlay contract to describe witness-line geometry derived from the referenced infinite lines and chosen angle arc endpoints.
- [x] 3.2 Render dashed angular witness lines in `src/components/cad/sketch-viewport-feedback.tsx` when the measured angle references an off-segment intersection and avoid extra witness geometry when it is not needed.
- [x] 3.3 Verify that minor/major angle placement still produces readable witness geometry for both preview and committed dimensions.

## 4. Tests and Verification

- [x] 4.1 Add `bun:test` coverage for compact committed dimension annotation rendering and preserved accessible metadata.
- [x] 4.2 Add interaction tests covering committed dimension double-click editing and annotation-chip drag routing.
- [x] 4.3 Add viewport feedback tests for angular witness-line rendering when the true angle intersection lies beyond one or both finite line segments.
- [x] 4.4 Run `bun run test`, `bun run lint`, and `bun run build`.
