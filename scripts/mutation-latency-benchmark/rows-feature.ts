// Feature and timeline rows of `bun run bench:mutation`: feature edits,
// previews and commits, and timeline gestures (reopen, cancel, suppress,
// delete, cursor moves, undo/redo of edits). The preview/commit, reopen,
// suppress and face-sketch rows read the debug platform
// (`window.__cadaraDebug`), so they need the TEST build.
import type { Page } from "@playwright/test";

import {
  activateTool,
  debugStateContains,
  deleteTimelineItemsAfter,
  finalRevisionSignal,
  findHoverPoint,
  glideOnto,
  glideToHover,
  hideBody,
  historySignature,
  now,
  partsTree,
  previewDiagnostics,
  redoButton,
  selectTarget,
  selectableTargets,
  settleBeforeCleanup,
  timedSample,
  timelineCount,
  timelineCountChanged,
  timelineItems,
  undoButton,
  undoUntimed,
  untimedHistoryAction,
  waitForHistoryChange,
  waitForMachine,
  waitForOccQuiet,
  waitInPage,
  SAMPLE_TIMEOUT_MS,
  type RowPreparation,
  type SampleTiming,
  type Session,
} from "./rows-shared.ts";
import {
  createFaceSketch,
  drawRectangle,
  enterTopSketch,
  exitSketch,
  findSketchFacePoint,
} from "./rows-sketch.ts";

export const FEATURE_ROW_KINDS = [
  "extrudeDepth",
  "featureAdd",
  "featureDelete",
  "cursorMove",
  "depthUndo",
  "depthRedo",
  "chamferPreview",
  "chamferCommit",
  "extrudePreview",
  "extrudeCommit",
  "filletPreview",
  "filletCommit",
  "shellPreview",
  "featureReopen",
  "featureReopenCancel",
  "featureSuppress",
  "featureUnsuppress",
  "featureDeleteMid",
  "featureEditUndo",
  "featureEditUndoFaceSketch",
] as const;
export type FeatureRowKind = (typeof FEATURE_ROW_KINDS)[number];

const EXTRUDE_TOOL = "Create an extruded solid or surface.";
/** Canvas corners of candidate extruded rectangles, off the model. */
const AWAY_RECTANGLES = [
  [
    { x: 1250, y: 450 },
    { x: 1450, y: 600 },
  ],
  [
    { x: 1330, y: 640 },
    { x: 1480, y: 760 },
  ],
  [
    { x: 330, y: 640 },
    { x: 480, y: 760 },
  ],
] as const;

interface NativeDocumentFeature {
  label: string;
  definition: {
    kind: string;
    parameters?: { extent?: { end?: { distance?: { source?: string } } } };
  };
}

/**
 * The last extrude whose depth is a literal: expression-bound depths are
 * read-only in the inspector (edited through variables instead).
 */
function lastLiteralDepthExtrude(document: Buffer) {
  const { features } = JSON.parse(document.toString("utf8")) as {
    features: NativeDocumentFeature[];
  };
  return features
    .filter(
      (feature) =>
        feature.definition.kind === "extrude" &&
        feature.definition.parameters?.extent?.end?.distance?.source ===
          "literal",
    )
    .at(-1)?.label;
}

async function addPlane(session: Session, timed: boolean) {
  const { page } = session;
  await page.locator('button[data-tool-id="plane"]').click();
  await partsTree(page)
    .locator('[data-parts-tree-target="construction:construction_plane-xy"]')
    .click();
  const commit = page.getByRole("button", { name: "Commit", exact: true });
  await commit.waitFor();
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === "Commit",
      );
      return (
        button !== undefined &&
        !button.disabled &&
        button.getAttribute("data-disabled") !== "true"
      );
    },
    undefined,
    { polling: 10, timeout: SAMPLE_TIMEOUT_MS },
  );
  const countBefore = await page.evaluate(timelineCount);
  const act = () => commit.click();
  const reflected = () =>
    waitInPage(page, timelineCountChanged, { count: countBefore, grew: true });
  if (timed) return timedSample(session, act, reflected);
  const before = await historySignature(page);
  const since = now();
  await act();
  await reflected();
  await waitForHistoryChange(page, before, since);
  return null;
}

/**
 * Reopens the last literal-depth extrude and fills a new depth (10% deeper
 * than the opened document's, or that original); resolves to its Commit
 * button.
 */
