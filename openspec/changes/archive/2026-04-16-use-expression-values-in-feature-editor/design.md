## Context

Document variables already store durable `name` and raw `valueText` strings, and the shared variable evaluator validates math.js expressions, dependency chains, cycles, unresolved references, and finite numeric results at runtime. That implementation deliberately keeps parsed ASTs, calculated values, and diagnostics out of persisted variable records.

Feature authoring is still literal-first. Feature drafts expose typed values such as `depth: number`, `radius: number`, `angle: number`, `copy: boolean`, and operation strings. Feature definitions persist those values directly in modeling payloads, and mock/OCC execution paths assume concrete values, for example positive numeric distances and radii. The feature editor form schema is also type-specific: numeric fields parse user input into numbers, enum fields carry strings, and reference fields carry durable references.

This change is about values that the user sees and edits through the feature editor form, excluding reference picker and reference collection fields. Sketch point and dimension expressions are intentionally not included in this slice.

## Goals / Non-Goals

**Goals:**
- Introduce a durable authored-value wrapper that can represent either a typed literal or raw expression text for eligible feature editor values.
- Resolve authored expressions through one shared runtime step before preview, commit, rebuild, solver calls, mock kernel execution, or OCC execution.
- Keep expression parsing, dependency lookup, type coercion, and diagnostics out of low-level geometry and adapter-specific feature code.
- Preserve raw expression text in durable feature definitions and operation history, while keeping calculated values runtime-only.
- Support value-kind-specific resolution for floats, positive numbers, integers, booleans, strings/enums, and angles where those kinds appear in feature editor form fields.
- Maintain backward compatibility for existing literal feature definitions through schema-versioned normalization or migration.

**Non-Goals:**
- Enabling expressions for references, selected topology, participant targets, feature kind discriminants, IDs, labels, or arbitrary document payload fields.
- Enabling sketch point, circle radius, dimension, or constraint expressions in this change.
- Rebuilding the feature editor UI. Current type-specific forms may keep their current controls while the contracts and domain layer learn authored values.
- Persisting parsed math.js ASTs, evaluated values, dependency graphs, validation state, or expression diagnostics.
- Teaching OCC, solver, or low-level geometry helpers to interpret expression wrappers.

## Decisions

### Use an explicit authored-value wrapper

Represent expression-capable values with a discriminated wrapper, conceptually:

```ts
type AuthoredValue<T> =
  | { source: 'literal'; value: T }
  | { source: 'expression'; valueText: string }
```

The wrapper should be used only on fields that are deliberately expression-capable. Existing reference fields and durable refs stay structurally unchanged.

Alternative considered: `T | string`. That is too ambiguous in this codebase because strings already represent enum values, IDs, labels, operation names, and raw variable names. A discriminated wrapper lets runtime schemas reject expression use where it is not supported.

### Resolve expressions in a distinct modeling step

Add a shared resolver that accepts an authored feature definition, current document variables, and feature value metadata, then returns either a resolved concrete feature definition or diagnostics. The resolved definition should match the concrete shapes that mock/OCC and solver-facing code already expect.

This boundary should sit before preview and commit execution, and before any rebuild path that consumes committed authored features. Kernel adapters may call the resolver at their boundary, but expression behavior must not be reimplemented per adapter.

Alternative considered: Make every feature executor and geometry helper call `resolveValue(...)` at each numeric use site. That would spread expression semantics through OCC, mock geometry, and solver code, making type errors and stale behavior much harder to control.

### Use value-kind descriptors rather than one generic conversion

Each expression-capable field needs a value-kind descriptor that validates the math.js result against the same domain rules as the literal field. The initial descriptors should cover:

- finite float
- positive finite float
- integer or non-negative integer where needed
- angle in radians, with UI conversion kept outside resolver semantics
- boolean
- string
- enum string constrained to a declared option set

For boolean fields, expressions such as comparisons may resolve to booleans. For enum/string fields, expressions must resolve to strings and enum fields must match an allowed option. Numeric fields must reject non-finite results and type mismatches.

Alternative considered: Reuse the document-variable evaluator's current finite-number-only result map for all values. That is insufficient for feature editor booleans, enums, and string-like fields.

### Preserve authored values in durable definitions and history

Durable feature definitions should store the wrapper, not the resolved result. Operation history should replay the same authored wrapper so editing preserves original expression text.

Resolved values may be recomputed for runtime previews and rebuilds, but must not be written back into the authored feature definition as a cache.

Alternative considered: Store both `valueText` and `resolvedValue` to make rebuild faster. That creates stale-data failure modes whenever variables change and conflicts with the current variable persistence rule.

### Version and normalize the contract deliberately

Because current feature definitions persist literal values directly, the implementation should either bump affected feature type schema versions or add explicit legacy normalization that maps prior literals into `{ source: 'literal', value }`. New writes should be canonical: eligible fields use wrappers, while unsupported fields remain unchanged.

Runtime schemas should accept supported legacy payloads only through deliberate migration paths, not through ad hoc field checks.

Alternative considered: Silently accept both wrappers and raw literals indefinitely throughout domain code. That would weaken the contract and make it unclear which shape feature authoring modules are supposed to produce.

### Keep feature authoring responsible for value metadata, not resolution

Feature authoring definitions should declare the form field value kinds and build authored feature definitions from drafts. They should not evaluate expressions or import kernel code. The shared resolver should use the field/value metadata to resolve and validate the authored definition.

Alternative considered: Let each feature authoring definition resolve its own expressions in `buildDefinition`. That duplicates math.js handling and makes preview/commit/rebuild behavior diverge across features.

## Risks / Trade-offs

- [Large contract churn] Wrapping current feature parameters touches many feature definitions, tests, normalizers, and history replay paths. Mitigation: implement by feature/value-kind slices and keep legacy normalization focused.
- [Expression leakage] Adapter or OCC code may start branching on wrappers. Mitigation: add resolved-definition helpers and tests proving feature execution receives concrete values.
- [Boolean and enum ambiguity] math.js supports richer values than this app should accept. Mitigation: require value-kind descriptors to normalize exact allowed runtime types and reject mismatches with diagnostics.
- [Variable updates can invalidate features] A valid variable change may make a dependent feature resolve to an invalid value. Mitigation: accept the variable mutation if variable expressions are valid, then surface rebuild diagnostics against affected feature values without rewriting authored expressions.
- [Migration complexity] Existing histories contain raw literal feature parameters. Mitigation: schema-versioned normalizers convert supported legacy values to literal wrappers and tests cover replay before and after the change.

## Migration Plan

1. Add authored-value contract types, runtime schemas, and helpers that normalize legacy literals to literal wrappers.
2. Add shared expression resolution over document variables plus value-kind descriptors.
3. Convert feature drafts and feature definitions for current non-reference form fields to authored values, starting with numeric fields before booleans/enums if needed.
4. Resolve authored feature definitions before preview, commit, and rebuild execution, leaving mock/OCC feature execution on concrete values.
5. Update persistence and replay tests to prove raw expression text survives refresh while resolved values are recomputed.

Rollback is straightforward before persistence migration lands. After new authored wrappers are persisted, rollback requires legacy readers or a downgrade migration that replaces expression wrappers with their literal values only when they are literal-sourced.

## Open Questions

- Should enum/string expression support be enabled in the first implementation slice, or should the resolver support it while current UI only exposes numeric expression entry?
- Should affected feature type versions all bump at once, or should feature versions advance only as each feature's fields move to authored wrappers?
