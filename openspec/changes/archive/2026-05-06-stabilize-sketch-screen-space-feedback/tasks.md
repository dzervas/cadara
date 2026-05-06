## 1. Viewport Sizing Seam

- [x] 1.1 Audit active sketch wire and marker rendering paths to identify every world-sized stroke, marker, and pick proxy used during sketch editing.
- [x] 1.2 Refactor the sketch world-units-per-pixel helper into a shared viewport sizing seam usable by polylines, markers, and pick proxies.
- [x] 1.3 Define active sketch pixel-size bounds for default wires, construction/reference wires, diagnostic overlays, point markers, overlay markers, and marker pick proxies.

## 2. Active Sketch Rendering

- [x] 2.1 Route active sketch wires that need reliable thickness through mesh stroke geometry instead of browser-dependent native line width behavior.
- [x] 2.2 Update default, construction, reference, hover, selection, diagnostic, and authored SVG stroke paths to preserve existing colors, opacity, dash, cap, join, and diagnostic behavior while using screen-space sizing.
- [x] 2.3 Update active sketch marker meshes to derive visible radius from the current camera and pixel-size bounds.
- [x] 2.4 Update active sketch marker pick proxies from the same screen-space sizing model as visible markers without changing durable target bindings.
- [x] 2.5 Keep inactive document renderables and non-authoring geometry on their existing sizing behavior unless they naturally share the active sketch path.

## 3. Verification

- [x] 3.1 Add or update UI-lane Bun coverage for the shared sizing helper, proving orthographic and perspective world-units-per-pixel behavior across zoom levels.
- [x] 3.2 Add or update UI-lane Bun coverage for marker visible radius and pick proxy radius staying within active-sketch pixel bounds after zoom changes.
- [x] 3.3 Add or update UI-lane Bun coverage for active sketch stroke geometry preserving styling while changing world thickness as camera scale changes.
- [x] 3.4 Run focused UI-lane tests for the touched viewport seams.
- [x] 3.5 Run live browser or Playwright verification that an active sketch remains visibly legible after zooming out.
- [x] 3.6 Run `bun run test:all` after the implementation is complete.
