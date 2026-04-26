## Context

The workbench already has the important ingredients for a temporary section-view workflow: toolbar tool dispatch, typed editor/runtime command state, durable target picking for faces/regions/constructions, and a React Three Fiber viewport that renders transient and durable triangulated meshes. What is missing is the inspect-style loop around those ingredients: activating `Section View`, collecting one planar seed, keeping temporary section state alive while the user drags a handle, clipping the visible model, and drawing a drafting-style cut surface.

This change is cross-cutting because it touches toolbar activation, editor/runtime command state, viewport picking/drag interaction, renderable composition, and section-specific rendering. It also has one non-trivial rendering constraint: the user wants cut faces to read like a classic mechanical section with flat fill and diagonal hatching, while uncut retained surfaces keep their original shading. That means simple mesh clipping alone is not enough; the viewport needs an explicit cut-surface rendering path.

## Goals / Non-Goals

**Goals:**

- Add a temporary `Section View` workflow in part mode that starts from one explicit planar seed.
- Accept planar faces, closed profile regions, and construction/plane references as section seeds.
- After seed selection, expose a viewport drag handle that moves the section plane back and forth along the section normal.
- Default the retained half to the side away from the camera, and allow the user to flip the retained side without reseeding.
- Clip the whole currently visible model temporarily, including visible preview solids, without mutating durable document geometry.
- Render cut faces with flat section fill plus diagonal hatch lines, while preserving existing shading on uncut retained surfaces.
- Keep section logic in frontend/editor/viewport layers and add focused unit/integration coverage around state, picking, dragging, clipping, and rendering.

**Non-Goals:**

- Add a durable modeling feature, feature-tree entry, or document serialization for section views.
- Support non-planar faces or arbitrary 3D curve selections as section seeds.
- Change the kernel contract, regenerate model topology, or persist sliced/capped geometry back into the document.
- Introduce a full drawing workspace or paper-space drafting annotations beyond the temporary section hatch treatment in the 3D viewport.

## Decisions

### Section view is an editor-owned temporary inspect command

Represent section view as a temporary editor/runtime command rather than as local component state in `CadWorkbench` or `ThreeCadViewport`. The command owns lifecycle phases such as idle, collecting seed, and active section manipulation; the viewport remains a renderer and pointer-input surface for that state.

Rationale: this reuses existing tool activation and selection-filter patterns, keeps cancellation/escape semantics consistent with other command workflows, and avoids burying cross-component state in React-local effects.

Alternative considered: store section state entirely in `CadWorkbench` or the viewport component. Rejected because the tool already enters through the shared action bus and needs typed selection gating, cancellation, and durable-target resolution that the editor/runtime layer already owns.

### Seed selection reuses existing durable target semantics

The section seed should be expressed as existing pick targets rather than a new target family. Accepted seeds are:

- `construction` references, including standard datum planes and authored plane outputs that surface as construction-plane targets
- planar `face` targets
- closed `region` targets, using the owning sketch plane as the seed plane

The runtime should install a dedicated section-view selection filter so unsupported targets are rejected without changing the rest of the selection system.

Alternative considered: introduce a new section-specific target type. Rejected because the current target model already captures the needed authored references, and a new target family would increase picking and selection complexity without adding new user-visible behavior.

### Section clipping is temporary and applies after visible-renderable composition

The active section should operate on the currently visible viewport renderables after hidden-target filtering and preview/document layering have already been composed. That means the section cuts the whole visible model, not only the seed owner, and it stays aligned with existing visibility toggles and preview behavior.

Rationale: the user asked to cut the whole visible model, and this keeps sectioning as a presentation concern rather than a modeling concern.

Alternative considered: clip directly from the raw snapshot render export or from one selected body only. Rejected because it would either ignore current visibility state or conflict with the requested whole-model scope.

### Cut surfaces should be generated from viewport mesh geometry, not durable model edits

Use the existing triangulated mesh renderables as the source of truth for temporary section caps. The retained-half meshes can use clipping-plane rendering, but cut faces need an explicit transient cap path derived from the intersection of visible mesh triangles with the active section plane. Those cap surfaces should be rendered with flat lighting and a hatch overlay in section-plane coordinates.

Rationale: the viewport already owns tessellated mesh data, and deriving temporary cap surfaces there keeps section view frontend-owned and testable. It also preserves existing shading on uncut surfaces because only the retained-half meshes are clipped; the cap rendering is additive and section-specific.

Alternative considered: use only material clipping and accept open cut holes. Rejected because it cannot produce the requested solid section treatment.

Alternative considered: use a pure stencil-buffer cap technique. Rejected for the first slice because it is more opaque to test, harder to express as renderable-domain logic, and more tightly coupled to renderer state.

### Dragging is axis-constrained along the section normal

After seed acceptance, the viewport should render one visible drag handle anchored on the active section plane. Primary-pointer dragging on that handle changes only the signed offset along the section normal; it does not permit arbitrary 2D plane repositioning. Pointer interactions away from the handle continue to use existing camera/navigation behavior.

Rationale: the user asked for “back n forth” dragging, which maps to one-dimensional displacement along the section normal and avoids ambiguity about free plane translation.

Alternative considered: let the user drag anywhere on the clipped plane surface. Rejected because it creates ambiguous motion mapping and increases accidental camera/selection conflicts.

### Flip state is explicit and independent from drag offset

Store retained-side orientation as its own boolean or signed mode separate from the plane offset. Seed acceptance initializes that state so the kept side is away from the camera, and a later flip action simply inverts the kept side while preserving the current plane position.

Rationale: this matches the requested behavior and avoids surprising offset jumps when the side is flipped.

Alternative considered: encode the kept side only by allowing negative offsets. Rejected because flipping becomes harder to reason about and cannot preserve a stable “same plane, opposite half” interaction.

## Risks / Trade-offs

- Computing cap geometry from triangulated meshes can expose tessellation seams or non-manifold artifacts on poor mesh inputs -> Keep the section effect mesh-based and temporary, test against current render exports, and accept that cap fidelity matches current viewport tessellation fidelity rather than exact analytic topology.
- Section drag interaction can conflict with camera controls or ordinary picking -> Give the handle an explicit pick target and only start section dragging from that handle, while preserving existing camera behavior for drags elsewhere.
- Hatch rendering can become visually noisy at very small or very large scales -> Define hatch spacing in section-plane/view space with bounded scaling so the pattern remains legible across common zoom levels.
- Adding editor runtime state for a non-modeling inspect tool increases command-surface complexity -> Keep the new state narrowly scoped to section-view lifecycle and avoid mixing section behavior into feature/sketch command branches.
- Preview and document renderables may not always share identical shading/material assumptions -> Apply section clipping at renderable composition and keep cap materials section-specific so uncut surfaces continue to use their existing render path.

## Migration Plan

No document migration or rollout gating is required because section view is temporary UI state only. Implementation can land incrementally behind the existing `Section View` toolbar tool:

1. Add runtime state and seed collection without changing durable modeling behavior.
2. Add viewport clipping and handle dragging for active section sessions.
3. Add cut-surface cap rendering and hatch treatment.
4. Add or update tests for runtime state, viewport interaction, and rendering behavior.

Rollback is straightforward: removing the section-view runtime branch and viewport render path restores the prior no-op tool behavior without affecting saved documents.

## Open Questions

None for this proposal. Seed scope, kept-side default, clipping scope, and hatch treatment were resolved during proposal review.
