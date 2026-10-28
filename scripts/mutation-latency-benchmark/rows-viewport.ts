// Selection and viewport rows of `bun run bench:mutation`: selecting in
// Parts & Objects and the viewport (with the Measure readout), hover,
// orbit and visibility. They read the debug platform
// (`window.__cadaraDebug`), so they need the TEST build.
import type { Page } from "@playwright/test";

import {
  animationFrames,
  canvasPoint,
  clearSelection,
  debugStateContains,
  findHoverPoint,
  firstBodyRow,
  glideOnto,
  glideToHover,
  hoverTarget,
  historySignature,
  medianAndP95,
  now,
  partsTree,
  round,
  selectTarget,
  selectableTargets,
  settleBeforeCleanup,
  startFrameProbe,
  startWatch,
  stopFrameProbe,
  timedSample,
  waitForHistoryChange,
  waitForOccQuiet,
  waitForWatch,
  waitInPage,
  type RowPreparation,
  type SampleTiming,
  type Session,
} from "./rows-shared.ts";

export const VIEWPORT_ROW_KINDS = [
  "selectBodyTree",
  "selectFaceViewport",
  "selectEdgeViewport",
  "hoverViewport",
  "orbit",
  "visibilityToggle",
] as const;
export type ViewportRowKind = (typeof VIEWPORT_ROW_KINDS)[number];

/** The plain-selection Measure readout lists at least one measured value. */
const measureReadoutShown = () =>
  Array.from(
    document.querySelectorAll("[data-measurement-panel] .tabular-nums"),
  ).some((value) => (value.textContent ?? "").trim() !== "");

const selectionContains = (page: Page, id: string) =>
  waitInPage(page, debugStateContains, { field: "selectionTargets", text: id });

/**
 * A selection sample: `act` selects `id`; reflected is the debug selection
 * listing it; `measureReadoutMs` is when the Measure readout showed a
 * value. Clears the selection afterwards.
 */
async function selectionSample(
  session: Session,
  id: string,
  act: () => Promise<void>,
  metrics: Record<string, number | null> = {},
) {
  const { page } = session;
  await startWatch(page, "measureReadout", measureReadoutShown, null);
  const timing = await timedSample(
    session,
    act,
    () => selectionContains(page, id),
    "none",
  );
  const readoutAt = await waitForWatch(page, "measureReadout");
  timing.metrics = {
    ...metrics,
    measureReadoutMs: round(readoutAt - timing.startMs),
  };
  await settleBeforeCleanup(page, timing);
  await clearSelection(page);
  return timing;
}

/**
 * Viewport selection of a face/edge: a real press where the hover target
 * is one (hover search around the projected points), otherwise the debug
 * selection (metric `viaDebugSelect` = 1).
 */
async function prepareViewportSelection(
  session: Session,
  pattern: RegExp,
  what: string,
): Promise<RowPreparation> {
  const { page } = session;
  const targets = await selectableTargets(page, pattern);
  if (targets.length === 0) return `no selectable body ${what}`;
  const found = await findHoverPoint(
    page,
    targets.slice(0, 8),
    (hovered) => pattern.test(hovered),
    40,
  );
  if (!found) {
    return async () =>
      selectionSample(
        session,
        targets[0]!,
        async () => void (await selectTarget(page, targets[0]!)),
        { viaDebugSelect: 1 },
      );
  }
  return async () => {
    await glideToHover(page, found.at, found.hovered);
    return selectionSample(
      session,
      found.hovered,
      async () => {
        await page.mouse.down();
        await page.mouse.up();
      },
      { viaDebugSelect: 0 },
    );
  };
}

const hoverTargetValue = () =>
  String(
    (
      window as unknown as {
        __cadaraDebug?: { getState(): { hoverTarget: string } | null };
      }
    ).__cadaraDebug?.getState()?.hoverTarget ?? "",
  );

const cameraValue = () =>
  JSON.stringify(
    (
      window as unknown as { __cadReadCamera?: () => unknown }
    ).__cadReadCamera?.() ?? null,
  );

/** Frame intervals (ms) between consecutive probed animation frames. */
const frameIntervals = (frames: readonly number[]) =>
  frames.slice(1).map((at, index) => at - frames[index]!);

