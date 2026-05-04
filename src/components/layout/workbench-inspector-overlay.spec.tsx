import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'
import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
} from '@/components/cad/viewport-overlay-layout'

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
      markup.includes('max-w-md'),
    'Workbench inspector overlay should clip and capture interaction only inside the panel surface, capped at a medium-width column so it does not collide with the parts tree or the right-edge floating chrome.',
  )
  expectTrue(
    markup.includes(`left:${VIEWPORT_FLOATING_PANEL_LEFT_PX}px`)
      && markup.includes(`top:${VIEWPORT_FLOATING_PANEL_TOP_STYLE}`),
    'Workbench inspector overlay should use the shared floating panel slot below the toolbar and past the parts tree.',
  )
})
