## Context

The feature editor already solves the "generic UI from schema" problem. Each feature implements `getFormSchema(session)` returning a `FeatureEditorFormSchema` with sections and typed fields. A single `FeatureFormFieldRenderer` component renders all field kinds (numeric, enum, referencePicker, referenceCollection, optionGroup, diagnostics, etc.) through a visitor pattern. Features never write form components — they describe what they need, the renderer handles how.

The import provider contract has `ImportProvider<TReview, TSelections>` with `review()` and `prepare()`. The `TSelections` type parameter already exists but there is no mechanism to collect selections from the user. The image import provider defines `ImageImportSelections` with plane/planeTarget/planeKey but nothing presents these to the user.

The `importPart` tool already exists in the tool registry with `group: 'import'` and `modes: ['part']`, but is hidden via `showPartImport={false}`.

## Goals / Non-Goals

**Goals:**
- A schema-driven import review UI where providers describe their fields and a generic renderer handles layout and interaction — same pattern as feature editing.
- A toolbar import button that opens a file picker, matches providers, and enters an import session.
- The image import provider wired end-to-end: button → file picker → plane selection → commit sketch.
- An import session state in the editor state machine that tracks the full lifecycle.

**Non-Goals:**
- Changing the feature editor form schema types — we reuse them as-is or create compatible equivalents.
- Multi-file import UI (e.g., STEP assembly file picker) — single-file for now.
- Drag-and-drop file import — file picker only for first version.
- Import progress/background job UI — the image provider is synchronous enough to not need it.

## Decisions

### 1. Reuse the existing form field types, not fork them

**Decision:** `ImportReviewFormSchema` uses the same `FeatureEditorFormSection` and `FeatureEditorFormField` types from `src/domain/feature-authoring/form-schema.ts`. The `ImportInspector` component delegates to the same `FeatureFormFieldRenderer` for field rendering.

**Alternative considered:** Define a parallel `ImportFormField` union with import-specific field kinds. This would duplicate the enum, numeric, referencePicker, summary, and diagnostics field types and require a second renderer component.

**Rationale:** The field kinds are generic UI primitives (pick a number, pick an enum, pick a reference, show diagnostics). There's nothing feature-specific about them. Reusing them means:
- Zero new field renderer code.
- Providers get referenceCollection, enum, numeric, diagnostics, optionGroup, discriminatedOptionGroup — all the expressivity features already have.
- Any future field kind added for features automatically works for import review.

### 2. Two new methods on ImportProvider, matching the feature pattern

**Decision:** Add to `ImportProvider`:
```
getReviewFormSchema(review: TReview, selections: TSelections): FeatureEditorFormSchema
applySelectionPatch(review: TReview, selections: TSelections, patch: Record<string, unknown>): TSelections
```

`getReviewFormSchema` is the equivalent of `FeatureAuthoringDefinition.getFormSchema(session)`. It returns a form schema computed from the current review + selections state. When a field changes, the renderer calls `applySelectionPatch` with the patch, which returns an updated `TSelections`. The schema is then re-derived from the new selections.

**Alternative considered:** A single `getReviewUI()` that returns a React component. This gives providers maximum flexibility but defeats the purpose — each provider writes its own UI.

**Rationale:** Schema-driven means the provider declares "I need a plane picker and a summary field", not "here's my JSX". The renderer handles focus management, layout, validation display, reference picker activation, and keyboard navigation consistently.

### 3. Import session in the editor state machine

**Decision:** Add an `importing` state to the editor state machine. The session tracks:
- `providerId` — which provider is active
- `resolvedSource` — the file bytes and metadata
- `review` — the provider's review result
- `selections` — the current user selections (updated by patches)
- `formSchema` — the current form schema (re-derived after each patch)
- `diagnostics` — accumulated diagnostics from review and selection validation

Events:
- `import.fileSelected` — user picked a file, triggers source resolution + provider matching
- `import.providerSelected` — user picked a provider (if multiple match)
- `import.selectionPatched` — user changed a field, triggers selection update + schema re-derive
- `import.commitRequested` — user clicks commit, triggers prepare + adapter apply
- `import.cancelled` — user clicks cancel, returns to idle
- `import.committed` — orchestrator finished applying, returns to idle

**Alternative considered:** Handle import state in React component state (like the old `stepImportFlow` / `meshImportFlow`). This was explicitly identified as problematic in the legacy removal — React state machines for multi-step flows are hard to reason about and test.

**Rationale:** The editor state machine already manages feature editing sessions with similar lifecycle (armed → collecting → editing → awaitingEffect). Import sessions follow the same pattern. Putting it in the machine makes it testable, serializable, and consistent with the rest of the editor.

### 4. Generic import button, not format-specific buttons

**Decision:** One "Import" button in the toolbar. Clicking it opens the browser file picker with all accepted extensions from all registered providers combined. After file selection, the orchestrator matches providers. If one matches, it's used directly. If multiple match, the user picks.

**Alternative considered:** Separate toolbar buttons per import type (Import STEP, Import Image, Import DXF). This requires a toolbar button for every provider and doesn't compose — new providers need toolbar changes.

**Rationale:** One button scales to any number of providers. The file picker's accepted extensions automatically expand as providers are registered. The matching step handles ambiguity.

### 5. File picker accept list derived from provider registry

**Decision:** The file picker's `accept` types are computed at runtime from all registered providers' `accepts()` behavior. Providers declare their accepted extensions/media types, and the orchestrator aggregates them into the file picker options.

**Rationale:** Adding a new provider automatically updates what the file picker accepts. No manual wiring.

### 6. ImportInspector renders in the same sidebar slot as FeatureInspector

**Decision:** When the editor is in `importing` state, the sidebar renders `ImportInspector` instead of `FeatureInspector`. Same position, same visual weight, same commit/cancel footer pattern.

**Rationale:** Only one editing session can be active at a time. The sidebar slot is already purpose-built for "active session" panels.

## Risks / Trade-offs

**[Form schema expressivity]** → The existing `FeatureEditorFormField` union covers numeric, enum, referencePicker, referenceCollection, optionGroup, discriminatedOptionGroup, summary, diagnostics, and custom. If a future provider needs a field kind that doesn't exist (e.g., a table selector for spreadsheet columns), it would need to be added to the shared union. Mitigation: the `custom` field kind with `rendererId` already exists as an escape hatch.

**[Reference picker integration]** → The `referencePicker` field kind activates viewport selection mode for picking geometry (faces, edges, planes). The import review needs this for plane selection. The picker infrastructure is already wired through the editor state machine's selection flow. Mitigation: the import session can delegate to the same viewport selection mechanism.

**[Provider matching ambiguity]** → Multiple providers accepting the same file type (e.g., a `.svg` could be imported as sketch geometry or as a reference image). Mitigation: present matching providers to the user for selection. First version can show a simple list picker.

**[Single-file limitation]** → This version only supports single-file import. Multi-file import (STEP assemblies) would need the review phase to request additional files. Mitigation: the provider contract already supports this conceptually; the UI for requesting additional files can be added later without changing the core flow.
