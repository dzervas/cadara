## 1. Contract And Runtime Schema

- [ ] 1.1 Add authored sketch entity variants for ellipse, elliptical arc, conic, Bezier curve, and profile-generating text.
- [ ] 1.2 Update zod runtime schemas and contract examples to validate valid and invalid advanced entity payloads.
- [ ] 1.3 Update shared ids/references helpers only where needed to keep advanced entities addressable as sketch targets.

## 2. Solver, Snapshot, And Persistence

- [ ] 2.1 Extend solved sketch snapshot records and validation so advanced entities round-trip without lossy coercion.
- [ ] 2.2 Update document persistence, operation-history fixtures, and snapshot hydration tests for the new entity kinds.
- [ ] 2.3 Add explicit diagnostics for supported-contract but unsupported-solver combinations.

## 3. Rendering And Profiles

- [ ] 3.1 Render advanced entities in active and committed sketch displays using existing sketch style and construction conventions.
- [ ] 3.2 Extend profile extraction for supported advanced curves and profile-generating text outlines.
- [ ] 3.3 Add unsupported profile diagnostics for valid entities that cannot yet create profile boundaries.

## 4. Verification

- [ ] 4.1 Add focused contract, runtime-schema, snapshot, rendering, and profile extraction tests.
- [ ] 4.2 Run `bun run test`.
- [ ] 4.3 Run `bun run lint`.
- [ ] 4.4 Run `bun run build`.
