import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  MAX_LEFT_SIDEBAR_WIDTH,
  MIN_LEFT_SIDEBAR_WIDTH,
  MIN_WORKBENCH_VIEWPORT_WIDTH,
  clampWorkbenchSidebarWidth,
  getWorkbenchSidebarWidthFromPointer,
} from '@/app/workbench/shell/workbench-shell-layout'

test('src/app/workbench-shell-layout.spec.ts', async () => {  expectTrue(
    clampWorkbenchSidebarWidth(MIN_LEFT_SIDEBAR_WIDTH - 80, 1600) === MIN_LEFT_SIDEBAR_WIDTH,
    'Sidebar resizing should not collapse below the minimum width.',
  )

  expectTrue(
    clampWorkbenchSidebarWidth(MAX_LEFT_SIDEBAR_WIDTH + 120, 2000) === MAX_LEFT_SIDEBAR_WIDTH,
    'Sidebar resizing should not exceed the configured maximum width on wide workbenches.',
  )

  expectTrue(
    clampWorkbenchSidebarWidth(900, MIN_LEFT_SIDEBAR_WIDTH + MIN_WORKBENCH_VIEWPORT_WIDTH + 120)
      === 400,
    'Sidebar resizing should preserve the minimum viewport width on narrow workbenches.',
  )

  expectTrue(
    getWorkbenchSidebarWidthFromPointer(540, 120, 1200) === 420,
    'Sidebar dragging should resolve width from the shell-relative pointer position.',
  )
})
