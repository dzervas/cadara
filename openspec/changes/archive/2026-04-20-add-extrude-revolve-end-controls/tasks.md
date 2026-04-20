## 1. Contracts

- [x] 1.1 Add typed extent mode, end-condition, and up-to offset contracts for extrude and revolve.
- [x] 1.2 Add runtime schema validation for one-side, symmetric, and two-side extent modes.
- [x] 1.3 Add authored value metadata for depth, angle, draft angle, and up-to offsets.
- [x] 1.4 Bump extrude and revolve feature schema versions or add an explicit compatibility path for legacy extent shapes.
- [x] 1.5 Add operation-history and snapshot hydration tests for advanced extent contracts and legacy blind/angle extent replay.

## 2. Feature Authoring

- [x] 2.1 Update extrude draft lifecycle, patches, form schema, and buildDefinition for advanced end conditions and up-to offsets.
- [x] 2.2 Update revolve draft lifecycle, patches, form schema, and buildDefinition for full/blind/up-to end conditions and offsets.
- [x] 2.3 Add diagnostics for missing required `upToFace`, `upToPart`, and `upToVertex` targets, while keeping `upToNext` targetless.
- [x] 2.4 Add authoring tests for symmetric, two-side, up-to-next, and through-all states.

## 3. OCC Geometry

- [x] 3.1 Implement OCC extrude geometry for blind, up-to-next, up-to-face, up-to-part, up-to-vertex, through-all, and up-to offsets.
- [x] 3.2 Implement OCC extrude draft handling for one-side, symmetric, and two-side extents.
- [x] 3.3 Implement OCC revolve geometry for full, blind, up-to end conditions, and up-to offsets.
- [x] 3.4 Add adapter diagnostics for ambiguous or impossible termination.
- [x] 3.5 Add OCC adapter tests for supported and failure cases.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
