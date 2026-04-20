## 1. Tool And Icon Registration

- [x] 1.1 Add `constraintConcentric`, `constraintMidpoint`, `constraintNormal`, `constraintPierce`, `constraintSymmetric`, and `constraintFix` to the relevant tool ID and icon ID types.
- [x] 1.2 Add toolbar definitions for the six tools in the sketch constraint group with sketch-only mode metadata.
- [x] 1.3 Map the six tools to the existing SVG assets: `sketch-concentric.svg`, `sketch-midpoint.svg`, `sketch-normal.svg`, `sketch-pierce.svg`, `sketch-symmetric.svg`, and `sketch-fix.svg`.
- [x] 1.4 Add or update toolbar registry tests proving the new tools are exposed in sketch mode and use the expected icon IDs/assets.

## 2. Constraint Registry Behavior

- [x] 2.1 Extend `SketchConstraintToolId` and `SketchConstraintDefinition` registry coverage for the six new tool IDs.
- [x] 2.2 Implement Concentric target resolution, preview, and commit contribution for local `concentric` and projected `concentricProjectedCurve` constraints.
- [x] 2.3 Implement Midpoint target resolution, preview, and commit contribution for local `midpoint` and projected `midpointProjectedLine` constraints.
- [x] 2.4 Implement Pierce target resolution, preview, and commit contribution for local `pointOnCurve` and projected `pointOnProjectedCurve` constraints.
- [x] 2.5 Implement Fix Geometry target resolution, preview, and commit contribution for points, lines, circles, arcs, and splines without committing partial results for unsupported targets.
- [x] 2.6 Implement Normal target resolution, preview, and commit contribution for a line, circle or arc, and editable contact point.
- [x] 2.7 Implement Symmetric target resolution, preview, and commit contribution for two editable points and a local or projected line axis.

## 3. Contracts And Solver

- [x] 3.1 Confirm whether Normal and Symmetric can be represented with existing durable constraints without helper sketch geometry.
- [x] 3.2 If needed, add narrow durable constraint shapes and runtime schemas for normal and symmetric local/projected relationships.
- [x] 3.3 Add solver validation and residual handling for any new durable constraint shapes.
- [x] 3.4 Add solver tests proving concentric, midpoint, pierce, fix geometry, normal, and symmetric relationships solve as specified.
- [x] 3.5 Add runtime-schema tests for any new durable constraint payloads.

## 4. Sketch Session And Annotations

- [x] 4.1 Update constraint deletion/reference helpers for any new durable constraint kinds and generated fix-geometry records.
- [x] 4.2 Add annotation glyph kinds for concentric, midpoint, normal, pierce, symmetric, and fixed geometry where missing.
- [x] 4.3 Map the new annotation glyphs to the same dedicated SVG icon assets used by the toolbar.
- [x] 4.4 Add annotation tests proving committed constraints expose the expected glyphs and affected geometry refs.

## 5. Authoring Tests

- [x] 5.1 Add registry/session tests for Concentric local and projected authoring.
- [x] 5.2 Add registry/session tests for Midpoint local and projected authoring.
- [x] 5.3 Add registry/session tests for Pierce local and projected authoring.
- [x] 5.4 Add registry/session tests for Fix Geometry on point, line, and circle targets.
- [x] 5.5 Add registry/session tests for Normal valid and invalid target flows.
- [x] 5.6 Add registry/session tests for Symmetric local and projected axis flows.

## 6. Verification

- [x] 6.1 Run `bun run test`.
- [x] 6.2 Run `bun run lint`.
- [x] 6.3 Run `bun run build`.
