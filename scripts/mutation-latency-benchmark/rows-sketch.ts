// Sketch-session rows of `bun run bench:mutation`: entering, drawing in,
// editing and finishing sketches (base plane and body face). They read the
// debug platform (`window.__cadaraDebug`), so they need the TEST build.
import type { Page } from "@playwright/test";

import {
  activateTool,
  animationFrames,
  canvasPoint,
  clearSelection,
  debugStateContains,
  debugStateField,
  deleteTimelineItemsAfter,
  findHoverPoint,
  glideClickCanvas,
  glideOnto,
  glideToHover,
  historySignature,
  medianAndP95,
  now,
  partsTree,
  selectableTargets,
  settleBeforeCleanup,
  stagedEntityCount,
  startFrameProbe,
  stopFrameProbe,
  timedSample,
  timelineCount,
  untimedHistoryAction,
  waitForHistoryChange,
  waitForMachine,
  waitForOccQuiet,
  waitInPage,
  type RowPreparation,
  type SampleTiming,
  type Session,
} from "./rows-shared.ts";

export const SKETCH_ROW_KINDS = [
  "sketchCreate",
  "sketchDraw",
  "sketchExit",
  "sketchCreateOnFace",
  "sketchExitFace",
  "sketchExitUnchanged",
  "sketchExitUnchangedFace",
  "sketchEditUpstream",
  "sketchDimensionEdit",
  "sketchConstraintAdd",
  "sketchEntityDelete",
  "sketchUndo",
  "sketchRedo",
  "sketchDragPoint",
] as const;
export type SketchRowKind = (typeof SKETCH_ROW_KINDS)[number];

const EXIT_SKETCH_TOOL = "Exit the active sketch.";
const RECTANGLE_TOOL = "Create rectangle geometry.";
const LINE_TOOL = "Create line geometry.";
const HORIZONTAL_TOOL =
  "Constrain a line parallel to the sketch horizontal axis.";
const DIMENSION_CHIP =
  'button[data-sketch-annotation-kind="dimension"][data-sketch-annotation-id]';
const FLOATING_INPUT = "[data-sketch-viewport-floating-input] input";

/** Starts a sketch on the Top plane; the plane pick is the timed gesture. */
export async function enterTopSketch(session: Session, timed: boolean) {
  const { page } = session;
  await page.locator('button[data-tool-id="sketch"]').click();
  const plane = partsTree(page).locator(
    '[data-parts-tree-target="construction:construction_plane-xy"]',
  );
  await plane.waitFor({ timeout: 120_000 });
  const act = () => plane.click();
  const reflected = () => waitForMachine(page, "editingSketch");
  // Entering a sketch is not an undoable action: no persisted signal.
  if (timed) return timedSample(session, act, reflected, "none");
  await act();
  await reflected();
  return null;
}

/** Canvas points of the drawn rectangle (viewport 1600x1000). */
export const RECTANGLE = [
  { x: 700, y: 400 },
  { x: 1000, y: 650 },
] as const;

/**
 * Draws one rectangle in the open sketch; the closing corner click is the
 * timed gesture (reflected: 4 entities staged; persisted: "Create Sketch
 * Geometry" in the undo strip). Leaves the Rectangle tool afterwards.
 * `corners` defaults to RECTANGLE.
 */
export async function drawRectangle(
  session: Session,
  timed = true,
  corners: readonly [{ x: number; y: number }, { x: number; y: number }] = [
    RECTANGLE[0],
    RECTANGLE[1],
  ],
) {
  const { page } = session;
  const stagedBefore = await stagedEntityCount(page);
  await activateTool(page, RECTANGLE_TOOL);
  await glideClickCanvas(page, corners[0]);
  const act = () => glideClickCanvas(page, corners[1]);
  const reflected = () =>
    waitInPage(page, debugStateContains, {
      field: "sketchSession",
      text: `${stagedBefore + 4} entities staged`,
    });
  let timing: SampleTiming | null = null;
  if (timed) {
    timing = await timedSample(session, act, reflected);
  } else {
    const before = await historySignature(page);
    const since = now();
    await act();
    await reflected();
    await waitForHistoryChange(page, before, since);
  }
  await page.keyboard.press("Escape");
  return timing!;
}

