import { describe, expect, test, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { workbenchTheme } from "@/theme/workbench-theme";
import { WebGlRecoveryPanel } from "./webgl-recovery-panel";
import {
  copyRecoveryDiagnostics,
  detectRecoveryProfile,
  getRecoveryGuide,
  recoveryBrowsers,
} from "./webgl-recovery-guide";

function renderPanel() {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <WebGlRecoveryPanel
        diagnostics={"Failure: <context unavailable>\nWebGL 2"}
        onRetry={() => undefined}
      />
    </MantineProvider>,
  );
}

test("renders the simplified recovery panel, editable selectors, actions and escaped selectable diagnostics", () => {
  const markup = renderPanel();
  for (const text of [
    "The 3D view couldn’t start",
    "Graphics unavailable",
    "Browser",
    "Platform",
    "Retry graphics",
    "Copy diagnostics",
    "Technical details",
    "not a diagnosis",
    "Don’t override graphics blocklists",
  ]) {
    expect(markup).toContain(text);
  }
  expect(markup).toContain("&lt;context unavailable&gt;");
  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain("user-select:text");
  expect(markup).toContain('role="status"');
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('rel="noopener noreferrer"');
  expect(markup).not.toContain("Start here");
  expect(markup).not.toContain("Save any work");
  expect(markup).not.toContain("CADara needs");
  expect(markup).not.toContain("Prototype");
});

test("internal graphics addresses are native links with a copy-address explanation", () => {
  try {
    for (const [userAgent, address] of [
      ["Windows Chrome/130 Safari/537", "chrome://gpu"],
      ["Windows Chrome/130 Edg/130", "edge://gpu"],
      ["Linux Firefox/130", "about:support"],
    ]) {
      vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 0 });
      const markup = renderPanel();
      expect(markup).toContain(`href="${address}"`);
      expect(markup).toContain(
        "If your browser blocks this link, copy the address into a new tab.",
      );
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("editable recovery guidance", () => {
  test("detects browser precedence, mobile variants, iPad desktop UA and unknowns", () => {
    for (const [ua, touch, browser, platform] of [
      ["Windows Chrome/130 Safari/537 Edg/130", 0, "edge", "windows"],
      ["Android Chrome/130 Safari/537 EdgA/130", 5, "edge", "android"],
      ["iPhone CriOS/130 Safari/604", 5, "chrome", "ios"],
      ["iPad FxiOS/130 Safari/604", 5, "firefox", "ios"],
      ["Macintosh Safari/604", 5, "safari", "ios"],
      ["Macintosh Safari/604", 0, "safari", "mac"],
      ["Linux Firefox/130", 0, "firefox", "linux"],
      ["", 0, "other", "other"],
    ] as const) {
      expect(detectRecoveryProfile(ua, touch)).toEqual({ browser, platform });
    }
  });

  test("desktop browser edits choose the corresponding internal address and official help", () => {
    for (const [browser, address, host] of [
      ["chrome", "chrome://gpu", "support.google.com"],
      ["edge", "edge://gpu", "support.microsoft.com"],
      ["firefox", "about:support", "support.mozilla.org"],
    ] as const) {
      const guide = getRecoveryGuide({ browser, platform: "windows" });
      expect(guide.steps.join(" ")).toContain(address);
      expect(new URL(guide.helpUrl).hostname).toBe(host);
      expect(guide.platformHelp).toContain("Windows Update");
    }
    expect(
      getRecoveryGuide({ browser: "safari", platform: "mac" }).steps.join(" "),
    ).toContain("macOS Software Update");
    expect(
      getRecoveryGuide({ browser: "chrome", platform: "linux" }).platformHelp,
    ).toContain("Mesa");
  });

  test("mobile platform edits override every desktop browser's settings and help", () => {
    for (const { value: browser } of recoveryBrowsers) {
      for (const platform of ["ios", "android"] as const) {
        const guide = getRecoveryGuide({ browser, platform });
        expect(guide.steps.join(" ")).not.toMatch(
          /chrome:\/\/|edge:\/\/|about:support|Settings →|macOS Software/,
        );
        expect(guide.platformHelp).toContain("administrator");
        expect(guide.helpUrl).toContain(
          platform === "ios"
            ? "support.apple.com"
            : "support.google.com/android",
        );
        if (browser === "embedded")
          expect(guide.steps[0]).toContain("embedded viewer");
        else
          expect(guide.steps[0]).toContain(
            platform === "ios" ? "iOS or iPadOS" : "Android updates",
          );
      }
    }
  });
});

test("copies exactly the parent's diagnostics, without rewriting or appending detected information", async () => {
  const writes: string[] = [];
  let fallback = false;
  expect(
    await copyRecoveryDiagnostics(
      "original failure\nUA",
      {
        writeText: async (text) => {
          writes.push(text);
        },
      },
      () => {
        fallback = true;
      },
    ),
  ).toBe("copied");
  expect(writes).toEqual(["original failure\nUA"]);
  expect(fallback).toBe(false);
});

test("missing and denied clipboard access both reveal selectable technical details", async () => {
  let selections = 0;
  const select = () => {
    selections++;
  };
  expect(await copyRecoveryDiagnostics("failure", undefined, select)).toBe(
    "selectable",
  );
  expect(
    await copyRecoveryDiagnostics(
      "failure",
      {
        writeText: async () => {
          throw new Error("Permission denied");
        },
      },
      select,
    ),
  ).toBe("selectable");
  expect(selections).toBe(2);
});
