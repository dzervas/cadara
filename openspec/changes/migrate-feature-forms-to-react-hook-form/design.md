## Context

Feature-session editing is currently split between:

- Feature-owned draft logic and declarative field descriptions in `src/domain/feature-authoring/**`
- Generic rendering in `src/components/layout/feature-inspector.tsx`
- Preview, commit, cancellation, and reference-picking orchestration in `src/contracts/editor/state-machine.ts`

The current form runtime is custom. Numeric and enum inputs dispatch draft patches directly from React event handlers, reference fields dispatch custom patch helpers, and field values are regenerated from `getFeatureEditorFormSchema(session)` on every render. That works, but it means React owns registration, coercion, input wiring, and external reset behavior by hand across a growing feature set. The codebase also already has two separate authoring surfaces: feature-session forms and sketch-only controls (`SketchToolPanel`, `SketchFloatingInput`, sketch constraint flows). Those sketch controls use different contracts and must stay out of scope.

This change introduces a new dependency and touches UI, domain form helpers, and editor-machine integration, so a design document is warranted.

## Goals / Non-Goals

**Goals:**
- Use `react-hook-form` as the local form runtime for feature-session forms rendered by `FeatureInspector`.
- Preserve the existing feature-authoring contract shape as much as possible so per-feature authoring files do not need to be rewritten into custom React components.
- Preserve current editor-machine ownership of preview, commit, cancel, feature hydration, and viewport/sidebar reference-picking flows.
- Keep feature-domain validation and value coercion in feature-authoring helpers instead of moving modeling semantics into presentational components.
- Keep the migration isolated to feature-session forms.

**Non-Goals:**
- Rebuild feature authoring around submit-only forms or move preview generation out of the editor machine.
- Replace the current feature draft/session model with `react-hook-form` state as the durable source of truth.
- Introduce `zod` or another resolver-driven validation layer for feature forms in this change.
- Migrate sketch tool panels, sketch floating inputs, or sketch constraint controls.
- Redesign the form layout or feature-authoring field vocabulary beyond what the migration needs.

## Decisions

Use `react-hook-form` only for local feature form state, not for editor-session ownership.

The active feature draft must remain in the editor machine because preview generation, selection filters, reopen flows, and commit effects already depend on that state. Replacing session ownership with RHF would spread machine concerns into React and would complicate viewport-driven reference selection. The chosen design uses RHF as a UI runtime layered on top of the existing session model: inputs register with RHF, but validated changes still emit `form.featurePatched` events back to the machine.

Alternative considered: make RHF the primary source of truth and only build a feature definition on submit. Rejected because it would change current live-preview behavior and duplicate feature-session state outside the machine.

Keep the existing declarative `FeatureEditorFormSchema`, but add an adapter for RHF-facing values and synchronization.

The current schema already encodes most of what RHF needs: stable field ids, field kind, display values, errors, and patch bindings. Replacing it with RHF-specific config would force every feature definition to change at once. Instead, add a small adapter layer that can:

- derive RHF `defaultValues` from the active schema
- translate RHF value changes back into existing patch helpers
- project schema-authored field errors into rendered controls
- normalize reference values for RHF resets and equality checks

This keeps feature files largely declarative and contains RHF-specific knowledge outside presentational components.

Alternative considered: rewrite `getFormSchema` so feature definitions return `register`/`Controller` config directly. Rejected because it would couple domain authoring definitions to React-form internals.

Preserve domain-owned coercion and validation instead of moving it into RHF resolvers.

Current feature definitions already encode important semantics:

- angle fields display degrees but patch radians through `createFeatureEditorFieldPatch`
- reference fields map to typed durable refs
- feature-specific validity lives in `getFormSchema`, `getMissingInputsDiagnostics`, and definition builders

The migration should keep those rules in domain helpers. RHF will manage value registration, touched/dirty state, and reset behavior, but the authoritative coercion path remains the patch helper / feature definition path. Field invalid state will continue to come from the schema unless a future change introduces dedicated form resolvers.

