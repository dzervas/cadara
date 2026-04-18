## 1. Command Routing And Tool Contracts

- [x] 1.1 Route `dimension` activation to the aligned distance dimension workflow and add reducer coverage that it stays in `editingSketch`.
- [x] 1.2 Add explicit sketch edit-tool definitions or equivalent domain registry entries for `trim` and `offset`.
- [x] 1.3 Remove `spline`, `dimension`, `trim`, and `offset` from passive/no-op sketch tool handling as each command gains real behavior.

## 2. Spline Authoring

- [x] 2.1 Extend sketch tool/domain types to support the chosen spline representation and staged multi-point preview.
- [x] 2.2 Add a registered `spline` sketch tool module with metadata, activation, pointer lifecycle, validation, presentation, and commit contribution behavior.
- [x] 2.3 Update runtime schemas, renderables, picking, and region/solver integration for persisted spline geometry where required.

## 3. Trim Authoring

- [x] 3.1 Add trim activation, hover/selection state, and generic presentation feedback for candidate trim targets.
- [x] 3.2 Implement trim draft mutation helpers for the supported first-version entity cases.
- [x] 3.3 Preserve stable sketch ids where possible and report validation feedback for unsupported or ambiguous trim targets.

## 4. Offset Authoring

- [x] 4.1 Add offset activation, entity selection, numeric distance control, side selection, and preview presentation.
- [x] 4.2 Implement offset draft mutation helpers for the supported first-version entity cases.
- [x] 4.3 Reject invalid offsets without changing the sketch draft and surface validation feedback.

## 5. Tests And Verification

- [x] 5.1 Add sketch tool registry/session tests for `spline`, `trim`, `offset`, and `dimension` activation behavior.
- [x] 5.2 Add domain tests for spline commit output, trim mutation output, and offset mutation output.
- [x] 5.3 Add viewport/renderable tests for new preview and persisted geometry display.
- [x] 5.4 Run `bun run test`.
- [x] 5.5 Run `bun run lint`.
