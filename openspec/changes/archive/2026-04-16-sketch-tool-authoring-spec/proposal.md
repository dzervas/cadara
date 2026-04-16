## Why

Sketch tools such as `line`, `rectangle`, and `circle` are interaction-driven authoring flows with pointer lifecycles, staged geometry, and solver-facing draft behavior that do not fit cleanly into the solid-feature authoring contract. They are currently implemented through shared sketch-session logic, which makes tool-specific behavior harder to isolate and increases the amount of central branching required as sketch tooling grows.

## What Changes

- Introduce a sketch-tool authoring spec where each sketch tool defines its own metadata and behavior in its own file.
- Define a shared sketch tool contract that covers tool identity, icon metadata, mode availability, activation behavior, pointer event handling, staged geometry updates, validation, and commit preparation hooks.
- Define a shared sketch tool editor/presentation contract that lets sketch tools declare the controls, prompts, and transient overlays they need with minimal custom code.
- Require the sketch session runtime to consume sketch tool definitions through a registry instead of hardcoded tool-kind branching.
- Preserve the existing solver and modeling boundaries so sketch tool definitions never require UI code to import kernel code or solver implementations to import UI code.

## Capabilities

### New Capabilities
- `sketch-tool-definition`: Defines the contract every sketch tool module must implement, including metadata, activation hooks, pointer lifecycle behavior, staged draft updates, validation, and commit integration.
- `sketch-tool-editor-schema`: Defines the declarative editor and overlay schema used by sketch tool modules so sketch controls and guidance can be rendered generically with minimal tool-specific UI code.

### Modified Capabilities

## Impact

- Affected areas include `src/domain/editor/sketch-session.ts`, `src/domain/editor/sketch-session-controller.ts`, sketch tool activation flow, sketch overlay/renderable generation, and any UI that presents sketch-tool controls or prompts.
- Introduces a registry-driven sketch tool model and a declarative schema for sketch-tool controls and transient guidance.
- Preserves the existing modeling and solver boundaries while moving sketch-tool-specific behavior into isolated per-tool modules.
