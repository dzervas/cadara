## Why

Document variables now validate and evaluate as math expressions, but feature authoring still stores the values users edit as concrete typed literals. Users need non-reference feature editor values such as distances, angles, toggles, and enum-like options to accept authored expressions while preserving the current solver/kernel expectation that rebuild inputs are already resolved to concrete types.

## What Changes

- Add an authored value wrapper for feature-editor values that can either hold a typed literal or raw expression text.
- Apply the wrapper only to values exposed by feature editor forms, excluding reference picker and reference collection fields.
- Resolve authored expressions in a distinct modeling step against evaluated document variables and math.js before preview, commit, rebuild, or feature execution.
- Keep solver, mock kernel, OCC kernel, and low-level geometry code operating on resolved concrete values so expression handling does not leak through geometry execution paths.
- Support value-kind-specific resolution and validation for the feature form vocabulary, including floats, positive numbers, angles, booleans, enums/strings, and integer-like values where a feature field requires them.
- Preserve raw authored expression text in durable feature definitions and operation history, while keeping parsed ASTs, calculated values, dependency graphs, and diagnostics runtime-only.
- Leave feature editor UI rendering changes out of this slice except for contract/schema support needed by current type-specific forms.

## Capabilities

### New Capabilities
- `feature-value-expressions`: Authored expressions for non-reference feature-editor values, including raw persistence, runtime resolution, diagnostics, and resolver boundary rules.

### Modified Capabilities
- `feature-editor-form-schema`: Non-reference form fields can describe expression-capable authored values without making reference fields expression-capable.
- `feature-authoring-definition`: Feature drafts and draft-to-definition builders preserve authored values and declare enough value-kind metadata for expression resolution without importing kernel logic.
- `durable-modeling-contract`: Durable feature definitions and operation history persist authored value wrappers for eligible fields while rebuild execution consumes resolved concrete definitions.
- `runtime-contract-validation`: Shared runtime schemas validate authored value wrappers and legacy literal compatibility at contract and persistence boundaries.

## Impact

- Affected contracts: modeling feature parameter types, advanced solid feature options, operation history payloads, runtime schemas, and feature type/schema version handling.
- Affected domain code: feature authoring drafts, form adapters, draft patching, feature definition building, preview/commit request preparation, history replay, and expression resolution helpers.
- Affected adapters: mock and OpenCascade modeling adapters should receive resolved concrete feature definitions or call a shared resolver before rebuild; expression parsing should not be duplicated per adapter.
- Affected validation: expression diagnostics must identify invalid syntax, unresolved document variables, unsupported result types, non-finite numbers, failed positive/integer constraints, and unsupported expression use on reference fields.
- Out of scope: sketch point/dimension expression support, arbitrary document payload expressions, expression-enabled reference selection, and a redesigned feature editor UI.
