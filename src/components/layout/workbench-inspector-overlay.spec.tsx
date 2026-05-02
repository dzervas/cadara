import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'

test('src/components/layout/workbench-inspector-overlay.spec.tsx', async () => {  const markup = renderToStaticMarkup(
    <WorkbenchInspectorOverlay>
      <div>Inspector content</div>
    </WorkbenchInspectorOverlay>,
  )

  expectTrue(
    markup.includes('absolute') &&
      markup.includes('pointer-events-none'),
    'Workbench inspector overlay should stay positioned inside the viewport frame instead of taking page flow space.',
  )
  expectTrue(
    markup.includes('pointer-events-auto') &&
      markup.includes('min-w-0') &&
      markup.includes('max-w-full'),
    'Workbench inspector overlay should clip and capture interaction only inside the panel surface.',
  )
})
