import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

const CAPTURE_FIXTURE_DIRECTORY = "test/fixtures/onshape-captures";

export const MOUNTS_BUNDLE_PATH = resolve(
  CAPTURE_FIXTURE_DIRECTORY,
  "40a51fb8fa82fd4565151114.onshape-capture.json",
);
export const PART_STUDIO_BUNDLE_PATH = resolve(
  CAPTURE_FIXTURE_DIRECTORY,
  "9841e486906fa2ce62d74d8e.onshape-capture.json",
);
export const WAVE_T_BUNDLE_PATH = resolve(
  CAPTURE_FIXTURE_DIRECTORY,
  "405fa226bb150016d09afc09.onshape-capture.json",
);
export const LAPTOP_STAND_BUNDLE_PATH = resolve(
  CAPTURE_FIXTURE_DIRECTORY,
  "5151a4c877c9493b733ad52f.onshape-capture.json",
);
export const SECOND_PART_STUDIO_BUNDLE_PATH = resolve(
  CAPTURE_FIXTURE_DIRECTORY,
  "d3cd9b09c3c36af1dd2efae9.onshape-capture.json",
);

type CaptureBundle = Record<string, unknown> & {
  partStudios?: Array<{ name?: unknown }>;
};

const captureBundleReads = new Map<string, Promise<CaptureBundle>>();

export async function importBundle(
  page: Page,
  bundlePath: string,
  finishSketch = false,
  studioName?: string,
  /** Raise only for captures whose live prefix genuinely builds more solids. */
  reviewBudgetMs = 1_500_000,
) {
  if (process.env.PLAYWRIGHT_REAL_CAPTURES !== "1") {
    throw new Error(
      "Real capture imports require PLAYWRIGHT_REAL_CAPTURES=1.",
    );
  }
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
  await fileChooser.setFiles(
    studioName
      ? await readSelectedStudioCapture(bundlePath, studioName)
      : bundlePath,
  );


  const commit = page.getByRole("button", { name: "Commit", exact: true });
  const alert = page.getByRole("alert").first();
  // The heaviest real captures run several real-kernel probes during review
  // (per-consumer prefixes, the verification pass, and the final build
  // containment pass), and the budget must absorb all of them plus contention
  // from the other parallel workers. It is only a wait cap: a real review
  // failure still resolves immediately through the alert branch below.
  const reviewBudget = reviewBudgetMs;
  try {
    let outcome = "pending";
    await expect
      .poll(
        async () => {
          outcome = (await alert.isVisible())
            ? `error:${await alert.innerText()}`
            : (await commit.isVisible())
              ? "review"
              : "pending";
          return outcome;
        },
        { timeout: reviewBudget },
      )
      .not.toBe("pending");
    if (outcome.startsWith("error:")) {
      throw new Error(`Import review failed: ${outcome.slice("error:".length)}`);
    }
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
  await waitForRevisionChange(page, beforeRevision, reviewBudget);

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

export async function waitForRevisionChange(
  page: Page,
  revision: string,
  // The largest captures commit dozens of real-kernel features in one apply, so
  // callers that drive a whole studio import raise this. It is only a wait cap.
  timeout = 60_000,
) {
  await page.waitForFunction(
    (previousRevision) =>
      window.__cadaraDebug?.getState().revision !== previousRevision,
    revision,
    { timeout },
  );
}

export async function waitForMachineIdle(page: Page) {
  await page.waitForFunction(
    () => window.__cadaraDebug?.getState().machineState === "idle",
    undefined,
    { timeout: 60_000 },
  );
}

async function readSelectedStudioCapture(
  bundlePath: string,
  studioName: string,
) {
  let pendingBundle = captureBundleReads.get(bundlePath);
  if (!pendingBundle) {
    pendingBundle = readFile(bundlePath, "utf8").then(
      (contents) => JSON.parse(contents) as CaptureBundle,
    );
    captureBundleReads.set(bundlePath, pendingBundle);
  }
  const bundle = await pendingBundle;
  const studios = (bundle.partStudios ?? []).filter(
    (studio) => studio.name === studioName,
  );
  if (studios.length !== 1) {
    throw new Error(
      `Expected exactly one Part Studio named ${studioName}; found ${studios.length}.`,
    );
  }
  return {
    name: basename(bundlePath),
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...bundle, partStudios: studios })),
  };
}

