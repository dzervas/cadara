import { expect, test, type Locator, type Page } from "@playwright/test";
import { SketchWorkbenchHarness } from "./helpers/sketch-workbench";
import {
  ANGLES,
  along,
  buildDenseFan,
  buildWideFan,
  layer,
  setShowAll,
  type ViewportPoint,
} from "./helpers/annotation-fan";

// Lane: e2e (docs/testing.md). Seam: the workbench browser flow of the T14g
// radial wheel (T-10): `+N` opens a wheel centred on the activating pointer
// (clamped only as far as needed at an edge), spoke hover highlights every
// affected entity, a selected spoke moves to the centre, the first blank
// collapses the wheel and keeps the siblings reachable, a spoke press never
// reaches the canvas, and a camera change or the chooser closes it. Only the
// real page composes the pointer, the DOM buttons over the canvas, the
// camera and the highlight pixels. The mouse glides (several `mouse.move`
// steps) so the overlays under the pointer see real enter/leave sequences.
test.setTimeout(150_000);
test.use({ viewport: { width: 1440, height: 960 } });

const wheelOf = (page: Page) => page.locator("[data-sketch-annotation-wheel]");
const chipOf = (page: Page) =>
  layer(page).locator("button[data-sketch-annotation-overflow]");
const spokes = (page: Page) =>
  page.locator('[data-sketch-annotation-wheel-slot="spoke"]');

/** The wheel's centre in page px (the layer is canvas-local). */
async function wheelCentre(page: Page) {
  const box = (await layer(page).boundingBox())!;
  const wheel = wheelOf(page);
  return {
    x:
      box.x +
      Number(await wheel.getAttribute("data-sketch-annotation-wheel-x")),
    y:
      box.y +
      Number(await wheel.getAttribute("data-sketch-annotation-wheel-y")),
  };
}

const centreOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function glideTo(page: Page, from: ViewportPoint, to: ViewportPoint) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

/** Glide onto `point` from 60 px away and click there (mouse down/up). */
async function glideClickAt(
  workbench: SketchWorkbenchHarness,
  point: ViewportPoint,
  from: ViewportPoint = { x: point.x + 60, y: point.y + 60 },
) {
  await glideTo(workbench.page, from, point);
  await workbench.waitForAnimationFrames(2);
  await workbench.page.mouse.down();
  await workbench.page.mouse.up();
  await workbench.waitForAnimationFrames(3);
}

/** Show all on, K = 4: the P cluster's `+N` is the only one. */
async function denseFanWithShowAll(workbench: SketchWorkbenchHarness) {
  await buildDenseFan(workbench);
  await setShowAll(workbench, true);
  await expect(chipOf(workbench.page)).toHaveCount(1);
  await expect(chipOf(workbench.page)).toHaveAccessibleName(
    "4 more constraints",
  );
}

/** A blank canvas point far from the fan, the panels and the wheel. */
const BLANK = { x: 900, y: 700 };

async function pageP(workbench: SketchWorkbenchHarness) {
  const box = (await workbench.viewport().boundingBox())!;
  // The fan was drawn with `clickViewportAt(P)` (canvas-local).
  return { x: box.x + 500, y: box.y + 330 };
}

test("T14g: `+N` opened from either side centres the wheel on the pointer; its 8 spokes sit on the 82 px radius", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const chip = await centreOf(chipOf(page));

  for (const dx of [-9, 9]) {
    const pointer = { x: chip.x + dx, y: chip.y + 5 };
    await glideClickAt(workbench, pointer, {
      x: pointer.x + dx * 8,
      y: pointer.y + 50,
    });
    await expect(
      wheelOf(page),
      `opened from ${dx < 0 ? "left" : "right"}`,
    ).toHaveCount(1);
    const centre = await wheelCentre(page);
    expect(Math.abs(centre.x - pointer.x), "x = the pointer").toBeLessThan(1);
    expect(Math.abs(centre.y - pointer.y), "y = the pointer").toBeLessThan(1);
    await expect(spokes(page), "every member of the P cluster").toHaveCount(8);
    await expect(chipOf(page), "the `+N` gave way").toHaveCount(0);
    for (const spoke of await spokes(page).all()) {
      const at = await centreOf(spoke);
      expect(Math.hypot(at.x - centre.x, at.y - centre.y)).toBeCloseTo(82, 0);
      const box = (await spoke.boundingBox())!;
      expect(Math.round(box.width)).toBe(28);
    }
    // `−N` collapses it.
    const collapse = layer(page).getByRole("button", {
      name: "Collapse the constraint wheel",
    });
    await expect(collapse).toHaveText("−4");
    await glideClickAt(workbench, await centreOf(collapse));
    await expect(wheelOf(page)).toHaveCount(0);
    await expect(chipOf(page)).toHaveCount(1);
  }
});