export async function prepareViewportRow(
  session: Session,
  kind: ViewportRowKind,
): Promise<RowPreparation> {
  const { page } = session;
  switch (kind) {
    case "selectBodyTree": {
      const body = await firstBodyRow(page);
      const id = body.target.replace(/^body:/, "");
      const button = partsTree(page)
        .locator(`[data-parts-tree-target="${body.target}"]`)
        .getByRole("button")
        .first();
      return async () => {
        await glideOnto(page, button);
        return selectionSample(session, id, () => button.click());
      };
    }
    case "selectFaceViewport":
      return prepareViewportSelection(session, /^body_[^.]+\.face_/, "face");
    case "selectEdgeViewport":
      return prepareViewportSelection(session, /^body_[^.]+\.edge_/, "edge");
    case "hoverViewport": {
      const centre = await page.evaluate(() => {
        const canvas = document.querySelector("main canvas")!;
        const box = canvas.getBoundingClientRect();
        return { x: box.width / 2, y: box.height / 2 };
      });
      // A 600 px diagonal through the centre crosses faces and edges of
      // the model (a 300 px horizontal stayed on one enclosure face).
      const steps = 30;
      const span = 600;
      return async (_session, index) => {
        // Every other sample glides back.
        const direction = index % 2 === 0 ? 1 : -1;
        const from = await canvasPoint(page, {
          x: centre.x - (direction * span) / 2,
          y: centre.y - (direction * span) / 4,
        });
        await page.mouse.move(from.x, from.y, { steps: 8 });
        await animationFrames(page, 3);
        await startFrameProbe(page, hoverTargetValue);
        const timing = await timedSample(
          session,
          async () => {
            for (let step = 1; step <= steps; step += 1) {
              await page.mouse.move(
                from.x + (direction * span * step) / steps,
                from.y + (direction * span * step) / (2 * steps),
              );
              await animationFrames(page);
            }
          },
          // The hover shown at the end of the glide: its last change.
          async () => {
            await animationFrames(page, 3);
            const { changes } = await stopFrameProbe(page);
            const last = changes.at(-1);
            if (!last)
              throw new Error(
                `the hover target never changed along the glide (stayed "${await hoverTarget(page)}")`,
              );
            return last.atMs;
          },
          "none",
        );
        const probe = await page.evaluate(
          () =>
            (
              window as unknown as {
                __benchFrameProbe: {
                  changes: { sinceMoveMs: number | null }[];
                };
              }
            ).__benchFrameProbe,
        );
        const perStep = medianAndP95(
          probe.changes.flatMap((change) => change.sinceMoveMs ?? []),
        );
        timing.metrics = {
          glideSteps: steps,
          hoverChanges: probe.changes.length,
          hoverStepMedianMs: perStep.median,
          hoverStepP95Ms: perStep.p95,
        };
        return timing;
      };
    }
    case "orbit": {
      if ((await page.evaluate(cameraValue)) === "null")
        return "window.__cadReadCamera is not exposed";
      const centre = await page.evaluate(() => {
        const box = document
          .querySelector("main canvas")!
          .getBoundingClientRect();
        return { x: box.width / 2, y: box.height / 2 };
      });
      const steps = 30;
      const span = 300;
      // OrbitControls: right button rotates, middle pans, left is the
      // workbench's selection (three-cad-viewport.tsx mouseButtons).
      return async (_session, index) => {
        const direction = index % 2 === 0 ? 1 : -1;
        const from = await canvasPoint(page, {
          x: centre.x - (direction * span) / 2,
          y: centre.y,
        });
        await page.mouse.move(from.x, from.y, { steps: 8 });
        // The previous sample's orbit keeps damping; drain it first
        // (OrbitControls damps per frame, acceptance.ts settledProjections).
        await page.evaluate(() =>
          (
            window as unknown as { __cadFlushCameraDamping?: () => boolean }
          ).__cadFlushCameraDamping?.(),
        );
        await animationFrames(page, 3);
        await startFrameProbe(page, cameraValue);
        let pressedAt = 0;
        let releasedAt = 0;
        const timing = await timedSample(
          session,
          async () => {
            pressedAt = now();
            await page.mouse.down({ button: "right" });
            await page.mouse.move(from.x + direction * span, from.y, {
              steps,
            });
            await page.mouse.up({ button: "right" });
            releasedAt = now();
          },
          // The first frame that shows the camera moved.
          async () => {
            await animationFrames(page, 3);
            const { changes } = await stopFrameProbe(page);
            const first = changes.find((change) => change.atMs >= pressedAt);
            if (!first) throw new Error("the camera never moved");
            return first.atMs;
          },
          "none",
        );
        const probe = await page.evaluate(
          () =>
            (
              window as unknown as {
                __benchFrameProbe: {
                  frames: number[];
                  changes: { atMs: number }[];
                };
              }
            ).__benchFrameProbe,
        );
        const dragFrames = probe.frames.filter((at) => at <= releasedAt);
        const intervals = medianAndP95(frameIntervals(dragFrames));
        timing.metrics = {
          dragSteps: steps,
          dragFrames: dragFrames.length,
          frameIntervalMedianMs: intervals.median,
          frameIntervalP95Ms: intervals.p95,
          cameraChanges: probe.changes.length,
        };
        // A context menu opened by the right button would hold the next sample.
        await page.keyboard.press("Escape");
        return timing;
      };
    }
    case "visibilityToggle": {
      const body = await firstBodyRow(page);
      const row = partsTree(page).locator(
        `[data-parts-tree-target="${body.target}"]`,
      );
      const hiddenIs = ({
        target,
        hidden,
      }: {
        target: string;
        hidden: boolean;
      }) =>
        (document
          .querySelector(`[data-parts-tree-target="${target}"]`)
          ?.getAttribute("data-hidden") ===
          "true") ===
        hidden;
      const toggle = async (hide: boolean) => {
        // The eye toggle shows on hover: glide onto the row first.
        await glideOnto(page, row);
        const button = row.getByRole("button", {
          name: `${hide ? "Hide" : "Show"} ${body.label}`,
          exact: true,
        });
        await glideOnto(page, button);
        return button;
      };
      // Untimed probe: is hiding an undoable action (listed in the strip)?
      const before = await historySignature(page);
      const since = now();
      await (await toggle(true)).click();
      await waitInPage(page, hiddenIs, { target: body.target, hidden: true });
      await (await toggle(false)).click();
      await waitInPage(page, hiddenIs, { target: body.target, hidden: false });
      await waitForOccQuiet(page);
      const undoable = (await historySignature(page)) !== before;
      if (undoable) await waitForHistoryChange(page, before, since);
      return async () => {
        const hide = await toggle(true);
        const timing: SampleTiming = await timedSample(
          session,
          () => hide.click(),
          () =>
            waitInPage(page, hiddenIs, { target: body.target, hidden: true }),
          undoable ? "history" : "none",
        );
        await settleBeforeCleanup(page, timing);
        await (await toggle(false)).click();
        await waitInPage(page, hiddenIs, {
          target: body.target,
          hidden: false,
        });
        return timing;
      };
    }
  }
}
