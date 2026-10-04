import { expect, test, type Page } from "@playwright/test";

import {
  createCommitSketchHistoryEntry,
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
  type ModelingOperationHistoryPayload,
} from "../src/contracts/modeling/operation-history";
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
} from "../src/contracts/modeling/schema";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "../src/contracts/shared/versioning";
import { SKETCH_SCHEMA_VERSION } from "../src/contracts/sketch/schema";
import { createStandardPlaneDefinition } from "../src/domain/modeling/opencascade-kernel-seed";
import { FeatureWorkbenchHarness } from "./helpers/feature-workbench";

test.setTimeout(180_000);
test.use({ viewport: { width: 1440, height: 960 } });

// Lane: e2e (docs/testing.md). Seam: a persisted sketch whose regions are
// bounded by spline spans → the workbench's extrude region selection → the
// browser OCC worker on the shipped `public/cadara-occ` build, which builds
// exact Bézier edges (T10c). Only the browser runtime proves the shipped
// bindings end to end. The native spline tool draws open 3-point splines
// only, so the closed splines are seeded through the operation history.

type Point = readonly [number, number];
type SketchId = `sketch_${string}`;
type Definition = CommitSketchRequest["definition"];

function sketchPoint(sketchId: SketchId, pointId: string, position: Point) {
  return {
    pointId: pointId as `sketch_point_${string}`,
    label: pointId,
    target: {
      kind: "sketchPoint" as const,
      sketchId,
      pointId: pointId as `sketch_point_${string}`,
    },
    position,
    isConstruction: false,
  };
}

function entityTarget(sketchId: SketchId, entityId: string) {
  return {
    kind: "sketchEntity" as const,
    sketchId,
    entityId: entityId as `sketch_entity_${string}`,
  };
}

/** A smooth spline through `pointIds`; `tangents[i]` authors occurrence i. */
function splineEntity(
  sketchId: SketchId,
  entityId: string,
  pointIds: readonly string[],
  closure: "smooth" | "open",
  tangents: readonly (Point | null)[] = [],
) {
  return {
    kind: "spline" as const,
    entityId: entityId as `sketch_entity_${string}`,
    label: entityId,
    target: entityTarget(sketchId, entityId),
    isConstruction: false,
    pointOccurrenceIds: pointIds.map((_, index) => `${entityId}_o${index}`),
    pointOccurrences: pointIds.map((pointId, index) => ({
      occurrenceId: `${entityId}_o${index}`,
      pointId: pointId as `sketch_point_${string}`,
      tangent: tangents[index]
        ? { kind: "authored" as const, vector: tangents[index] }
        : { kind: "automatic" as const },
    })),
    closure,
    interpolationPolicy: "centripetal-mean-arm-v1" as const,
  };
}

function sketchRequest(
  sketchId: SketchId,
  sketchLabel: string,
  points: readonly ReturnType<typeof sketchPoint>[],
  entities: readonly unknown[],
  planeKey: "xy" | "xz" = "xy",
): CommitSketchRequest {
  return {
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
    sketchLabel,
    plane: createStandardPlaneDefinition(planeKey),
    definition: {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map(
        (entity) => (entity as { entityId: string }).entityId,
      ),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    } as unknown as Definition,
  };
}

function historyOf(
  sketches: readonly CommitSketchRequest[],
  features: readonly CreateFeatureRequest[] = [],
): ModelingOperationHistoryPayload {
  return {
    ...createEmptyOperationHistory("doc_workspace"),
    entries: [
      ...sketches.map((request) =>
        createCommitSketchHistoryEntry(request, request.sketchId!),
      ),
      ...features.map(createCreateFeatureHistoryEntry),
    ],
  };
}

/** A sketch of smooth closed splines, one per fit-point list. */
function closedSplineSketchHistory(
  sketchId: SketchId,
  splines: readonly (readonly Point[])[],
): ModelingOperationHistoryPayload {
  const points = splines.flatMap((fit, spline) =>
    fit.map((position, index) =>
      sketchPoint(sketchId, `sketch_point_${spline}_${index}`, position),
    ),
  );
  const entities = splines.map((fit, spline) =>
    splineEntity(
      sketchId,
      `sketch_entity_spline_${spline}`,
      fit.map((_, index) => `sketch_point_${spline}_${index}`),
      "smooth",
    ),
  );
  return historyOf([
    sketchRequest(sketchId, "Spline Sketch", points, entities),
  ]);
}

