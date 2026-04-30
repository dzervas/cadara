export const DEFAULT_LEFT_SIDEBAR_WIDTH = 360
export const MIN_LEFT_SIDEBAR_WIDTH = 280
export const MAX_LEFT_SIDEBAR_WIDTH = 520
export const MIN_WORKBENCH_VIEWPORT_WIDTH = 640

export function clampWorkbenchSidebarWidth(width: number, containerWidth: number) {
  const boundedContainerWidth = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : MIN_LEFT_SIDEBAR_WIDTH + MIN_WORKBENCH_VIEWPORT_WIDTH
  const maxWidth = Math.max(
    MIN_LEFT_SIDEBAR_WIDTH,
    Math.min(MAX_LEFT_SIDEBAR_WIDTH, boundedContainerWidth - MIN_WORKBENCH_VIEWPORT_WIDTH),
  )

  return Math.min(Math.max(width, MIN_LEFT_SIDEBAR_WIDTH), maxWidth)
}

export function getWorkbenchSidebarWidthFromPointer(
  pointerClientX: number,
  containerLeft: number,
  containerWidth: number,
) {
  return clampWorkbenchSidebarWidth(pointerClientX - containerLeft, containerWidth)
}