Alternative considered: add a per-feature RHF resolver, potentially using `zod`. Rejected for now because the codebase does not have feature-form schemas expressed as reusable validation schemas, and duplicating domain validation in resolvers would create drift.

Synchronize RHF state from external session changes selectively, not on every render.

The editor machine updates the active feature session immediately after a field patch, and reference-picker selections can also mutate the session from outside the form controls. A naive `form.reset(defaultValues)` on every schema change would constantly overwrite local typing and cursor position. The design therefore requires:

- a normalized form-values snapshot derived from the current schema
- a comparison against RHF's current values
- reset only when the active session identity changes or when externally applied values diverge from the local form state

This preserves user typing while still handling feature reopen, edit-session hydration, reference-picker updates, and command cancellation correctly.

Alternative considered: never reset RHF after mount and rely on manual `setValue` calls. Rejected because feature reopen and external reference changes affect multiple fields and need a single reliable resync path.

Keep reference-picking integrated with the editor machine and bridge selected values back into RHF.

Reference fields are not standard text inputs; they rely on `form.referencePickerActivated`, selection filters, viewport/sidebar selection, `createFeatureEditorReferenceSelectionPatch`, and `activeReferencePickerFieldId`. That orchestration must stay in the machine. The migration should treat reference fields as externally updated RHF values:

- activating a reference field still dispatches `form.referencePickerActivated`
- viewport/sidebar selection still updates the editor session through the machine
- the resulting session change is reflected into RHF through the adapter sync path

This keeps one interaction model for durable reference picking and avoids inventing a second form-local picker workflow.

Alternative considered: move reference picking into RHF-only controlled components. Rejected because selection filters and CAD target resolution are already machine-owned.

## Risks / Trade-offs

- [RHF local state can drift from editor-session state during preview and selection updates] → Mitigate with a normalized adapter snapshot and guarded reset logic keyed to external session changes.
- [Keeping schema-owned validation means RHF is not the sole validation source] → Mitigate by treating RHF as the form runtime and the feature-authoring layer as the validation authority for this change; document this boundary clearly.
- [Reference fields are complex values, not primitive inputs] → Mitigate by using `Controller` or explicit `setValue` integration for non-primitive field values instead of forcing them through primitive form registration patterns.
- [A large adapter can become a second form abstraction] → Mitigate by keeping the adapter narrow: derive values, compare/reset values, and translate changes back into existing patch helpers only.
- [The migration could accidentally pull sketch authoring into the same abstraction] → Mitigate by scoping all new helpers and tasks to `FeatureInspector` and `feature-authoring` modules only, and by explicitly excluding `src/components/cad/` sketch controls.

## Migration Plan

1. Add `react-hook-form` and introduce a feature-form adapter module that derives RHF values from `FeatureEditorFormSchema` and translates RHF changes back into feature patches.
2. Refactor `FeatureInspector` to instantiate RHF, register numeric/enum fields through RHF, and route control changes through the adapter while preserving current layout and buttons.
3. Bridge reference picker and reference collection fields through RHF synchronization without changing editor-machine selection behavior.
4. Update feature-form tests to cover reset/sync behavior, angle coercion, reference-picker updates, and unchanged sketch-control boundaries.
5. Remove any now-redundant direct input-to-patch wiring that RHF replaces, while leaving feature-authoring definitions and machine contracts otherwise intact.

Rollback strategy: revert the `FeatureInspector`/adapter path and remove the dependency. Because the durable feature-session and editor-machine contracts remain unchanged, rollback is low-risk if the migration is kept UI-local.

## Open Questions

- Whether the adapter should key RHF values by existing field `id` values or whether a dedicated stable form-path property should be added for future nested fields.
- Whether any fields need RHF `Controller` immediately versus using `register` for primitives and explicit sync for reference fields.
- Whether a later follow-up should add schema-authored validation metadata that maps more directly onto RHF field rules without duplicating domain validation.