async function regionTargets(page: Page, sketchId: string, count: number) {
  const pattern = `^${sketchId}\\.region_[0-9a-f]{32}$`;
  let targets: string[] = [];
  await expect
    .poll(
      async () => {
        targets = await page.evaluate(
          (source) =>
            window.__cadaraDebug
              ?.getState()
              ?.selectableTargets.filter((target) =>
                new RegExp(source).test(target),
              ) ?? [],
          pattern,
        );
        return targets.length;
      },
      {
        message: `The spline sketch publishes ${count} selectable regions.`,
        timeout: 30_000,
      },
    )
    .toBe(count);
  return targets;
}

/** Face targets the snapshot publishes for `bodyId`. */
async function bodyFaceCount(page: Page, bodyId: string) {
  return page.evaluate(
    (prefix) =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) => target.startsWith(prefix))
        .length ?? 0,
    `${bodyId}.face_`,
  );
}

async function snapshotDiagnosticsCount(page: Page) {
  return page.evaluate(
    () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
  );
}

/**
 * Review A-3: the committed body is the exact prism (one side face per
 * boundary edge plus the two caps), and no region raised a new document
 * diagnostic (a failed profile face would add a `profile-…` warning).
 */
async function expectExactPrism(
  page: Page,
  bodyId: string,
  faces: readonly number[],
  diagnosticsBefore: number,
) {
  await expect
    .poll(() => bodyFaceCount(page, bodyId), {
      message: `${bodyId} has one face per boundary edge plus two caps`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  expect(faces).toContain(await bodyFaceCount(page, bodyId));
  expect(
    await snapshotDiagnosticsCount(page),
    "no new document diagnostic (no profile-… region warning)",
  ).toBe(diagnosticsBefore);
}

// An 8-point lemniscate: one smooth closed spline crossing itself once.
const FIGURE_EIGHT = [...Array(8).keys()].map((k): Point => {
  const t = Math.PI / 8 + (k * Math.PI) / 4;
  return [
    Math.round(6 * Math.cos(t) * 1000) / 1000,
    Math.round(6 * Math.sin(t) * Math.cos(t) * 1000) / 1000,
  ];
});

test("one lobe of a figure-eight spline extrudes into a body", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    closedSplineSketchHistory("sketch_figure_eight", [FIGURE_EIGHT]),
  );
  await workbench.open();

  await workbench.activateFeature("extrude");
  const lobes = await regionTargets(page, "sketch_figure_eight", 2);
  const diagnostics = await snapshotDiagnosticsCount(page);
  expect(diagnostics, "every lobe renders its exact face").toBe(0);
  await workbench.selectReference(lobes[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyCountAtLeast(1);
  // A lobe is 5 boundary segments (3 spans and 2 pieces split at the crossing).
  await expectExactPrism(page, "body_feature_extrude-1", [7], diagnostics);
});

test("both regions of a spline annulus (the annulus and its spline disk) extrude into bodies", async ({
  page,
}) => {
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    closedSplineSketchHistory("sketch_annulus", [
      [
        [6, 0],
        [0, 5],
        [-6, 0],
        [0, -5],
      ],
      [
        [2.5, 0.5],
        [0, 2],
        [-2, 0],
        [0, -1.5],
      ],
    ]),
  );
  await workbench.open();

  await workbench.activateFeature("extrude");
  const targets = await regionTargets(page, "sketch_annulus", 2);
  const diagnostics = await snapshotDiagnosticsCount(page);
  expect(diagnostics, "both regions render their exact faces").toBe(0);
  await workbench.selectReference(targets[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyCountAtLeast(1);
  // The annulus has 4 + 4 span edges, the disk 4 (plus the two caps each).
  await expectExactPrism(page, "body_feature_extrude-1", [10, 6], diagnostics);
  const first = await bodyFaceCount(page, "body_feature_extrude-1");

  // The other region alone, as a new body (one of the two is the annulus).
  await workbench.activateFeature("extrude");
  await page.getByRole("button", { name: "Clear Profile targets" }).click();
  await expect(
    page.getByRole("button", { name: `Remove ${targets[0]!}` }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => window.__cadaraDebug?.selectTarget(id) ?? false,
      targets[1]!,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: `Remove ${targets[1]!}` }),
  ).toHaveCount(1, { timeout: 10_000 });
  await workbench.setOperation("newBody");
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-2");
  await workbench.expectBodyCountAtLeast(2);
  await expectExactPrism(
    page,
    "body_feature_extrude-2",
    [first === 10 ? 6 : 10],
    diagnostics,
  );

  // T10j (§6.3 item 2): the annulus prism has a through hole. Each cap is an
  // annulus (outer and inner loop, 4 spans each), so the solid carries 8
  // side faces and 8 vertical edges; the disk prism has 4 and 4.
  const [annulus, disk] =
    first === 10
      ? ["body_feature_extrude-1", "body_feature_extrude-2"]
      : ["body_feature_extrude-2", "body_feature_extrude-1"];
  expect(
    await bodyTopology(page, annulus),
    "annulus prism: 16 vertices, 24 edges, 10 faces (a hole through the solid)",
  ).toEqual({ vertices: 16, edges: 24, faces: 10 });
  expect(await bodyTopology(page, disk)).toEqual({
    vertices: 8,
    edges: 12,
    faces: 6,
  });
});

// ---------------------------------------------------------------------------
// T10j (T10 plan §6.3 items 1, 2, 5; §2.9; routed T10d browser row).

/** Durable topology counts of a body, from the debug bridge. */
async function bodyTopology(page: Page, bodyId: string) {
  return page.evaluate((id) => {
    const body = window.__cadaraDebug
      ?.getState()
      ?.topologyDebug.bodies.find((entry) => entry.bodyId === id);
    return body
      ? { vertices: body.vertices, edges: body.edges, faces: body.faces }
      : null;
  }, bodyId);
}

/** The last committed authored position of `pointId` (operation history). */
async function committedPointPosition(page: Page, pointId: string) {
  return page.evaluate((id) => {
    const serialized = window.localStorage.getItem(
      "cad.modeling.operationHistory.doc_workspace.v1",
    );
    const payload = JSON.parse(serialized ?? "{}") as {
      entries?: {
        kind: string;
        payload?: {
          definition?: {
            points?: { pointId: string; position: [number, number] }[];
          };
        };
      }[];
    };
    return (
      payload.entries
        ?.filter((entry) => entry.kind === "commitSketch")
        .at(-1)
        ?.payload?.definition?.points?.find((point) => point.pointId === id)
        ?.position ?? null
    );
  }, pointId);
}

/**
 * Screen centroid of a body's face targets and of the Top Plane (the origin),
 * under the current camera (review A-6).
 */
async function bodyScreenCentroid(page: Page, bodyId: string) {
  return page.evaluate((prefix) => {
    const faces =
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) => target.startsWith(prefix)) ?? [];
    const points = faces
      .map((face) => window.__cadProjectToScreen?.(face) ?? null)
      .filter((point): point is { x: number; y: number } => point !== null);
    const origin = window.__cadProjectToScreen?.("construction_plane-xy");
    return points.length === 0 || !origin
      ? null
      : {
          faces: points.length,
          x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
          y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
          origin,
        };
  }, `${bodyId}.face_`);
}

