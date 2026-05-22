import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BROWSER_STORAGE_WARNING_TOOLTIP,
  DOWNLOAD_COPY_DOCUMENT_DESCRIPTION,
  DocumentFileMenu,
  OpenDocumentModal,
  OPEN_COPY_DOCUMENT_DESCRIPTION,
  OPEN_LINKED_DOCUMENT_DESCRIPTION,
  SaveAsDocumentModal,
  SAVE_LINKED_DOCUMENT_DESCRIPTION,
} from "@/components/layout/document-file-menu";
import {
  DOCUMENT_FILE_MENU_ITEMS,
  getDocumentFileMenuCommand,
} from "@/components/layout/document-file-menu-model";
import { workbenchTheme } from "@/theme/workbench-theme";

test("src/components/layout/document-file-menu.spec.tsx", () => {
  expect(
    DOCUMENT_FILE_MENU_ITEMS.map((item) => item.label).join(","),
    "Document file menu model should expose exactly New, Open..., and Save As in order.",
  ).toBe("New,Open...,Save As");

  expect(
    DOCUMENT_FILE_MENU_ITEMS.map((item) =>
      getDocumentFileMenuCommand(item.id),
    ).join(","),
    "Document file menu model should route each item to the expected handler command.",
  ).toBe("newDocument,openDocument,saveDocumentAs");

  const markup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentFileMenu
        defaultOpened
        showBrowserStorageWarning
        onNewDocument={() => undefined}
        onOpenDocument={() => undefined}
        onSaveDocumentAs={() => undefined}
      />
    </MantineProvider>,
  );

  expect(
    markup.includes('aria-label="File"'),
    "File menu should expose an accessible icon-only trigger.",
  ).toBeTruthy();
  expect(
    markup.includes("New document"),
    "File menu should not expose the removed New document label.",
  ).toBeFalsy();
  expect(
    markup.includes("Open local file"),
    "File menu should not expose the removed Open local file label.",
  ).toBeFalsy();
  expect(
    markup.includes("Save local file"),
    "File menu should not expose the removed Save local file label.",
  ).toBeFalsy();
  expect(
    markup.includes("Import"),
    "File menu should not expose the removed top-level Import label.",
  ).toBeFalsy();
  expect(
    markup.includes("Export"),
    "File menu should not expose the removed top-level Export label.",
  ).toBeFalsy();
  expect(
    markup.includes('aria-label="Open document copy file"'),
    "File menu should not own the one-shot document file input.",
  ).toBeFalsy();
  expect(
    markup.includes(".cadara,application/json,application/vnd.cadara+json"),
    "File menu should not own cadara picker options.",
  ).toBeFalsy();
  expect(
    markup.includes(".step,.stp"),
    "File menu import picker should not accept STEP part files.",
  ).toBeFalsy();
  expect(
    markup.includes('multiple=""'),
    "File menu import picker should import one cadara document at a time.",
  ).toBeFalsy();
  expect(
    markup.includes("/icons/document.svg"),
    "File trigger should use the local document icon.",
  ).toBeTruthy();
  expect(
    BROWSER_STORAGE_WARNING_TOOLTIP,
    "Browser-storage warning tooltip copy should match the product copy exactly.",
  ).toBe(
    "The data are currently saved within the browser, which might result in data loss. Please use the local file functionality to make sure that all changes are saved on your computer's disk so you can back them up",
  );
  expect(
    markup.includes("data-workbench-browser-storage-warning") &&
      markup.includes("/icons/warning-overlay.svg") &&
      markup.includes("The data are currently saved within the browser"),
    "File menu should render a browser-storage warning next to the file icon when durable save is unavailable.",
  ).toBeTruthy();

  const openModalMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <OpenDocumentModal
        opened
        withinPortal={false}
        onClose={() => undefined}
        onOpenCopy={() => undefined}
        onOpenLinked={() => undefined}
      />
    </MantineProvider>,
  );

  expect(
    openModalMarkup.includes("Open Document"),
    "Open... should render the Open Document modal.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes("Open a copy"),
    "Open modal should expose the copy-open choice.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes(OPEN_COPY_DOCUMENT_DESCRIPTION),
    "Open modal should include exact copy-open explanatory text.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes("Open and keep linked"),
    "Open modal should expose the linked-open choice.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes(OPEN_LINKED_DOCUMENT_DESCRIPTION),
    "Open modal should include exact linked-open explanatory text.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes('aria-label="Open document copy file"'),
    "Open modal should own the copy-open file input.",
  ).toBeTruthy();
  expect(
    openModalMarkup.includes(
      ".cadara,application/json,application/vnd.cadara+json",
    ),
    "Open modal picker should accept cadara document files.",
  ).toBeTruthy();

  const saveAsModalMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <SaveAsDocumentModal
        opened
        withinPortal={false}
        onClose={() => undefined}
        onDownloadCopy={() => undefined}
        onSaveLinked={() => undefined}
      />
    </MantineProvider>,
  );

  expect(
    saveAsModalMarkup.includes("Save As"),
    "Save As should render the Save As modal.",
  ).toBeTruthy();
  expect(
    saveAsModalMarkup.includes("Download a copy"),
    "Save As modal should expose the download-copy choice.",
  ).toBeTruthy();
  expect(
    saveAsModalMarkup.includes(DOWNLOAD_COPY_DOCUMENT_DESCRIPTION),
    "Save As modal should include exact download-copy explanatory text.",
  ).toBeTruthy();
  expect(
    saveAsModalMarkup.includes("Save and keep linked"),
    "Save As modal should expose the linked-save choice.",
  ).toBeTruthy();
  expect(
    saveAsModalMarkup.includes(SAVE_LINKED_DOCUMENT_DESCRIPTION),
    "Save As modal should include exact linked-save explanatory text.",
  ).toBeTruthy();
});