function prepareDepthEdit(session: Session) {
  const { page } = session;
  const extrude = lastLiteralDepthExtrude(session.document);
  if (!extrude) return "no extrude with a literal depth";
  const label = `Select ${extrude}. Double-click to reopen.`;
  let original: number | null = null;
  return async (deeper: boolean) => {
    await page
      .getByRole("button", { name: label, exact: true })
      .dblclick({ force: true });
    const depth = page.locator("#extrude-depth");
    await depth.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
    original ??= Number(await depth.inputValue());
    const next = deeper ? original * 1.1 : original;
    await depth.fill(String(Number(next.toFixed(4))));
    return page.getByRole("button", { name: "Commit", exact: true });
  };
}

async function waitForInspectorClosed(page: Page, inputId: string) {
  return waitInPage(
    page,
    (id: string) => document.getElementById(id) === null,
    inputId,
  );
}

const commitButton = (page: Page) =>
  page.getByRole("button", { name: "Commit", exact: true });

async function cancelFeature(page: Page) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await waitForMachine(page, "idle");
}

const featureSessionContains = (page: Page, text: string) =>
  waitInPage(page, debugStateContains, { field: "featureSession", text });

/** Throws when the open feature's preview reports an error. */
async function assertPreviewOk(page: Page, what: string) {
  const diagnostics = await previewDiagnostics(page);
  if (/\berror\b/i.test(diagnostics)) {
    throw new Error(`${what} preview failed: ${diagnostics}`);
  }
}

/**
 * Commit of the open feature (timeline +1), then an untimed Undo;
 * `settleFirst` records settled before the Undo (chamferCommit keeps its
 * original settled, which includes the Undo's rebuild).
 */
async function commitAndUndo(session: Session, settleFirst: boolean) {
  const { page } = session;
  const countBefore = await page.evaluate(timelineCount);
  const timing = await timedSample(
    session,
    () => commitButton(page).click(),
    () =>
      waitInPage(page, timelineCountChanged, {
        count: countBefore,
        grew: true,
      }),
  );
  if (settleFirst) await settleBeforeCleanup(page, timing);
  // Undo the feature so the next sample starts from the opened model.
  await undoUntimed(page);
  await waitInPage(page, timelineCountChanged, {
    count: countBefore + 1,
    grew: false,
  });
  return timing;
}

/**
 * Chamfer/fillet rows: the first selectable body edge whose preview is
 * clean (some enclosure edges reject the shape at any size), then a
 * preview (edge pick) or commit sample per call.
 */
async function prepareEdgeFeatureRow(
  session: Session,
  feature: { kind: "chamfer" | "fillet"; tool: string; field: string },
  commit: boolean,
): Promise<RowPreparation> {
  const { page } = session;
  const edges = await selectableTargets(page, /^body_[^.]+\.edge_/);
  if (edges.length === 0) return "no selectable body edge";
  const open = async () => {
    await activateTool(page, feature.tool);
    const field = page.getByRole("spinbutton", { name: feature.field });
    await field.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
    await field.fill("0.25");
  };
  const preview = () =>
    featureSessionContains(page, `create:${feature.kind}:previewReady`);
  // Untimed setup: the first edge OCC shapes cleanly.
  let edge: string | null = null;
  for (const candidate of edges.slice(0, 12)) {
    await open();
    await selectTarget(page, candidate);
    await preview();
    const diagnostics = await previewDiagnostics(page);
    await cancelFeature(page);
    await waitForOccQuiet(page);
    if (!/\berror\b/i.test(diagnostics)) {
      edge = candidate;
      break;
    }
  }
  if (!edge) return `no edge previews a clean ${feature.kind}`;
  return async () => {
    await open();
    if (!commit) {
      // The preview is not an undoable action: no persisted signal.
      const timing = await timedSample(
        session,
        async () => void (await selectTarget(page, edge)),
        preview,
        "none",
      );
      await assertPreviewOk(page, feature.kind);
      if (feature.kind !== "chamfer")
        await settleBeforeCleanup(page, timing, false);
      await cancelFeature(page);
      return timing;
    }
    await selectTarget(page, edge);
    await preview();
    await assertPreviewOk(page, feature.kind);
    return commitAndUndo(session, feature.kind !== "chamfer");
  };
}

/** The middle feature of the timeline (by order), as a stable locator. */
async function middleFeature(page: Page) {
  const features = page.locator("button[data-history-feature-id]");
  const count = await features.count();
  if (count < 3) return null;
  const id = (await features
    .nth(Math.floor(count / 2))
    .getAttribute("data-history-feature-id"))!;
  return {
    id,
    item: page.locator(`button[data-history-feature-id="${id}"]`),
  };
}

