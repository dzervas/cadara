import { expect, type Locator, type Page } from "@playwright/test";

import type { SketchWorkbenchHarness } from "./sketch-workbench";

/**
 * Gliding-pointer helpers for the mirror E2E rows (T16g). Every press is a
 * real glide (several `mouse.move` steps) onto its target, never a forced
 * or jumping click, so DOM overlays under the pointer see what a user's
 * pointer produces. Waits are on committed history entries and session
 * state, never on a fixed number of frames.
 */

export type Vec = readonly [number, number];
export type CanvasPoint = { x: number; y: number };

export type MirrorSketchSnapshot = {
  points: { id: string; position: Vec }[];
  entities: {
    id: string;
    kind: string;
    pointIds?: string[];
    radius?: number;
  }[];
  liveRegions?: { status: string; count: number };
  derivedRelationships: {
    id: string;
    kind: string;
    mirrorReference?: { kind: string; entityId?: string; datum?: string };
    outputs: {
      seedEntityId: string;
      outputEntityId: string;
      seedPointIds: string[];
      outputPointIds: string[];
    }[];
  }[];
};

export async function sketchSnapshot(
  page: Page,
): Promise<MirrorSketchSnapshot> {
  const snap = await page.evaluate(
    () => window.__cadaraDebug?.getSketchSnapshot() ?? null,
  );
  if (!snap) throw new Error("No live sketch snapshot.");
  return snap as unknown as MirrorSketchSnapshot;
}

export const entityTarget = (id: string) => new RegExp(`\\.${id}$`);

export async function openTopSketch(workbench: SketchWorkbenchHarness) {
  await workbench.activateTool("Start a new sketch.");
  await glidePress(
    workbench.page,
    workbench.page.getByRole("button", { name: /Top Plane/ }).first(),
  );
  await workbench.expectSketchSessionActive();
}

export async function expectStaged(
  workbench: SketchWorkbenchHarness,
  count: number,
) {
  await expect
    .poll(() => workbench.currentSketchSession(), { timeout: 15_000 })
    .toContain(`${count} entities staged`);
}

/** A gliding press on a canvas point (canvas coordinates). */
export async function glideClick(
  workbench: SketchWorkbenchHarness,
  to: CanvasPoint,
) {
  const page = workbench.page;
  const canvas = (await workbench.viewport().boundingBox())!;
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps: 8 });
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.up();
}

/** A gliding press on a DOM control's centre. */
export async function glidePress(page: Page, control: Locator) {
  await expect(control).toBeVisible({ timeout: 15_000 });
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.down();
  await page.mouse.up();
}

/** Shift-placed gliding clicks (no inferred constraint), then back to Select. */
export async function placeFreely(
  workbench: SketchWorkbenchHarness,
  points: readonly CanvasPoint[],
) {
  const page = workbench.page;
  await page.keyboard.down("Shift");
  for (const point of points) await glideClick(workbench, point);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

/** Hovers along a short vertical scan until `pattern` is the hover target. */
export async function hoverUntil(
  workbench: SketchWorkbenchHarness,
  around: CanvasPoint,
  pattern: RegExp,
  span = 12,
) {
  for (let dy = 0; dy <= span; dy += 1)
    for (const y of dy === 0 ? [around.y] : [around.y - dy, around.y + dy]) {
      await workbench.hoverViewportAt({ x: around.x, y });
      await workbench.waitForAnimationFrames(2);
      if (pattern.test(await workbench.currentHoverTarget()))
        return { x: around.x, y };
    }
  throw new Error(
    `Nothing matching ${pattern} is hoverable near ${JSON.stringify(around)}.`,
  );
}

export async function openSearchTool(page: Page, name: string) {
  const search = page.getByPlaceholder("Search tools");
  await search.fill(name);
  await search.press("Enter");
}

/** The undo entries labelled `label` (exactly) in the history strip. */
export const undoEntries = (page: Page, label: string) =>
  page
    .locator('[data-history-action-direction="undo"]')
    .filter({ hasText: new RegExp(`^${label}$`) });

export const mirrorPanel = (page: Page) =>
  page.getByRole("region", { name: "Mirror" });

/** The mirror relationships of a snapshot. */
export const mirrorsOf = (snap: MirrorSketchSnapshot) =>
  snap.derivedRelationships.filter(
    (relationship) => relationship.kind === "mirror",
  );

export const positionOf = (snap: MirrorSketchSnapshot, id: string) => {
  const point = snap.points.find((candidate) => candidate.id === id);
  if (!point) throw new Error(`No point ${id}.`);
  return point.position;
};

export const entityOf = (snap: MirrorSketchSnapshot, id: string) => {
  const entity = snap.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`No entity ${id}.`);
  return entity;
};

/** R(p) about the line through `a` and `b`. */
export function reflectAbout(point: Vec, a: Vec, b: Vec): Vec {
  const d = [b[0] - a[0], b[1] - a[1]] as const;
  const t =
    ((point[0] - a[0]) * d[0] + (point[1] - a[1]) * d[1]) /
    (d[0] * d[0] + d[1] * d[1]);
  return [2 * (a[0] + t * d[0]) - point[0], 2 * (a[1] + t * d[1]) - point[1]];
}

export type Rgb = readonly [number, number, number];

export const colorDistance = (left: Rgb, right: Rgb) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

/** A (2r × 2r) frame crop centred on a canvas point, as rows of RGB pixels. */
export async function cropPixels(
  workbench: SketchWorkbenchHarness,
  at: CanvasPoint,
  radius = 16,
): Promise<Rgb[][]> {
  const page = workbench.page;
  const canvas = (await workbench.viewport().boundingBox())!;
  const png = await page.screenshot({
    scale: "css",
    clip: {
      x: Math.round(canvas.x + at.x - radius),
      y: Math.round(canvas.y + at.y - radius),
      width: radius * 2,
      height: radius * 2,
    },
  });
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

/** The largest per-pixel colour change between two crops of one place. */
export function maxColorDistance(left: Rgb[][], right: Rgb[][]) {
  let max = 0;
  left.forEach((row, y) =>
    row.forEach((pixel, x) => {
      max = Math.max(max, colorDistance(pixel, right[y]![x]!));
    }),
  );
  return max;
}

/**
 * The sketch palette's danger red (`--workbench-shell-danger-text`, the
 * colour invalid derived output is drawn in), resolved in the page.
 */
export async function dangerColor(page: Page): Promise<Rgb> {
  const color = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--workbench-shell-danger-text)";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  });
  const channels = color.match(/\d+(\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3)
    throw new Error(`Unreadable danger colour ${color}.`);
  return [channels[0]!, channels[1]!, channels[2]!];
}

/** How many pixels of a crop are drawn in (close to) `color`. */
export const pixelsNear = (crop: Rgb[][], color: Rgb, within = 60) =>
  crop.flat().filter((pixel) => colorDistance(pixel, color) < within).length;
