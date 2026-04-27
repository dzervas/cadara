## Context

The editor runtime already hosts several workflow types, including sketch editing, feature editing, generic import sessions, and section-view inspection. What it lacks is a clean sketch-owned workflow contract for committed sketch operations that need their own pointer semantics, overlays, hit targets, and structured side-panel UI. Without that layer, every such workflow would be forced either into ad hoc viewport branching or into inappropriate reuse of sketch tools, feature forms, or deprecated SVG-style UI code.

This change introduces that missing host contract and keeps it deliberately generic so later workflows can reuse it without being forced into the semantics of reference images or any other single mode.

## Goals / Non-Goals

**Goals:**
- Add a sketch-owned special editor mode contract for committed sketch operations.
- Make the contract explicitly viewport-aware: picking, hover, click, double-click, drag, overlays, and mode-local target identity.
- Add a structured panel contract that visually continues the feature editor's form language without sharing feature-editor business logic or reusing deprecated SVG tool UI components.
- Keep mode-specific logic out of the viewport component and out of generic sketch tool branches.
- Provide a reusable foundation for future specialized sketch workflows beyond reference images.

**Non-Goals:**
- Implement any particular mode-specific behavior such as image calibration.
- Merge sketch sessions and feature sessions into one universal editing-state type.
- Reuse the deprecated SVG tool form components or their special-case UI plumbing.

## Decisions

### 1. Special editor modes are sketch-owned workflows, not feature sessions and not sketch tools

An active sketch session will be able to host an optional special editor mode that targets a committed sketch operation. That mode remains separate from:
- ordinary sketch drawing/edit tools
- feature sessions
- generic import sessions

Why:
- The semantics are different from both drawing tools and feature forms.
- It avoids forcing operation editors through tool-specific staged-geometry assumptions.
- It keeps workflow ownership local to the sketch editor where the committed operation lives.

Alternative considered:
- Model special modes as sketch tools.
- Rejected because committed-operation editing is not the same as drawing/staging new sketch geometry.

### 2. The viewport consumes a generic mode adapter, not per-mode branches

Each special mode definition will provide a viewport-facing adapter that describes:
- supported pick targets
- hover handling
- click and double-click handling
- drag start/update/finish behavior
- mode-local overlays

Why:
- The viewport already owns low-level event routing and should continue to do so.
- The adapter keeps business logic out of the viewport and avoids a growing switch on mode IDs.

Alternative considered:
- Let each mode manipulate viewport-local React state directly.
- Rejected because it recreates exactly the ad hoc orchestration this change is meant to prevent.

### 3. Special mode panels use a dedicated declarative form contract

The mode panel should visually continue the feature editor's structured sections and controls, but it should use its own contract and implementation surface rather than importing feature-editor definitions or deprecated SVG tool components.

Why:
- The feature editor already proves the value of a structured panel vocabulary.
- Reusing visual direction without reusing business logic preserves clean boundaries.
- The user explicitly asked for a feature-editor-like continuation and explicitly rejected reuse of the deprecated SVG tool components.

Alternative considered:
- Reuse feature-editor form schema directly.
- Rejected because sketch special modes are not feature drafts and would inherit the wrong semantics.

### 4. Mode definitions live in their own dedicated registry and folders

Recommended structure:
- `src/domain/sketch-special-modes/` for the generic contract, registry, and host utilities
- `src/components/...` for generic panel/presentation components only
- one dedicated folder per mode implementation under its own domain

Why:
- It gives each later mode a clear home without threading code through sketch-session and viewport files.
- It supports extension without normalizing everything into one giant sketch domain file.

## Risks / Trade-offs

- [Too much genericity too early] → Keep the host contract narrowly focused on lifecycle, viewport interaction, overlays, and panel rendering; leave mode semantics to dedicated implementations.
- [Feature-editor visual continuity accidentally becomes feature-editor coupling] → Reuse shell patterns and presentation direction only; define a separate special-mode form contract.
- [Viewport integration becomes another branch layer] → Route all special-mode behavior through a generic adapter and registry rather than inline conditionals.
- [Sketch session state grows] → Keep the special-mode state nested and optional instead of flattening its fields into the generic sketch session surface.

## Migration Plan

- Introduce the generic special editor mode contracts, registry, and runtime state.
- Add viewport routing hooks and generic panel rendering hooks for active special modes.
- Keep all current behavior unchanged for sketches that do not activate a special mode.
- Layer concrete modes, beginning with reference-image calibration, on top of the new host contract in later changes.

## Open Questions

- None for this infrastructure change. Concrete mode semantics are intentionally deferred.
