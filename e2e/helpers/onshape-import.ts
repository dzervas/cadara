import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

export const MOUNTS_BUNDLE_PATH = resolve(
  "40a51fb8fa82fd4565151114.onshape-capture.json",
);
export const PART_STUDIO_BUNDLE_PATH = resolve(
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
);
export const WAVE_T_BUNDLE_PATH = resolve(
  "405fa226bb150016d09afc09.onshape-capture.json",
);
export const LAPTOP_STAND_BUNDLE_PATH = resolve(
  "5151a4c877c9493b733ad52f.onshape-capture.json",
);
export const SECOND_PART_STUDIO_BUNDLE_PATH = resolve(
  "d3cd9b09c3c36af1dd2efae9.onshape-capture.json",
);

export async function importBundle(
  page: Page,
  bundlePath: string,
  finishSketch = false,
  studioName?: string,
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

  if (studioName) {
    const studio = page.getByRole("combobox", { name: "Part Studio" });
    await studio.click();
    await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(studioName)} \\(`) }).click();
    await expect(studio).toHaveValue(new RegExp(`^${escapeRegExp(studioName)} \\(`));
  }

  const commit = page.getByRole("button", { name: "Commit", exact: true });
  const alert = page.getByRole("alert").first();
  // The heaviest real captures run a double real-kernel probe during review; the
  // budget must absorb that plus contention from the other parallel workers. It
  // is only a wait cap: a real review failure still resolves through the alert.
  const reviewBudget = 300_000;
  try {
    const outcome = await Promise.race([
      commit.waitFor({ state: "visible", timeout: reviewBudget }).then(() => ({ kind: "review" as const })),
      alert.waitFor({ state: "visible", timeout: reviewBudget }).then(async () => ({
        kind: "error" as const,
        message: await alert.innerText(),
      })),
    ]);
    if (outcome.kind === "error") throw new Error(`Import review failed: ${outcome.message}`);
    await expect(commit).toBeEnabled({ timeout: reviewBudget });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      state: window.__cadaraDebug?.getState(),
      trace: window.__cadaraDebug?.getTrace().entries.slice(-20),
    }));
    throw new Error(`Import review did not open. Runtime diagnostics: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  }
  const reviewText = await page.locator("main").innerText();
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

  return { reviewText };
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
