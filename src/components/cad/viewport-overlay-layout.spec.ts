import { test } from 'bun:test'

import {
  VIEWPORT_OVERLAY_GAP_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEW_CUBE_SIZE_PX,
  getWorkbenchNotificationRightOffsetPx,
} from '@/components/cad/viewport-overlay-layout'

test('src/components/cad/viewport-overlay-layout.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: false }) === VIEWPORT_OVERLAY_INSET_PX,
    'Notification cards should use the normal viewport inset when no view cube space is reserved.',
  )

  assert(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })
      === VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX,
    'Notification cards should reserve the view cube width plus a gap when sharing the top-right viewport corner.',
  )
})
