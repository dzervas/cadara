## Context

Feature drafts and durable feature definitions already support authored literal and expression values for eligible non-reference fields. The current inspector uses `react-hook-form`, but field renderers still treat expression-capable fields as ordinary inputs or enum controls. The form schema exposes `authoredValue` metadata on numeric and enum fields, while reference picker fields intentionally do not expose that metadata.

The UI also cannot rely on the displayed field value alone to determine whether a value was authored as an expression. Numeric expression text like `10` and enum expression text that resolves to an existing option can look identical to literal values. The form layer needs explicit source state derived centrally from authored values.

## Goals / Non-Goals

**Goals:**

- Provide one expression affordance and edit flow for all expression-capable feature form fields.
- Keep the implementation centered on the existing `react-hook-form` feature inspector runtime.
- Preserve authored expression text while showing resolved preview values in the field UI.
- Keep reference pickers, reference collections, durable references, IDs, selection targets, and feature discriminants out of expression entry.
- Reuse the existing expression parser/evaluator and value-kind validation semantics.

**Non-Goals:**

- Do not implement a new expression engine or change document variable evaluation.
- Do not add expression support to sketch-only authoring controls.
- Do not enable expressions for references or selection targets.
- Do not redesign feature forms beyond the expression control wrapper.

## Decisions

### Add explicit authored source state to form values/schema

Expression-capable fields should receive centrally derived UI state that distinguishes literal from expression-authored values. This can be represented as a small form-layer structure or schema sidecar that carries:

- current source: `literal` or `expression`
- raw expression text when present
- display value for the normal control
- value-kind metadata already provided by `field.authoredValue`

This avoids inferring expression state from strings, which breaks for numeric-looking expression text and enum expressions that match existing options.

Alternative considered: infer expression mode by parsing the current string field value. That is smaller, but it loses source information and creates incorrect UI for expression text that is also a valid literal.

### Wrap expression-capable controls centrally

Introduce a reusable expression field wrapper around `Controller` rendering rather than adding custom `f(x)` behavior inside each feature definition. The wrapper should:

- no-op for fields without `authoredValue`
- render the local SVG `public/icons/function.svg` beside supported controls
- switch a supported field into expression text mode on `f(x)` click
- render the normal control disabled with the resolved display value when an expression is active but not being edited
- expose a render prop for the normal field UI so numeric, enum, and future non-reference input kinds share the same expression behavior

Alternative considered: add expression UI directly in `NumericField` and `EnumField`. That would work for the current two field types but would repeat state, validation, and patch semantics as soon as another non-reference input type is added.

### Add one field-level preview evaluator

Live validation should use one shared field-level helper that accepts expression text, document variables, field label, and `FeatureValueKindDescriptor`. The helper should reuse the existing math.js validation rules and document variable evaluation behavior used by feature value expression resolution, then return either a displayable result or the existing diagnostic style.

For fields with display transforms, such as `angleDegrees`, the preview should be formatted for the current form control without changing the existing persisted expression semantics. This keeps the UI consistent with literal display while avoiding a second expression model.

Alternative considered: let the React component call `math.parse` directly. That would duplicate expression semantics in the presentation layer and make preview behavior diverge from commit/rebuild validation.

### Keep expression clearing deterministic

Clicking the red clear action in expression edit mode should remove the expression wrapper and return to literal editing. When the current expression preview is valid, the literal field value should become that resolved value through the same form patch path used by normal input changes. If the expression is invalid, clearing should restore the last synced literal/default value for that field and leave the normal control enabled.

Alternative considered: clear to an empty input every time. That is simpler but can create avoidable invalid feature drafts even when the expression had a valid computed value.

## Risks / Trade-offs

- [Source state drift] React local edit state could disagree with the active feature session after an external draft update. Mitigation: derive expression source state from the form schema and reset it through the same session-key synchronization path as existing form values.
- [Validation mismatch] UI preview could accept an expression that commit later rejects. Mitigation: export/reuse shared field-level expression validation and cover it with tests against existing value-kind cases.
- [Enum UX] Enum expressions may resolve to strings and are less common than numeric expressions. Mitigation: the central wrapper should still support enum fields because the schema already declares enum value kinds; the normal enum control can be replaced by the same text expression editor while editing.
- [Angle display confusion] Existing angle expression semantics are owned by the expression resolver and form adapter. Mitigation: this UI change should format previews for display without changing persisted expression text or resolver units.

## Migration Plan

1. Add central form adapter/source-state helpers and tests for literal values, expression values, and expression-capable versus non-capable fields.
2. Add the field-level expression preview helper using existing document variable and value-kind validation behavior.
3. Wrap expression-capable feature inspector controls with the shared `react-hook-form` expression shell.
4. Add focused rendering tests for the `f(x)` affordance, active expression state, edit mode, invalid preview, Enter/blur acceptance, and clear-to-literal behavior.
5. Run `bun run test` and `bun run lint`.

Rollback is limited to removing the new UI wrapper and helpers. Persisted feature expression data remains compatible because this change does not introduce a new durable expression format.

## Open Questions

None.
