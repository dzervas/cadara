export const VIEWPORT_OVERLAY_INSET_PX = 16
export const VIEWPORT_OVERLAY_GAP_PX = 16
export const VIEW_CUBE_SIZE_PX = 120
/**
 * Top inset for any viewport overlay that must clear the floating toolbar.
 * The floating toolbar sits at top:12 with height 50, plus ~14px of breathing room.
 * Used by the view cube, notifications, and any other top-anchored overlay.
 */
export const VIEWPORT_OVERLAY_TOP_INSET_PX = 76
export const WORKBENCH_STATUS_TOP_PX = VIEWPORT_OVERLAY_TOP_INSET_PX
export const WORKBENCH_STATUS_TOP_WITH_RESTORE_PX = WORKBENCH_STATUS_TOP_PX + 60

export function getWorkbenchNotificationRightOffsetPx(options: { reserveViewCube: boolean }) {
  if (!options.reserveViewCube) {
    return VIEWPORT_OVERLAY_INSET_PX
  }

  return VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX
}
