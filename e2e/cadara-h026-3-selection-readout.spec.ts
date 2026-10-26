import { expect as baseExpect, test, type Page } from "@playwright/test";

import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";
import { createBaseExtrudeOperationHistory } from "./helpers/modeling-fixtures";

// Lane: e2e (docs/testing.md). Seam: the measurement readout of the plain
// selection with no tool armed (cadara-h026.3), as the browser workbench
// shows it: real viewport picks in part and sketch mode, the readout's
// appearance and disappearance, and the min / max / centre distance switch,
// the one part of the pass-through bottom overlay that takes the pointer.
// The readout's derivation is covered in the logic lane
// (measurement-selection-readout.spec.ts).

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const readout = (page: Page) => page.locator("[data-measurement-panel]");
const rowValue = (page: Page, label: string) =>
  readout(page)
    .locator("span", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::span")
    .innerText();
const millimetres = async (page: Page, label: string) => {
  const text = await rowValue(page, label);
  const value = Number.parseFloat(text.replace("≈", "").trim());
  if (!Number.isFinite(value)) throw new Error(`${label}: "${text}"`);
  return value;
};
const command = (page: Page) =>
  page.evaluate(() => window.__cadaraDebug?.getState()?.command);
const distanceSwitch = (page: Page) =>
  readout(page).getByRole("group", { name: "Distance" });
const distanceMode = (page: Page) => (label: "Min" | "Max" | "Center") =>
  distanceSwitch(page).getByRole("button", { name: label, exact: true });
const pressedMode = (page: Page) =>
  distanceSwitch(page).locator('button[aria-pressed="true"]').innerText();

test.describe("part mode", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  // The base extrude's initial body-fit frame (cadara-h026-1-multi-selection).
  const FACE_POINT = { x: 390, y: 265 };
  const VERTEX_POINT = { x: 257, y: 351 };

  test("cadara-h026.3: with no tool armed, a picked face shows its readout and Escape hides it; a second pick shows the distance, its X/Y/Z components and the min / max / centre switch, which takes real clicks", async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.openWithOperationHistory(
      createBaseExtrudeOperationHistory(),
    );
    await expect(readout(page)).toHaveCount(0);

    await workbench.clickViewportAtReal(FACE_POINT);
    await expect(readout(page)).toBeVisible();
    expect(await command(page), "no tool is armed").toBe("none");
    // The kernel's exact measure arrives for a plain selection too: the
    // face is named by its surface and nothing is a mesh approximation.
    await expect(readout(page)).toContainText("Planar face · Extrude 1");
    await expect(readout(page)).toContainText(/Area\s*[\d.]+ mm²/);
    await expect(readout(page)).not.toContainText("≈");
    await expect(distanceSwitch(page), "one target: no switch").toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(readout(page), "clearing the selection hides it").toHaveCount(
      0,
    );

    await workbench.clickViewportAtReal(FACE_POINT);
    await workbench.clickViewportAtReal(VERTEX_POINT);
    await expect(distanceSwitch(page)).toBeVisible();
    await expect(readout(page)).toContainText("Vertex · Extrude 1");
    for (const label of ["Distance", "ΔX", "ΔY", "ΔZ"])
      await expect(
        readout(page).locator("span", { hasText: new RegExp(`^${label}$`) }),
      ).toHaveCount(1);
    expect(await pressedMode(page)).toBe("Min");
    const minimum = await millimetres(page, "Distance");

    // Real clicks: the readout passes the pointer through, its switch not.
    await distanceMode(page)("Max").click();
    await expect.poll(() => pressedMode(page)).toBe("Max");
    await expect
      .poll(() => millimetres(page, "Distance"), {
        message: "the farthest points are farther than the closest",
      })
      .toBeGreaterThan(minimum + 1e-6);
    const maximum = await millimetres(page, "Distance");
    const components = await Promise.all(
      ["ΔX", "ΔY", "ΔZ"].map((label) => millimetres(page, label)),
    );
    expect(
      Math.hypot(...components),
      "the components make up the distance (to display rounding)",
    ).toBeCloseTo(maximum, 1);

    await distanceMode(page)("Center").click();
    await expect.poll(() => pressedMode(page)).toBe("Center");
    await expect
      .poll(() => millimetres(page, "Distance"))
      .not.toBeCloseTo(maximum, 3);

    await distanceMode(page)("Min").click();
    await expect.poll(() => pressedMode(page)).toBe("Min");
    await expect
      .poll(() => millimetres(page, "Distance"))
      .toBeCloseTo(minimum, 3);
    expect(
      await workbench.currentMachineSelectionCount(),
      "the switch clicks did not reach the viewport",
    ).toBe(2);
    // The switch does not keep the keyboard: Escape still clears.
    await page.keyboard.press("Escape");
    await expect(readout(page)).toHaveCount(0);
  });
});

test.describe("sketch mode", () => {
  // Sketch coordinates on the Top plane (1440 × 900): the X axis runs along
  // y ≈ 450 (the T11c audit frame).
  test.use({ viewport: { width: 1440, height: 900 } });

  test("cadara-h026.3: in an open sketch with no sketch tool, a picked line shows its length; a second line shows their distance and angle with the switch; Escape hides the readout", async ({
    page,
  }) => {
    const workbench = new FeatureWorkbenchHarness(page);
    await workbench.open();
    await workbench.activateTool("Start a new sketch.");
    await page
      .getByRole("button", { name: /Top Plane/ })
      .first()
      .click();
    await workbench.expectSketchSessionActive();
    for (const [index, y] of [300, 600].entries()) {
      await workbench.activateTool("Create line geometry.");
      await workbench.clickViewportAt({ x: 800, y });
      await workbench.clickViewportAt({ x: 1000, y });
      await expect
        .poll(() => workbench.currentSketchSession())
        .toContain(`${index + 1} entities staged`);
      await expect(
        readout(page),
        "an armed sketch tool owns the selection",
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect.poll(() => command(page)).toBe("sketch");
    }
    await page.keyboard.press("Escape");
    await expect(readout(page)).toHaveCount(0);

    await workbench.clickViewportAt({ x: 900, y: 300 });
    await expect(readout(page)).toBeVisible();
    await expect(readout(page)).toContainText(/ · Sketch/);
    const length = await millimetres(page, "Length");
    expect(length).toBeGreaterThan(0);

    await workbench.clickViewportAt({ x: 900, y: 600 });
    await expect(distanceSwitch(page)).toBeVisible();
    expect(await rowValue(page, "Angle")).toBe("0 deg");
    expect(
      await millimetres(page, "ΔX"),
      "parallel lines one above the other",
    ).toBe(0);
    const minimum = await millimetres(page, "Distance");
    expect(minimum).toBeGreaterThan(0);

    await distanceMode(page)("Max").click();
    await expect.poll(() => pressedMode(page)).toBe("Max");
    await expect
      .poll(() => millimetres(page, "ΔX"), {
        message: "the farthest ends are a line length apart in X",
      })
      .toBeCloseTo(length, 1);
    await distanceMode(page)("Center").click();
    await expect
      .poll(() => millimetres(page, "Distance"), {
        message: "aligned equal lines: centre to centre is the gap",
      })
      .toBeCloseTo(minimum, 2);

    await page.keyboard.press("Escape");
    await expect(readout(page)).toHaveCount(0);
  });
});
