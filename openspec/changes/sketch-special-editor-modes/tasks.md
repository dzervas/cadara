## 1. Define the special-mode host contracts

- [ ] 1.1 Add sketch special editor mode contracts, registry wiring, and sketch-session state for mode ownership and lifecycle.
- [ ] 1.2 Add a dedicated structured panel schema for sketch special modes that follows feature-editor presentation without reusing deprecated SVG tool components.
- [ ] 1.3 Add durable target and handle identity types for committed-operation mode interactions.

## 2. Integrate runtime and viewport routing

- [ ] 2.1 Extend the editor runtime to enter, update, cancel, and exit active sketch special editor modes.
- [ ] 2.2 Route viewport hover, click, double-click, and drag events through the active special-mode adapter instead of mode-specific viewport branches.
- [ ] 2.3 Preserve current sketch-tool, feature-session, import-session, and section-view behavior when no special mode is active.

## 3. Add generic UI shells and guardrails

- [ ] 3.1 Build generic sketch special-mode panel components aligned with the feature editor's sectioned UI feel.
- [ ] 3.2 Build generic overlay and feedback hooks for special-mode handles, prompts, and diagnostics.
- [ ] 3.3 Add tests proving generic viewport and panel shells do not import or branch on mode-specific business logic.