/** Exits the open sketch; the machine returning to idle is the reflected signal. */
export async function exitSketch(session: Session, timed = false) {
  const { page } = session;
  const act = () => activateTool(page, EXIT_SKETCH_TOOL);
  const reflected = () => waitForMachine(page, "idle");
  if (timed) return timedSample(session, act, reflected, "none");
  await act();
  await reflected();
  return null;
}

/**
 * A body face that starts a sketch with the Sketch tool armed (hovered and
 * pressed in the viewport). The untimed trial enters and finishes that
 * sketch, then deletes what it added to the timeline. Null when no face is
 * hoverable.
 */
export async function findSketchFacePoint(session: Session) {
  const { page } = session;
  const countBefore = await page.evaluate(timelineCount);
  // A selected planar face would start the sketch as soon as the tool is armed.
  await clearSelection(page);
  await page.locator('button[data-tool-id="sketch"]').click();
  const faces = await selectableTargets(page, /^body_[^.]+\.face_/);
  const found = await findHoverPoint(
    page,
    faces.slice(0, 24),
    (hovered) => /^body_[^.]+\.face_/.test(hovered),
    25,
  );
  if (!found) {
    await page.keyboard.press("Escape");
    return null;
  }
  await page.mouse.down();
  await page.mouse.up();
  await waitForMachine(page, "editingSketch");
  await exitSketch(session);
  await waitForOccQuiet(page);
  await deleteTimelineItemsAfter(page, countBefore);
  return found.hovered;
}

/**
 * Sketch tool armed, then a press on `face`. Entering a face sketch turns
 * the camera to it, so the face is searched under the pointer again.
 */
export async function enterFaceSketch(
  session: Session,
  face: string,
  timed: boolean,
) {
  const { page } = session;
  await clearSelection(page);
  await page.locator('button[data-tool-id="sketch"]').click();
  const seen = new Map<string, number>();
  const found = await findHoverPoint(
    page,
    [face],
    (hovered) => hovered === face,
    undefined,
    seen,
  );
  if (!found) {
    throw new Error(
      `${face} is no longer hoverable (projected: ${JSON.stringify(
        await page.evaluate(
          (id) =>
            (
              window as unknown as {
                __cadProjectToScreen?: (id: string) => unknown;
              }
            ).__cadProjectToScreen?.(id) ?? null,
          face,
        ),
      )}; hover targets seen: ${JSON.stringify(Object.fromEntries(seen))})`,
    );
  }
  await glideToHover(page, found.at, face);
  const act = async () => {
    await page.mouse.down();
    await page.mouse.up();
  };
  const reflected = () => waitForMachine(page, "editingSketch");
  if (timed) return timedSample(session, act, reflected, "none");
  await act();
  await reflected();
  return null;
}

/** A finished face sketch holding one rectangle; its timeline aria label. */
export async function createFaceSketch(session: Session, face: string) {
  const { page } = session;
  await enterFaceSketch(session, face, false);
  await drawRectangle(session, false);
  await exitSketch(session);
  await waitForOccQuiet(page);
  return (await page
    .locator("button[data-history-sketch-id]")
    .last()
    .getAttribute("aria-label"))!;
}

/** Double-clicks a timeline sketch (gliding onto it first) until editing. */
async function reopenSketch(
  session: Session,
  ariaLabel: string,
  timed = false,
) {
  const { page } = session;
  const entry = page.locator(`button[aria-label="${ariaLabel}"]`);
  await glideOnto(page, entry);
  const act = () => entry.dblclick();
  const reflected = () => waitForMachine(page, "editingSketch");
  if (timed) return timedSample(session, act, reflected, "none");
  await act();
  await reflected();
  await waitForOccQuiet(page);
  return null;
}

async function firstSketchLabel(page: Page) {
  return page
    .locator("button[data-history-sketch-id]")
    .first()
    .getAttribute("aria-label");
}

/** The serialized dimensions of the open sketch's authored definition. */
const sketchDimensionsJson = () =>
  JSON.stringify(
    (
      window as unknown as {
        __cadaraDebug?: {
          getSketchSnapshot(): {
            definition?: { dimensions?: unknown };
          } | null;
        };
      }
    ).__cadaraDebug?.getSketchSnapshot()?.definition?.dimensions ?? null,
  );

