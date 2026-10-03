import { expect, test, type Page } from "@playwright/test";

import {
  createCommitSketchHistoryEntry,
  createEmptyOperationHistory,
  type ModelingOperationHistoryPayload,
} from "../src/contracts/modeling/operation-history";
import type { CommitSketchRequest } from "../src/contracts/modeling/schema";
import { SKETCH_SCHEMA_VERSION } from "../src/contracts/sketch/schema";
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

/** A sketch of smooth closed splines, one per fit-point list. */
function closedSplineSketchHistory(
  sketchId: `sketch_${string}`,
  splines: readonly (readonly Point[])[],
): ModelingOperationHistoryPayload {
  const points = splines.flatMap((fit, spline) =>
    fit.map((position, index) => ({
      pointId: `sketch_point_${spline}_${index}` as const,
      label: `Spline ${spline} point ${index}`,
      target: {
        kind: "sketchPoint" as const,
        sketchId,
        pointId: `sketch_point_${spline}_${index}` as const,
      },
      position,
      isConstruction: false,
    })),
  );
  const entities = splines.map((fit, spline) => ({
    kind: "spline" as const,
    entityId: `sketch_entity_spline_${spline}` as const,
    label: `Spline ${spline}`,
    target: {
      kind: "sketchEntity" as const,
      sketchId,
      entityId: `sketch_entity_spline_${spline}` as const,
    },
    isConstruction: false,
    pointOccurrenceIds: fit.map((_, index) => `spline_${spline}_o${index}`),
    pointOccurrences: fit.map((_, index) => ({
      occurrenceId: `spline_${spline}_o${index}`,
      pointId: `sketch_point_${spline}_${index}` as const,
      tangent: { kind: "automatic" as const },
    })),
    closure: "smooth" as const,
    interpolationPolicy: "centripetal-mean-arm-v1" as const,
  }));
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
    sketchLabel: "Spline Sketch",
    plane: {
      key: "xy",
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
    },
    definition: {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    },
  } as CommitSketchRequest;
  return {
    ...createEmptyOperationHistory("doc_workspace"),
    entries: [createCommitSketchHistoryEntry(request, sketchId)],
  };
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
});