async function reopenSketch(workbench: FeatureWorkbenchHarness, label: string) {
  await workbench.page
    .getByRole("button", { name: `Select ${label}. Double-click to reopen.` })
    .dblclick();
  await workbench.expectSketchSessionActive();
}

async function projectSketchPoint(page: Page, targetId: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await page.evaluate(
          (id) => window.__cadProjectToScreen?.(id) ?? null,
          targetId,
        );
        return point !== null;
      },
      { message: `${targetId} is projected`, timeout: 15_000 },
    )
    .toBe(true);
  return point!;
}

/**
 * Drags authored fit points to sketch positions. The top view maps sketch
 * (x, y) affinely to the screen; the map is read off two projected points
 * whose authored positions are known.
 */
async function dragFitPoints(
  workbench: FeatureWorkbenchHarness,
  sketchId: string,
  known: readonly [{ id: string; at: Point }, { id: string; at: Point }],
  moves: readonly { id: string; from: Point; to: Point }[],
) {
  const page = workbench.page;
  const box = await workbench.viewportSurface().boundingBox();
  if (!box) throw new Error("Viewport surface is not visible.");
  const [a, b] = await Promise.all(
    known.map((entry) => projectSketchPoint(page, `${sketchId}.${entry.id}`)),
  );
  const scaleX = (a!.x - b!.x) / (known[0].at[0] - known[1].at[0]);
  const scaleY = (a!.y - b!.y) / (known[0].at[1] - known[1].at[1]);
  const screen = ([x, y]: Point) => ({
    x: box.x + a!.x + scaleX * (x - known[0].at[0]),
    y: box.y + a!.y + scaleY * (y - known[0].at[1]),
  });
  for (const move of moves) {
    const start = screen(move.from);
    const end = screen(move.to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await workbench.waitForAnimationFrames(2);
  }
}

/**
 * A12 timing record (not gated): Finish → the committed snapshot publishes
 * the sketch's regions (a new revision, machine idle, `count` selectable
 * regions of the sketch).
 */
async function finishAndTimeRegions(
  workbench: FeatureWorkbenchHarness,
  sketchId: string,
  count: number,
) {
  const page = workbench.page;
  const before = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.revision ?? "",
  );
  const started = Date.now();
  await page.locator('button[data-tool-id="finishSketch"]').click();
  await page.waitForFunction(
    ({ before, pattern, count }) => {
      const state = window.__cadaraDebug?.getState();
      return (
        !!state &&
        state.revision !== before &&
        state.machineState.includes("idle") &&
        state.selectableTargets.filter((target) =>
          new RegExp(pattern).test(target),
        ).length === count
      );
    },
    { before, pattern: `^${sketchId}\\.region_[0-9a-f]{32}$`, count },
    { timeout: 60_000, polling: 25 },
  );
  return Date.now() - started;
}

