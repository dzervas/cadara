## Context

Feature authoring behavior is currently split across shared editor files. The modeling boundary is already clean enough that React and editor code talk to the modeling service rather than directly to OpenCascade, but per-feature concerns such as defaults, selection semantics, draft patching, validation, preview labels, and form rendering are still centralized in shared unions and switch statements.

This change introduces a new architectural pattern rather than a small local refactor. It affects editor state integration, toolbar/tool metadata, feature inspector rendering, and the organization of feature-specific authoring code. The design must preserve the existing modeling contract and keep kernel implementations replaceable behind the adapter boundary.

## Goals / Non-Goals

**Goals:**
- Define one feature authoring contract that every feature implements in its own file.
- Make the feature inspector generic by rendering a declarative form schema instead of branching on feature kind.
- Keep selection filters, draft behavior, diagnostics, preview/commit preparation, and toolbar metadata owned by the feature definition.
- Preserve the current modeling-service and kernel boundary so feature definitions depend on contracts, not kernel internals.
- Minimize boilerplate for new features by providing shared form-field and reference-picking primitives.

**Non-Goals:**
- Change the public modeling contract for feature mutation or preview requests.
- Move kernel-specific geometry or topology logic into the UI or editor layer.
- Fully redesign sketch authoring in this change.
- Require every feature to provide fully custom React components for its editor.

## Decisions

Create a registry of feature authoring definitions keyed by feature kind. Each feature module will export one definition object that owns its metadata and authoring behavior. The registry becomes the single source of truth for feature identity, toolbar integration, mode availability, selection filtering, draft creation, hydration, patch application, draft validation, preview labeling, and draft-to-contract translation.

This is preferable to the current central switch-based model because it localizes feature-specific behavior and lets the editor runtime depend on one uniform interface. The alternative, keeping the current shared file and merely splitting helper functions, would reduce file size but not remove the coupling between unrelated features.

Use a declarative editor-form schema instead of per-feature inspector branches. Each feature definition will describe its form as structured sections and fields such as numeric inputs, enum choices, boolean toggles, single-reference pickers, multi-reference lists, read-only summaries, and diagnostics blocks. The inspector will render this schema generically and route field changes back through a shared patch channel.

This is preferable to custom feature components as the default because the current editors are similar in structure and differ mostly in field composition rather than layout mechanics. The design still allows an escape hatch for a feature to supply a custom field renderer or custom section when the shared field vocabulary is insufficient.

Keep the form schema UI-oriented but contract-agnostic. Feature definitions may map draft state to form fields and map draft state to modeling definitions, but the form schema itself will not embed kernel details or require direct knowledge of `FeatureDefinition` variants. This avoids coupling the generic inspector renderer to the modeling contract shape.

Treat selection handling as a feature-owned policy. A feature definition will declare the selection filter it needs and expose selection-application behavior so the editor state machine no longer hardcodes per-feature target coercion rules. The runtime remains responsible for machine transitions and request orchestration; the feature definition remains responsible for interpreting selections into draft state.

Preserve the existing runtime flow for previews and commits. The editor state machine will continue to own when previews and commits are triggered and to call the modeling service through the current contract. The change is that the state machine will ask the active feature definition to validate the draft and build the typed modeling definition instead of calling centralized helpers.

## Risks / Trade-offs

- [A form schema that is too weak will force features back into custom UI code] → Mitigate by defining a broad initial field vocabulary, including reference-picking and repeated-reference fields, and by allowing explicit custom-renderer escape hatches.
- [A form schema that is too broad will become a second UI framework] → Mitigate by keeping it focused on feature editor needs and by forbidding layout/style concerns beyond sections, rows, and field groupings.
- [Moving all feature behavior behind one interface can produce an oversized contract] → Mitigate by separating required hooks from optional hooks and by keeping runtime-owned concerns such as async orchestration out of the feature definition.
- [Existing features may migrate unevenly, leaving two authoring systems active] → Mitigate by planning an incremental migration where the registry can wrap migrated features first and the old central code is removed only after all current feature kinds are ported.
- [The generic inspector may accidentally grow knowledge of modeling contracts] → Mitigate by ensuring it consumes only the form schema and patch events, never `FeatureDefinition` builders or kernel-specific helpers.

## Migration Plan

1. Introduce the feature authoring definition contract, registry, and generic form schema types alongside the current implementation.
2. Implement the generic inspector renderer against the form schema while preserving the existing commit/cancel flow.
3. Migrate current features one by one into per-feature modules, starting with an existing low-complexity feature to shake out the API.
4. Update the editor state machine and toolbar integration to resolve active features through the registry.
5. Remove the centralized feature switch logic after all current feature kinds are represented by feature-owned definitions.

## Open Questions

- Whether toolbar-only metadata should live on the same feature definition object or in a thin adjacent registration layer.
- Whether per-feature form schemas should be static data or be allowed to derive sections dynamically from the current draft and snapshot context.
- Whether diagnostics presentation should be fully generic or allow feature-authored diagnostic groupings and ordering.
