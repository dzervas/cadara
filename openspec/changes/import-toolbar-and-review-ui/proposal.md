## Why

The import provider contract and the image import provider exist but there is no way for a user to trigger an import. There is no toolbar button, no file picker flow, no review UI, and no way for providers to describe what input they need from the user. Each new provider would have to build its own UI from scratch — the same problem the feature editor solved with schema-driven forms.

## What Changes

- **Enable the import toolbar button** — the `importPart` tool definition already exists in the tool registry with `group: 'import'`. Rename it to a generic `import` tool, enable it in the toolbar, and wire it to open a file picker.
- **New `ImportReviewFormSchema` type** reusing the same field kinds as `FeatureEditorFormSchema` (numeric, enum, referencePicker, referenceCollection, summary, diagnostics). Providers implement a `getReviewFormSchema()` method that returns a form schema computed from their review result and current selections. The generic renderer handles layout and field rendering — providers never write UI components.
- **Extend `ImportProvider` with UI hooks** — `getReviewFormSchema(review, selections)` returns the form schema, `applySelectionPatch(review, selections, patch)` returns updated selections when the user changes a field. Same pattern as feature authoring's `getFormSchema(session)` / `applyPatch(draft, patch)`.
- **New `ImportInspector` component** — a generic sidebar panel (like `FeatureInspector`) that renders the provider's form schema using the existing `FeatureFormFieldRenderer` infrastructure. Shows provider name, review summary, schema-driven fields, diagnostics, and commit/cancel buttons.
- **New import session state in the editor state machine** — when the user triggers import, the machine enters an `importing` state that tracks the provider, resolved source, review result, current selections, and form schema. Commit transitions back to idle after applying prepared actions through the orchestrator.
- **Wire the image import provider** — the image provider's `getReviewFormSchema()` returns a plane picker field (referencePicker with plane/face selection filter) and an image dimensions summary. The `ImageImportSelections` type already has `plane`, `planeTarget`, `planeKey`.

## Capabilities

### New Capabilities
- `import-review-form-schema`: Defines the `ImportReviewFormSchema` type, the `getReviewFormSchema()` and `applySelectionPatch()` methods on `ImportProvider`, and the contract between providers and the generic review UI renderer.
- `import-toolbar-and-session`: Defines the import toolbar trigger, file picker flow, import session state in the editor state machine, and the `ImportInspector` component that renders provider review forms.

### Modified Capabilities
- `import-provider-contract`: `ImportProvider` interface extended with `getReviewFormSchema()` and `applySelectionPatch()` methods.
- `toolbar-tool-presentation`: Import tool renamed from `importPart` to `import`, enabled in toolbar.

## Impact

- `src/contracts/import/provider.ts`: Two new methods on `ImportProvider`.
- `src/contracts/import/form-schema.ts` (new): `ImportReviewFormSchema` type reusing field kinds from feature authoring.
- `src/contracts/editor/state-machine.ts`: New `importing` state and associated events.
- `src/domain/tools/tool-registry.ts`: Rename `importPart` → `import`, update tooltip.
- `src/components/layout/import-inspector.tsx` (new): Generic import review panel.
- `src/components/layout/workspace-toolbar.tsx`: Enable import button, wire file picker.
- `src/app/cad-workbench.tsx`: Import session orchestration, provider matching, commit flow.
- `src/domain/import/providers/image-import-provider.ts`: Implement `getReviewFormSchema()` and `applySelectionPatch()`.
- Existing `FeatureFormFieldRenderer` reused as-is — no changes needed to the field renderer.