test("T14g: hovering a spoke highlights every entity its constraint affects (no click)", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const p = await pageP(workbench);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);

  // Parallel 15 is on L4/L8 (angles 155° and 335°): sample both lines
  // 165 px from P, outside the wheel.
  const lineL4 = along(p, ANGLES[3]!, 165);
  const lineL8 = along(p, ANGLES[7]!, 165);
  await page.mouse.move(BLANK.x, BLANK.y, { steps: 4 });
  await expect.poll(() => workbench.currentHoverTarget()).toBe("none");
  const before = [await crop(page, lineL4), await crop(page, lineL8)];

  const spoke = layer(page).getByRole("button", { name: /^Parallel 15:/ });
  await expect(spoke).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "spoke",
  );
  // Glide in from inside the wheel (between the centre and the spoke), so
  // no other spoke is crossed on the way.
  const centre = await wheelCentre(page);
  const target = await centreOf(spoke);
  await glideTo(
    page,
    {
      x: centre.x + (target.x - centre.x) * 0.45,
      y: centre.y + (target.y - centre.y) * 0.45,
    },
    target,
  );
  await expect
    .poll(() => workbench.currentHoverTarget(), {
      message: "the spoke's hover reaches the editor and stays",
    })
    .toMatch(/constraint/);
  for (const [index, point] of [lineL4, lineL8].entries()) {
    await expect
      .poll(
        async () => maxColorDistance(await crop(page, point), before[index]!),
        { message: `L${index === 0 ? 4 : 8} is highlighted` },
      )
      .toBeGreaterThan(60);
  }
  expect(await workbench.currentEditorSelection(), "no click").toBe(
    "Nothing selected",
  );
});

test("T14g: a selected spoke moves to the centre and another one swaps; the first blank collapses the wheel and a sibling is then selectable", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const expandedBefore = await labelBoxes(page);
  expect(
    Object.keys(expandedBefore).filter(isPCluster).sort(),
    "premise: K = 4",
  ).toEqual(["Equal 10", "Equal 12", "Parallel 11", "Parallel 13"]);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  const centre = await wheelCentre(page);

  const parallel15 = layer(page).getByRole("button", { name: /^Parallel 15:/ });
  await glideClickAt(workbench, await centreOf(parallel15));
  await expect(parallel15).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
  );
  await expect(parallel15).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  const at15 = await centreOf(parallel15);
  expect(Math.hypot(at15.x - centre.x, at15.y - centre.y)).toBeLessThan(1);
  await expect(spokes(page), "the other N − 1 stay radial").toHaveCount(7);
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toMatch(/constraint/);
  const selected15 = await workbench.currentEditorSelection();

  const equal14 = layer(page).getByRole("button", { name: /^Equal 14:/ });
  await glideClickAt(workbench, await centreOf(equal14));
  await expect(equal14).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
  );
  await expect(
    parallel15,
    "the previous centre is back on the wheel",
  ).toHaveAttribute("data-sketch-annotation-wheel-slot", "spoke");
  await expect(spokes(page)).toHaveCount(7);
  expect(await workbench.currentEditorSelection()).not.toBe(selected15);

  // Back to Parallel 15, then one blank click: the wheel collapses, nothing
  // is selected, Parallel 15 (`last`) is expanded in the collapsed cluster
  // and takes one slot; the other expanded glyphs keep their places.
  await glideClickAt(workbench, await centreOf(parallel15));
  await expect(parallel15).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
  );
  await glideClickAt(workbench, BLANK);
  await expect(wheelOf(page)).toHaveCount(0);
  await expect
    .poll(() => workbench.currentEditorSelection())
    .toBe("Nothing selected");
  const last = layer(page).getByRole("button", { name: /^Parallel 15:/ });
  await expect(last).toHaveAttribute(
    "data-sketch-annotation-selection",
    "last",
  );
  await expect(chipOf(page)).toHaveAccessibleName("4 more constraints");
  const after = await labelBoxes(page);
  expect(Object.keys(after).filter(isPCluster).sort()).toEqual([
    "Equal 10",
    "Equal 12",
    "Parallel 11",
    "Parallel 15",
  ]);
  for (const name of ["Equal 10", "Parallel 11", "Equal 12"]) {
    expect(after[name], `${name} kept its place`).toEqual(expandedBefore[name]);
  }

  // A sibling is directly selectable after the first blank.
  const equal10 = layer(page).getByRole("button", { name: /^Equal 10:/ });
  await glideClickAt(workbench, await centreOf(equal10));
  await expect(equal10).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
});

