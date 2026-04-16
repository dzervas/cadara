## 1. Define the sketch tool contract

- [x] 1.1 Add shared types for the sketch tool definition contract, including metadata, activation hooks, pointer lifecycle hooks, staged-geometry outputs, validation outputs, and commit contribution hooks
- [x] 1.2 Add shared types for the declarative sketch tool editor schema, including prompts, controls, live measurements, overlay annotations, validation messaging, and extension points
- [x] 1.3 Create a sketch tool registry that resolves tool definitions by tool ID and exposes them to sketch-session runtime code

## 2. Refactor the sketch runtime to consume the registry

- [x] 2.1 Update sketch session activation to initialize the active tool through the sketch tool registry instead of centralized tool-kind branching
- [x] 2.2 Update pointer-move and pointer-release handling to delegate active-tool interaction behavior to the registered sketch tool definition
- [x] 2.3 Update staged geometry, live guidance, and validation flow so the runtime consumes structured outputs from the active sketch tool definition

## 3. Build generic sketch-tool presentation

- [x] 3.1 Implement generic sketch UI surfaces that render prompts, controls, and validation from the declarative sketch tool schema
- [x] 3.2 Implement generic overlay rendering for standard staged annotations such as measurements, anchors, helper markers, and completion cues
- [x] 3.3 Wire generic sketch-tool UI interactions to shared tool actions or patches without embedding tool-specific drawing logic in the UI layer

## 4. Migrate current sketch tools into per-tool modules

- [x] 4.1 Create per-tool modules for `line`, `rectangle`, and `circle`, each owning its metadata, activation behavior, pointer lifecycle, staged geometry, validation, and presentation schema
- [x] 4.2 Register all current sketch tools and route toolbar/editor integration through the sketch tool registry
- [x] 4.3 Remove obsolete centralized sketch-tool switches once all current tools are served by dedicated tool modules

## 5. Verify architecture and behavior

- [x] 5.1 Add or update tests for the sketch tool registry, per-tool pointer behavior, and staged-geometry outputs
- [x] 5.2 Add or update tests for generic sketch-tool prompts, controls, and overlays across at least `line` and `circle`
- [x] 5.3 Verify that sketch tool modules and generic sketch UI surfaces do not import solver implementation modules or kernel-specific modeling modules and that shared sketch commit flow still executes through the existing boundaries
