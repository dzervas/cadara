## Why

The sketch editor needs a direct Point constructor for standalone vertices and an explicit Collinear constraint for CAD-style alignment workflows. Onshape documents Point as a first-class sketch tool and represents line collinearity through Coincident; CADara should expose the clearer Collinear command while matching that underlying geometric behavior.

Assumption: `Collinear` is a dedicated CADara constraint tool and durable constraint kind, not a UI alias for `Coincident`, because the user asked for a co-linear constraint and non-overlapping/non-shared line alignment should remain understandable in the sketch history and annotations.

## What Changes

- Expose a sketch Point tool that creates a single durable sketch vertex at each accepted placement and keeps the active sketch session open.
- Ensure standalone sketch points participate in selection, snapping, deletion, persistence, commit, solve, and constraint authoring the same way entity-owned vertices do where applicable.
- Add a sketch-mode `Collinear` constraint tool with stable tool identity, toolbar metadata, search/dropdown availability, icon/glyph behavior, and validation feedback.
- Add durable collinear constraint records for supported editable local targets and supported projected/read-only line targets.
- Support Onshape-level collinearity behavior for line and point/line combinations:
  - line to line, including non-overlapping lines and lines that do not share vertices;
  - point to line in either selection order;
  - multiple selected lines and points constrained to the first selected line's underlying infinite geometry where the target set is valid.
- Reject unsupported combinations with existing sketch validation feedback instead of committing partial or silent no-op constraints.
- Add logic-lane coverage for tool registration, point authoring, durable collinear records, solver behavior, projected target handling, and invalid-target feedback, plus focused UI-lane coverage only where toolbar exposure or annotation rendering requires it.

## Capabilities

### New Capabilities
- `sketch-collinear-constraint`: Defines the explicit Collinear sketch constraint, supported target combinations, durable records, solver behavior, projected/read-only target support, annotations, and validation rules.

### Modified Capabilities
- `sketch-primitive-constructor-tools`: Clarifies that the Point constructor is reachable and commits standalone durable sketch points.
- `sketch-tool-definition`: Requires point and collinear additions to use the existing sketch tool/constraint definition seams rather than presentational branches.
- `sketch-tool-editor-schema`: Ensures the generic sketch tool presentation schema can express point placement guidance and collinear target-collection feedback.
- `sketch-constraint-authoring`: Extends first-class constraint authoring to include Collinear and its multi-target selection flow.
- `sketch-constraint-tool-behavior`: Adds Collinear to the supported sketch constraint toolbar and defines its target behavior alongside the existing constraint tools.
- `sketch-constraint-solver`: Adds solver-owned evaluation for collinear line/line and point/line relationships, including projected line references.

## Impact

- Affected source areas:
  - `src/core/sketch-tools/` for Point tool registration/exposure and commit behavior.
  - `src/core/sketch-constraints/` for Collinear definition, target rules, durable record emission, and glyph metadata.
  - `src/domain/editor/sketch-session/` for active authoring state, point placement, constraint commit, selection, deletion, display, and persistence integration.
  - `src/domain/solver/` and sketch solver/core modules for collinear residuals, gradients, and diagnostics.
  - `src/domain/tools/` and toolbar presentation seams for sketch-mode tool metadata.
  - `src/components/cad/` only for generic annotation/rendering support if current descriptors lack a collinear glyph path.
- No new runtime dependencies are expected.
- External parity reference: Onshape Point and Coincident documentation, where Coincident makes the infinite underlying geometry of selected entities coincident.