test("T14g: a press and drag on a spoke over a line never drags the line; geometry is unchanged", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const p = await pageP(workbench);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);

  // Find a spoke whose box covers one of the lines (a point on a line ≥ 20 px
  // from P inside the spoke's box).
  let press: { point: ViewportPoint; spoke: Locator } | null = null;
  for (const spoke of await spokes(page).all()) {
    const box = (await spoke.boundingBox())!;
    for (const angle of ANGLES) {
      const hit = Array.from({ length: 90 }, (_, index) =>
        along(p, angle, 20 + index * 2),
      ).find(
        (point) =>
          point.x >= box.x + 4 &&
          point.x <= box.x + box.width - 4 &&
          point.y >= box.y + 4 &&
          point.y <= box.y + box.height - 4,
      );
      if (hit) {
        press = { point: hit, spoke };
        break;
      }
    }
    if (press) break;
  }
  expect(press, "premise: a spoke sits over a line").not.toBeNull();
  const { point } = press!;
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-sketch-annotation-wheel-slot]")
          ?.getAttribute("data-sketch-annotation-wheel-slot") ?? null,
      point,
    ),
    "premise: the spoke, not the canvas, is under the press",
  ).toBe("spoke");

  const before = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
  );
  await glideTo(page, { x: point.x + 40, y: point.y + 40 }, point);
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(point.x + 30, point.y + 40, { steps: 8 });
  await page.mouse.up();
  await workbench.waitForAnimationFrames(4);
  const after = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
  );
  expect(after, "no sketch point moved").toEqual(before);
});

test("T14g: a camera change closes the wheel; near the top edge the wheel shifts just enough to stay inside the usable canvas", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const topInset = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--workbench-viewport-overlay-top",
      ),
    ),
  );
  const canvas = (await layer(page).boundingBox())!;
  const chipBefore = await centreOf(chipOf(page));
  await glideClickAt(workbench, chipBefore);
  await expect(wheelOf(page)).toHaveCount(1);

  // Pan the sketch up (middle button on blank canvas) until the `+N` is
  // 50 px below the usable top: the camera change closes the wheel (T-10,
  // a recorded departure from the prototype).
  const lift = chipBefore.y - (canvas.y + topInset + 50);
  await page.mouse.move(BLANK.x, BLANK.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(BLANK.x, BLANK.y - lift, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await expect(wheelOf(page), "the pan closed the wheel").toHaveCount(0);
  // Let the damped camera settle completely before opening it again.
  await page.waitForTimeout(4_000);

  const chip = await centreOf(chipOf(page));
  expect(
    chip.y - canvas.y,
    "premise: the `+N` is within 100 px of the usable top",
  ).toBeLessThan(topInset + 90);
  await glideClickAt(workbench, chip, { x: chip.x + 40, y: chip.y + 60 });
  await expect(wheelOf(page)).toHaveCount(1);
  const centre = await wheelCentre(page);
  expect(Math.abs(centre.x - chip.x), "x stays on the pointer").toBeLessThan(1);
  expect(
    Math.abs(centre.y - canvas.y - (topInset + 100)),
    "y moved only to 100 px below the usable top",
  ).toBeLessThan(1);
  for (const spoke of await spokes(page).all()) {
    const box = (await spoke.boundingBox())!;
    expect(box.y, "every spoke is below the toolbar").toBeGreaterThanOrEqual(
      canvas.y + topInset,
    );
  }
  await workbench.waitForAnimationFrames(30);
  await expect(wheelOf(page), "a settled camera leaves it open").toHaveCount(1);
});

