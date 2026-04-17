## 1. Preview Descriptor Contract

- [ ] 1.1 Extend sketch constraint preview descriptors for dimension lines, extension lines, angle arcs, and reference labels.
- [ ] 1.2 Extend floating input descriptors so constraint value entry can anchor near the mouse or preview reference.
- [ ] 1.3 Add tests for preview descriptor generation from partial target selections.

## 2. Reference Disambiguation

- [ ] 2.1 Implement pointer-based diagonal, horizontal, and vertical distance reference selection.
- [ ] 2.2 Update the dimension preview line as the pointer moves between reference candidates.
- [ ] 2.3 Add tests for point-to-point dimension reference selection.

## 3. Viewport Rendering

- [ ] 3.1 Render transient dimension preview lines and labels inside the viewport.
- [ ] 3.2 Render transient angle arcs between affected lines or references inside the viewport.
- [ ] 3.3 Render constraint value input near the active preview reference instead of in a fixed panel.

## 4. Verification

- [ ] 4.1 Run `bun run test`.
- [ ] 4.2 Run `bun run lint`.
