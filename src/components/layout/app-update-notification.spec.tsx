// UI lane (src/components, docs/testing.md). Seam: the update prompt's
// presentation for each Reload phase.
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import {
  APP_UPDATE_NOTIFICATION_TITLE,
  AppUpdateNotificationView,
} from "@/components/layout/app-update-notification";
import type { AppUpdatePhase } from "@/hooks/use-app-update";
import { workbenchTheme } from "@/theme/workbench-theme";

const render = (phase: AppUpdatePhase, version: string | null) =>
  renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <AppUpdateNotificationView
        version={version}
        phase={phase}
        onReload={() => undefined}
      />
    </MantineProvider>,
  );

const reloadButton = (markup: string) =>
  markup.match(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/s)?.[0] ?? "";

test("the update prompt names the new version and offers an enabled Reload", () => {
  const markup = render("idle", "v0.0.1 abc1234");
  expect(markup).toContain(APP_UPDATE_NOTIFICATION_TITLE);
  expect(markup).toContain('role="status"');
  expect(markup).toContain("v0.0.1 abc1234");
  expect(markup, "no dismiss: the prompt stays until reload").not.toContain(
    "Dismiss",
  );
  const button = reloadButton(markup);
  expect(button).toContain("Reload");
  expect(button).not.toContain("disabled");
});

test("while local changes are saved and while reloading, Reload is disabled and says so", () => {
  for (const [phase, label] of [
    ["saving", "Saving…"],
    ["reloading", "Reloading…"],
  ] as const) {
    const button = reloadButton(render(phase, null));
    expect(button).toContain(label);
    expect(button).toContain("disabled");
  }
});
