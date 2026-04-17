## Why

Once sketches can author and display projected reference geometry, constraints need to target that geometry directly. Without reference-aware constraint targets, users can see external geometry but cannot build durable parametric relationships to it.

## What Changes

- Extend sketch constraint target resolution to represent both local sketch geometry and projected reference geometry.
- Add durable constraint target forms for supported relationships between local sketch geometry and projected reference geometry.
- Teach the solver to evaluate the initial supported reference relationships.
- Render and select annotations that affect projected reference geometry without making the reference geometry editable.

## Capabilities

### New Capabilities
- `sketch-reference-constraint-targets`: Defines durable constraints and dimensions that target projected reference geometry.

### Modified Capabilities
- `sketch-constraint-authoring`: Constraint tools can collect projected reference geometry where the operation supports it.
- `sketch-constraint-solver`: Solver evaluation includes supported local-to-reference geometric relationships.
- `frontend-modeling-boundary`: Durable reference-targeted constraint mutations remain modeling-boundary actions.

## Impact

- Affected areas: sketch constraint schemas, runtime validation, solver loss terms, editor target resolution, annotation rendering, modeling mutation flow, and tests.
- Depends on `add-sketch-reference-geometry-authoring`.
- Does not add snap inference or automatic constraint authoring.
