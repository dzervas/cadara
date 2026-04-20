## 1. Edit Tool Definitions

- [x] 1.1 Add sketch edit tool ids, metadata, icons, and registration for fillet, chamfer, extend, split, and slot.
- [x] 1.2 Define selection requirements, preview labels, validation messages, and accepted mutation contracts for each operator.
- [x] 1.3 Ensure sketch-mode tools are distinct from existing part-mode feature tools with overlapping names.

## 2. Geometry Operations

- [x] 2.1 Add or harden shared curve intersection, split, extend, fillet, and chamfer helpers.
- [x] 2.2 Implement sketch fillet and chamfer mutations for supported adjacent curves.
- [x] 2.3 Implement extend and split mutations for supported curves.
- [x] 2.4 Implement slot generation around selected line, spline, arc, or closed profile references.

## 3. Session And Viewport Integration

- [x] 3.1 Wire edit operators into sketch session state, target selection, preview, and validation flows.
- [x] 3.2 Preserve sketch-local history, active session state, construction/style behavior, and stable references where possible.
- [x] 3.3 Add unsupported-case diagnostics for valid but unimplemented operator combinations.

## 4. Verification

- [x] 4.1 Add operation-level and sketch-session tests for each edit operator.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
- [x] 4.4 Run `bun run build`.
