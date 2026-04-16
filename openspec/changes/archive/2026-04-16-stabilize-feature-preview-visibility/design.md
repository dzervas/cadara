## Context

Feature previews are editor-owned transient renderables returned by preview evaluation, while committed scene geometry comes from the current document snapshot. The current workbench composes the viewport by passing `previewRenderables ?? snapshot?.document.render.records ?? []` into the renderable merge path, which means any active preview replaces the committed scene instead of layering over it.

That substitution creates two user-facing problems. First, the rest of the model disappears or flickers as preview lifecycle events arrive, which breaks spatial context during authoring. Second, preview geometry is styled through the same base render material path as committed geometry, so even when the preview is visible it is not clearly differentiated as transient feedback.

## Goals / Non-Goals

**Goals:**
- Keep committed document geometry visible while a feature preview is active.
- Render feature previews as a transient overlay with reduced opacity so users can distinguish previewed results from committed geometry.
- Make preview start, update, stale-response handling, cancel, and commit transitions visually stable without blanking unrelated scene content.
- Keep the change scoped to viewport composition and render-style mapping without changing modeling preview contracts.

**Non-Goals:**
- Redesign feature preview generation in the modeling adapters.
- Change durable document render colors outside the preview-specific differentiation needed here.
- Introduce new persisted render metadata or kernel-owned preview semantics.
- Solve every overlap artifact between preview and committed geometry if that requires a broader rendering architecture change.

## Decisions

Layer preview renderables on top of committed document renderables instead of choosing one source or the other. The workbench should always start from snapshot renderables, then append active preview renderables before sketch-session overlays are merged. This directly addresses the current replacement bug and keeps committed geometry available through the full preview lifecycle.

Apply preview-specific visual treatment in the viewport renderer rather than extending the render contract. Preview ownership is already implicit in the workbench state because `previewRenderables` are stored separately from durable snapshot renderables. The renderer can therefore classify appended preview records as transient and apply adjusted materials, opacity, and render order without changing modeling adapter payloads or durable render schemas.

Use a consistent preview material policy by geometry class. Preview faces should remain partially transparent and render above durable faces; preview edges and markers should use the existing authoring color family with slightly reduced opacity or elevated render order so they remain readable over the base scene. Durable geometry must retain its normal styling so the preview contrast comes from the overlay, not from dimming the committed scene.

Keep preview cleanup state-local and additive. Clearing a preview because of cancel, commit, stale responses, or invalid drafts should remove only the transient overlay set and fall back to the unchanged snapshot renderables in the same composition path. This avoids introducing a separate hidden-scene mode and reduces the chance of empty-frame regressions.

## Risks / Trade-offs

- [Overlaying preview and committed geometry can introduce z-fighting or heavy visual overlap] -> Mitigate with preview-specific transparency, elevated render order, and existing polygon-offset/depth-write controls.
- [Preview overlays may duplicate bindings already present in the committed scene] -> Mitigate by keeping durable scene composition authoritative and treating preview renderables purely as additive visual feedback.
- [Applying preview styling in the viewport could drift from future rendering contracts] -> Mitigate by centralizing the transient-style mapping alongside existing material helpers instead of scattering one-off opacity changes.
- [Stale preview responses could still flash if the composition path swaps arrays too late] -> Mitigate by preserving current stale-preview guards and ensuring the fallback scene is always the durable snapshot list.

## Migration Plan

1. Update workbench viewport composition so snapshot renderables remain present when preview renderables exist.
2. Thread preview-origin classification into the viewport render-object assembly path.
3. Add preview-specific material and render-order handling for meshes, polylines, and markers.
4. Verify preview clear and stale-response paths restore the normal committed scene without geometry loss.
5. Add regression coverage around layered preview composition and preview styling.

## Open Questions

- Should preview overlays participate in picking exactly like committed geometry, or should future work make them non-pickable when they duplicate durable targets?
- Do preview faces need semantic-class-specific opacity values, or is one shared preview transparency sufficient for the first pass?
