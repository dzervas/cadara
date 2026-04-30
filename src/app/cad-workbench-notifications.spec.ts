import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-notifications.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = readFileSync(join(process.cwd(), 'src/app/workbench/cad-workbench.tsx'), 'utf8')
  const notificationsSource = readFileSync(join(process.cwd(), 'src/app/workbench/controllers/use-workbench-notifications.ts'), 'utf8')

  assert(
    workbenchSource.includes("from '@/components/layout/workbench-notification'"),
    'CadWorkbench should render viewport feedback through the shared notification component.',
  )
  assert(
    notificationsSource.includes("type: 'info'") && notificationsSource.includes("title: 'Workbench action'"),
    'Workbench status feedback should use info notification presentation by default in the shared notifications controller.',
  )
  assert(
    notificationsSource.includes("type: 'error'") && notificationsSource.includes("title: 'Workbench action failed'"),
    'Workbench action failures should use error notification presentation in the shared notifications controller.',
  )
  assert(
    workbenchSource.includes('type="error"') && workbenchSource.includes('title="History restore failed"'),
    'History restore failures should render as error notifications.',
  )
  assert(
    workbenchSource.includes('WORKBENCH_STATUS_TOP_WITH_RESTORE_PX') &&
      workbenchSource.includes('restoreMessage ? WORKBENCH_STATUS_TOP_WITH_RESTORE_PX : WORKBENCH_STATUS_TOP_PX'),
    'Viewport-local notification surfaces should remain vertically separated when restore and status messages coexist.',
  )
  assert(
    workbenchSource.includes('right: notificationRightOffset'),
    'Viewport-local notification surfaces should preserve the view-cube-safe right offset.',
  )
  assert(
    notificationsSource.includes('modelingService.getHistoryRestoreState') &&
      notificationsSource.includes("state.kind === 'failed'"),
    'History restore failures should still be sourced from modeling-service restore state inside the notifications controller.',
  )
})
