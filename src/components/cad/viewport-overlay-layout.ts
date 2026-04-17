export const VIEWPORT_OVERLAY_INSET_PX = 16
export const VIEWPORT_OVERLAY_GAP_PX = 16
export const VIEW_CUBE_SIZE_PX = 120
export const WORKBENCH_STATUS_TOP_PX = VIEWPORT_OVERLAY_INSET_PX
export const WORKBENCH_STATUS_TOP_WITH_RESTORE_PX = 136

export function getWorkbenchNotificationRightOffsetPx(options: { reserveViewCube: boolean }) {
  if (!options.reserveViewCube) {
    return VIEWPORT_OVERLAY_INSET_PX
  }

  return VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX
}
