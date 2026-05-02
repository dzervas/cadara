import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  VIEWPORT_OVERLAY_GAP_PX,
  VIEWPORT_OVERLAY_INSET_PX,
  VIEW_CUBE_SIZE_PX,
  getWorkbenchNotificationRightOffsetPx,
} from '@/components/cad/viewport-overlay-layout'

test('src/components/cad/viewport-overlay-layout.spec.ts', async () => {  expectTrue(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: false }) === VIEWPORT_OVERLAY_INSET_PX,
    'Notification cards should use the normal viewport inset when no view cube space is reserved.',
  )

  expectTrue(
    getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })
      === VIEWPORT_OVERLAY_INSET_PX + VIEW_CUBE_SIZE_PX + VIEWPORT_OVERLAY_GAP_PX,
    'Notification cards should reserve the view cube width plus a gap when sharing the top-right viewport corner.',
  )
})
