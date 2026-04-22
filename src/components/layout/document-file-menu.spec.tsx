import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  BROWSER_STORAGE_WARNING_TOOLTIP,
  DocumentFileMenu,
} from '@/components/layout/document-file-menu'
import {
  DOCUMENT_FILE_MENU_ITEMS,
  getDocumentFileMenuCommand,
} from '@/components/layout/document-file-menu-model'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/document-file-menu.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    DOCUMENT_FILE_MENU_ITEMS.map((item) => item.label).join(',') === 'New,Open local file,Save local file,Import,Export',
    'Document file menu model should expose New, Open local file, Save local file, Import, and Export in order.',
  )

  assert(
    DOCUMENT_FILE_MENU_ITEMS.map((item) => getDocumentFileMenuCommand(item.id)).join(',')
      === 'newDocument,openLocalFile,saveLocalFile,importDocument,exportDocument',
    'Document file menu model should route each item to the expected handler command.',
  )

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentFileMenu
        defaultOpened
        showBrowserStorageWarning
        onNewDocument={() => undefined}
        onOpenLocalFile={() => undefined}
        onSaveLocalFile={() => undefined}
        onImportDocument={() => undefined}
        onExportDocument={() => undefined}
      />
    </MantineProvider>,
  )

  assert(markup.includes('aria-label="File"'), 'File menu should expose an accessible icon-only trigger.')
  assert(markup.includes('aria-label="Import document file"'), 'File menu should render the hidden import file input.')
  assert(markup.includes('.step,.stp'), 'File menu import picker should accept STEP files.')
  assert(markup.includes('/icons/document.svg'), 'File trigger should use the local document icon.')
  assert(
    BROWSER_STORAGE_WARNING_TOOLTIP
      === "The data are currently saved within the browser, which might result in data loss. Please use the local file functionality to make sure that all changes are saved on your computer's disk so you can back them up",
    'Browser-storage warning tooltip copy should match the product copy exactly.',
  )
  assert(
    markup.includes('data-workbench-browser-storage-warning')
      && markup.includes('/icons/warning-overlay.svg')
      && markup.includes('The data are currently saved within the browser'),
    'File menu should render a browser-storage warning next to the file icon when durable save is unavailable.',
  )
})
