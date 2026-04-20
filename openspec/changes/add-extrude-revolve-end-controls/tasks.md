## 1. Contracts

- [ ] 1.1 Add typed extent mode, end-condition, and up-to offset contracts for extrude and revolve.
- [ ] 1.2 Add runtime schema validation for one-side, symmetric, and two-side extent modes.
- [ ] 1.3 Add authored value metadata for depth, angle, draft angle, and up-to offsets.
- [ ] 1.4 Bump extrude and revolve feature schema versions or add an explicit compatibility path for legacy extent shapes.
- [ ] 1.5 Add operation-history and snapshot hydration tests for advanced extent contracts and legacy blind/angle extent replay.

## 2. Feature Authoring

- [ ] 2.1 Update extrude draft lifecycle, patches, form schema, and buildDefinition for advanced end conditions and up-to offsets.
- [ ] 2.2 Update revolve draft lifecycle, patches, form schema, and buildDefinition for full/blind/up-to end conditions and offsets.
- [ ] 2.3 Add diagnostics for missing required `upToFace`, `upToPart`, and `upToVertex` targets, while keeping `upToNext` targetless.
- [ ] 2.4 Add authoring tests for symmetric, two-side, up-to-next, and through-all states.

## 3. OCC Geometry

- [ ] 3.1 Implement OCC extrude geometry for blind, up-to-next, up-to-face, up-to-part, up-to-vertex, through-all, and up-to offsets.
- [ ] 3.2 Implement OCC extrude draft handling for one-side, symmetric, and two-side extents.
- [ ] 3.3 Implement OCC revolve geometry for full, blind, up-to end conditions, and up-to offsets.
- [ ] 3.4 Add adapter diagnostics for ambiguous or impossible termination.
- [ ] 3.5 Add OCC adapter tests for supported and failure cases.

## 4. Verification

- [ ] 4.1 Run `bun run test`.
- [ ] 4.2 Run `bun run lint`.
- [ ] 4.3 Run `bun run build`.
