import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/workbench-context-menu.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const items: WorkbenchContextMenuEntry[] = [
    {
      kind: 'item',
      id: 'rename',
      label: 'Rename',
      onSelect: () => undefined,
    },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      danger: true,
      onSelect: () => undefined,
    },
    {
      kind: 'divider',
      id: 'divider',
    },
    {
      kind: 'item',
      id: 'export',
      label: 'Export',
      disabled: true,
      onSelect: () => undefined,
    },
  ]

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <WorkbenchContextMenu
        defaultOpened
        items={items}
        label="Body actions"
        withinPortal={false}
      >
        <button type="button">Part 1</button>
      </WorkbenchContextMenu>
    </MantineProvider>,
  )

  assert(markup.includes('aria-haspopup="menu"'), 'Wrapped target should expose a menu popup affordance.')
  assert(markup.includes('aria-label="Body actions"'), 'Menu dropdown should expose the provided accessible label.')
  assert(markup.includes('Rename'), 'Menu should render rename item labels.')
  assert(markup.includes('Delete'), 'Menu should render regular or danger item labels.')
  assert(markup.includes('Export'), 'Menu should render disabled item labels.')
  assert(markup.includes('disabled'), 'Disabled menu items should render as disabled controls.')
})
