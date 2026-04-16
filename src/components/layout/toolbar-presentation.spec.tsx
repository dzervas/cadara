import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { getToolbarToolIconSrc } from '@/components/layout/toolbar-tool-icon-src'
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

  const runtimeGlobal = globalThis as typeof globalThis & {
    __CADARA_SINGLE_ASSETS__?: Window['__CADARA_SINGLE_ASSETS__']
  }
  const previousAssets = runtimeGlobal.__CADARA_SINGLE_ASSETS__

  try {
    runtimeGlobal.__CADARA_SINGLE_ASSETS__ = {
      icons: {
        'extrude.svg': 'data:image/svg+xml;base64,PHN2Zy8+',
      },
    }

    assert(
      getToolbarToolIconSrc('extrude') === 'data:image/svg+xml;base64,PHN2Zy8+',
      'Toolbar icons should use injected single-file SVG assets when present.',
    )
  } finally {
    runtimeGlobal.__CADARA_SINGLE_ASSETS__ = previousAssets
  }

  const tooltipMarkup = renderToStaticMarkup(
    <ToolbarTooltipContent title="Pattern" description="Choose a pattern tool." />,
  )

  assert(tooltipMarkup.includes('Pattern'), 'Tooltips should show the tool name as the heading.')
  assert(
    tooltipMarkup.includes('Choose a pattern tool.'),
    'Tooltips should show descriptive copy beneath the heading.',
  )
  assert(
    tooltipMarkup.includes('--workbench-tooltip-title') &&
      tooltipMarkup.includes('--workbench-tooltip-description'),
    'Toolbar tooltip copy should derive its contrast treatment from shared workbench theme variables.',
  )
})