test("a figure-eight lobe keeps its region through a fit-point edit, asks for reselection when the crossing goes, and rebuilds once reselected", async ({
  page,
}, testInfo) => {
  const sketchId = "sketch_figure_eight";
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    closedSplineSketchHistory(sketchId, [FIGURE_EIGHT]),
  );
  await workbench.open();

  await workbench.activateFeature("extrude");
  const lobes = await regionTargets(page, sketchId, 2);
  await workbench.selectReference(lobes[0]!);
  await workbench.expectFeaturePreviewReady("extrude");
  await workbench.commitFeature("feature_extrude-1");
  await workbench.expectBodyPresent("body_feature_extrude-1");
  const lobeFaces = (await bodyTopology(page, "body_feature_extrude-1"))!.faces;
  const revisionBeforeEdit = await page.evaluate(
    () => window.__cadaraDebug?.getState()?.revision ?? "",
  );
  const before = (await bodyScreenCentroid(page, "body_feature_extrude-1"))!;
  expect(before, "the lobe body's faces are projected").not.toBeNull();

  // A fit-point edit that keeps the crossing: the same canonical boundary, so
  // the same region ids, and Extrude 1 rebuilds on the edited lobe. The outer
  // fit point of the extruded lobe is dragged outward: fit point 0 (5.54,
  // 2.12) for the +x lobe, fit point 4 (−5.54, 2.12) for the −x lobe (+x is
  // to the right of the origin on screen in the default view).
  const fit = (index: number) => `sketch_point_0_${index}`;
  const outer = before.x > before.origin.x ? 0 : 4;
  const target: Point = outer === 0 ? [6.0, 2.5] : [-6.0, 2.5];
  const known = [
    { id: fit(0), at: FIGURE_EIGHT[0]! },
    { id: fit(3), at: FIGURE_EIGHT[3]! },
  ] as const;
  await reopenSketch(workbench, "Spline Sketch");
  await dragFitPoints(workbench, sketchId, known, [
    { id: fit(outer), from: FIGURE_EIGHT[outer]!, to: target },
  ]);
  const figureEightMs = await finishAndTimeRegions(workbench, sketchId, 2);
  const moved = await committedPointPosition(page, fit(outer));
  expect(
    Math.hypot(moved![0] - target[0], moved![1] - target[1]),
    `the fit point was dragged to ≈ (${target}): ${moved}`,
  ).toBeLessThan(0.2);
  expect(
    (await regionTargets(page, sketchId, 2)).toSorted(),
    "the lobes keep their region ids",
  ).toEqual(lobes.toSorted());
  await workbench.expectBodyPresent("body_feature_extrude-1");
  await expect(
    page.getByRole("treeitem", { name: /^Repair Extrude 1/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__cadaraDebug?.getState()?.revision ?? ""),
  ).not.toBe(revisionBeforeEdit);
  expect((await bodyTopology(page, "body_feature_extrude-1"))!.faces).toBe(
    lobeFaces,
  );
  // Review A-6: the rebuilt body is the edited lobe, not a cached shape. Under
  // the same camera (the origin projects to the same pixel), its faces moved
  // outward with the dragged fit point.
  let after = before;
  await expect
    .poll(
      async () => {
        after = (await bodyScreenCentroid(page, "body_feature_extrude-1"))!;
        return Math.hypot(after.x - before.x, after.y - before.y);
      },
      { message: "the lobe body's faces moved", timeout: 15_000 },
    )
    .toBeGreaterThan(1);
  expect(
    Math.hypot(
      after.origin.x - before.origin.x,
      after.origin.y - before.origin.y,
    ),
    "same camera before and after the edit",
  ).toBeLessThan(0.5);
  const fromOrigin = (point: {
    x: number;
    y: number;
    origin: { x: number; y: number };
  }) => Math.hypot(point.x - point.origin.x, point.y - point.origin.y);
  expect(
    fromOrigin(after),
    "the body grew outward, toward the dragged outer fit point",
  ).toBeGreaterThan(fromOrigin(before));

  // An edit that removes the crossing: one region with a new identity, so
  // Extrude 1 asks for reselection and has no body.
  await reopenSketch(workbench, "Spline Sketch");
  await dragFitPoints(
    workbench,
    sketchId,
    outer === 0 ? [{ id: fit(0), at: target }, known[1]] : known,
    [
      { id: fit(2), from: FIGURE_EIGHT[2]!, to: [-2.3, 3.0] },
      { id: fit(3), from: FIGURE_EIGHT[3]!, to: [-5.5, 3.5] },
    ],
  );
  await finishAndTimeRegions(workbench, sketchId, 1);
  const [simple] = await regionTargets(page, sketchId, 1);
  expect(lobes).not.toContain(simple);
  const repair = page.getByRole("treeitem", {
    name: /Repair Extrude 1\. Edit Extrude 1 and choose a valid profile selection\./,
  });
  await expect(repair).toBeVisible({ timeout: 30_000 });
  await workbench.expectBodyAbsent("body_feature_extrude-1");

  // Reselect: the dangling lobe is kept as a missing region until replaced.
  await repair.dblclick();
  await expect(page.getByText(`Missing region (${lobes[0]})`)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: `Remove ${lobes[0]}` }).click();
  await workbench.selectReference(simple!);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState()?.featureSession ?? "",
        ),
      { timeout: 30_000 },
    )
    .toContain(":previewReady");
  await page.getByRole("button", { name: "Commit" }).click();
  await workbench.expectMachine("idle", 75_000);
  await workbench.expectBodyPresent("body_feature_extrude-1");
  await expect(repair).toHaveCount(0);

  testInfo.annotations.push({
    type: "A12 figure-eight Finish→regions (ms)",
    description: String(figureEightMs),
  });
  console.log(
    `A12 figure-eight Finish→regions: ${figureEightMs} ms (fit point ${outer})`,
  );
});

