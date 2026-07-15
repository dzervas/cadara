import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

export const MOUNTS_BUNDLE_PATH = resolve(
  "40a51fb8fa82fd4565151114.onshape-capture.json",
);
export const PART_STUDIO_BUNDLE_PATH = resolve(
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
);

export async function importBundle(
  page: Page,
  bundlePath: string,
  finishSketch = false,
) {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis, "showOpenFilePicker", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(
    () => window.__cadaraDebug?.getState().revision !== "loading",
  );
  const beforeRevision = await currentRevision(page);

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator('button[data-tool-id="import"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(bundlePath);

  const commit = page.getByRole("button", { name: "Commit", exact: true });
  await expect(commit).toBeEnabled({ timeout: 60_000 });
  await commit.click();
  await waitForRevisionChange(page, beforeRevision);

  if (finishSketch) {
    await page.waitForFunction(
      () =>
        ["editingSketch", "idle"].includes(
          window.__cadaraDebug?.getState().machineState ?? "",
        ),
      undefined,
      { timeout: 60_000 },
    );
    const machineState = await page.evaluate(
      () => window.__cadaraDebug?.getState().machineState,
    );
    if (machineState === "editingSketch") {
      await page.locator('button[data-tool-id="finishSketch"]').click();
    }
    await waitForMachineIdle(page);
}
}

export async function editVariable(page: Page, name: string, value: string) {
  const beforeRevision = await currentRevision(page);
  await page.locator("[data-workbench-variables-fab]").click();
  const panel = page.locator("[data-workbench-variables-panel]");
  const editButton = panel.getByRole("button", {
    name: `Edit variable ${name}`,
  });
  const variableId = await editButton.locator("..").getAttribute("data-variable-row");
  expect(variableId).not.toBeNull();
  await editButton.click();
  await page.keyboard.press("F2");

  const valueInput = panel.getByLabel(`Variable value ${variableId}`);
  await valueInput.evaluate((input, nextValue) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setValue) throw new Error("HTML input value setter is unavailable.");
    setValue.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await valueInput.press("Enter");

  await waitForRevisionChange(page, beforeRevision);
  await waitForMachineIdle(page);
  await expect(
    panel.locator(`[data-variable-expression="${variableId}"]`),
  ).toHaveText(value, { timeout: 60_000 });
  return page.evaluate(() => window.__cadaraDebug!.getState());
}

export async function currentRevision(page: Page) {
  return page.evaluate(() => window.__cadaraDebug!.getState().revision);
}

export async function waitForRevisionChange(page: Page, revision: string) {
  await page.waitForFunction(
    (previousRevision) =>
      window.__cadaraDebug?.getState().revision !== previousRevision,
    revision,
    { timeout: 60_000 },
  );
}

export async function waitForMachineIdle(page: Page) {
  await page.waitForFunction(
    () => window.__cadaraDebug?.getState().machineState === "idle",
    undefined,
    { timeout: 60_000 },
  );
}
