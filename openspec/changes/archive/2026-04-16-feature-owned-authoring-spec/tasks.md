## 1. Define the feature authoring contract

- [x] 1.1 Add shared types for the feature authoring definition contract, including feature metadata, draft lifecycle hooks, selection hooks, diagnostics hooks, and draft-to-definition builders
- [x] 1.2 Add shared types for the declarative feature editor form schema, including sections, numeric fields, enum fields, reference pickers, reference collections, summaries, diagnostics blocks, and extension points
- [x] 1.3 Create a feature registry that resolves authoring definitions by feature kind and exposes them to editor/runtime code

## 2. Refactor the editor runtime to consume the registry

- [x] 2.1 Update feature session creation and hydration logic to delegate to registered feature authoring definitions instead of centralized per-feature switches
- [x] 2.2 Update selection handling, preview labeling, and missing-input diagnostics to delegate to the active feature authoring definition
- [x] 2.3 Update preview and commit preparation so the editor runtime requests typed modeling definitions from the active feature authoring definition

## 3. Build the generic feature inspector

- [x] 3.1 Replace feature-kind branching in the inspector with a renderer that consumes the declarative form schema
- [x] 3.2 Implement generic field renderers for the shared field vocabulary, including numeric inputs, operation choices, single-reference displays, multi-reference displays, and diagnostics sections
- [x] 3.3 Wire generic form events to the shared patch/action channel without embedding feature-specific business logic in the inspector

## 4. Migrate existing features into per-feature modules

- [x] 4.1 Create per-feature authoring modules for `extrude`, `revolve`, `fillet`, `plane`, and `shell`, each owning its metadata, draft defaults, selection semantics, form schema, diagnostics, and draft-to-definition logic
- [x] 4.2 Register all current feature authoring modules and route toolbar/editor integration through the registry
- [x] 4.3 Remove the obsolete centralized feature-editing switches once all current features are served by the new registry

## 5. Verify architecture and behavior

- [x] 5.1 Add or update tests for the feature authoring registry, per-feature draft behavior, and draft-to-definition translation
- [x] 5.2 Add or update tests for generic inspector rendering and patch dispatch across at least `revolve` and `shell`
- [x] 5.3 Verify that feature authoring modules and the generic inspector do not import kernel-specific modules and that preview/commit flows still execute through the modeling service boundary
