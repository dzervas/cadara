## 1. Selection Contract

- [x] 1.1 Add an editor event or selection intent for sketch connected-geometry selection triggered by a viewport double-click.
- [x] 1.2 Implement a domain helper that derives editable local sketch entity connected components from shared point ids in the active sketch definition.
- [x] 1.3 Ensure unsupported targets such as projected reference geometry, annotations, regions, points, and non-sketch targets do not expand through the connected-geometry path.

## 2. Viewport Integration

- [x] 2.1 Route double-clicks on picked editable local sketch entity targets from the Three.js viewport to the new editor selection intent.
- [x] 2.2 Preserve existing single-click selection, direct drag, active drawing-tool routing, constraint/tool target routing, and annotation double-click editing behavior.
- [x] 2.3 Ensure the expanded selection updates existing highlight, delete, style, construction toggle, and sketch edit tool consumers through the normal selection state.

## 3. Tests

- [x] 3.1 Add domain/editor state tests for double-click selecting two connected lines.
- [x] 3.2 Add domain/editor state tests for selecting all four edges of a rectangle from any one edge.
- [x] 3.3 Add domain/editor state tests for branching connected components and for projected reference geometry not expanding.
- [x] 3.4 Add or update viewport/workbench interaction tests proving double-click dispatches the connected selection intent without breaking ordinary click routing.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
