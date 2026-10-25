// UI lane (src/components, docs/testing.md). Seam: the update prompt's
// presentation for each Reload phase and its What's new link.
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import {
  APP_UPDATE_NOTIFICATION_TITLE,
  APP_UPDATE_WHATS_NEW_LABEL,
  AppUpdateNotificationView,
} from "@/components/layout/app-update-notification";
import { DISCORD_URL } from "@/components/layout/community-links";
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

const whatsNewLink = (markup: string) =>
  markup.match(/<a[^>]*>(?:(?!<\/a>).)*<\/a>/s)?.[0] ?? "";

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

test("the update prompt links What's new to #announcements on Discord in a new tab, beside Reload", () => {
  const markup = render("idle", null);
  const link = whatsNewLink(markup);
  expect(APP_UPDATE_WHATS_NEW_LABEL).toBe(
    "What's new · #announcements on Discord",
  );
  expect(link).toContain(`href="${DISCORD_URL}"`);
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
  expect(link).toContain("What&#x27;s new · #announcements on Discord");
  expect(
    markup.indexOf(reloadButton(markup)),
    "the link follows Reload",
  ).toBeLessThan(markup.indexOf(link));
});
