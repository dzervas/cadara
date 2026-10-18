import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { SketchWorkbenchHarness } from "./sketch-workbench";
import { glidePress } from "./mirror-workbench";

/**
 * Shared acceptance harness (T17b). Every pointer path glides (several
 * `mouse.move` steps) so DOM overlays under the pointer see what a user's
 * pointer produces; waits are on committed history entries and revisions,
 * never on a fixed number of frames (frames are waited only inside the
 * bounded hover search, which fails explicitly).
 */

export type CanvasPoint = { x: number; y: number };

/**
 * The hover-search candidates around a region's projected point (T17b0 P-5):
 * the point itself, then rings of 8…106 px (≈ 14 px apart, each ring turned
 * a little: a spiral), then a ±180 px grid of 15 px, nearest first.
 */
function regionSearchOffsets() {
  const offsets: CanvasPoint[] = [];
  const seen = new Set<string>();
  const push = (x: number, y: number) => {
    const point = { x: Math.round(x), y: Math.round(y) };
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    offsets.push(point);
  };
  push(0, 0);
  [8, 16, 26, 38, 52, 68, 86, 106].forEach((radius, ring) => {
    const count = Math.max(8, Math.round((2 * Math.PI * radius) / 14));
    for (let k = 0; k < count; k += 1) {
      const angle = (2 * Math.PI * k) / count + ring * 0.37;
      push(radius * Math.cos(angle), radius * Math.sin(angle));
    }
  });
  const grid: CanvasPoint[] = [];
  for (let x = -180; x <= 180; x += 15)
    for (let y = -180; y <= 180; y += 15) grid.push({ x, y });
  grid.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  for (const point of grid) push(point.x, point.y);
  return offsets;
}
const REGION_SEARCH_OFFSETS = regionSearchOffsets();

/**
 * Selects `regionId` the way a user does: glides the pointer over candidate
 * points around the region's projected point until the viewport reports the
 * region itself as the hover target, presses there, and waits for the
 * selection (the profile chip of an active feature, or the editor
 * selection). Fails with the hover targets it saw; it never falls back to a
 * debug selection. `from` replaces the projected start point (same canvas
 * coordinates), e.g. a point on a thin region once zoomed in, where the
 * region's projected point is far off screen.
 */
/**
 * The remove button of `regionKey`'s profile chip (`sketch_….region_…`).
 * T17k2: chips are named by label; the key is a data attribute, not text.
 */
export function profileChip(page: Page, regionKey: string) {
  return page.locator(`button[data-reference-key="${regionKey}"]`);
}

export async function selectRegionInViewport(
  workbench: SketchWorkbenchHarness,
  regionId: string,
  { from }: { from?: CanvasPoint } = {},
) {
  const page = workbench.page;
  const surface = await workbench.viewportSurface().boundingBox();
  if (!surface) throw new Error("Viewport surface is not visible.");
  const start =
    from ??
    (await page.evaluate(
      (id) => window.__cadProjectToScreen?.(id) ?? null,
      regionId,
    ));
  if (!start) throw new Error(`${regionId} has no projected screen point.`);
  const seen = new Map<string, number>();
  for (const offset of REGION_SEARCH_OFFSETS) {
    const at = { x: start.x + offset.x, y: start.y + offset.y };
    if (
      at.x < 2 ||
      at.y < 2 ||
      at.x > surface.width - 2 ||
      at.y > surface.height - 2
    )
      continue;
    await page.mouse.move(surface.x + at.x, surface.y + at.y, { steps: 3 });
    await workbench.waitForAnimationFrames(2);
    const hovered = await workbench.currentHoverTarget();
    seen.set(hovered, (seen.get(hovered) ?? 0) + 1);
    if (hovered !== regionId) continue;
    await page.mouse.down();
    await page.mouse.up();
    const chip = profileChip(page, regionId);
    await expect
      .poll(
        async () =>
          (await chip.isVisible()) ||
          (await workbench.currentEditorSelection()).includes(regionId),
        {
          message: `${regionId} is selected after a press at ${JSON.stringify(at)}`,
          timeout: 15_000,
        },
      )
      .toBe(true);
    return at;
  }
  throw new Error(
    `${regionId} was never the hover target around ${JSON.stringify(start)}; hover targets seen: ${JSON.stringify(Object.fromEntries(seen))}.`,
  );
}

