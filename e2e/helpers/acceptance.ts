import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { SketchWorkbenchHarness } from "./sketch-workbench";

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
 * debug selection.
 */
export async function selectRegionInViewport(
  workbench: SketchWorkbenchHarness,
  regionId: string,
) {
  const page = workbench.page;
  const surface = await workbench.viewportSurface().boundingBox();
  if (!surface) throw new Error("Viewport surface is not visible.");
  const start = await page.evaluate(
    (id) => window.__cadProjectToScreen?.(id) ?? null,
    regionId,
  );
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
    const chip = page.getByRole("button", { name: `Remove ${regionId}` });
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
  const box = await target.boundingBox();
  if (!box) throw new Error("The double-click target is not visible.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
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
 * re-pin "one action" through a one-step Undo. Returns the committed entry.
 */
export async function waitForCommittedAction(
  page: Page,
  label: string,
  act: () => Promise<unknown>,
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
        timeout: 15_000,
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
  return `/?${params}`;
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
