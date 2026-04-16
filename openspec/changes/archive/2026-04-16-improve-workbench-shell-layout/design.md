## Context

The shell layout already coordinates the left navigation, central viewport, right inspector, and bottom timeline, but two aspects are currently awkward for authoring. First, the left sidebar cannot be resized to match document density or screen size. Second, the right inspector participates in page flow, so opening it can force overflow and scrolling instead of behaving like a CAD panel over the viewport. The timeline also exposes cursor movement through discrete controls even though the feature sequence is spatially represented.

## Goals / Non-Goals

**Goals:**

- Add a bounded left-sidebar resize interaction.
- Make the right inspector an overlay with its own scroll container.
- Replace timeline step controls with a draggable cursor handle that snaps to valid positions.

**Non-Goals:**

- Redesigning sidebar content hierarchy or inspector form internals.
- Changing document cursor semantics or adding branch visualization.
- Adding freeform timeline positions that do not map to valid document cursor anchors.

## Decisions

### Keep shell geometry in the workbench layout layer

Sidebar width, inspector overlay state, and timeline cursor layout should be managed by the workbench shell rather than by nested content components. The shell already owns the viewport rectangle and stacking relationships, so it is the right place to enforce width bounds, overlay anchoring, and timeline control placement.

This is preferable to decentralized sizing logic because inconsistent ownership would make viewport sizing regressions more likely.

### Inspector overlays the viewport instead of participating in page flow

The right panel should be rendered as an overlay anchored within the workbench frame. Its contents should scroll internally, and the underlying page should no longer need to expand just to show the inspector.

This is preferable to keeping the current flow layout because CAD-style side panels should not reflow the entire authoring surface.

### Timeline cursor is a direct-manipulation snapped handle

The timeline cursor should be represented as a draggable vertical handle using the requested two-arrow glyph. Dragging updates a local hover or drag position, snaps to the nearest valid cursor anchor, and dispatches rollback or replay changes only for valid snapped positions.

This is preferable to step buttons because the control already sits on a spatial timeline. It is also preferable to unsnapped dragging because the underlying document cursor is discrete.

## Risks / Trade-offs

- [Resizable sidebars can create cramped viewport widths on small screens] → Mitigate by enforcing minimum and maximum bounds and preserving a minimum viewport width.
- [Overlay inspector stacking can interfere with viewport pointer events] → Mitigate by clipping overlay bounds and ensuring only the panel surface captures pointer input.
- [Timeline drag interactions can feel jumpy on dense feature lists] → Mitigate by snapping to explicit anchors and showing clear hover or active feedback on the handle.
