## Context

Document variables already exist as ordered durable records with `variableId`, `name`, and raw `valueText`. Add/update mutations currently persist those strings without evaluating them, and the existing spec requires validation state and calculated values to stay out of document records.

This change turns `valueText` into a math.js expression while preserving that persistence contract. Both the mock adapter and OpenCascade adapter currently own variable mutation behavior, so validation has to be shared rather than duplicated.

## Goals / Non-Goals

**Goals:**
- Evaluate document variable expressions with math.js.
- Resolve variables against other variables in the same document, including dependency chains.
- Validate variable names, expression syntax, unresolved references, duplicate names, cycles, and non-finite results before accepting add/update mutations.
- Persist only raw `name` and `valueText` strings in document records and operation history.
- Cover simple literals, complex expressions, dependency chains, and validation failures with focused `bun:test` tests.

**Non-Goals:**
- Use variables inside feature parameter forms or feature rebuild geometry in this slice.
- Persist evaluated values, expression ASTs, dependency graphs, diagnostics, or invalid flags.
- Add unit conversion or CAD parameter typing beyond what math.js evaluation returns for document variables.
- Add a new UI workflow beyond surfacing the existing mutation diagnostics/invalid runtime state.

## Decisions

### Put expression behavior in a shared domain helper

Create a small shared module for document variable expressions, likely under `src/domain/modeling/`, that exposes validation/evaluation over a candidate ordered variable list. Add/update flows build the candidate list first, call the helper, and only mutate snapshots/authoring state when validation succeeds.

Alternative considered: evaluate directly inside each adapter. That would duplicate dependency, cycle, and diagnostic behavior across mock and OCC paths and make tests easier to pass in one adapter while failing in the other.

### Keep persisted variable records raw

`DocumentVariableRecord` continues to store only `variableId`, `name`, and `valueText`. The evaluator may return a runtime result map for tests and future consumers, but mutation persistence and operation history continue to write the authored strings.

Alternative considered: cache evaluated values on the document snapshot. That would violate the existing persistence requirement and create stale-data risks whenever dependencies change.

### Validate with math.js parse/evaluate and explicit graph checks

Use math.js as the expression engine. The helper should parse each `valueText`, reject non-value expression forms such as assignments, collect symbol references that match document variable names, and topologically evaluate variables so expressions like `y = x + 50` resolve through the current candidate document state.

Name validation should be intentionally small: require non-empty math-compatible identifiers and reject duplicate names. Expression validation should reject parse errors, unresolved variable references, dependency cycles, and results that are not finite numeric/math.js values acceptable for document variables.

Alternative considered: use ad hoc string parsing for dependencies and arithmetic. That would be smaller initially but brittle for complex expressions and inconsistent with the requested math.js engine.

### Reject invalid mutations through existing modeling diagnostics

Invalid add/update requests should return the existing rejected mutation shape with error diagnostics and no snapshot mutation. Diagnostic codes should be stable enough for tests to assert high-signal categories, such as invalid variable name, duplicate variable name, invalid expression, unresolved variable reference, dependency cycle, or non-finite result.

Alternative considered: accept invalid records and mark them only in UI runtime state. That matches the previous UI placeholder behavior but does not implement actual validation logic.

## Risks / Trade-offs

- [math.js symbol ambiguity] Built-in function and constant names can be confused with user variables. Mitigation: validate variable names as identifiers and treat references to known document variable names as dependencies while allowing math.js built-ins to resolve normally.
- [Cycles hidden through dependency chains] A variable may indirectly depend on itself. Mitigation: build a dependency graph from parsed expressions and reject cycles before evaluation.
- [Expression results may include units or complex objects] math.js can return richer values than plain numbers. Mitigation: start with finite numeric results unless implementation tests intentionally accept a narrower math.js value type; leave feature-parameter unit support out of scope.
- [Validation can diverge between adapters] Mock and OCC mutations currently live in separate modules. Mitigation: adapters must call the same helper and tests should cover shared helper behavior plus at least one mutation rejection path.
