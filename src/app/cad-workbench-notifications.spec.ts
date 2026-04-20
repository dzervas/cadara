import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-notifications.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = readFileSync(join(process.cwd(), 'src/app/cad-workbench.tsx'), 'utf8')

  assert(
    source.includes("from '@/components/layout/workbench-notification'"),
    'CadWorkbench should render viewport feedback through the shared notification component.',
  )
  assert(
    source.includes("type: 'info'") && source.includes("title: 'Workbench action'"),
    'Workbench status feedback should use info notification presentation by default.',
  )
  assert(
    source.includes("type: 'error'") && source.includes("title: 'Workbench action failed'"),
    'Workbench action failures should use error notification presentation.',
  )
  assert(
    source.includes('type="error"') && source.includes('title="History restore failed"'),
    'History restore failures should render as error notifications.',
  )
  assert(
    source.includes('WORKBENCH_STATUS_TOP_WITH_RESTORE_PX') &&
      source.includes('restoreMessage ? WORKBENCH_STATUS_TOP_WITH_RESTORE_PX : WORKBENCH_STATUS_TOP_PX'),
    'Viewport-local notification surfaces should remain vertically separated when restore and status messages coexist.',
  )
  assert(
    source.includes('right: notificationRightOffset'),
    'Viewport-local notification surfaces should preserve the view-cube-safe right offset.',
  )
})
