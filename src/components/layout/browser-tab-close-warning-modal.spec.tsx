import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  BROWSER_TAB_CLOSE_WARNING_MESSAGE,
  BROWSER_TAB_CLOSE_WARNING_TITLE,
  BrowserTabCloseWarningModal,
} from '@/components/layout/browser-tab-close-warning-modal'
import { workbenchTheme } from '@/theme/workbench-theme'
import { expectTrue } from '@/testing/expect.spec'

test('browser-tab-close-warning-modal renders loss warning and save choices', () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <BrowserTabCloseWarningModal
        opened
        withinPortal={false}
        documentTitle="Bracket draft"
        onCancel={() => undefined}
        onCloseWithoutSaving={() => undefined}
        onDownloadCopy={() => undefined}
        onSaveLinked={() => undefined}
      />
    </MantineProvider>,
  )

  expectTrue(markup.includes(BROWSER_TAB_CLOSE_WARNING_TITLE), 'Modal should name the close warning.')
  expectTrue(markup.includes('Bracket draft'), 'Modal should identify the browser-only document being closed.')
  expectTrue(markup.includes(BROWSER_TAB_CLOSE_WARNING_MESSAGE), 'Modal should warn that closing without saving loses the document forever.')
  expectTrue(markup.includes('Download a copy'), 'Modal should offer a portable copy path.')
  expectTrue(markup.includes('Save and keep linked'), 'Modal should offer a direct local sync path.')
  expectTrue(markup.includes('Close without saving'), 'Modal should make destructive close explicit.')
  expectTrue(
    markup.indexOf('Download a copy') < markup.indexOf('Cancel'),
    'Modal should place save choices above the bottom cancel row.',
  )
  expectTrue(
    markup.indexOf('Save and keep linked') < markup.indexOf('Close without saving'),
    'Modal should place local sync above the destructive close action.',
  )
})
