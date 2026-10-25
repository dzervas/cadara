// UI lane (docs/testing.md). Seam: the notifications for a .cadara file the
// operating system launched the app with: the offer to save
// back (branch b) and what replaces it when declined (branch c), rendered
// through the shared WorkbenchNotification. Opening and linking are proven
// in document-file-actions.spec.ts; the clicks in
// e2e/launched-document-files.spec.ts.
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { DocumentId } from "@/contracts/shared/ids";
import { WorkbenchNotification } from "@/components/layout/workbench-notification";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  getLaunchedDocumentFileNotification,
  LAUNCHED_FILE_KEPT_MESSAGE,
  type LaunchedDocumentFileNotice,
} from "@/workbench/adapters/use-launched-document-files";

const handle = { name: "bracket.cadara" } as LocalFileSystemFileHandle;
const actions = { allowSaving: () => undefined, dismiss: () => undefined };

function render(notice: LaunchedDocumentFileNotice) {
  const notification = getLaunchedDocumentFileNotification(notice, actions);
  return {
    notification,
    markup: renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <WorkbenchNotification {...notification} />
      </MantineProvider>,
    ),
  };
}

const offer = (allowing: boolean): LaunchedDocumentFileNotice => ({
  kind: "offer-saving",
  id: "n1",
  documentId: "doc_launched" as DocumentId,
  handle,
  allowing,
});

test("a launched file opened as a browser copy offers Allow saving until the user answers", () => {
  const { notification, markup } = render(offer(false));
  expect(markup).toContain(
    "bracket.cadara opened from your computer. Allow CADara to save changes back to this file?",
  );
  expect(markup).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Allow saving/s);
  expect(markup).toContain('aria-label="Dismiss notification"');
  expect(notification.persistent, "no auto-dismiss").toBe(true);
});

test("while the permission request runs, Allow saving is disabled", () => {
  const { notification } = render(offer(true));
  expect(notification.action).toMatchObject({
    label: "Allow saving",
    disabled: true,
  });
});

test("declined or dismissed, the offer becomes the kept-in-CADara notice without an action", () => {
  const { notification, markup } = render({
    kind: "kept-in-browser",
    id: "n1",
    fileName: "bracket.cadara",
  });
  expect(markup).toContain(LAUNCHED_FILE_KEPT_MESSAGE);
  expect(notification.action).toBeUndefined();
});
