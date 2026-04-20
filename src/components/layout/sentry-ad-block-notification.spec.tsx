import { MantineProvider } from '@mantine/core'
import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SentryAdBlockNotificationView } from '@/components/layout/sentry-ad-block-notification'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/sentry-ad-block-notification.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <SentryAdBlockNotificationView onDismiss={() => undefined} />
    </MantineProvider>,
  )

  assert(markup.includes('data-notification-type="warning"'), 'Sentry ad-block notice should use warning notification presentation.')
  assert(markup.includes('role="status"'), 'Sentry ad-block notice should use warning status semantics.')
  assert(markup.includes('Error reporting blocked'), 'Sentry ad-block notice should render a warning title.')
  assert(markup.includes('Please disable the ad-block'), 'Sentry ad-block notice should preserve the warning body copy.')
  assert(markup.includes('Dismiss ad-block notification'), 'Sentry ad-block notice should preserve manual dismissal.')
})
