## 1. Preview Descriptor Contract

- [x] 1.1 Extend sketch constraint preview descriptors for dimension lines, extension lines, angle arcs, and reference labels.
- [x] 1.2 Extend floating input descriptors so constraint value entry can anchor near the mouse or preview reference.
- [x] 1.3 Add tests for preview descriptor generation from partial target selections.

## 2. Reference Disambiguation

- [x] 2.1 Implement pointer-based diagonal, horizontal, and vertical distance reference selection.
- [x] 2.2 Update the dimension preview line as the pointer moves between reference candidates.
- [x] 2.3 Add tests for point-to-point dimension reference selection.

## 3. Viewport Rendering

- [x] 3.1 Render transient dimension preview lines and labels inside the viewport.
- [x] 3.2 Render transient angle arcs between affected lines or references inside the viewport.
- [x] 3.3 Render constraint value input near the active preview reference instead of in a fixed panel.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
