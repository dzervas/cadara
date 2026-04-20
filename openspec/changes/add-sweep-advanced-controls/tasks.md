## 1. Contracts And Authoring

- [ ] 1.1 Add typed sweep option shape for profile control, twist, and scale.
- [ ] 1.2 Add participants or reference fields for lock profile faces with one or more face targets and lock profile direction with exactly one edge or construction target.
- [ ] 1.3 Update sweep draft creation, hydration, patching, validation, and buildDefinition.
- [ ] 1.4 Update sweep form schema with profile control, twist variant, and scale controls.

## 2. Geometry

- [ ] 2.1 Implement default and keep-profile-orientation sweep frame behavior in OCC.
- [ ] 2.2 Implement lock-profile-faces and lock-profile-direction behavior for supported references.
- [ ] 2.3 Implement twist by turns, angle, and pitch.
- [ ] 2.4 Implement proportional end scale along the sweep path.

## 3. Tests

- [ ] 3.1 Add authoring tests for every profile control option.
- [ ] 3.2 Add contract and persistence tests for active twist variants and scale.
- [ ] 3.3 Add OCC adapter tests for the minimum supported matrix: every profile control option, twist by turns, twist by angle, twist by pitch, and non-1 end scale.
- [ ] 3.4 Add diagnostics tests for missing lock references and invalid option values.

## 4. Verification

- [ ] 4.1 Run `bun run test`.
- [ ] 4.2 Run `bun run lint`.
- [ ] 4.3 Run `bun run build`.