/** Screen points (`__cadProjectToScreen` coordinates) of `ids`, once still. */
export async function settledProjections(
  workbench: SketchWorkbenchHarness,
  ids: readonly string[],
) {
  const read = () =>
    workbench.page.evaluate(
      (targets) =>
        targets.map((id) => window.__cadProjectToScreen?.(id) ?? null),
      [...ids],
    );
  let previous = await read();
  let current = previous;
  await expect
    .poll(
      async () => {
        await workbench.waitForAnimationFrames(3);
        current = await read();
        const still = current.every((point, index) => {
          const before = previous[index];
          return (
            point !== null &&
            before != null &&
            Math.hypot(point.x - before.x, point.y - before.y) < 0.01
          );
        });
        previous = current;
        return still;
      },
      { message: `the camera settled (${ids.join(", ")})`, timeout: 15_000 },
    )
    .toBe(true);
  return current as CanvasPoint[];
}

export const mean = (points: readonly CanvasPoint[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});
export const spread = (points: readonly CanvasPoint[]) =>
  Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);

/** The viewport centre in viewport-surface (`__cadProjectToScreen`) px. */
async function viewportCentre(workbench: SketchWorkbenchHarness) {
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const canvas = (await workbench.viewport().boundingBox())!;
  return {
    surface,
    centre: {
      x: canvas.x + canvas.width / 2 - surface.x,
      y: canvas.y + canvas.height / 2 - surface.y,
    },
  };
}

/**
 * Pans the mean screen point of the scene targets `anchor` to the viewport
 * centre with gliding middle-button drags (at most 300 px per glide);
 * returns the anchor's screen point (viewport-surface px).
 */
export async function panToViewportCentre(
  workbench: SketchWorkbenchHarness,
  anchor: readonly string[],
) {
  const page = workbench.page;
  const { surface, centre } = await viewportCentre(workbench);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const at = mean(await settledProjections(workbench, anchor));
    const offset = Math.hypot(centre.x - at.x, centre.y - at.y);
    if (offset < 2) return at;
    // Grab at the centre and drag the scene by at most 300 px per glide.
    const step = Math.min(1, 300 / offset);
    await page.mouse.move(surface.x + centre.x, surface.y + centre.y, {
      steps: 6,
    });
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(
      surface.x + centre.x + (centre.x - at.x) * step,
      surface.y + centre.y + (centre.y - at.y) * step,
      { steps: 16 },
    );
    await page.mouse.up({ button: "middle" });
  }
  const at = mean(await settledProjections(workbench, anchor));
  expect(
    Math.hypot(centre.x - at.x, centre.y - at.y),
    "the zoom anchor is panned to the viewport centre",
  ).toBeLessThan(2);
  return at;
}

/**
 * Zooms the viewport in `factor` times about the mean screen point of the
 * scene targets `anchor`: pans it to the viewport centre
 * (`panToViewportCentre`; the controls zoom about the centre), wheels in at
 * the centre until the two point targets `scale` are `factor` times
 * farther apart on screen, then pans the anchor back to the centre.
 * Returns the anchor's screen point. (Moved from
 * `part-mode-line-pick-radius.spec.ts`, T17i: thin regions of the
 * converted region rows are picked after the same zoom.)
 */
export async function zoomInAbout(
  workbench: SketchWorkbenchHarness,
  anchor: readonly string[],
  scale: readonly [string, string],
  factor: number,
) {
  const page = workbench.page;
  const { surface, centre } = await viewportCentre(workbench);
  const start = spread(await settledProjections(workbench, scale));
  await panToViewportCentre(workbench, anchor);
  for (let round = 0; round < 40; round += 1) {
    if (spread(await settledProjections(workbench, scale)) >= factor * start)
      break;
    await page.mouse.move(surface.x + centre.x, surface.y + centre.y, {
      steps: 4,
    });
    for (let event = 0; event < 10; event += 1) {
      await page.mouse.wheel(0, -100);
    }
  }
  expect(
    spread(await settledProjections(workbench, scale)),
    `zoomed in ${factor}×`,
  ).toBeGreaterThanOrEqual(factor * start);
  return panToViewportCentre(workbench, anchor);
}

/**
 * After the profile list is cleared (or a missing region removed) the
 * feature's profile slot is no longer the active pick target; a user
 * presses "+ Add Profile" before picking in the viewport.
 */
