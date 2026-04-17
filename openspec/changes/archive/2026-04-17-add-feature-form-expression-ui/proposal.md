## Why

Feature definitions can already preserve and resolve authored expressions, but feature forms still present expression-capable values like ordinary literal inputs. Users need a consistent way to opt into expression entry from the inspector without adding field-by-field UI branches or changing reference picker behavior.

## What Changes

- Add an `f(x)` affordance beside every feature form field that declares authored expression support.
- Let the affordance switch that field into an expression text editor that live-validates the expression and previews the resolved value inside the input.
- When expression editing is accepted by blur or Enter, return to the normal field presentation with the control disabled, showing the calculated value, and mark the `f(x)` affordance with the active foreground color.
- Add a red clear expression action to expression edit mode; clearing returns the field to ordinary literal editing with a normal `f(x)` affordance.
- Implement the behavior through centralized `react-hook-form` field wrappers and shared form adapter helpers so numeric, enum, and future non-reference expression-capable controls inherit the behavior without ad hoc per-feature code.
- Keep reference picker and reference collection fields excluded because they do not declare expression metadata and cannot author expression values.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feature-form-react-hook-form`: feature-session forms need centralized expression entry controls for expression-capable non-reference fields.

## Impact

- Affected UI: `src/components/layout/feature-inspector.tsx` and focused child components/helpers if extracted.
- Affected form/domain helpers: `src/domain/feature-authoring/form-adapter.ts` and related tests for authored expression form values.
- Affected validation path: UI live validation should reuse existing document variable and feature value expression evaluation semantics, not introduce a second expression engine.
- Affected assets: use the local `public/icons/function.svg` asset for the `f(x)` button.
- Tests: update or add `bun:test` coverage for form adapter behavior and React-rendered feature inspector expression states.
