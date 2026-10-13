import { expect, test, type Page } from "@playwright/test";

import {
  createCommitSketchHistoryEntry,
  createEmptyOperationHistory,
  type ModelingOperationHistoryPayload,
} from "../src/contracts/modeling/operation-history";
import type { CommitSketchRequest } from "../src/contracts/modeling/schema";
import { SKETCH_SCHEMA_VERSION } from "../src/contracts/sketch/schema";
import { createStandardPlaneDefinition } from "../src/domain/modeling/opencascade-kernel-seed";
import {
  mean,
  selectRegionInViewport,
  settledProjections,
  spread,
  zoomInAbout,
  type CanvasPoint,
} from "./helpers/acceptance";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(300_000);

// Lane: e2e (docs/testing.md). Seam: part-mode region picking in the real
// viewport (T17-19): curves are picked within a screen-pixel band, so a
// region narrower than the band at the default zoom (the offset-0.1 ring of
// T17b0 P-5, a r = 0.5 disk) becomes pickable by zooming in. Only the
// browser composes the camera controls, the raycast and the feature's
// profile selection. Every pointer path glides; camera waits poll the
// projected screen points until they stop moving.

const REGION_TARGET = /^sketch_.+\.region_[0-9a-f]{32}$/;
/** `DEFAULT_LINE_PICK_RADIUS_PX` (render-picking.ts). */
const LINE_PICK_RADIUS_PX = 21;

async function regionTargets(page: Page, count: number) {
  let targets: string[] = [];
  await expect
    .poll(
      async () => {
        targets = await page.evaluate(
          (pattern) =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                new RegExp(pattern).test(target),
              ) ?? [],
          REGION_TARGET.source,
        );
        return targets.length;
      },
      {
        message: `The sketch publishes ${count} selectable regions.`,
        timeout: 90_000,
      },
    )
    .toBe(count);
  return targets;
}

type Point = readonly [number, number];
type SketchId = `sketch_${string}`;

const SMALL_DISK_SKETCH: SketchId = "sketch_small_disk";

/** A circle (r = 0.5) at (1, 0) inside a 4 × 3 rectangle centred at 0. */
function smallDiskInRectangle(): ModelingOperationHistoryPayload {
  const sketchId = SMALL_DISK_SKETCH;
  const at: Record<string, Point> = {
    a: [-2, -1.5],
    b: [2, -1.5],
    c: [2, 1.5],
    d: [-2, 1.5],
    o: [1, 0],
  };
  const points = Object.entries(at).map(([key, position]) => ({
    pointId: `sketch_point_${key}`,
    label: key,
    target: { kind: "sketchPoint", sketchId, pointId: `sketch_point_${key}` },
    position,
    isConstruction: false,
  }));
  const entity = (entityId: string) => ({
    entityId,
    label: entityId,
    target: { kind: "sketchEntity", sketchId, entityId },
    isConstruction: false,
  });
  const line = (from: string, to: string) => ({
    ...entity(`sketch_entity_${from}${to}`),
    kind: "lineSegment",
    startPointId: `sketch_point_${from}`,
    endPointId: `sketch_point_${to}`,
  });
  const entities = [
    line("a", "b"),
    line("b", "c"),
    line("c", "d"),
    line("d", "a"),
    {
      ...entity("sketch_entity_circle"),
      kind: "circle",
      centerPointId: "sketch_point_o",
      radius: 0.5,
    },
  ];
  const request = {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_fixture",
    solverCorrelation: {
      requestId: "request_fixture",
      projectionRequestId: "request_fixture:project",
      validationRequestId: "request_fixture:validate",
      solveRequestId: "request_fixture:solve",
      regionRequestId: "request_fixture:regions",
    },
    sketchId,
    sketchLabel: "Small disk",
    plane: createStandardPlaneDefinition("xy"),
    definition: {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((item) => item.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    },
  } as unknown as CommitSketchRequest;
  return {
    ...createEmptyOperationHistory("doc_workspace"),
    entries: [createCommitSketchHistoryEntry(request, sketchId)],
  };
}

test("T17-19: a r = 0.5 disk inside a rectangle is picked in the viewport after zooming in", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.openWithOperationHistory(smallDiskInRectangle());
  await workbench.activateFeature("extrude");
  const regions = await regionTargets(page, 2);
  // The bottom and top sides' projected points (their midpoints).
  const sides = [
    `${SMALL_DISK_SKETCH}.sketch_entity_ab`,
    `${SMALL_DISK_SKETCH}.sketch_entity_cd`,
  ] as const;
  // The frame's projected point is the rectangle's centre; the disk's is
  // the circle's centre, 1 unit to the right.
  const centre = mean(await settledProjections(workbench, sides));
  const projected = await settledProjections(workbench, regions);
  const [frame, disk] = [...regions].sort(
    (left, right) =>
      Math.hypot(
        projected[regions.indexOf(left)]!.x - centre.x,
        projected[regions.indexOf(left)]!.y - centre.y,
      ) -
      Math.hypot(
        projected[regions.indexOf(right)]!.x - centre.x,
        projected[regions.indexOf(right)]!.y - centre.y,
      ),
  ) as [string, string];
  expect(frame, "premise: two distinct regions").not.toBe(disk);

  // ×6 about the disk: its radius grows from ≈ 14 px (inside the 21 px
  // curve band) to ≈ 84 px. (With the former world-unit band, 0.75 > r,
  // the circle covers the whole disk at every zoom: T17b0 P-5.)
  const at = await zoomInAbout(workbench, [disk], [frame, disk], 6);
  await selectRegionInViewport(workbench, disk, { from: at });
});

