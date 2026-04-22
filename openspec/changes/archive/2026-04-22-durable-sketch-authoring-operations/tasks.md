## 1. Contract And Persistence

- [x] 1.1 Extend the sketch authored contract with optional durable `authoringOperations` metadata and typed operation/member references.
- [x] 1.2 Update sketch runtime schema parsing and normalization to accept missing legacy operation metadata without rejecting existing documents.
- [x] 1.3 Preserve `authoringOperations` through commit sketch requests, operation history persistence, document save/load, and reopened sketch hydration.
- [x] 1.4 Add contract/runtime tests for persistence, legacy missing metadata, and round-tripping operation ids, labels, kinds, and target references.

## 2. Sketch Session Operation Authoring

- [x] 2.1 Update sketch constructor commit paths so one accepted drawing action appends one authoring operation containing created geometry, constraints, dimensions, and inferred snap constraints.
- [x] 2.2 Update manual constraint and dimension authoring so each accepted constraint or dimension appends its own authoring operation.
- [x] 2.3 Update geometry, constraint, dimension, and annotation deletion so deleted members are removed from the live flat graph and a separate delete operation is appended.
- [x] 2.4 Update explicit operation edit paths, such as editing a rectangle width value, so they mutate the targeted operation metadata and corresponding live graph records without appending delete/add operations.
- [x] 2.5 Add sketch-session tests for rectangle creation, inferred constraints, delete edge from rectangle, add/delete/add constraint, rectangle delete/recreate, and explicit operation edit behavior.

## 3. Cursor And History Display

- [x] 3.1 Update sketch-local history item derivation to prefer durable authoring operation rows and use flat-record fallback only for legacy sketches without metadata.
- [x] 3.2 Update sketch cursor movement and insertion-after-cursor logic to operate on authoring operation boundaries and rebuild the active flat graph for the cursor.
- [x] 3.3 Update active sketch history UI to render operation rows only, without expandable geometry child rows.
- [x] 3.4 Add tests covering operation-row display, undo/redo by operation, insert after rolled-back operation cursor, and reopened sketch-local history.

## 4. Solver And Graph Isolation

- [x] 4.1 Ensure solver, dragged-handle solve, region extraction, rendering, picking, selection, and commit payload paths consume only the active flat sketch graph.
- [x] 4.2 Add tests proving different operation metadata over the same flat graph does not change solved output.
- [x] 4.3 Add tests proving deleted historical targets are absent from current solver input, renderable output, selection targets, and commit payloads.

## 5. Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
- [x] 5.3 Run `bun run build`.
