## Why

Sketch mirror, pattern, and transform tools must preserve relationships to their source geometry rather than creating static copies. This change adds durable referenced and related sketch geometry so transformed results can remain associated with their seeds across edits.

## What Changes

- Add sketch-mode mirror, linear pattern, circular pattern, and transform operators.
- Keep these separate from existing part-mode mirror/transform/pattern feature tools.
- Add durable relationship records or equivalent authored graph structures that bind derived geometry to seed geometry and transform parameters.
- Ensure seed edits, history navigation, selection, persistence, and validation preserve supported derived relationships.

## Capabilities

### New Capabilities
- `sketch-derived-transform-operators`: Durable associative sketch mirror, pattern, and transform operators.

### Modified Capabilities

## Impact

- Affects sketch contracts, runtime validation, sketch session edit state, solver/snapshot handling, rendering, profile extraction, operation history, and toolbar registration.
- Should be implemented after primitive constructors and expanded entity support so derived relationships can target the full sketch graph.
- Requires careful unsupported-case diagnostics for relationships the solver or profile extractor cannot yet maintain.
