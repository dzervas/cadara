import { MantineProvider } from "@mantine/core";
import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
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
  expectTrue(
    infoMarkup.includes('role="status"'),
    "Info notifications should expose status semantics.",
  );
  expectTrue(
    infoMarkup.includes('aria-live="polite"'),
    "Info notifications should use non-interruptive live semantics.",
  );
  expectTrue(
    infoMarkup.includes('data-notification-type="info"'),
    "Info notifications should expose their type hook.",
  );
  expectTrue(
    infoMarkup.includes('data-notification-icon="info"'),
    "Info notifications should expose their icon hook.",
  );
  expectTrue(
    infoMarkup.includes('data-notification-accent="info"'),
    "Info notifications should expose their accent hook.",
  );
  expectTrue(
    infoMarkup.includes("/icons/info.svg"),
    "Info notifications should use the info icon asset.",
  );
  expectTrue(
    infoMarkup.includes("Workbench action"),
    "Info notifications should render the title.",
  );
  expectTrue(
    infoMarkup.includes("Saved the document."),
    "Info notifications should render the message body.",
  );
  expectTrue(
    infoMarkup.includes("Dismiss notification"),
    "Dismissible notifications should render a dismiss control.",
  );
  expectTrue(
    infoMarkup.includes("right:152px") && infoMarkup.includes("top:16px"),
    "Viewport notifications should render viewport placement.",
  );

  const warningMarkup = renderNotification(
    <WorkbenchNotification
      type="warning"
      title="Telemetry blocked"
      message="Error reporting is currently blocked."
      onDismiss={() => undefined}
    />,
  );
  expectTrue(
    warningMarkup.includes('role="status"'),
    "Warning notifications should expose status semantics.",
  );
  expectTrue(
    warningMarkup.includes('data-notification-type="warning"'),
    "Warning notifications should expose their type hook.",
  );
  expectTrue(
    warningMarkup.includes("/icons/warning-overlay.svg"),
    "Warning notifications should use a warning icon asset.",
  );
  expectTrue(
    warningMarkup.includes("var(--workbench-notification-warning-accent)"),
    "Warning notifications should resolve accent color through semantic theme tokens.",
  );

  const errorMarkup = renderNotification(
    <WorkbenchNotification
      type="error"
      title="History restore failed"
      message="Stored operation history could not be replayed."
      action={{ label: "Reset stored history", onClick: () => undefined }}
      onDismiss={() => undefined}
    />,
  );
  expectTrue(
    errorMarkup.includes('role="alert"'),
    "Error notifications should expose alert semantics.",
  );
  expectTrue(
    errorMarkup.includes('aria-live="assertive"'),
    "Error notifications should use assertive live semantics.",
  );
  expectTrue(
    errorMarkup.includes('data-notification-type="error"'),
    "Error notifications should expose their type hook.",
  );
  expectTrue(
    errorMarkup.includes("/icons/error.svg"),
    "Error notifications should use the error icon asset.",
  );
  expectTrue(
    errorMarkup.includes("Reset stored history"),
    "Notifications should render optional action controls.",
  );
  expectTrue(
    errorMarkup.includes("var(--workbench-notification-error-border)"),
    "Error notifications should resolve border color through semantic theme tokens.",
  );
});

function renderNotification(node: ReactElement) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      {node}
    </MantineProvider>,
  );
}
