## 1. Projection Boundary

- [x] 1.1 Add a modeling-service projection entry point for active sketch external references using the existing `ProjectSketchExternalReferencesRequest` / `ProjectSketchExternalReferencesResponse` shape.
- [x] 1.2 Extend the modeling kernel adapter boundary, mock kernel adapter, and OCC kernel adapter to resolve projection requests against the requested document revision.
- [x] 1.3 Route editor `sketch.projectReferences` effects through the source-aware modeling projection entry point instead of the standalone sketch solver fallback.
- [x] 1.4 Ensure stale projection responses are ignored by existing request/document/revision correlation tests.

## 2. Source Resolution

- [x] 2.1 Implement shared helpers for stable projected geometry IDs, sketch-plane coordinate mapping, and projection diagnostics.
- [x] 2.2 Resolve supported existing sketch points and entities into projected point, line segment, circle, or arc records.
- [x] 2.3 Resolve supported model vertices and linear/circular/arc edges in the mock and OCC-backed adapters.
- [x] 2.4 Resolve representable coplanar planar face boundary segments, and return explicit ambiguity or unsupported diagnostics when the face cannot be represented safely.
- [x] 2.5 Preserve authored references and non-`projected` statuses for missing, stale, out-of-plane, unsupported, or ambiguous sources.

## 3. Sketch Lifecycle Integration

- [x] 3.1 Refresh projected references during active sketch editing after a reference is accepted or deleted.
- [x] 3.2 Feed live projected records into commit validation, solving, and derived region extraction.
- [x] 3.3 Persist committed projected reference records on sketch snapshots and hydrate them during sketch re-entry before refreshed projection results arrive.
- [x] 3.4 Ensure document reload/rebuild paths refresh projected records for the active revision without mutating authored sketch geometry.

## 4. Downstream Behavior

- [x] 4.1 Verify sketch display, selection, deletion, and snapping consume live projected records as read-only reference geometry.
- [x] 4.2 Verify supported constraint authoring stores projected operands and solving treats projected geometry as fixed input.
- [x] 4.3 Verify region extraction can derive mixed local/projected profile loops from active projection records.
- [x] 4.4 Verify OCC profile construction uses active projected boundary geometry and reports invalidation when projection data is missing.

## 5. Tests and Verification

- [x] 5.1 Add domain tests for source-backed projection of existing sketch points/entities and model vertex/edge/face sources.
- [x] 5.2 Add editor runtime tests for projection effect routing, stale response handling, active edit refresh, and sketch re-entry hydration.
- [x] 5.3 Add kernel/modeling tests for commit persistence, rebuild invalidation diagnostics, and operation-history reload behavior.
- [x] 5.4 Add region/profile/constraint tests covering mixed local/projected loops and projected constraint operands.
- [x] 5.5 Run `bun run test` and `bun run lint`.
