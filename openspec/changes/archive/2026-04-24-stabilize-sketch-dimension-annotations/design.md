## Context

Committed sketch dimensions are currently built from two loosely-coupled presentation paths:

- `src/domain/editor/sketch-session.ts` emits durable `SketchAnnotationDescriptor` entries for the committed annotation chip and separate committed overlay descriptors for dimension lines and angle arcs.
- `src/components/cad/sketch-constraint-annotations.tsx` renders every committed annotation as the same square icon button, regardless of whether the target is a geometric constraint or a driving dimension.
- `src/components/cad/sketch-viewport-feedback.tsx` owns drag hit areas for dimension overlays, so committed dimension placement currently starts from the line or arc geometry rather than from the visible annotation chip.

That split already causes user-visible mismatch. Dimension annotations read like generic constraint badges, compact value display is missing, drag ownership lives on geometry the user does not perceive as the main handle, and angle dimensions do not expose enough dashed witness geometry when the true measured intersection lies beyond the finite line segments.

The code is also fragile because label formatting, hit-testing, and placement updates are spread across independent descriptor and rendering paths with minimal type-level distinction between constraint annotations and dimension annotations.

## Goals / Non-Goals

**Goals:**

- Render committed dimensions as compact dimension annotations whose visible content is `icon + value`.
- Preserve committed dimension double-click editing and make it an explicit supported interaction.
- Move committed dimension placement dragging to the visible dimension annotation icon instead of the committed dimension line or angle arc.
- Render angular dimension witness lines so off-segment intersections remain readable.
- Clarify ownership between annotation descriptors, overlay descriptors, and session mutations so the implementation closes the current bug-prone seams without overreaching.

**Non-Goals:**

- A full rewrite of the committed annotation system for every sketch annotation type.
- New dimension kinds, solver behavior, or document-schema changes unrelated to presentation and placement interaction.
- A broad visual redesign of sketch annotations beyond what is required to make committed dimensions read like dimensions.
- Replacing draft preview dragging during active dimension authoring unless that change is required to preserve parity with committed behavior.

## Decisions

1. Add dimension-specific committed annotation presentation instead of reusing the generic badge contract unchanged.

   `SketchAnnotationDescriptor` should carry enough information to distinguish a committed dimension annotation from a generic constraint annotation at render time. The visible dimension annotation should expose compact display text and an optional placement-drag handle while keeping verbose label/detail metadata available for `aria-label`, `title`, and diagnostics.

   Alternative considered: infer compact dimension text entirely inside `SketchConstraintAnnotations` from existing `glyphKind`, `label`, and `detail`. That keeps the type surface smaller, but it leaves formatting rules duplicated in the view layer and continues to blur the difference between constraint and dimension annotations.

2. Route committed dimension drag initiation through the annotation chip, not the committed overlay geometry.

   The viewport already has a stable patch path for `setDimensionAnnotationPlacement`. The change should reuse that path, but the initiating hit target should move to the committed annotation icon/value chip. Committed overlay geometry remains visible feedback, while active preview overlays may keep their existing draft drag handles if needed during authoring.

   Alternative considered: leave overlay dragging in place and merely add dragging to the annotation chip as a second path. That would preserve backward behavior, but it keeps conflicting drag affordances alive and makes accidental drags more likely.

3. Keep compact visible value text separate from accessible and debugging text.

   Dimension annotations should display only the compact measurement value next to the icon, but the descriptor should still preserve verbose semantic text such as dimension label, units, and target description for accessibility and debugging. This keeps the viewport readable without discarding metadata that existing tests and diagnostics rely on.

   Alternative considered: replace `label` and `detail` with compact display text everywhere. That would simplify rendering, but it would throw away useful descriptive context and weaken accessibility.

4. Extend angle-dimension overlay data with explicit witness-line geometry derived from the referenced infinite lines.

   Angular dimensions should derive dashed witness lines from the actual referenced line directions and the chosen angle-arc endpoints, including cases where the true line intersection lies outside one or both finite segments. The renderer should consume explicit witness-line descriptors instead of recomputing geometry ad hoc in React so that committed and preview paths share the same math.

   Alternative considered: draw extra dashed lines directly inside `sketch-viewport-feedback.tsx` by inspecting only `angleArc` start/end/center data. That would keep the schema smaller, but it would bury geometry logic in the renderer and make committed/preview parity harder to test.

5. Narrow the implementation to explicit boundary fixes instead of a general annotation refactor.

   The proposal should isolate three responsibilities: session code owns annotation semantics and durable placement math, annotation rendering owns chip layout and gesture forwarding, and overlay rendering owns measurement geometry only. That is the smallest change that addresses the current bugs while reducing future fragility.

   Alternative considered: replace the entire committed annotation and overlay stack with a single unified annotation model. That may be attractive long-term, but it is too broad for the current request and would create avoidable regression risk.

## Risks / Trade-offs

- Dragging from the annotation chip can interfere with click and double-click selection/edit timing. → Use the existing selection/edit contract and add explicit tests for click, double-click, and drag threshold behavior on committed dimensions.
- Compact dimension text can hide useful context if it becomes the only surfaced string. → Keep verbose label/detail metadata for accessibility and diagnostics while limiting the visible chip text.
- Off-segment angle witness lines can add visual clutter. → Render them only for angular dimensions, keep them dashed/muted, and derive them from arc endpoints so they clearly explain the measured reference.
- The existing code has multiple fragile presentation seams, so a partial fix can miss one path. → Keep the change centered on shared descriptor contracts and add tests in session, annotation rendering, and viewport feedback layers.

## Migration Plan

No document migration is expected because the change is presentation- and interaction-focused. Rollback is limited to restoring the prior committed annotation rendering and overlay hit targets; durable dimension records remain valid.

## Open Questions

- Whether committed radius and diameter annotations should share exactly the same compact chip layout as linear dimensions or reserve a slightly different value suffix is an implementation detail and does not block the proposal.
