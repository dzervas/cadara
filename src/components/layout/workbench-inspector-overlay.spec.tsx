import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'

test('src/components/layout/workbench-inspector-overlay.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const markup = renderToStaticMarkup(
    <WorkbenchInspectorOverlay>
      <div>Inspector content</div>
    </WorkbenchInspectorOverlay>,
  )

  assert(
    markup.includes('absolute') &&
      markup.includes('left-4') &&
      markup.includes('right-4') &&
      markup.includes('pointer-events-none'),
    'Workbench inspector overlay should stay positioned inside the viewport frame instead of taking page flow space.',
  )
  assert(
    markup.includes('pointer-events-auto') &&
      markup.includes('min-w-0') &&
      markup.includes('max-w-full') &&
      markup.includes('overflow-hidden'),
    'Workbench inspector overlay should clip and capture interaction only inside the panel surface.',
  )
})
