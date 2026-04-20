import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  DocumentFileMenu,
} from '@/components/layout/document-file-menu'
import { DOCUMENT_FILE_MENU_ITEMS } from '@/components/layout/document-file-menu-model'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/document-file-menu.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    DOCUMENT_FILE_MENU_ITEMS.map((item) => item.label).join(',') === 'New,Import,Export',
    'Document file menu model should expose New, Import, and Export in order.',
  )

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentFileMenu
        defaultOpened
        onNewDocument={() => undefined}
        onImportDocument={() => undefined}
        onExportDocument={() => undefined}
      />
    </MantineProvider>,
  )

  assert(markup.includes('aria-label="File"'), 'File menu should expose an accessible icon-only trigger.')
  assert(markup.includes('aria-label="Import document file"'), 'File menu should render the hidden import file input.')
  assert(markup.includes('/icons/document.svg'), 'File trigger should use the local document icon.')
})