test("A12 timing record: a rounded rectangle Finish → regions current (unchanged, warm cache)", async ({
  page,
}, testInfo) => {
  const sketchId = "sketch_rounded";
  // 10 × 6 with radius 1 corners; lines and arcs share their end points.
  const corners: [string, Point][] = [
    ["b0", [1, 0]],
    ["b1", [9, 0]],
    ["r0", [10, 1]],
    ["r1", [10, 5]],
    ["t0", [9, 6]],
    ["t1", [1, 6]],
    ["l0", [0, 5]],
    ["l1", [0, 1]],
    ["cbr", [9, 1]],
    ["ctr", [9, 5]],
    ["ctl", [1, 5]],
    ["cbl", [1, 1]],
  ];
  const points = corners.map(([name, at]) =>
    sketchPoint(sketchId, `sketch_point_${name}`, at),
  );
  const line = (name: string, from: string, to: string) => ({
    kind: "lineSegment" as const,
    entityId: `sketch_entity_${name}`,
    label: name,
    target: entityTarget(sketchId, `sketch_entity_${name}`),
    isConstruction: false,
    startPointId: `sketch_point_${from}`,
    endPointId: `sketch_point_${to}`,
  });
  const arc = (name: string, center: string, from: string, to: string) => ({
    kind: "arc" as const,
    entityId: `sketch_entity_${name}`,
    label: name,
    target: entityTarget(sketchId, `sketch_entity_${name}`),
    isConstruction: false,
    centerPointId: `sketch_point_${center}`,
    startPointId: `sketch_point_${from}`,
    endPointId: `sketch_point_${to}`,
    sweepDirection: "counterClockwise" as const,
  });
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    historyOf([
      sketchRequest(sketchId, "Rounded Sketch", points, [
        line("bottom", "b0", "b1"),
        arc("br", "cbr", "b1", "r0"),
        line("right", "r0", "r1"),
        arc("tr", "ctr", "r1", "t0"),
        line("top", "t0", "t1"),
        arc("tl", "ctl", "t1", "l0"),
        line("left", "l0", "l1"),
        arc("bl", "cbl", "l1", "b0"),
      ]),
    ]),
  );
  await workbench.open();
  await regionTargets(page, sketchId, 1);

  // Unconstrained arcs cannot be dragged without breaking their radius, so
  // the session finishes unchanged: the kernel adapter's one solver already
  // holds this sketch's exact requests (A10), i.e. the warm path.
  await reopenSketch(workbench, "Rounded Sketch");
  const roundedMs = await finishAndTimeRegions(workbench, sketchId, 1);
  testInfo.annotations.push({
    type: "A12 rounded rectangle Finish→regions (ms)",
    description: String(roundedMs),
  });
  console.log(`A12 rounded rectangle Finish→regions: ${roundedMs} ms`);
});

