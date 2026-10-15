import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  getDocumentRefreshFailureNotification,
  getEditorFailureNotification,
} from "@/workbench/runtime/document-refresh-failure";

// T17o (T17c3 route). UI lane; seam: the workbench notice of a failed
// document snapshot refresh (the editor state's `documentRefreshFailure`,
// pinned in the logic lane by the event-loop row). Red on base: no notice
// existed; the failure reached only the debug preview label.
test("T17o: a failed snapshot refresh shows an error notice with the reason and a retry", () => {
  let retries = 0;
  expect(
    getDocumentRefreshFailureNotification(
      { documentRefreshFailure: null },
      () => {},
    ),
  ).toBeNull();
  const notification = getDocumentRefreshFailureNotification(
    { documentRefreshFailure: "Repository offline." },
    () => {
      retries += 1;
    },
  );
  expect(notification).toMatchObject({
    type: "error",
    title: "Document refresh failed",
    message:
      "Repository offline. The view may still show an older revision of the document.",
    action: { label: "Retry" },
  });
  notification!.action!.onClick();
  expect(retries, "Retry requests a new refresh").toBe(1);

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme}>
      <WorkbenchNotification {...notification!} />
    </MantineProvider>,
  );
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("Document refresh failed");
  expect(markup).toContain("Repository offline.");
  expect(markup).toContain(">Retry<");
});

// T17o review fixes. UI lane; seam: the workbench's one failure notice for a
// failed sketch open, feature edit or history move (`failureNotice`, pinned
// in the logic lane by `failure-notice.spec.ts` and the event-loop rows).
// Red on base: no notice existed.
test("T17o review: a failed sketch open, feature edit or history move shows one dismissible error notice", () => {
  let dismissals = 0;
  const dismiss = () => {
    dismissals += 1;
  };
  expect(getEditorFailureNotification({ failureNotice: null }, dismiss)).toBe(
    null,
  );
  for (const [kind, title] of [
    ["sketchOpen", "Sketch could not be opened"],
    ["featureEdit", "Feature could not be edited"],
    ["historyMove", "History move failed"],
  ] as const) {
    const notification = getEditorFailureNotification(
      { failureNotice: { kind, message: "Repository offline." } },
      dismiss,
    );
    expect(notification).toMatchObject({
      type: "error",
      title,
      message: "Repository offline.",
    });
    const markup = renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme}>
        <WorkbenchNotification {...notification!} />
      </MantineProvider>,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(title);
    expect(markup).toContain("Dismiss notification");
    notification!.onDismiss!();
  }
  expect(dismissals).toBe(3);
});
