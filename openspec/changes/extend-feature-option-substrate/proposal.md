## Why

Advanced solid features need richer options than the current flat numeric/boolean form vocabulary can express. Without a shared option substrate, extrude, revolve, sweep, and loft will each reimplement enum groups, conditional fields, authored values, and validation differently.

## What Changes

- Add a shared advanced feature option contract for typed option descriptors, discriminated option groups, conditional option visibility, and reusable option validation.
- Extend the feature editor form schema so generic feature editors can render nested/conditional option groups without feature-specific UI branches.
- Ensure expression-capable advanced feature option values preserve authored literal/expression sources consistently with existing feature value behavior.
- Keep durable references as participants or reference fields, not expression-authored option values.
- Do not move existing core feature definitions into a generic options bag; typed feature contracts can reuse the shared option primitives.

## Capabilities

### New Capabilities
- `advanced-feature-option-contract`: Shared typed option descriptor and validation behavior for advanced feature options.

### Modified Capabilities
- `feature-editor-form-schema`: Add nested, conditional, and discriminated option fields for generic feature editors.
- `feature-value-expressions`: Extend authored expression handling to advanced option values.

## Impact

- Affects `src/contracts/modeling/advanced-solid.ts`, `src/contracts/modeling/authored-values.ts`, feature authoring definitions, feature form schema/adapters, and generic inspector rendering.
- Provides prerequisite structure for advanced extrude/revolve, sweep, and loft option proposals.
- No new external dependency is expected.
