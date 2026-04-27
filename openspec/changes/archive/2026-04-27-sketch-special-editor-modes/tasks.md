## 1. Define the special-mode host contracts

- [x] 1.1 Add sketch special editor mode contracts, registry wiring, and sketch-session state for mode ownership and lifecycle.
- [x] 1.2 Add a dedicated structured panel schema for sketch special modes that follows feature-editor presentation without reusing deprecated SVG tool components.
- [x] 1.3 Add durable target and handle identity types for committed-operation mode interactions.

## 2. Integrate runtime and viewport routing

- [x] 2.1 Extend the editor runtime to enter, update, cancel, and exit active sketch special editor modes.
- [x] 2.2 Route viewport hover, click, double-click, and drag events through the active special-mode adapter instead of mode-specific viewport branches.
- [x] 2.3 Preserve current sketch-tool, feature-session, import-session, and section-view behavior when no special mode is active.

## 3. Add generic UI shells and guardrails

- [x] 3.1 Build generic sketch special-mode panel components aligned with the feature editor's sectioned UI feel.
- [x] 3.2 Build generic overlay and feedback hooks for special-mode handles, prompts, and diagnostics.
- [x] 3.3 Add tests proving generic viewport and panel shells do not import or branch on mode-specific business logic.