/**
 * The first visible dimension chip of the open sketch and a value editor:
 * `edit(deeper)` double-clicks the chip (gliding onto it) and fills its
 * value input with 10% more than the opened value (`deeper`) or the
 * opened text (an expression stays an expression), and resolves to the
 * input; Enter commits. Null when the sketch shows no dimension chip.
 */
async function prepareDimensionEdit(page: Page) {
  const chips = page.locator(DIMENSION_CHIP);
  const count = await chips.count();
  let id: string | null = null;
  for (let index = 0; index < count && !id; index += 1) {
    if (await chips.nth(index).isVisible())
      id = await chips.nth(index).getAttribute("data-sketch-annotation-id");
  }
  if (!id) return null;
  const chip = page.locator(
    `button[data-sketch-annotation-id="${id}"][data-sketch-annotation-kind="dimension"]`,
  );
  let original: { text: string; value: number } | null = null;
  return async (deeper: boolean) => {
    await glideOnto(page, chip);
    // The chip is replaced by the value input once double-clicked.
    const chipText = original ? "" : await chip.innerText();
    await chip.dblclick();
    const input = page.locator(FLOATING_INPUT).first();
    await input.waitFor({ timeout: 15_000 });
    if (!original) {
      const text = await input.inputValue();
      // An expression-bound value shows its expression; its chip shows the
      // evaluated number (the last number of its text).
      const value = Number.isFinite(Number(text))
        ? Number(text)
        : Number(chipText.match(/-?\d+(\.\d+)?/g)?.at(-1));
      if (!Number.isFinite(value) || value === 0) {
        throw new Error(
          `dimension chip ${id} has no numeric value (input "${text}", chip "${chipText}")`,
        );
      }
      original = { text, value };
    }
    await input.fill(
      deeper
        ? String(Number((original.value * 1.1).toFixed(4)))
        : original.text,
    );
    return input;
  };
}

/**
 * One sample in a scratch Top-plane sketch: `body` acts in the open sketch
 * (drawing its untimed geometry first); the sketch is then finished and
 * removed from the timeline again, so every sample starts idle on the
 * opened document (the viewport's render-idle signal needs an idle editor).
 */
async function inScratchTopSketch(
  session: Session,
  body: () => Promise<SampleTiming>,
) {
  const { page } = session;
  const countBefore = await page.evaluate(timelineCount);
  await enterTopSketch(session, false);
  const timing = await body();
  await settleBeforeCleanup(page, timing, false);
  await page.keyboard.press("Escape");
  await exitSketch(session);
  await waitForOccQuiet(page);
  await deleteTimelineItemsAfter(page, countBefore);
  return timing;
}

/** Untimed Ctrl+Z inside the sketch session. */
function undoInSketch(page: Page) {
  return untimedHistoryAction(page, () => page.keyboard.press("Control+z"));
}