export async function activateProfileSlot(page: Page) {
  const add = page.getByRole("button", { name: "+ Add Profile" });
  await expect(add).toBeVisible({ timeout: 15_000 });
  if ((await add.getAttribute("aria-pressed")) === "true") return;
  await glidePress(page, add);
  await expect(add).toHaveAttribute("aria-pressed", "true", {
    timeout: 10_000,
  });
}

/**
 * A gliding press on an object's Parts & Objects visibility toggle
 * ("Show ‹label›" / "Hide ‹label›", revealed on hover). A sketch consumed
 * by a feature is auto-hidden: picking another of its regions starts by
 * showing it again; a body in front of a region is hidden, as a user does.
 */
export async function toggleVisibility(
  page: Page,
  action: "Show" | "Hide",
  label: string | RegExp,
) {
  const toggle = page
    .getByRole("button", {
      name:
        typeof label === "string"
          ? `${action} ${label}`
          : new RegExp(`^${action} ${label.source}`),
    })
    .first();
  await expect(toggle, `${action} ${label}`).toHaveCount(1, {
    timeout: 15_000,
  });
  await glidePress(page, toggle);
}

export const showInViewport = (page: Page, label: string | RegExp) =>
  toggleVisibility(page, "Show", label);

/** A gliding drag in canvas coordinates: glide on, press, glide, release. */
export async function glideDrag(
  workbench: SketchWorkbenchHarness,
  from: CanvasPoint,
  to: CanvasPoint,
  { steps = 16, release = true }: { steps?: number; release?: boolean } = {},
) {
  const page = workbench.page;
  const canvas = await workbench.viewport().boundingBox();
  if (!canvas) throw new Error("Viewport canvas is not visible.");
  await page.mouse.move(canvas.x + from.x, canvas.y + from.y, { steps: 8 });
  // Hover settles on the grab target before the press.
  await workbench.waitForAnimationFrames(2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + to.x, canvas.y + to.y, { steps });
  // The last pointer move is drawn before the release.
  await workbench.waitForAnimationFrames(2);
  if (release) await page.mouse.up();
}

/** Glides onto `target` (e.g. a timeline entry) and double-clicks it. */
export async function glideDoubleClick(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 });
  // "active" is set before the timeline's 200 ms translation finishes.
  // Trial hover waits for native stability (two frames) without moving the pointer.
  await target.hover({ trial: true });
  const box = await target.boundingBox();
  if (!box) throw new Error("The double-click target is not visible.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  // The glide can itself move a control; remeasure at action time through the
  // locator's native stability/hit-target checks, never reuse the pre-glide box.
  await target.dblclick();
}

export type HistoryEntry = { sequence: number; label: string };
/** The history strip's entries, newest first (it shows ≤ 4 undo, ≤ 2 redo). */
export type HistoryStrip = { undo: HistoryEntry[]; redo: HistoryEntry[] };

export function readHistoryStrip(page: Page): Promise<HistoryStrip> {
  return page.evaluate(() => {
    const read = (direction: "undo" | "redo") =>
      Array.from(
        document.querySelectorAll(
          `[data-history-action-direction="${direction}"]`,
        ),
        (entry) => ({
          sequence: Number(entry.getAttribute("data-history-action-sequence")),
          label: (entry.textContent ?? "").replace(/^Redo /, ""),
        }),
      );
    return { undo: read("undo"), redo: read("redo") };
  });
}

const sequenceOf = (entry: HistoryEntry | undefined) => entry?.sequence ?? null;

/**
 * Runs `act` and waits until it committed exactly one action labelled
 * `label` (T17-17): the newest undo entry is new (its sequence is above
 * every sequence shown before) and the previous newest entry is right below
 * it. (Sequences are one counter per history, so after an Undo the next
 * commit skips the undone sequences: "exactly one" is checked by position,
 * not by `+1`.) Limit: a second commit that lands in a later render, after
 * the poll accepted the first, is not seen; rows that must exclude it also
 * re-pin "one action" through a one-step Undo. `timeout` is for commits that
 * wait on a background derivation (e.g. an offset's certification). Returns
 * the committed entry.
 */
