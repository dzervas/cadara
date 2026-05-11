import { MantineProvider } from "@mantine/core";
import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import { renderToStaticMarkup } from "react-dom/server";

import { SentryAdBlockNotificationView } from "@/components/layout/sentry-ad-block-notification";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/sentry-ad-block-notification.spec.tsx", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <SentryAdBlockNotificationView onDismiss={() => undefined} />
    </MantineProvider>,
  );

  expectTrue(
    markup.includes('data-notification-type="warning"'),
    "Sentry ad-block notice should use warning notification presentation.",
  );
  expectTrue(
    markup.includes('role="status"'),
    "Sentry ad-block notice should use warning status semantics.",
  );
  expectTrue(
    markup.includes("Error reporting blocked"),
    "Sentry ad-block notice should render a warning title.",
  );
  expectTrue(
    markup.includes("Error reporting is blocked by an ad blocker"),
    "Sentry ad-block notice should explain that an ad blocker is blocking error reporting.",
  );
  expectTrue(
    markup.includes("Dismiss ad-block notification"),
    "Sentry ad-block notice should preserve manual dismissal.",
  );
});
