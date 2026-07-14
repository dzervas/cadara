import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

const mountsBundlePath = resolve(
  "40a51fb8fa82fd4565151114.onshape-capture.json",
);
const enclosureBundlePath = resolve(
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
);

async function importBundle(page: Page, bundlePath: string, finishSketch = false) {
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
  const beforeRevision = await page.evaluate(
    () => window.__cadaraDebug!.getState().revision,
  );

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator('button[data-tool-id="import"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(bundlePath);

  const commit = page.getByRole("button", { name: "Commit", exact: true });
  await expect(commit).toBeEnabled({ timeout: 60_000 });
  await commit.click();
  await page.waitForFunction(
    (revision) => window.__cadaraDebug?.getState().revision !== revision,
    beforeRevision,
    { timeout: 60_000 },
  );

  if (finishSketch) {
    await page.waitForFunction(
      () => window.__cadaraDebug?.getState().machineState === "editingSketch",
      undefined,
      { timeout: 60_000 },
    );
    await page.locator('button[data-tool-id="finishSketch"]').click();
  }
  await page.waitForFunction(
    () => window.__cadaraDebug?.getState().machineState === "idle",
    undefined,
    { timeout: 60_000 },
  );
}

async function editVariable(page: Page, name: string, value: string) {
  const beforeRevision = await page.evaluate(
    () => window.__cadaraDebug!.getState().revision,
  );
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

  await page.waitForFunction(
    (revision) => window.__cadaraDebug?.getState().revision !== revision,
    beforeRevision,
    { timeout: 60_000 },
  );
  await expect(
    panel.locator(`[data-variable-expression="${variableId}"]`),
  ).toHaveText(value, { timeout: 60_000 });
  return await page.evaluate(() => window.__cadaraDebug!.getState());
}

test("real Onshape variable edit preserves the imported sketch region", async ({
  page,
}) => {
  test.skip(
    !existsSync(mountsBundlePath),
    "Real Onshape capture is not present locally.",
  );
  await importBundle(page, mountsBundlePath, true);
  const rebuilt = await editVariable(page, "nail", "5");

  expect(rebuilt.snapshotDiagnosticsCount).toBe(0);
  expect(rebuilt.selectableTargets).toContain(
    "sketch_primary.region_primary-sketch_entity_FOoap8tw3jKAJf5_0_ATLNdmpEpWg5-3h5wtq1po7fut",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: /does not resolve on sketch/i }),
  ).toHaveCount(0);
});

test("second real Onshape bundle updates walls against the latest revision", async ({
  page,
}) => {
  test.skip(
    !existsSync(enclosureBundlePath),
    "Second real Onshape capture is not present locally.",
  );
  await importBundle(page, enclosureBundlePath);
  await editVariable(page, "walls", "3");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /request revision .* does not match current revision/i }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Workbench action failed/i),
  ).toHaveCount(0);
});