test("T14g review R-1: `+N` clicked during the damped tail of a pan keeps its wheel open; a pan, a zoom or a window resize started after opening closes it", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const chip = chipOf(page);

  /** Middle-button pan on blank canvas; resolves at the release. */
  const pan = async (dy: number) => {
    await page.mouse.move(BLANK.x, BLANK.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(BLANK.x, BLANK.y + dy, { steps: 12 });
    await page.mouse.up({ button: "middle" });
    return Date.now();
  };
  /** Click the `+N` where it is now (few round trips: it may be drifting). */
  const clickChip = async () => {
    const at = await centreOf(chip);
    await page.mouse.move(at.x + 20, at.y + 20);
    await page.mouse.move(at.x, at.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.up();
    return { at, time: Date.now() };
  };

  // A pan, then `+N` a few hundred ms after the release: the damped camera
  // is still moving the cluster (premise), the wheel opens and stays open.
  // 120 px keeps the cluster clear of the top inset, where the layout
  // re-places chips sideways and the press would miss the moving `+N`.
  const released = await pan(-120);
  const early = await centreOf(chip);
  const clicked = await clickChip();
  // The delay depends on the load (about 0.5–0.8 s here); the premise that
  // matters is that the cluster was still moving when `+N` was pressed.
  console.log(`R-1: +N pressed ${clicked.time - released} ms after release`);
  expect(
    Math.hypot(clicked.at.x - early.x, clicked.at.y - early.y),
    "premise: the cluster was still drifting",
  ).toBeGreaterThanOrEqual(1);
  await expect(wheelOf(page), "the wheel opened").toHaveCount(1);
  await page.waitForTimeout(2_000);
  await expect(
    wheelOf(page),
    "the drift of a pan that ended before opening keeps it open",
  ).toHaveCount(1);

  // A pan started after opening closes it.
  await pan(40);
  await expect(wheelOf(page), "a new pan closed the wheel").toHaveCount(0);

  // A mouse-wheel zoom over the canvas closes a wheel opened at once.
  await page.waitForTimeout(200);
  await clickChip();
  await expect(wheelOf(page)).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(wheelOf(page), "premise: still open").toHaveCount(1);
  await page.mouse.move(BLANK.x, BLANK.y, { steps: 4 });
  await page.mouse.wheel(0, 40);
  await expect(wheelOf(page), "the zoom closed the wheel").toHaveCount(0);

  // A window resize closes it.
  await page.waitForTimeout(1_500);
  await clickChip();
  await expect(wheelOf(page)).toHaveCount(1);
  await page.setViewportSize({ width: 1400, height: 960 });
  await expect(wheelOf(page), "the resize closed the wheel").toHaveCount(0);
});

test("T14g: opening the pick chooser closes the wheel", async ({ page }) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const p = await pageP(workbench);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);
  // P (8 line ends and the shared point) is an overlap; Alt+click there.
  const onL1 = along(p, ANGLES[0]!, 3);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      onL1,
    ),
    "premise: the canvas is under the click",
  ).toBe("CANVAS");
  await glideTo(page, { x: onL1.x + 30, y: onL1.y + 60 }, onL1);
  await workbench.waitForAnimationFrames(2);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.getByRole("menu"), "the chooser opened").toBeVisible();
  await expect(wheelOf(page), "and closed the wheel").toHaveCount(0);
});

/** The P cluster's members (Parallel/Equal 9–16; 17 and 18 sit elsewhere). */
const isPCluster = (name: string) => /^(Parallel|Equal) (9|1[0-6])$/.test(name);

/** Every interactive glyph's box (centre) by name. */
async function labelBoxes(page: Page) {
  return Object.fromEntries(
    await layer(page)
      .locator("button[data-sketch-annotation-kind]")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return [
            (element.getAttribute("aria-label") ?? "").replace(/:.*$/, ""),
            `${Math.round(box.x)},${Math.round(box.y)}`,
          ];
        }),
      ),
  ) as Record<string, string>;
}