export async function waitForCommittedAction(
  page: Page,
  label: string,
  act: () => Promise<unknown>,
  { timeout = 15_000 }: { timeout?: number } = {},
): Promise<HistoryEntry> {
  const before = await readHistoryStrip(page);
  const shown = [...before.undo, ...before.redo].map((entry) => entry.sequence);
  const highest = Math.max(0, ...shown);
  await act();
  let after = before;
  await expect
    .poll(
      async () => {
        after = await readHistoryStrip(page);
        return {
          label: after.undo[0]?.label ?? null,
          new: (after.undo[0]?.sequence ?? 0) > highest,
          below: sequenceOf(after.undo[1]),
        };
      },
      {
        message: `one "${label}" action is committed on top of ${JSON.stringify(before.undo)}`,
        timeout,
      },
    )
    .toEqual({ label, new: true, below: sequenceOf(before.undo[0]) });
  return after.undo[0]!;
}

/**
 * Runs `act` (an Undo) and waits until the newest undo entry, labelled
 * `label`, moved to the top of the redo entries and nothing else changed.
 */
export async function waitForUndoneAction(
  page: Page,
  label: string,
  act: () => Promise<unknown>,
) {
  const before = await readHistoryStrip(page);
  expect(before.undo[0]?.label, "premise: the newest undo entry").toBe(label);
  await act();
  await expect
    .poll(
      async () => {
        const after = await readHistoryStrip(page);
        return { undo: sequenceOf(after.undo[0]), redo: after.redo[0] ?? null };
      },
      { message: `"${label}" is undone in one step`, timeout: 15_000 },
    )
    .toEqual({ undo: sequenceOf(before.undo[1]), redo: before.undo[0] });
}

/**
 * Runs `act` (a Redo) and waits until the newest redo entry, labelled
 * `label`, is the newest undo entry again and nothing else changed.
 */
export async function waitForRedoneAction(
  page: Page,
  label: string,
  act: () => Promise<unknown>,
) {
  const before = await readHistoryStrip(page);
  expect(before.redo[0]?.label, "premise: the newest redo entry").toBe(label);
  await act();
  await expect
    .poll(
      async () => {
        const after = await readHistoryStrip(page);
        return {
          undo: after.undo[0] ?? null,
          below: sequenceOf(after.undo[1]),
          redo: sequenceOf(after.redo[0]),
        };
      },
      { message: `"${label}" is redone in one step`, timeout: 15_000 },
    )
    .toEqual({
      undo: before.redo[0],
      below: sequenceOf(before.undo[0]),
      redo: sequenceOf(before.redo[1]),
    });
}

function peerSyncPath(channel: string, databaseName: string) {
  const params = new URLSearchParams({
    cadLocalPeerSync: "1",
    cadLocalPeerSyncChannel: channel,
    cadRepositoryDbName: databaseName,
    cadTestMode: "1",
  });
  return `/app?${params}`;
}

/**
 * Two sessions of one shared document: two pages of `context` on the local
 * peer sync `channel`, each with its own repository database. The second
 * opens once the first has published the document's repository URL.
 */
export async function openTwoSessions(
  context: BrowserContext,
  channel: string,
) {
  const first = new SketchWorkbenchHarness(await context.newPage());
  const second = new SketchWorkbenchHarness(await context.newPage());
  await first.openPreservingStorage(peerSyncPath(channel, `${channel}-a`));
  const key = `cad.documentRepository.automergeUrls.v1:cad-local-peer-channel:${encodeURIComponent(channel)}`;
  await expect
    .poll(
      () =>
        first.page.evaluate(
          (storageKey) => localStorage.getItem(storageKey),
          key,
        ),
      { message: "the first session published its document", timeout: 30_000 },
    )
    .toContain("doc_workspace");
  await second.openPreservingStorage(peerSyncPath(channel, `${channel}-b`));
  return { first, second };
}

export function currentRevision(page: Page) {
  return page.evaluate(
    () => window.__cadaraDebug?.getState()?.revision ?? "loading",
  );
}

/**
 * Waits until `page` shows a revision other than `previous` through the
 * production peer refresh (no debug refresh), and returns it.
 */
export async function waitForPeerRevision(page: Page, previous: string) {
  let revision = previous;
  await expect
    .poll(
      async () => {
        revision = await currentRevision(page);
        return revision;
      },
      { message: `a peer revision after ${previous}`, timeout: 30_000 },
    )
    .not.toBe(previous);
  return revision;
}
