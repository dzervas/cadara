## 1. Runtime And Selection Flow

- [x] 1.1 Wire the `Measure` toolbar action into the editor runtime so it starts a real temporary command session instead of a logging-only subscriber path.
- [x] 1.2 Add a `measure` command selection filter that accepts measurable geometry targets and supports one-target and two-target measurement selection behavior.
- [x] 1.3 Implement measurement-selection lifecycle rules for first target, compatible second target, replacement with a new selection, tool cancellation, and explicit selection clearing.

## 2. Measurement Resolution

- [x] 2.1 Add a measurement domain module that resolves the active measurement selection into compact readout rows and retained viewport witness geometry.
- [x] 2.2 Implement single-target measurements for bodies, faces, linear edges, circles, arcs, and splines, including face perimeter/boundary lengths and solid volume/surface area where available.
- [x] 2.3 Implement supported two-target minimum-distance-style measurements for vertex/edge/face combinations and return only applicable populated fields.
- [x] 2.4 Define formatting and visibility rules so inapplicable labels are hidden instead of rendering zero or placeholder values.

## 3. Viewport And Overlay Presentation

- [x] 3.1 Render retained measurement witness geometry in the viewport using a bright yellow thicker-than-normal line treatment with a soft halo.
- [x] 3.2 Clear stale retained measurement geometry whenever the active measurement selection is replaced, cleared, or the `Measure` tool exits.
- [x] 3.3 Add a bottom-left measurement panel positioned to the right of the state debugger and bind it to the derived measurement view model.
- [x] 3.4 Ensure the panel stays compact and only renders populated measurement rows for the current selection.

## 4. Tests And Verification

- [x] 4.1 Add or update runtime/state tests covering Measure activation, accepted target selection, two-target pairing, replacement behavior, and cleanup on cancel or selection clear.
- [x] 4.2 Add or update measurement-domain tests covering line, arc, circle, spline, face, body, and supported pairwise measurement outputs.
- [x] 4.3 Add or update viewport and overlay tests covering debugger-adjacent panel rendering, hidden inapplicable labels, retained highlight styling, and stale-feedback cleanup.
- [x] 4.4 Run `bun run test`.
- [x] 4.5 Run `bun run lint`.
- [x] 4.6 Run `bun run build`.