type Rgb = readonly [number, number, number];

/** A 24 × 24 page crop centred on a point. */
async function crop(page: Page, point: ViewportPoint) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return readPixels(
    page,
    await page.screenshot({
      scale: "css",
      clip: {
        x: Math.round(point.x - 12),
        y: Math.round(point.y - 12),
        width: 24,
        height: 24,
      },
    }),
  );
}

function maxColorDistance(left: Rgb[][], right: Rgb[][]) {
  let max = 0;
  left.forEach((row, y) =>
    row.forEach((pixel, x) => {
      const other = right[y]![x]!;
      max = Math.max(
        max,
        Math.hypot(
          pixel[0] - other[0],
          pixel[1] - other[1],
          pixel[2] - other[2],
        ),
      );
    }),
  );
  return max;
}

/** Decodes a PNG screenshot in the page into rows of RGB pixels. */
async function readPixels(page: Page, png: Buffer): Promise<Rgb[][]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    return Array.from({ length: image.height }, (_, y) =>
      Array.from({ length: image.width }, (_, x) => {
        const index = (y * image.width + x) * 4;
        return [data[index]!, data[index + 1]!, data[index + 2]!] as const;
      }),
    );
  }, png.toString("base64"));
}

test("T14g keyboard: Enter on `+N` focuses the wheel; Tab reaches a spoke, Enter selects it, Delete deletes it (the wheel shrinks), Escape closes and focuses `+N`", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  const chip = chipOf(page);
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(wheelOf(page)).toHaveCount(1);
  await expect(
    layer(page).getByRole("button", { name: "Collapse the constraint wheel" }),
    "the wheel's centre has the focus",
  ).toBeFocused();

  await page.keyboard.press("Tab");
  const focusedName = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? "",
  );
  expect(focusedName, "Tab reaches the first spoke (top)").toMatch(
    /^Equal 10:/,
  );
  await page.keyboard.press("Enter");
  const equal10 = layer(page).getByRole("button", { name: /^Equal 10:/ });
  await expect(equal10).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "centre",
  );
  await expect(equal10, "the focus stays on the moved spoke").toBeFocused();

  await page.keyboard.press("Delete");
  await expect(
    page.locator("[data-sketch-constraint-row]"),
    "Delete deleted the selected spoke",
  ).toHaveCount(9);
  await expect(wheelOf(page), "the wheel stays open").toHaveCount(1);
  await expect(spokes(page), "7 spokes left").toHaveCount(7);
  const collapse = layer(page).getByRole("button", {
    name: "Collapse the constraint wheel",
  });
  await expect(collapse).toHaveText("−3");
  // Review R-3: the deleted centre spoke's focus goes to the new centre.
  await expect(collapse, "the focus moved to `−N`").toBeFocused();

  await page.keyboard.press("Escape");
  await expect(wheelOf(page)).toHaveCount(0);
  await expect(chipOf(page), "the focus returns to `+N`").toBeFocused();
});

