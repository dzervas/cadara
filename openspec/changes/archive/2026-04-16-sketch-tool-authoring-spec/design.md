## Context

Sketch authoring currently lives in shared sketch-session logic that owns tool activation, pointer handling, in-progress geometry, and commit preparation for multiple tool kinds. That keeps the interaction flow working, but it centralizes tool-specific behavior and makes new sketch tools more expensive to add because each tool must fit into shared branching and shared mutable state conventions.

This change introduces a separate architectural pattern for sketch tools that is parallel to, but distinct from, the feature-owned authoring model. Sketch tools are interaction-first workflows with pointer lifecycles, staged entities, and solver-facing updates, so they need a specialized contract rather than reuse of the solid-feature authoring contract.

## Goals / Non-Goals

**Goals:**
- Define one sketch tool contract that every drawing tool implements in its own file.
- Move activation behavior, pointer lifecycle handling, staged geometry updates, and validation into per-tool modules.
- Provide a declarative schema for tool prompts, controls, and transient guidance so sketch tooling can stay mostly generic at the UI layer.
- Preserve the existing sketch session, solver, and modeling boundaries so sketch tools do not import solver or kernel implementation internals directly.
- Let the editor runtime resolve sketch-tool behavior through a registry instead of tool-specific switches.

**Non-Goals:**
- Merge sketch tools into the solid-feature authoring contract.
- Redesign the underlying solver contracts or sketch document schema.
- Eliminate all shared sketch-session state; the runtime still owns common session orchestration.
- Require every sketch tool to provide its own bespoke React UI.

## Decisions

Create a dedicated sketch tool definition contract with lifecycle hooks tailored to interaction-heavy tools. Each tool definition will own its metadata, activation defaults, pointer event behavior, staged-entity updates, validation, and commit contribution logic. The runtime will continue to own the overarching sketch session state machine and effect orchestration.

This is preferable to forcing sketch tools into the feature authoring contract because sketch tools respond to ongoing pointer input and incremental geometry construction in a way that solid features do not. A shared mega-interface would either be full of irrelevant hooks or would blur the boundary between two genuinely different authoring systems.

Use a sketch tool registry keyed by tool ID. The toolbar and editor runtime will resolve sketch tools through this registry for activation and event dispatch. This localizes tool-specific behavior and allows new tools to be added without editing unrelated tool branches.

Use a declarative sketch tool editor schema for standard prompts and controls. The schema should cover tool status prompts, lightweight numeric or option controls, live measurement readouts, transient completion hints, and overlay annotations. This is narrower than a full UI framework and focuses on the common needs of line/rectangle/circle-style tools.

Keep the runtime responsible for shared concerns such as session creation, pointer capture, solver invocation timing, and durable sketch commit orchestration. Tool definitions will propose draft changes and staged renderable state, but they will not directly call solver or kernel implementations.

Allow tool definitions to emit structured staged geometry and overlay descriptors rather than raw UI code. This keeps the rendering layer generic and avoids coupling each tool to React or Three.js details.

## Risks / Trade-offs

- [Tool definitions may still need shared geometry helpers, creating a second hidden coupling layer] → Mitigate by creating explicit sketch-tool helper modules for reusable math and staged-entity utilities rather than keeping ad hoc shared logic in the runtime.
- [The tool contract may become too broad if it tries to anticipate every future sketch interaction] → Mitigate by defining a focused initial lifecycle around current tools and allowing additive extensions later.
- [A generic prompt/control schema may be too limited for advanced sketch tools] → Mitigate by providing a documented extension point while keeping common tools on the standard schema.
- [Partial migration could leave mixed ownership between registry-based and switch-based tools] → Mitigate by planning incremental migration and removing centralized tool branches only after all current tools have dedicated modules.

## Migration Plan

1. Introduce the sketch tool definition types, registry, and declarative sketch tool schema alongside the current shared implementation.
2. Update the sketch session runtime to resolve the active tool through the registry while preserving current session orchestration responsibilities.
3. Migrate current tools such as `line`, `rectangle`, and `circle` into per-tool modules.
4. Route sketch prompts, controls, and staged overlays through the declarative schema.
5. Remove obsolete centralized tool branching after all current sketch tools are registry-backed.

## Open Questions

- Whether the sketch-tool schema should include snapping and constraint hints directly or leave them as runtime-generated overlay data.
- Whether staged geometry ownership should stay entirely tool-local or be split between tool definitions and a shared staged-entity helper layer.
- Whether future constraint-creation tools belong in the same sketch-tool contract or require a second sketch authoring family.
