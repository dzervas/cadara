import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'

test('src/components/layout/toolbar-presentation.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const iconMarkup = renderToStaticMarkup(<ToolbarToolIcon icon="extrude" />)

  assert(iconMarkup.includes('/icons/extrude.svg'), 'Toolbar icons should resolve to local SVG assets.')
  assert(!iconMarkup.includes('lucide'), 'Toolbar icons should not render Lucide glyph markup.')

  const tooltipMarkup = renderToStaticMarkup(
    <ToolbarTooltipContent title="Pattern" description="Choose a pattern tool." />,
  )

  assert(tooltipMarkup.includes('Pattern'), 'Tooltips should show the tool name as the heading.')
  assert(
    tooltipMarkup.includes('Choose a pattern tool.'),
    'Tooltips should show descriptive copy beneath the heading.',
  )
})