test("T14g: deleting spokes until N − 1 ≤ K closes the wheel; the cluster renders expanded and Escape's next stage is the selection", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);
  for (const [index, name] of [
    "Parallel 9",
    "Parallel 11",
    "Parallel 13",
  ].entries()) {
    const spoke = layer(page).getByRole("button", {
      name: new RegExp(`^${name}:`),
    });
    await glideClickAt(workbench, await centreOf(spoke));
    await expect(spoke).toHaveAttribute(
      "data-sketch-annotation-wheel-slot",
      "centre",
    );
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-sketch-constraint-row]")).toHaveCount(
      9 - index,
    );
    await expect(wheelOf(page), `after deleting ${name}: open`).toHaveCount(1);
    await expect(spokes(page)).toHaveCount(7 - index);
    // Review R-3: the focused centre spoke was deleted; `−N` takes it.
    await expect(
      layer(page).getByRole("button", {
        name: "Collapse the constraint wheel",
      }),
      `after deleting ${name}: the focus is on \`−N\``,
    ).toBeFocused();
  }
  // 5 members left: deleting one more leaves 4 = K, the wheel closes.
  const parallel15 = layer(page).getByRole("button", { name: /^Parallel 15:/ });
  await glideClickAt(workbench, await centreOf(parallel15));
  await expect(
    parallel15,
    "premise: the clicked spoke has the focus",
  ).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-sketch-constraint-row]")).toHaveCount(6);
  await expect(wheelOf(page), "N − 1 ≤ K: closed").toHaveCount(0);
  await expect(chipOf(page), "no `+N`: the cluster is expanded").toHaveCount(0);
  // Review R-3: no `+N` remains; the cluster's first glyph takes the focus.
  await expect(
    layer(page).getByRole("button", { name: /^Equal 10:/ }),
    "the focus moved to the cluster's first glyph",
  ).toBeFocused();
  const names = Object.keys(await labelBoxes(page))
    .filter(isPCluster)
    .sort();
  expect(names).toEqual(["Equal 10", "Equal 12", "Equal 14", "Equal 16"]);

  // No stale wheel is left in the editor: Escape's next stage is the
  // selection (a selected glyph is cleared by one Escape).
  const equal12 = layer(page).getByRole("button", { name: /^Equal 12:/ });
  await glideClickAt(workbench, await centreOf(equal12));
  await expect(equal12).toHaveAttribute(
    "data-sketch-annotation-selection",
    "active",
  );
  await page.mouse.move(BLANK.x, BLANK.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await expect(equal12).toHaveAttribute(
    "data-sketch-annotation-selection",
    "last",
  );
});

test("T14g T-6/R-9: with the wheel open the first click inside a region only collapses the wheel; the second selects the region", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await workbench.open();
  await workbench.activateTool("Start a new sketch.");
  await page
    .getByRole("button", { name: /Top Plane/ })
    .first()
    .click();
  await workbench.expectSketchSessionActive();
  // A small rectangle (60 × 40 px): its four edge constraints link into
  // one cluster and its context is small (K = 2), so Show all gives `+2`.
  await workbench.openToolMenu("Create rectangle geometry.");
  await page.locator('[role="menuitem"][data-tool-id="rectangle"]').click();
  await workbench.clickViewportAt({ x: 640, y: 420 });
  await workbench.clickViewportAt({ x: 700, y: 460 });
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 10_000 })
    .toContain("4 entities staged");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle");
  await page
    .getByRole("button", { name: /^Select .*Double-click to reopen\.$/ })
    .filter({ hasText: /Sketch/ })
    .first()
    .dblclick();
  await workbench.expectSketchSessionActive();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                target.includes(".region_"),
              ).length ?? 0,
        ),
      {
        message: "premise: the reopened rectangle has a live region",
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0);
  await setShowAll(workbench, true);
  await expect(chipOf(page), "premise: one collapsed cluster").toHaveCount(1);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);

  // An interior point with the canvas on top (not under the wheel centre).
  const canvas = (await workbench.viewport().boundingBox())!;
  let interior: ViewportPoint | null = null;
  // ≥ 16 px from every edge, so no corner or edge is the pick.
  for (const dx of [30, 22, 38, 18, 42]) {
    for (const dy of [20, 17, 23]) {
      const point = { x: canvas.x + 640 + dx, y: canvas.y + 420 + dy };
      const tag = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        point,
      );
      if (tag === "CANVAS") {
        interior = point;
        break;
      }
    }
    if (interior) break;
  }
  expect(interior, "premise: a free interior point").not.toBeNull();

  await glideClickAt(workbench, interior!);
  await expect(
    wheelOf(page),
    "the first click collapsed the wheel",
  ).toHaveCount(0);
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "the first interior click selected nothing",
    })
    .toBe("Nothing selected");
  await glideClickAt(workbench, interior!);
  await expect
    .poll(() => workbench.currentEditorSelection(), {
      message: "the second selects the region",
    })
    .toContain(".region_");
});

