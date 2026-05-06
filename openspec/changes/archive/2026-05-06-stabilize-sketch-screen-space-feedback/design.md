## Context

Active sketch editing currently mixes two display behaviors. Authored SVG-style strokes can use mesh stroke geometry sized from `getSketchStrokeWorldUnitsPerPixel`, but default sketch wires still use ordinary Three line primitives and sketch point renderables carry fixed `displayRadius` values in sketch/world units. When the user zooms out, those world-sized point affordances quickly collapse visually, and any stroke path that depends on world-space sizing or browser-native line behavior can become too thin to read or reliably target.

The product direction is a dense professional CAD viewport. Sketch authoring affordances should behave like screen-space drafting feedback: the geometry's position and shape zoom normally, while strokes, vertices, handles, and snap/datum point affordances retain usable pixel-scale visibility.

## Goals / Non-Goals

**Goals:**

- Make active sketch wire stroke width remain legible across representative zoom levels.
- Make active sketch point and handle markers remain legible across representative zoom levels.
- Centralize the camera-to-world pixel scale calculation so sketch wires, marker meshes, and marker pick proxies use the same viewport math.
- Preserve existing constraint-state colors, hover/selection colors, construction dashed styling, datum/reference styling, authored SVG stroke/fill behavior, and sketch picking targets.
- Add UI-lane tests for the exported sizing seam and live-path browser verification for zooming an active sketch.

**Non-Goals:**

- Change sketch geometry, solver output, persisted sketch data, or document file format.
- Change model-body, region-fill, datum-plane, or solid topology rendering.
- Redesign the sketch color palette or introduce new theme tokens.
- Make inactive committed sketches globally screen-space sized unless they are rendered through the active sketch authoring layer.

## Decisions

1. Treat active sketch feedback sizing as screen-space presentation, not sketch data.

   `displayRadius`, authored stroke width, and default line width are authoring presentation hints. The implementation should convert those hints to world units at the React/Three viewport boundary using the current camera and viewport height, then update render geometry as zoom changes. The sketch session and persisted sketch definition should continue to store geometric points, entities, styles, and operations only.

   Alternative considered: scale marker radii in `src/domain/editor/sketch-session/display.ts`. That would leak camera state into domain display construction and would make persisted or test-only display renderables depend on viewport state.

2. Reuse a shared world-units-per-pixel helper for sketch feedback.

   The existing `getSketchStrokeWorldUnitsPerPixel(camera, viewportHeight, points)` path is close to the needed seam for stroke meshes. It should become the shared sizing primitive for active sketch feedback and accept a stable anchor point or bounds input so markers, polylines, and pick proxies all derive from the same camera math.

   Alternative considered: use hardcoded distance-based scale factors per component. That would create drift between wires, points, and pick targets and would make orthographic and perspective behavior diverge.

3. Prefer mesh-based stroke geometry for active sketch wires that need reliable width.

   Native WebGL line width support is inconsistent and `LineBasicMaterial.linewidth` cannot be trusted as a cross-browser authoring contract. Active sketch wires should render through mesh stroke geometry when stable pixel thickness matters, including default sketch lines, construction lines, references, hover/selection/diagnostic overlays, and authored SVG-style strokes. Existing SVG cap/join/dash handling should be preserved.

   Alternative considered: switch to `Line2` / `LineMaterial` from Three examples. That is viable, but it introduces another line-rendering stack while the code already has SVGLoader-backed mesh stroke construction for authored styles. Mesh strokes are more consistent with existing cap/join work and easier to verify with ordinary geometry tests.

4. Scale marker visible meshes and pick proxies from pixel targets.

   Active sketch point renderables should keep the same logical `displayRadius`, but `SketchDisplayMarkerNode` should translate it into a pixel-clamped visible radius each frame. The visible sphere and invisible pick proxy should update together so what the user can see and what the user can click do not diverge. Pick proxy radius may remain larger than the visible marker, but it must be derived from the same world-units-per-pixel value.

   Alternative considered: leave pick proxies world-sized because projected picking already exists for some datum targets. That would fix visibility without fixing reachable interaction for ordinary point markers.

5. Keep the contract scoped to active sketch editing.

   The bug report is about sketch editing. Inactive document renderables can keep their current display rules unless they share code paths that are naturally safe to update. The proposal should avoid accidentally making all model vertices or inactive committed sketch points screen-space overlays.

   Alternative considered: make every wire and marker in the viewport screen-space sized. That is broader than the reported editing problem and risks changing feature topology presentation.

## Risks / Trade-offs

- Mesh strokes can create more geometry during zoom changes -> only regenerate when the derived pixel scale token changes meaningfully and reuse existing buffer update patterns.
- Pixel-clamped markers can look too large when zoomed far out -> define min/max pixel bounds rather than a single unbounded fixed size.
- Marker visible size and pick size can drift -> update both from the same helper and cover that with a UI-lane spec.
- Dashed construction lines can change dash cadence if dash units are interpreted differently -> keep authored/default dash sizes in pixel units for active feedback, while geometry positions remain in world space.
- E2E visual assertions can be flaky -> keep durable behavior coverage in UI-lane helper tests and use Playwright only as a smoke check for live active-sketch zoom behavior.
