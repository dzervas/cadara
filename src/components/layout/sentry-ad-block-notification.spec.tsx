import { MantineProvider } from "@mantine/core";
import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SentryAdBlockNotificationView } from "@/components/layout/sentry-ad-block-notification";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/sentry-ad-block-notification.spec.tsx", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <SentryAdBlockNotificationView onDismiss={() => undefined} />
    </MantineProvider>,
  );

  expect(
    markup.includes('data-notification-type="warning"'),
    "Sentry ad-block notice should use warning notification presentation.",
  ).toBeTruthy();
  expect(
    markup.includes('role="status"'),
    "Sentry ad-block notice should use warning status semantics.",
  ).toBeTruthy();
  expect(
    markup.includes("Error reporting blocked"),
    "Sentry ad-block notice should render a warning title.",
  ).toBeTruthy();
  expect(
    markup.includes("Error reporting is blocked by an ad blocker"),
    "Sentry ad-block notice should explain that an ad blocker is blocking error reporting.",
  ).toBeTruthy();
  expect(
    markup.includes("Dismiss ad-block notification"),
    "Sentry ad-block notice should preserve manual dismissal.",
  ).toBeTruthy();
});
