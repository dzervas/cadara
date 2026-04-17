## 1. Annotation Descriptors

- [ ] 1.1 Generate committed annotation descriptors from durable sketch constraint and dimension records.
- [ ] 1.2 Include glyph kind, viewport anchor, durable annotation target, and affected geometry refs in each descriptor.
- [ ] 1.3 Add tests for descriptor generation for at least one geometric constraint and one dimension.

## 2. Viewport Glyph Interaction

- [ ] 2.1 Render committed annotation glyphs near affected sketch geometry in the viewport.
- [ ] 2.2 Add glyph hit-testing that selects the annotation target rather than the affected geometry.
- [ ] 2.3 Highlight affected geometry on glyph hover and selected annotation state without selecting that geometry.

## 3. Deletion Flow

- [ ] 3.1 Ensure Delete and Backspace remove the selected committed annotation through durable sketch mutation flow.
- [ ] 3.2 Add tests for committed annotation selection and deletion.

## 4. Verification

- [ ] 4.1 Run `bun run test`.
- [ ] 4.2 Run `bun run lint`.
