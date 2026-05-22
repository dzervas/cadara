## 1. Sketch Pointer Event Flow

- [x] 1.1 Add a frame-coalesced active sketch pointer preview scheduler at the sketch interaction boundary.
- [x] 1.2 Ensure click, key, and tool-acceptance paths flush the latest pending pointer preview before consuming pointer-dependent tool state.
- [x] 1.3 Add no-op guards so pointer movement with no preview-relevant sketch state preserves sketch-session identity.
- [x] 1.4 Preserve the existing direct sketch geometry drag coalescing and interactive solve lifecycle.

## 2. Active Sketch Display Derivation

- [x] 2.1 Split active sketch display derivation into stable accepted renderables and transient pointer/tool preview overlays.
- [x] 2.2 Define stable display invalidation inputs for accepted definition changes, projection/reference changes, solved snapshot changes, region refreshes, diagnostics, styles, and history cursor changes.
- [x] 2.3 Reuse the stable accepted display basis across pointer-only preview frames.
- [x] 2.4 Ensure direct drag frames invalidate stable display only when an accepted solved basis changes.

## 3. Demand-Driven Viewport Rendering

- [x] 3.1 Add a viewport invalidation bridge for renderable, authoring-feedback, hover, selection, camera, controls, resize, section view, clipping, LOD, and theme/material changes.
- [x] 3.2 Switch the Three.js canvas from continuous idle rendering to demand-driven rendering.
- [x] 3.3 Verify camera controls, view cube, fit/reset view, camera transitions, pointer hover, sketch preview, direct drag, and async renderable updates request visible frames.
- [x] 3.4 Remove any temporary continuous-render fallback introduced during the implementation.

## 4. Tests and Validation

- [x] 4.1 Review `docs/testing.md` before adding or changing tests and choose the owning test lanes for each seam.
- [x] 4.2 Add logic coverage for pointer preview coalescing, no-op pointer movement, acceptance flushing, stable display reuse, and stable display invalidation.
- [x] 4.3 Add viewport/UI or e2e coverage proving demand rendering invalidates on camera movement, renderable changes, hover/selection, and sketch preview movement.
- [x] 4.4 Add or update a large-sketch pointer stress check based on `public/logo.cadara` that catches repeated full-solve/display derivation during pointer-only preview.
- [x] 4.5 Run `bun run test:all` and targeted sketch e2e coverage, then fix residual regressions.