test('T14g review A-4: "More…" on a 14-member wheel narrows the Constraints list to the members and expands it; the open wheel stays clear of the list', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const workbench = new SketchWorkbenchHarness(page);
  await buildWideFan(workbench);
  await setShowAll(workbench, true);
  await expect(chipOf(page)).toHaveAccessibleName("10 more constraints");
  const list = page.locator("[data-sketch-constraint-list]");
  const rows = page.locator("[data-sketch-constraint-row]");
  await page
    .getByRole("button", { name: "Collapse the constraints list" })
    .click();
  await expect(rows, "premise: the list is collapsed").toHaveCount(0);

  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);
  await expect(spokes(page), "11 member spokes").toHaveCount(11);
  const more = layer(page).getByRole("button", {
    name: "More: 3 more in the Constraints list",
  });
  await expect(more).toHaveAttribute(
    "data-sketch-annotation-wheel-slot",
    "more",
  );
  const before = await wheelCentre(page);

  await glideClickAt(workbench, await centreOf(more));
  await expect(rows, "only the 14 members are listed").toHaveCount(14);
  await expect(list.locator("[data-sketch-constraint-filter]")).toHaveText(
    /14 nearby constraints/,
  );
  await expect(
    list.getByText("Equal", { exact: false }).first(),
    "premise: the expanded list is visible",
  ).toBeVisible();
  await expect(wheelOf(page), "the wheel stays open").toHaveCount(1);
  await workbench.waitForAnimationFrames(3);
  const after = await wheelCentre(page);
  console.log(
    `A-4: the wheel centre moved ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(1)} px when the list expanded`,
  );
  const panel = (await list.boundingBox())!;
  for (const slot of await page
    .locator("[data-sketch-annotation-wheel-slot]")
    .all()) {
    const box = (await slot.boundingBox())!;
    const clear =
      box.x + box.width <= panel.x ||
      box.x >= panel.x + panel.width ||
      box.y + box.height <= panel.y ||
      box.y >= panel.y + panel.height;
    expect(clear, "no wheel slot over the Constraints list").toBe(true);
  }

  await list.getByRole("button", { name: "Show every constraint" }).click();
  await expect(rows, "the reset lists every constraint").toHaveCount(15);
});

test("T14g re-review R-4: a double-click on a radial spoke acts on that spoke only: it becomes the centre (a constraint without a value editor stays selected alone), the wheel stays open and nothing reaches another spoke or the canvas", async ({
  page,
}) => {
  const workbench = new SketchWorkbenchHarness(page);
  await denseFanWithShowAll(workbench);
  await glideClickAt(workbench, await centreOf(chipOf(page)));
  await expect(wheelOf(page)).toHaveCount(1);
  const pointsBefore = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
  );

  // The re-review's three cases: the top spoke (a neighbour slides under
  // the pointer), and two whose slots become canvas after the re-spacing.
  for (const name of ["Equal 10", "Equal 12", "Equal 16"]) {
    const spoke = layer(page).getByRole("button", {
      name: new RegExp(`^${name}:`),
    });
    await expect(spoke, `premise: ${name} is radial`).toHaveAttribute(
      "data-sketch-annotation-wheel-slot",
      "spoke",
    );
    const at = await centreOf(spoke);
    await glideTo(page, { x: at.x + 30, y: at.y + 40 }, at);
    await workbench.waitForAnimationFrames(2);
    await page.mouse.dblclick(at.x, at.y);
    await expect(wheelOf(page), `${name}: the wheel stays open`).toHaveCount(1);
    await expect(spoke, `${name} is the centre`).toHaveAttribute(
      "data-sketch-annotation-wheel-slot",
      "centre",
    );
    await expect(spoke).toHaveAttribute(
      "data-sketch-annotation-selection",
      "active",
    );
    await expect
      .poll(() => workbench.currentMachineSelectionCount(), {
        message: `${name}: only that constraint is selected`,
      })
      .toBe(1);
    expect(await workbench.currentEditorSelection()).toMatch(/constraint/);
    expect(
      await workbench.currentSketchSession(),
      "Equal has no value editor",
    ).not.toMatch(/awaitingValue/i);
    await expect(spokes(page), "the other 7 stay radial").toHaveCount(7);
  }
  expect(
    await page.evaluate(
      () => window.__cadaraDebug?.getSketchSnapshot()?.points ?? [],
    ),
    "no sketch point moved",
  ).toEqual(pointsBefore);
});
