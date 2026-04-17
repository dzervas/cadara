## 1. Annotation Descriptors

- [x] 1.1 Generate committed annotation descriptors from durable sketch constraint and dimension records.
- [x] 1.2 Include glyph kind, viewport anchor, durable annotation target, and affected geometry refs in each descriptor.
- [x] 1.3 Add tests for descriptor generation for at least one geometric constraint and one dimension.

## 2. Viewport Glyph Interaction

- [x] 2.1 Render committed annotation glyphs near affected sketch geometry in the viewport.
- [x] 2.2 Add glyph hit-testing that selects the annotation target rather than the affected geometry.
- [x] 2.3 Highlight affected geometry on glyph hover and selected annotation state without selecting that geometry.

## 3. Deletion Flow

- [x] 3.1 Ensure Delete and Backspace remove the selected committed annotation through durable sketch mutation flow.
- [x] 3.2 Add tests for committed annotation selection and deletion.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
