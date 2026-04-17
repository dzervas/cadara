## 1. Descriptor Contract

- [ ] 1.1 Extend sketch tool presentation types to represent anchored measurements and floating input positions.
- [ ] 1.2 Update line, rectangle, and circle tool presentations to emit anchored live labels.
- [ ] 1.3 Add tests for descriptor output for circle diameter, rectangle width/height, and line length/angle.

## 2. Viewport Rendering

- [ ] 2.1 Add a viewport overlay renderer that projects sketch/world anchors to screen-space labels.
- [ ] 2.2 Render numeric input near the active anchor instead of fixed bottom-center placement.
- [ ] 2.3 Remove or suppress fixed panel-style drawing feedback for active drawing tools.

## 3. Verification

- [ ] 3.1 Add component or integration coverage for geometry-anchored drawing labels.
- [ ] 3.2 Run `bun run test`.
- [ ] 3.3 Run `bun run lint`.
