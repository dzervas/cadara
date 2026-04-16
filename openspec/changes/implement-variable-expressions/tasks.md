## 1. Dependency and Shared Expression Engine

- [x] 1.1 Add `mathjs` to runtime dependencies and refresh the Bun lockfile.
- [x] 1.2 Create a shared document variable expression helper that validates names, parses math.js value expressions, collects document-variable references, detects duplicate names and cycles, and evaluates variables in dependency order.
- [x] 1.3 Add focused `bun:test` coverage for the helper covering simple literals, complex math expressions, dependent expressions such as `y = x + 50`, chained dependencies, invalid syntax, unresolved references, cycles, duplicate/invalid names, and non-finite results.

## 2. Mutation Validation

- [x] 2.1 Integrate the shared helper into mock document variable add/update mutations so invalid candidate variable sets return rejected mutation diagnostics without changing the snapshot.
- [x] 2.2 Integrate the shared helper into OpenCascade-backed document variable add/update mutations so invalid candidate variable sets return rejected mutation diagnostics without changing authoring state.
- [x] 2.3 Add mutation-path tests proving accepted expressions persist raw `valueText` and rejected expressions leave document variables unchanged.

## 3. Persistence and Contract Safety

- [x] 3.1 Verify document snapshots and operation-history entries continue to store only `variableId`, `name`, and raw `valueText`, not calculated values, ASTs, dependency graphs, or validation diagnostics.
- [x] 3.2 Update existing variable persistence/replay tests where needed so replay restores raw expressions and dependent expressions remain evaluable after refresh.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