type CommittedSketchDefinition = {
  points: Array<{ pointId: string }>;
  entities: Array<{
    entityId: string;
    kind: string;
    startPointId?: string;
    endPointId?: string;
  }>;
  derivedRelationships?: Array<{
    kind: string;
    outputs: Array<{ outputEntityId: string }>;
  }>;
};

/** The definition of the last sketch commit in the browser's operation history. */
async function lastCommittedSketch(page: Page) {
  return page.evaluate(() => {
    const payload = JSON.parse(
      window.localStorage.getItem(
        "cad.modeling.operationHistory.doc_workspace.v1",
      ) ?? "{}",
    ) as {
      entries?: Array<{
        kind: string;
        payload?: { sketchId?: string; definition?: unknown };
      }>;
    };
    const entry = payload.entries
      ?.filter((item) => item.kind === "commitSketch")
      .at(-1)?.payload;
    return entry
      ? {
          sketchId: entry.sketchId ?? null,
          definition: entry.definition as CommittedSketchDefinition,
        }
      : null;
  });
}

test("T17-19: the offset-0.1 annulus ring (sketch-offset-regions row 2, T17b0 P-5) is picked in the viewport after zooming in", async ({
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
  const expectStaged = (count: number, timeout = 15_000) =>
    expect
      .poll(() => workbench.currentSketchSession(), { timeout })
      .toContain(`${count} entities staged`);

  // The sketch-offset-regions row 2 sketch: a 3-point spline arch closed
  // by a line, offset outward by 0.1.
  await workbench.activateTool("Create spline geometry.");
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await workbench.clickViewportAt({ x: 720, y: 440 });
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await page.keyboard.press("Enter");
  await expectStaged(1);
  await workbench.activateTool("Create line geometry.");
  await workbench.clickViewportAt({ x: 840, y: 560 });
  await workbench.clickViewportAt({ x: 600, y: 560 });
  await expectStaged(2);
  await workbench.activateTool(
    "Offset a connected chain with a durable offset relationship.",
  );
  const clickEntityAlong = async (
    from: CanvasPoint,
    to: CanvasPoint,
    entity: RegExp,
  ) => {
    for (let index = 0; index <= 24; index += 1) {
      const point = {
        x: Math.round(from.x + ((to.x - from.x) * index) / 24),
        y: Math.round(from.y + ((to.y - from.y) * index) / 24),
      };
      await workbench.hoverViewportAt(point);
      await workbench.waitForAnimationFrames();
      if (entity.test(await workbench.currentHoverTarget())) {
        await workbench.clickViewportAt(point);
        return;
      }
    }
    throw new Error(`No ${entity} hover target along the scan.`);
  };
  await clickEntityAlong({ x: 660, y: 430 }, { x: 660, y: 540 }, /spline/);
  await clickEntityAlong({ x: 680, y: 545 }, { x: 680, y: 575 }, /line/);
  await page.getByRole("textbox", { name: "Distance" }).fill("0.1");
  await workbench.hoverViewportAt({ x: 720, y: 400 });
  const floatingInput = page.locator("[data-sketch-viewport-floating-input]");
  await expect(floatingInput).toBeVisible();
  await floatingInput
    .getByRole("button", { name: "Create" })
    .click({ timeout: 5_000 });
  await expectStaged(6, 90_000);
  await workbench.activateTool("Exit the active sketch.");
  await workbench.expectMachine("idle", 90_000);

  await workbench.activateFeature("extrude");
  const regions = await regionTargets(page, 2);
  const saved = await lastCommittedSketch(page);
  const offset = saved?.definition.derivedRelationships?.find(
    (relationship) => relationship.kind === "offset",
  );
  if (!saved?.sketchId || !offset) throw new Error("No committed offset.");
  const outputs = new Set(offset.outputs.map((item) => item.outputEntityId));
  const line = (isOutput: boolean) => {
    const entity = saved.definition.entities.find(
      (item) =>
        item.kind === "lineSegment" && outputs.has(item.entityId) === isOutput,
    );
    if (!entity) throw new Error(`No ${isOutput ? "output" : "source"} line.`);
    return `${saved.sketchId}.${entity.entityId}`;
  };
  // The source line and its offset output (0.1 apart) bound the ring's
  // straight part; their projected points are their midpoints.
  const ringSides = [line(false), line(true)] as const;

  // Both regions' projected points lie in the source region (the ring's is
  // in its hole); hovering there names the source, so the ring is the
  // other region.
  const surface = (await workbench.viewportSurface().boundingBox())!;
  const [sourcePoint] = await settledProjections(workbench, [regions[0]!]);
  await page.mouse.move(
    surface.x + sourcePoint!.x,
    surface.y + sourcePoint!.y,
    {
      steps: 6,
    },
  );
  await workbench.waitForAnimationFrames(2);
  const sourceRegion = await workbench.currentHoverTarget();
  expect(regions, "premise: the source region is hovered").toContain(
    sourceRegion,
  );
  const ring = regions.find((region) => region !== sourceRegion)!;

  // ×30 about the middle of the ring's straight part: the ring is ≈ 2 px
  // wide at the default zoom (inside the 21 px curve band) and ≈ 60 px
  // wide after the zoom, with its middle third outside both bands.
  const ringWidth = async () =>
    spread(await settledProjections(workbench, ringSides));
  expect(
    await ringWidth(),
    "premise: the ring is inside the band",
  ).toBeLessThan(2 * LINE_PICK_RADIUS_PX);
  const at = await zoomInAbout(workbench, ringSides, ringSides, 30);
  expect(
    await ringWidth(),
    "the ring is wider than both bands",
  ).toBeGreaterThan(2 * LINE_PICK_RADIUS_PX);
  await selectRegionInViewport(workbench, ring, { from: at });
});