test("an open spline extrudes into a surface and is a sweep path in the browser (T10d)", async ({
  page,
}) => {
  const profileId = "sketch_sweep_profile";
  const pathId = "sketch_sweep_path";
  const square: [string, Point][] = [
    ["a", [-0.2, -0.2]],
    ["b", [0.2, -0.2]],
    ["c", [0.2, 0.2]],
    ["d", [-0.2, 0.2]],
  ];
  const profilePoints = square.map(([name, at]) =>
    sketchPoint(profileId, `sketch_point_${name}`, at),
  );
  const side = (from: string, to: string) => ({
    kind: "lineSegment" as const,
    entityId: `sketch_entity_${from}${to}`,
    label: `${from}${to}`,
    target: entityTarget(profileId, `sketch_entity_${from}${to}`),
    isConstruction: false,
    startPointId: `sketch_point_${from}`,
    endPointId: `sketch_point_${to}`,
  });
  // On the XZ plane, leaving the profile centroid along +z (authored tangent).
  const pathFit: Point[] = [
    [0, 0],
    [1, 2.5],
    [3, 3.5],
    [5, 3],
  ];
  const pathPoints = pathFit.map((at, index) =>
    sketchPoint(pathId, `sketch_point_path_${index}`, at),
  );
  const pathSpline = splineEntity(
    pathId,
    "sketch_entity_path",
    pathPoints.map((point) => point.pointId),
    "open",
    [[0, 2]],
  );
  const surfaceExtrude: CreateFeatureRequest = {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_fixture",
    definition: {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        resultBodyType: "surface",
        profiles: [
          {
            kind: "sketchEntity",
            sketchId: pathId,
            entityId: "sketch_entity_path",
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: 2 },
        },
      },
    },
  };
  const workbench = new FeatureWorkbenchHarness(page);
  await workbench.seedOperationHistory(
    historyOf(
      [
        sketchRequest(profileId, "Sweep Profile", profilePoints, [
          side("a", "b"),
          side("b", "c"),
          side("c", "d"),
          side("d", "a"),
        ]),
        sketchRequest(pathId, "Sweep Path", pathPoints, [pathSpline], "xz"),
      ],
      [surfaceExtrude],
    ),
  );
  await workbench.open();

  // The surface extrude of the 3-span open spline: one sheet face per span.
  await workbench.expectBodyPresent("body_feature_extrude-1");
  await workbench.expectBodyEulerCharacteristic("body_feature_extrude-1", 1);
  expect((await bodyTopology(page, "body_feature_extrude-1"))!.faces).toBe(3);
  expect(await snapshotDiagnosticsCount(page), "no rebuild diagnostic").toBe(0);

  // The square region sweeps along the open spline path.
  await workbench.activateFeature("sweep");
  const [profileRegion] = await regionTargets(page, profileId, 1);
  await workbench.selectReference(profileRegion!);
  await workbench.selectReference(`${pathId}.sketch_entity_path`);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__cadaraDebug?.getState()?.featureSession ?? "",
        ),
      { timeout: 30_000 },
    )
    .toContain("create:sweep:previewReady");
  await workbench.commitFeature("feature_sweep-1");
  await workbench.expectBodyPresent("body_feature_sweep-1");
  await workbench.expectBodyEulerCharacteristic("body_feature_sweep-1", 2);
});
