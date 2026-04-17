## 1. Region and Solver Contract

- [x] 1.1 Extend region extraction to include projected geometry boundary segments when local and projected geometry form closed loops.
- [x] 1.2 Preserve projected boundary segment identity using authored reference IDs and projected geometry IDs.
- [x] 1.3 Add validation that projected profile boundaries are derived from live references and are not copied into local sketch points or entities.
- [x] 1.4 Add tests for mixed local/projected loops and projected-only loops where supported.

## 2. OCC Profile Reconstruction

- [x] 2.1 Pass active projected reference geometry into OCC profile-building paths that consume sketch regions.
- [x] 2.2 Reconstruct OCC wires from projected point, line, circle, and arc segment geometry without creating local sketch entities.
- [x] 2.3 Replace the projected-region-loop rejection only for cases backed by resolvable live projection data.
- [x] 2.4 Report explicit diagnostics when live projected boundary segments cannot be resolved.

## 3. Feature Rebuild and Invalidation

- [x] 3.1 Preserve live-derived projected profile references across document rebuild and feature replay.
- [x] 3.2 Ensure topology invalidation keeps authored references and reports machine-readable invalidation reasons.
- [x] 3.3 Add tests proving referenced geometry is never copied into sketch-owned points or entities for projected profile boundaries.

## 4. Verification

- [x] 4.1 Add focused `bun:test` coverage for projected-region extraction, OCC profile reconstruction, and invalidation diagnostics.
- [x] 4.2 Run `bun run test`.
- [x] 4.3 Run `bun run lint`.