async function contextMenuItem(
  page: Page,
  item: ReturnType<Page["locator"]>,
  name: string,
) {
  await item.click({ button: "right", force: true });
  const entry = page.getByRole("menuitem", { name, exact: true });
  await entry.waitFor();
  return entry;
}

const suppressedIs = ({
  id,
  suppressed,
}: {
  id: string;
  suppressed: boolean;
}) =>
  (document
    .querySelector(`button[data-history-feature-id="${id}"]`)
    ?.getAttribute("data-history-feature-suppressed") ===
    "true") ===
  suppressed;

/** An edit inspector is open and its preview is ready. */
const editPreviewReady = () => {
  const session = String(
    (
      window as unknown as {
        __cadaraDebug?: { getState(): { featureSession: string } | null };
      }
    ).__cadaraDebug?.getState()?.featureSession ?? "",
  );
  return (
    session.startsWith("edit:") &&
    session.endsWith(":previewReady") &&
    Array.from(document.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Commit",
    )
  );
};

export async function prepareFeatureRow(
  session: Session,
  kind: FeatureRowKind,
): Promise<RowPreparation> {
  const { page } = session;
  switch (kind) {
    case "extrudeDepth": {
      const editDepth = prepareDepthEdit(session);
      if (typeof editDepth === "string") return editDepth;
      return async (_session, index) => {
        const commit = await editDepth(index % 2 === 0);
        return timedSample(
          session,
          () => commit.click(),
          () => waitForInspectorClosed(page, "extrude-depth"),
        );
      };
    }
    // Undo/Redo of a geometric change: the history restores the document
    // (cadara-jxe3), unlike the body rename that undo/redo time.
    case "depthUndo":
    case "depthRedo": {
      const editDepth = prepareDepthEdit(session);
      if (typeof editDepth === "string") return editDepth;
      const untimed = async (act: () => Promise<void>) => {
        const before = await historySignature(page);
        const since = now();
        await act();
        await waitForHistoryChange(page, before, since);
      };
      return async (_session, index) => {
        // Undo always returns to the original depth, so each edit deepens.
        const commit = await editDepth(kind === "depthUndo" || index % 2 === 0);
        await untimed(async () => {
          await commit.click();
          await waitForInspectorClosed(page, "extrude-depth");
        });
        if (kind === "depthUndo") {
          return timedSample(session, () => undoButton(page).click(), null);
        }
        await untimed(() => undoButton(page).click());
        return timedSample(session, () => redoButton(page).click(), null);
      };
    }
    case "featureEditUndo":
    case "featureEditUndoFaceSketch": {
      const editDepth = prepareDepthEdit(session);
      if (typeof editDepth === "string") return editDepth;
      if (kind === "featureEditUndoFaceSketch") {
        // A face sketch after the edited extrude: Undo re-resolves its plane.
        const face = await findSketchFacePoint(session);
        if (!face)
          return "no body face is hoverable with the Sketch tool armed";
        await createFaceSketch(session, face);
      }
      return async () => {
        const commit = await editDepth(true);
        await untimedHistoryAction(page, async () => {
          await commit.click();
          await waitForInspectorClosed(page, "extrude-depth");
        });
        await waitForOccQuiet(page);
        // Reflected: the document revision the undo restores is shown.
        return timedSample(
          session,
          () => undoButton(page).click(),
          await finalRevisionSignal(page),
        );
      };
    }
    case "featureAdd":
      return async () => (await addPlane(session, true))!;
    case "featureDelete":
      return async () => {
        await addPlane(session, false);
        const remove = await contextMenuItem(
          page,
          timelineItems(page).last(),
          "Delete",
        );
        const countBefore = await page.evaluate(timelineCount);
        return timedSample(
          session,
          () => remove.click(),
          () =>
            waitInPage(page, timelineCountChanged, {
              count: countBefore,
              grew: false,
            }),
        );
      };
    case "cursorMove": {
      const count = await timelineItems(page).count();
      if (count < 2) return "timeline has fewer than two items";
      const cursor = page.locator('[aria-label^="Timeline cursor "]');
      return async (_session, index) => {
        const rollBack = index % 2 === 0;
        const item = await contextMenuItem(
          page,
          timelineItems(page).nth(rollBack ? count - 2 : 0),
          rollBack ? "Roll History Here" : "Roll To End",
        );
        const before = await cursor.getAttribute("aria-label");
        // Cursor moves are not undoable actions: no persisted signal in the UI.
        return timedSample(
          session,
          () => item.click(),
          () =>
            waitInPage(
              page,
              (label: string | null) =>
                document
                  .querySelector('[aria-label^="Timeline cursor "]')
                  ?.getAttribute("aria-label") !== label,
              before,
            ),
          "none",
        );
      };
    }
    case "chamferPreview":
    case "chamferCommit":
      return prepareEdgeFeatureRow(
        session,
        { kind: "chamfer", tool: "Bevel selected edges.", field: "Distance" },
        kind === "chamferCommit",
      );
    case "filletPreview":
    case "filletCommit":
      return prepareEdgeFeatureRow(
        session,
        { kind: "fillet", tool: "Round selected edges.", field: "Radius" },
        kind === "filletCommit",
      );
    case "extrudePreview":
    case "extrudeCommit": {
      // Untimed setup: a finished Top-plane sketch with one rectangle off
      // the model, and the viewport point where its region is hovered. A
      // body above the rectangle owns the hover, so candidate placements
      // are tried in turn (each failed sketch is deleted again), then the
      // same after hiding the bodies that took the hover. When no region
      // is ever hovered (the large fixture's sheet bodies cover all three
      // placements), the region is picked through the debug selection
      // (metric `viaDebugSelect` = 1).
      const countBefore = await page.evaluate(timelineCount);
      const seen = new Map<string, number>();
      const drawRegionSketch = async (
        corners: (typeof AWAY_RECTANGLES)[number],
      ) => {
        await enterTopSketch(session, false);
        await drawRectangle(session, false, corners);
        await exitSketch(session);
        await waitForOccQuiet(page);
        const sketchId = (await page
          .locator("button[data-history-sketch-id]")
          .last()
          .getAttribute("data-history-sketch-id"))!;
        await activateTool(page, EXTRUDE_TOOL);
        const regions = await selectableTargets(
          page,
          new RegExp(
            `^${sketchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.region_`,
          ),
        );
        return regions;
      };
      const findRegion = async () => {
        for (const corners of AWAY_RECTANGLES) {
          const regions = await drawRegionSketch(corners);
          const found = await findHoverPoint(
            page,
            regions,
            (hovered, id) => hovered === id,
            undefined,
            seen,
          );
          await cancelFeature(page);
          await waitForOccQuiet(page);
          if (found) return found;
          await deleteTimelineItemsAfter(page, countBefore);
        }
        return null;
      };
      let found = await findRegion();
      // As the acceptance rows do, a user hides the bodies in front of the
      // region (Parts & Objects eye); they stay hidden for the row.
      const occluding = [
        ...new Set(
          [...seen.keys()].flatMap(
            (hovered) => /^body_[^.]+/.exec(hovered)?.[0] ?? [],
          ),
        ),
      ];
      if (!found && occluding.length > 0) {
        for (const body of occluding) await hideBody(page, body);
        found = await findRegion();
      }
      let pickRegion: () => Promise<void>;
      let aim: () => Promise<void>;
      if (found) {
        const pickAt = found;
        aim = () => glideToHover(page, pickAt.at, pickAt.hovered);
        pickRegion = async () => {
          await page.mouse.down();
          await page.mouse.up();
        };
      } else {
        const [region] = await drawRegionSketch(AWAY_RECTANGLES[0]);
        await cancelFeature(page);
        await waitForOccQuiet(page);
        if (!region) return "the new rectangle sketch has no selectable region";
        aim = async () => {};
        pickRegion = async () => void (await selectTarget(page, region));
      }
      const viaDebugSelect = found ? 0 : 1;
      const preview = () =>
        featureSessionContains(page, "create:extrude:previewReady");
      return async () => {
        await activateTool(page, EXTRUDE_TOOL);
        await aim();
        if (kind === "extrudePreview") {
          const timing = await timedSample(
            session,
            pickRegion,
            preview,
            "none",
          );
          timing.metrics = { viaDebugSelect };
          await assertPreviewOk(page, "extrude");
          await settleBeforeCleanup(page, timing, false);
          await cancelFeature(page);
          return timing;
        }
        await pickRegion();
        await preview();
        await assertPreviewOk(page, "extrude");
        const timing = await commitAndUndo(session, true);
        timing.metrics = { viaDebugSelect };
        return timing;
      };
    }
    case "shellPreview": {
      const [body] = await selectableTargets(page, /^body_[^.]+$/);
      if (!body) return "no selectable body";
      const faces = await selectableTargets(
        page,
        new RegExp(`^${body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.face_`),
      );
      const open = async () => {
        await activateTool(page, "Hollow a solid body.");
        const thickness = page.getByRole("spinbutton", { name: "Thickness" });
        await thickness.waitFor({ timeout: SAMPLE_TIMEOUT_MS });
        await thickness.fill("1");
        await selectTarget(page, body);
      };
      const preview = () =>
        featureSessionContains(page, "create:shell:previewReady");
      let face: string | null = null;
      for (const candidate of faces.slice(0, 12)) {
        await open();
        await selectTarget(page, candidate);
        await preview();
        const diagnostics = await previewDiagnostics(page);
        await cancelFeature(page);
        await waitForOccQuiet(page);
        if (!/\berror\b/i.test(diagnostics)) {
          face = candidate;
          break;
        }
      }
      if (!face)
        return `no clean shell preview on the first ${Math.min(12, faces.length)} faces of ${body}`;
      return async () => {
        await open();
        await waitForOccQuiet(page);
        const timing = await timedSample(
          session,
          async () => void (await selectTarget(page, face)),
          preview,
          "none",
        );
        await assertPreviewOk(page, "shell");
        await settleBeforeCleanup(page, timing, false);
        await cancelFeature(page);
        return timing;
      };
    }
    case "featureReopen":
    case "featureReopenCancel": {
      const middle = await middleFeature(page);
      if (!middle) return "timeline has fewer than three features";
      const cursor = page.locator('[aria-label^="Timeline cursor "]');
      // Forced like extrudeDepth's reopen: an unforced double-click on the
      // glided-onto item timed out in Playwright's actionability checks.
      const reopen = () => middle.item.dblclick({ force: true });
      return async () => {
        await glideOnto(page, middle.item);
        if (kind === "featureReopen") {
          // The reopen rolls the cursor back and previews: not undoable.
          const timing = await timedSample(
            session,
            reopen,
            () => waitInPage(page, editPreviewReady, null),
            "none",
          );
          await settleBeforeCleanup(page, timing, false);
          await cancelFeature(page);
          return timing;
        }
        const atEnd = await cursor.getAttribute("aria-label");
        await reopen();
        await waitInPage(page, editPreviewReady, null);
        return timedSample(
          session,
          () =>
            page.getByRole("button", { name: "Cancel", exact: true }).click(),
          () =>
            waitInPage(
              page,
              (atEnd: string | null) =>
                document
                  .querySelector('[aria-label^="Timeline cursor "]')
                  ?.getAttribute("aria-label") === atEnd &&
                String(
                  (
                    window as unknown as {
                      __cadaraDebug?: {
                        getState(): { machineState: string } | null;
                      };
                    }
                  ).__cadaraDebug?.getState()?.machineState ?? "",
                ).includes("idle"),
              atEnd,
            ),
          "none",
        );
      };
    }
    case "featureSuppress":
    case "featureUnsuppress": {
      const middle = await middleFeature(page);
      if (!middle) return "timeline has fewer than three features";
      const toggle = async (suppress: boolean, timed: boolean) => {
        const entry = await contextMenuItem(
          page,
          middle.item,
          suppress ? "Suppress" : "Unsuppress",
        );
        const reflected = () =>
          waitInPage(page, suppressedIs, {
            id: middle.id,
            suppressed: suppress,
          });
        if (timed) return timedSample(session, () => entry.click(), reflected);
        await untimedHistoryAction(page, () => entry.click());
        await reflected();
        await waitForOccQuiet(page);
        return null;
      };
      return async () => {
        if (kind === "featureSuppress") {
          const timing = (await toggle(true, true))!;
          await settleBeforeCleanup(page, timing);
          await toggle(false, false);
          return timing;
        }
        await toggle(true, false);
        return (await toggle(false, true))!;
      };
    }
    case "featureDeleteMid": {
      const middle = await middleFeature(page);
      if (!middle) return "timeline has fewer than three features";
      return async () => {
        const remove = await contextMenuItem(page, middle.item, "Delete");
        const countBefore = await page.evaluate(timelineCount);
        const timing: SampleTiming = await timedSample(
          session,
          () => remove.click(),
          () =>
            waitInPage(page, timelineCountChanged, {
              count: countBefore,
              grew: false,
            }),
        );
        await settleBeforeCleanup(page, timing);
        await undoUntimed(page);
        await waitInPage(page, timelineCountChanged, {
          count: countBefore - 1,
          grew: true,
        });
        return timing;
      };
    }
  }
}
