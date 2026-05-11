export const VIEWPORT_OVERLAY_INSET_PX = 16;
export const VIEWPORT_OVERLAY_GAP_PX = 16;
export const VIEW_CUBE_SIZE_PX = 120;
export const FLOATING_PARTS_TREE_WIDTH_PX = 240;
export const VIEWPORT_FLOATING_PANEL_GAP_PX = 12;
/**
 * Top inset for any viewport overlay that must clear the floating toolbar.
 * The floating toolbar sits at top:12 with height 50, plus ~14px of breathing room.
 * Used by the view cube, notifications, and any other top-anchored overlay.
 */
export const VIEWPORT_OVERLAY_TOP_INSET_PX = 76;
export const VIEWPORT_OVERLAY_TOP_INSET_STYLE =
  "var(--workbench-viewport-overlay-top, 76px)";
/**
 * Shared left-side panel slot. It starts below the toolbar and to the right of
 * the floating parts tree, matching the feature editor placement.
 */
export const VIEWPORT_FLOATING_PANEL_LEFT_PX =
  VIEWPORT_OVERLAY_INSET_PX +
  FLOATING_PARTS_TREE_WIDTH_PX +
  VIEWPORT_FLOATING_PANEL_GAP_PX;
export const VIEWPORT_FLOATING_PANEL_TOP_PX = VIEWPORT_OVERLAY_TOP_INSET_PX;
export const VIEWPORT_FLOATING_PANEL_TOP_STYLE =
  VIEWPORT_OVERLAY_TOP_INSET_STYLE;
/**
 * Top inset for the visible viewport surface itself. The shell uses floating
 * chrome, so the viewport surface starts at the top edge.
 */
export const VIEWPORT_CANVAS_TOP_INSET_PX = 0;

/**
 * Width of the legacy structural sidebar that the canvas no longer reserves.
 * The fullscreen canvas extends `LEGACY_VIEWPORT_LEFT_INSET_PX` further to
 * the LEFT than the legacy canvas did; the orthographic camera frustum scales
 * with canvas width, so the same world point now projects 180px (= 360/2)
 * further LEFT in canvas pixel space than under the legacy 1080px canvas.
 *
 * These constants keep the e2e marker width aligned with the old viewport bbox
 * without reserving corresponding screen real estate.
 */
export const LEGACY_VIEWPORT_LEFT_INSET_PX = 180;
export const LEGACY_VIEWPORT_WIDTH_PX = 1080;
export const LEGACY_VIEWPORT_HEIGHT_PX = 912;
export const WORKBENCH_STATUS_TOP_PX = VIEWPORT_OVERLAY_TOP_INSET_PX;
export const WORKBENCH_STATUS_TOP_WITH_RESTORE_PX =
  WORKBENCH_STATUS_TOP_PX + 60;
export const WORKBENCH_STATUS_TOP_STYLE = VIEWPORT_OVERLAY_TOP_INSET_STYLE;
export const WORKBENCH_STATUS_TOP_WITH_RESTORE_STYLE =
  "calc(var(--workbench-viewport-overlay-top, 76px) + 60px)";

export function getWorkbenchNotificationRightOffsetPx(options: {
  reserveViewCube: boolean;
}) {
  if (!options.reserveViewCube) {
    return VIEWPORT_OVERLAY_INSET_PX;
  }

  return (
    VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX
  );
}
