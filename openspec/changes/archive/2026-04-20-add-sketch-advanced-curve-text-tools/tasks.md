## 1. Tool Metadata And Presentation

- [x] 1.1 Add tool ids, metadata, icons, and registration for ellipse, elliptical arc, conic, Bezier, control-point spline, and text.
- [x] 1.2 Add dropdown families where needed for spline and advanced curve variants.
- [x] 1.3 Extend the generic sketch tool presentation schema only where required for text and control-point handles.

## 2. Tool Implementations

- [x] 2.1 Implement ellipse and elliptical arc tool modules with staged previews and validation.
- [x] 2.2 Implement conic and Bezier curve tool modules with control/defining point previews.
- [x] 2.3 Implement spline control-point authoring without replacing fit-point spline behavior.
- [x] 2.4 Implement profile-generating text placement, validation, and commit behavior.

## 3. Profile And Selection Integration

- [x] 3.1 Ensure committed advanced entities render and expose stable selectable targets.
- [x] 3.2 Ensure supported profile-generating text exposes selectable downstream profile regions.
- [x] 3.3 Add unsupported-case diagnostics for advanced tool outputs that are valid but not yet profile-capable.

## 4. Verification

- [x] 4.1 Add sketch tool lifecycle, commit, profile, and rendering tests for advanced tools.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
- [x] 4.4 Run `bun run build`.
