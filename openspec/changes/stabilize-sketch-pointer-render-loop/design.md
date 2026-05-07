## Context

The current active sketch pointer path treats ordinary drawing-tool pointer preview as a full sketch-session state update. `three-cad-viewport` forwards every sketch pointer move, the editor event loop applies `sketch.pointerMoved`, workbench state recomposes viewport renderables from the changed sketch session, and active sketch display derivation still solves the current definition to build display renderables.

The archived `optimize-sketch-solver-runtime` change addressed direct constrained drag: drag moves are coalesced, use warm-started interactive solve sessions, avoid solving unrelated components, and defer live region extraction. That optimization does not cover pointer-only drawing previews, hover-like staged tool geometry, snap indicator movement, or dimension placement preview movement. Those preview updates can still pay the cost of solved active sketch display even when accepted geometry is unchanged.

The viewport also currently renders continuously while mounted. Lazy rendering can reduce idle GPU/CPU work and fits this change, but it does not by itself remove the CPU-side sketch pointer/display churn that causes freeze-class behavior during sketch authoring.

## Goals / Non-Goals

**Goals:**

- Make active sketch pointer preview updates frame-bounded and semantically no-op aware.
- Reuse stable active-sketch display renderables while only pointer/tool preview state changes.
- Keep direct constrained drag behavior on the existing interactive solver path.
- Render the Three.js viewport on demand while preserving visible authoring feedback for all existing interactions.
- Add focused behavioral/performance guardrails at the owning sketch and viewport seams.

**Non-Goals:**

- Rewriting the sketch solver or replacing the archived interactive solver work.
- Moving sketch solving, display derivation, or Three.js rendering to a worker or offscreen canvas.
- Changing persisted sketch/document schemas.
- Changing feature editing semantics beyond benefiting from demand-driven viewport rendering where it naturally applies.
- Silencing exceptions from invalid sketch state, stale sessions, or renderer failures.

## Decisions

1. Coalesce `sketch.pointerMoved` at the sketch interaction boundary.

   Pointer moves that only update active sketch preview state should be buffered to the next animation frame, preserving the latest projected sketch-plane point for that frame. If a newer pointer move arrives before the frame, the older projected point is replaced.

   Rationale: this matches the existing direct drag coalescing contract and bounds preview updates to the display cadence. It also avoids pushing high-frequency browser pointer events through the TEA event loop one by one.

   Alternative considered: throttle inside individual sketch tools. That would duplicate scheduling across line, circle, rectangle, dimension, snap, and future tools, and it would still let non-tool pointer state churn through the editor.

2. Return unchanged editor/sketch-session state for no-op pointer moves.

   The sketch pointer transition should avoid creating a new session object when no active tool, snap candidate, dimension placement, pending anchor, drag, or hover-relevant state can change. It should also avoid updates when the projected point remains within the existing pointer precision bucket for the active preview.

   Rationale: workbench renderable recomposition is keyed by state identity. No-op pointer updates must remain no-ops at the domain state seam, not just later in React rendering.

   Alternative considered: memoize only in React/workbench. That can hide some component work, but it still burns editor transition and sketch display derivation work.

3. Split active sketch display into stable basis and transient preview overlays.

   `getSketchSessionDisplayRenderables` should distinguish:

   - Stable accepted geometry renderables derived from the current sketch definition, projected references, committed constraints/dimensions, current solved snapshot, diagnostics, and region freshness.
   - Transient preview renderables derived from active tool pointer state, snap feedback, pending dimension placement, reference-image anchor placement, and similar staged authoring state.

   Stable display derivation should be cached or retained on the session/controller until its structural inputs change. Pointer-only preview updates should reuse the stable basis and rebuild only the transient overlay. Accepted geometry edits, constraint edits, projection changes, solve-result changes, history cursor changes, SVG style changes, and region refreshes invalidate the stable basis.

   Rationale: the freeze-class repro is not only event frequency. The expensive part is solving and rebuilding accepted geometry display for unchanged accepted geometry.

   Alternative considered: cache the raw solve result inside `display.ts` by object identity. That would help one function but leave invalidation implicit and make reference-image/region/constraint display staleness harder to reason about.

4. Preserve direct drag as a separate solve/display path.

   Direct geometry drags keep using the interactive solver lifecycle from the previous change. Drag frames may update accepted sketch definition or solved draft state, so they invalidate stable accepted display only when an accepted drag frame changes the solved basis. Deferred regions remain deferred under the existing direct-drag contract.

   Rationale: direct drag is a real geometry edit; pointer-only drawing preview is not. Treating them the same caused unnecessary cost and risks regressing the solver optimization.

   Alternative considered: route drawing preview through the interactive solver session too. That would add lifecycle complexity without providing value for pointer-only staged geometry.

5. Use demand-driven viewport rendering with explicit invalidation.

   The React Three Fiber canvas should render on demand instead of continuously while idle. A small viewport invalidation bridge should request frames when:

   - viewport renderables, active sketch preview overlays, hover/selection, section view, clipping, LOD tier, or theme/material inputs change;
   - OrbitControls, camera transitions, view cube actions, fit/reset view, pan/rotate/zoom, or resize events change the camera;
   - active drags, transient animations, or async geometry results need visible feedback.

   Rationale: lazy rendering is valuable once CPU-side pointer churn is fixed. It reduces idle work while preserving responsiveness through explicit invalidation at interaction seams.

   Alternative considered: leave `frameloop="always"` until later. That is simpler, but the invalidation bridge is close to the same viewport state seams touched by sketch preview rendering and provides a low-risk idle performance win.

## Risks / Trade-offs

- [Stale stable display cache] -> Define stable-basis invalidation from explicit sketch definition, projection, solve result, region, style, history cursor, and diagnostics inputs; add tests that pointer-only preview reuses stable display while accepted edits invalidate it.
- [Dropped final pointer position] -> Flush or process the latest pending pointer preview before click/accept flows that consume the pointer position.
- [Preview feels laggy] -> Coalesce to animation frames, not timer throttles, and always use the latest projected point for the frame.
- [Viewport misses a render after switching to demand mode] -> Centralize invalidation through a small bridge and cover camera changes, renderable changes, sketch preview changes, hover/selection, and resize with integration/e2e checks.
- [Performance tests become brittle] -> Prefer deterministic seam tests that assert solve/display call counts or stable-basis reuse over wall-clock thresholds; keep browser smoke measurements as developer diagnostics, not the only correctness proof.
- [Feature editing idle behavior changes unexpectedly] -> Demand rendering applies globally, but feature-editing state changes must invalidate through the same renderable/camera/selection seams already needed for sketch editing.

## Migration Plan

1. Add or adjust sketch-session tests around pointer-only preview updates, no-op updates, and direct-drag separation.
2. Refactor sketch pointer scheduling so active sketch pointer moves are coalesced and flushed before acceptance paths that require the latest pointer.
3. Split active sketch display derivation into stable accepted renderables and transient preview overlays with explicit invalidation inputs.
4. Wire workbench renderable composition to reuse the stable active-sketch display basis across pointer-only preview frames.
5. Introduce the viewport invalidation bridge and switch the Three.js canvas to demand-driven rendering.
6. Add viewport coverage for invalidation on camera movement, renderable changes, hover/selection, and active sketch preview movement.
7. Validate against the existing sketch e2e suite plus a large-sketch pointer-move stress path based on `public/logo.cadara`.
