## 1. Extend ImportProvider Contract

- [x] 1.1 Add `acceptedFileTypes` property to `ImportProvider` in `src/contracts/import/provider.ts` — type: `readonly { extension: string; mediaType?: string }[]`. Used by the orchestrator to build the file picker accept filter.
- [x] 1.2 Add `createDefaultSelections(review: ImportReviewEnvelope<TReview>): TSelections` method to `ImportProvider`. Returns the initial selections when the review form first appears.
- [x] 1.3 Add `getReviewFormSchema(review: ImportReviewEnvelope<TReview>, selections: TSelections): FeatureEditorFormSchema` method to `ImportProvider`. Returns the form schema computed from current review and selections. Import the `FeatureEditorFormSchema` type from `src/domain/feature-authoring/form-schema.ts`.
- [x] 1.4 Add `applySelectionPatch(review: ImportReviewEnvelope<TReview>, selections: TSelections, patch: Record<string, unknown>): TSelections` method to `ImportProvider`. Returns updated selections when a form field changes.

## 2. Image Import Provider — UI Hooks

- [x] 2.1 Add `acceptedFileTypes` to `ImageImportProvider` — PNG, JPEG, WebP, BMP, TIFF with their extensions and media types.
- [x] 2.2 Implement `createDefaultSelections()` — return `ImageImportSelections` with `plane: null`, `planeTarget: null`, `planeKey: null`.
- [x] 2.3 Implement `getReviewFormSchema()` — return a schema with: (1) a summary section showing image dimensions (`pixelWidth × pixelHeight`), source name, and file size; (2) a references section with a `referencePicker` field for plane selection configured with a selection filter accepting construction planes and planar faces; (3) a diagnostics section if the review has diagnostics.
- [x] 2.4 Implement `applySelectionPatch()` — handle the plane picker patch key, resolve the selected reference into `plane`, `planeTarget`, and `planeKey` on `ImageImportSelections`.
- [x] 2.5 Add unit tests for the image provider's UI hooks — default selections have null plane, form schema has plane picker field, patch updates plane selection.

## 3. Toolbar — Import Button

- [x] 3.1 Rename `importPart` tool definition to `import` in `src/domain/tools/tool-registry.ts` — update id, name, tooltip, and icon reference. Keep `group: 'import'` and `modes: ['part']`.
- [x] 3.2 Update any references to `importPart` tool ID across the codebase (tool-action-bus subscriptions, use-tool-actions, spec files).
- [x] 3.3 Enable the import button in the toolbar — remove `showPartImport={false}` gating in `cad-workbench.tsx` and `workspace-toolbar.tsx`. The button should be unconditionally visible in part mode.
- [x] 3.4 Wire the import button click to open the browser file picker — compute accept filter from all registered providers' `acceptedFileTypes`, open `showOpenFilePicker()` or `<input type="file">` with the combined accept filter.

## 4. Editor State Machine — Import Session

- [x] 4.1 Add `ImportSessionState` type to `src/contracts/editor/state-machine.ts` — fields: `providerId: string`, `resolvedSource: ResolvedImportSource`, `review: ImportReviewEnvelope<unknown>`, `selections: unknown`, `formSchema: FeatureEditorFormSchema`, `diagnostics: ModelingDiagnostic[]`.
- [x] 4.2 Add import session events to `EditorEvent` union — `import.fileSelected`, `import.providerSelected`, `import.selectionPatched`, `import.commitRequested`, `import.cancelled`, `import.committed`, `import.failed`.
- [x] 4.3 Add `importing` state to the editor state machine with transitions: `idle → importing` (on file selected), `importing → idle` (on cancelled or committed), `importing → importing` (on selection patched).
- [x] 4.4 Implement the import session orchestration logic — on `import.fileSelected`: resolve source, match providers, run `review()`, create default selections, derive form schema, enter `importing` state. On `import.commitRequested`: run `prepare()`, apply through orchestrator, emit `import.committed`. On `import.selectionPatched`: call `applySelectionPatch()`, re-derive form schema.

## 5. ImportInspector Component

- [x] 5.1 Create `src/components/layout/import-inspector.tsx` — a sidebar panel that renders when the editor is in `importing` state. Header shows provider label. Body renders `formSchema.sections` using `FeatureFormFieldRenderer`. Footer has Cancel and Commit buttons.
- [x] 5.2 Wire the Commit button — dispatch `import.commitRequested`. Disable when required fields are missing (e.g., plane picker has no selection).
- [x] 5.3 Wire the Cancel button — dispatch `import.cancelled`.
- [x] 5.4 Wire reference picker fields — when a `referencePicker` field is activated, enter viewport selection mode with the field's selection filter. When selection completes, dispatch `import.selectionPatched` with the selected reference as the patch value.
- [x] 5.5 Conditionally render `ImportInspector` vs `FeatureInspector` in the sidebar based on editor state — `importing` state shows `ImportInspector`, `editingFeature` state shows `FeatureInspector`.

## 6. Provider Matching and File Picker Integration

- [x] 6.1 Implement a function to aggregate `acceptedFileTypes` from all registered providers into file picker accept options — combine extensions, deduplicate, format for `showOpenFilePicker` or `<input accept>`.
- [x] 6.2 Implement provider matching after file selection — call `accepts()` on each registered provider with the resolved source, collect matches, present picker if multiple, auto-select if single.
- [x] 6.3 Handle no-match case — show a notification diagnostic indicating no importer is available for the selected file type.

## 7. Verification

- [x] 7.1 Run `bun run build` — confirm zero compile errors.
- [x] 7.2 Run `bun run lint` — confirm zero lint errors.
- [x] 7.3 Run `bun run test` — confirm all tests pass.
- [ ] 7.4 Manual verification: click import button → select an image file → see ImportInspector with plane picker → select a plane → commit → sketch with image reference appears in the feature tree.