/** A sloped line drawn with the Line tool (untimed), back to Select. */
async function drawSlopedLine(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await activateTool(page, LINE_TOOL);
  await glideClickCanvas(page, from);
  await untimedHistoryAction(page, () => glideClickCanvas(page, to));
  // The first Escape ends the chain, the second leaves the Line tool.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

const pointsJson = () =>
  JSON.stringify(
    (
      window as unknown as {
        __cadaraDebug?: {
          getSketchSnapshot(): { points?: unknown } | null;
        };
      }
    ).__cadaraDebug?.getSketchSnapshot()?.points ?? null,
  );

export async function prepareSketchRow(
  session: Session,
  kind: SketchRowKind,
): Promise<RowPreparation> {
  const { page } = session;
  switch (kind) {
    case "sketchCreate":
      return async () => {
        const timing = await enterTopSketch(session, true);
        await exitSketch(session);
        return timing!;
      };
    case "sketchDraw":
      return async () => {
        await enterTopSketch(session, false);
        const timing = await drawRectangle(session);
        await exitSketch(session);
        return timing;
      };
    case "sketchExit":
      return async () => {
        await enterTopSketch(session, false);
        await drawRectangle(session, false);
        return (await exitSketch(session, true))!;
      };
    case "sketchCreateOnFace":
    case "sketchExitFace": {
      const face = await findSketchFacePoint(session);
      if (!face) return "no body face is hoverable with the Sketch tool armed";
      const countBefore = await page.evaluate(timelineCount);
      return async () => {
        let timing: SampleTiming;
        if (kind === "sketchCreateOnFace") {
          timing = (await enterFaceSketch(session, face, true))!;
          await settleBeforeCleanup(page, timing, false);
          await exitSketch(session);
        } else {
          await enterFaceSketch(session, face, false);
          await drawRectangle(session, false);
          timing = (await exitSketch(session, true))!;
          await settleBeforeCleanup(page, timing);
        }
        await waitForOccQuiet(page);
        await deleteTimelineItemsAfter(page, countBefore);
        return timing;
      };
    }
    case "sketchExitUnchanged":
    case "sketchExitUnchangedFace": {
      let label: string | null;
      if (kind === "sketchExitUnchanged") {
        label = await firstSketchLabel(page);
        if (!label) return "the timeline has no sketch";
      } else {
        const face = await findSketchFacePoint(session);
        if (!face)
          return "no body face is hoverable with the Sketch tool armed";
        label = await createFaceSketch(session, face);
      }
      return async () => {
        await reopenSketch(session, label);
        return (await exitSketch(session, true))!;
      };
    }
    case "sketchEditUpstream": {
      const label = await firstSketchLabel(page);
      if (!label) return "the timeline has no sketch";
      await reopenSketch(session, label);
      const edit = await prepareDimensionEdit(page);
      await exitSketch(session);
      await waitForOccQuiet(page);
      if (!edit) return "the first sketch shows no dimension chip";
      return async (_session, index) => {
        await reopenSketch(session, label);
        // Every other sample restores the opened value (as extrudeDepth).
        const input = await edit(index % 2 === 0);
        await untimedHistoryAction(page, () => input.press("Enter"));
        await waitForOccQuiet(page);
        const revision = await debugStateField(page, "revision");
        return timedSample(
          session,
          () => activateTool(page, EXIT_SKETCH_TOOL),
          () =>
            waitInPage(
              page,
              (revision: string) => {
                const state = (
                  window as unknown as {
                    __cadaraDebug?: {
                      getState(): {
                        machineState: string;
                        revision: string;
                      } | null;
                    };
                  }
                ).__cadaraDebug?.getState();
                return (
                  !!state &&
                  state.machineState.includes("idle") &&
                  state.revision !== revision
                );
              },
              revision,
            ),
        );
      };
    }
    case "sketchDimensionEdit": {
      const label = await firstSketchLabel(page);
      if (!label) return "the timeline has no sketch";
      await reopenSketch(session, label);
      const edit = await prepareDimensionEdit(page);
      await exitSketch(session);
      await waitForOccQuiet(page);
      if (!edit) return "the first sketch shows no dimension chip";
      return async (_session, index) => {
        await reopenSketch(session, label);
        // Every other sample restores the opened value (as extrudeDepth).
        const input = await edit(index % 2 === 0);
        const before = await page.evaluate(sketchDimensionsJson);
        const timing = await timedSample(
          session,
          () => input.press("Enter"),
          () =>
            waitInPage(
              page,
              (before: string) =>
                JSON.stringify(
                  (
                    window as unknown as {
                      __cadaraDebug?: {
                        getSketchSnapshot(): {
                          definition?: { dimensions?: unknown };
                        } | null;
                      };
                    }
                  ).__cadaraDebug?.getSketchSnapshot()?.definition
                    ?.dimensions ?? null,
                ) !== before,
              before,
            ),
        );
        await settleBeforeCleanup(page, timing, false);
        await exitSketch(session);
        return timing;
      };
    }
    // A rectangle's sides already carry Horizontal/Vertical requirements,
    // so the Horizontal is added to a sloped line instead.
    case "sketchConstraintAdd": {
      const line = [
        { x: 700, y: 400 },
        { x: 1000, y: 460 },
      ] as const;
      const middle = {
        x: (line[0].x + line[1].x) / 2,
        y: (line[0].y + line[1].y) / 2,
      };
      return () =>
        inScratchTopSketch(session, async () => {
          await drawSlopedLine(page, line[0], line[1]);
          const rows = await page
            .locator("[data-sketch-constraint-row]")
            .count();
          await activateTool(page, HORIZONTAL_TOOL);
          const at = await canvasPoint(page, middle);
          await page.mouse.move(at.x, at.y, { steps: 8 });
          await animationFrames(page);
          return timedSample(
            session,
            async () => {
              await page.mouse.down();
              await page.mouse.up();
            },
            () =>
              waitInPage(
                page,
                (rows: number) =>
                  document.querySelectorAll("[data-sketch-constraint-row]")
                    .length > rows,
                rows,
              ),
          );
        });
    }
    case "sketchEntityDelete": {
      const left = {
        x: RECTANGLE[0].x,
        y: (RECTANGLE[0].y + RECTANGLE[1].y) / 2,
      };
      return () =>
        inScratchTopSketch(session, async () => {
          await drawRectangle(session, false);
          const staged = await stagedEntityCount(page);
          await glideClickCanvas(page, left);
          await waitInPage(
            page,
            () =>
              (
                window as unknown as {
                  __cadaraDebug?: {
                    getState(): { selectionCount: number } | null;
                  };
                }
              ).__cadaraDebug?.getState()?.selectionCount === 1,
            null,
          );
          return timedSample(
            session,
            () => page.keyboard.press("Delete"),
            () =>
              waitInPage(page, debugStateContains, {
                field: "sketchSession",
                text: `${staged - 1} entities staged`,
              }),
          );
        });
    }
    case "sketchUndo":
    case "sketchRedo": {
      const stagedChanged = (staged: number) => {
        const session = String(
          (
            window as unknown as {
              __cadaraDebug?: {
                getState(): { sketchSession: string } | null;
              };
            }
          ).__cadaraDebug?.getState()?.sketchSession ?? "",
        );
        return (
          Number(/(\d+) entities staged/.exec(session)?.[1] ?? 0) !== staged
        );
      };
      return () =>
        inScratchTopSketch(session, async () => {
          // The undone action is an untimed rectangle ("Create Sketch Geometry").
          await drawRectangle(session, false);
          await waitForOccQuiet(page);
          if (kind === "sketchRedo") await undoInSketch(page);
          const staged = await stagedEntityCount(page);
          return timedSample(
            session,
            () =>
              page.keyboard.press(
                kind === "sketchUndo" ? "Control+z" : "Control+Shift+z",
              ),
            () => waitInPage(page, stagedChanged, staged),
          );
        });
    }
    case "sketchDragPoint": {
      const corner = RECTANGLE[1];
      const dropped = { x: corner.x + 40, y: corner.y + 40 };
      const steps = 24;
      return () =>
        inScratchTopSketch(session, async () => {
          await drawRectangle(session, false);
          await waitForOccQuiet(page);
          const start = await canvasPoint(page, corner);
          const end = await canvasPoint(page, dropped);
          await page.mouse.move(start.x, start.y, { steps: 8 });
          await animationFrames(page);
          await startFrameProbe(page, pointsJson);
          const timing = await timedSample(
            session,
            async () => {
              await page.mouse.down();
              await page.mouse.move(end.x, end.y, { steps });
              await animationFrames(page);
              await page.mouse.up();
            },
            // The sketch shows the corner's final position: the last change
            // of the solved points the per-frame probe saw (after release).
            async () => {
              await animationFrames(page, 3);
              const { changes } = await stopFrameProbe(page);
              const last = changes.at(-1);
              if (!last) throw new Error("the dragged corner never moved");
              return last.atMs;
            },
          );
          // Long Animation Frames of the drag are the sample's `frames`.
          const probe = await page.evaluate(
            () =>
              (
                window as unknown as {
                  __benchFrameProbe: {
                    changes: { sinceMoveMs: number | null }[];
                    frames: number[];
                  };
                }
              ).__benchFrameProbe,
          );
          const perMove = medianAndP95(
            probe.changes.flatMap((change) => change.sinceMoveMs ?? []),
          );
          timing.metrics = {
            dragSteps: steps,
            pointChanges: probe.changes.length,
            perMoveReflectedMedianMs: perMove.median,
            perMoveReflectedP95Ms: perMove.p95,
            probedFrames: probe.frames.length,
          };
          return timing;
        });
    }
  }
}
