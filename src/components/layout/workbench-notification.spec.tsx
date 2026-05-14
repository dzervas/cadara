import { MantineProvider } from "@mantine/core";
import { test, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/workbench-notification.spec.tsx", () => {
  const infoMarkup = renderNotification(
    <WorkbenchNotification
      type="info"
      title="Workbench action"
      message="Saved the document."
      onDismiss={() => undefined}
      placement={{ kind: "viewport", right: 152, top: 16 }}
    />,
  );
  expect(
    infoMarkup.includes('role="status"'),
    "Info notifications should expose status semantics.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes('aria-live="polite"'),
    "Info notifications should use non-interruptive live semantics.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes('data-notification-type="info"'),
    "Info notifications should expose their type hook.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes('data-notification-icon="info"'),
    "Info notifications should expose their icon hook.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes('data-notification-accent="info"'),
    "Info notifications should expose their accent hook.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes("/icons/info.svg"),
    "Info notifications should use the info icon asset.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes("Workbench action"),
    "Info notifications should render the title.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes("Saved the document."),
    "Info notifications should render the message body.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes("Dismiss notification"),
    "Dismissible notifications should render a dismiss control.",
  ).toBeTruthy();
  expect(
    infoMarkup.includes("right:152px") && infoMarkup.includes("top:16px"),
    "Viewport notifications should render viewport placement.",
  ).toBeTruthy();

  const warningMarkup = renderNotification(
    <WorkbenchNotification
      type="warning"
      title="Telemetry blocked"
      message="Error reporting is currently blocked."
      onDismiss={() => undefined}
    />,
  );
  expect(
    warningMarkup.includes('role="status"'),
    "Warning notifications should expose status semantics.",
  ).toBeTruthy();
  expect(
    warningMarkup.includes('data-notification-type="warning"'),
    "Warning notifications should expose their type hook.",
  ).toBeTruthy();
  expect(
    warningMarkup.includes("/icons/warning-overlay.svg"),
    "Warning notifications should use a warning icon asset.",
  ).toBeTruthy();
  expect(
    warningMarkup.includes("var(--workbench-notification-warning-accent)"),
    "Warning notifications should resolve accent color through semantic theme tokens.",
  ).toBeTruthy();

  const errorMarkup = renderNotification(
    <WorkbenchNotification
      type="error"
      title="History restore failed"
      message="Stored operation history could not be replayed."
      action={{ label: "Reset stored history", onClick: () => undefined }}
      onDismiss={() => undefined}
    />,
  );
  expect(
    errorMarkup.includes('role="alert"'),
    "Error notifications should expose alert semantics.",
  ).toBeTruthy();
  expect(
    errorMarkup.includes('aria-live="assertive"'),
    "Error notifications should use assertive live semantics.",
  ).toBeTruthy();
  expect(
    errorMarkup.includes('data-notification-type="error"'),
    "Error notifications should expose their type hook.",
  ).toBeTruthy();
  expect(
    errorMarkup.includes("/icons/error.svg"),
    "Error notifications should use the error icon asset.",
  ).toBeTruthy();
  expect(
    errorMarkup.includes("Reset stored history"),
    "Notifications should render optional action controls.",
  ).toBeTruthy();
  expect(
    errorMarkup.includes("var(--workbench-notification-error-border)"),
    "Error notifications should resolve border color through semantic theme tokens.",
  ).toBeTruthy();
});

function renderNotification(node: ReactElement) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      {node}
    </MantineProvider>,
  );
}
