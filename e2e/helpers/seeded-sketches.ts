import { expect, type Page } from "@playwright/test";

import {
  createCommitSketchHistoryEntry,
  createCreateFeatureHistoryEntry,
  createEmptyOperationHistory,
  type ModelingOperationHistoryPayload,
} from "../../src/contracts/modeling/operation-history";
import type {
  CommitSketchRequest,
  CreateFeatureRequest,
} from "../../src/contracts/modeling/schema";
import { SKETCH_SCHEMA_VERSION } from "../../src/contracts/sketch/schema";
import { createStandardPlaneDefinition } from "../../src/domain/modeling/opencascade-kernel-seed";

// Small current-format sketches seeded through the operation history, for
// the rows whose specification says "in separate small fixtures" (§2
// figure-eight lobes, point-touching loops, nested/annular regions), plus
// the debug reads those rows assert with (selectable regions, topology
// counts, document diagnostics). Moved from
// `sketch-spline-region-extrude.spec.ts` (T17i), shared with
// `acceptance-mixed-topology.spec.ts`.

export type Point = readonly [number, number];
export type SketchId = `sketch_${string}`;
type Definition = CommitSketchRequest["definition"];

export function sketchPoint(
  sketchId: SketchId,
  pointId: string,
  position: Point,
) {
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

export function entityRef(sketchId: SketchId, entityId: string) {
  return {
    kind: "sketchEntity" as const,
    sketchId,
    entityId: entityId as `sketch_entity_${string}`,
  };
}

/** A smooth spline through `pointIds`; `tangents[i]` authors occurrence i. */
export function splineEntity(
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
    target: entityRef(sketchId, entityId),
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

/** A line between two points of `sketchId` (`sketch_point_<from|to>`). */
export function lineEntity(
  sketchId: SketchId,
  name: string,
  from: string,
  to: string,
) {
  return {
    kind: "lineSegment" as const,
    entityId: `sketch_entity_${name}`,
    label: name,
    target: entityRef(sketchId, `sketch_entity_${name}`),
    isConstruction: false,
    startPointId: `sketch_point_${from}`,
    endPointId: `sketch_point_${to}`,
  };
}

export function sketchRequest(
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

export function historyOf(
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
export function closedSplineSketch(
  sketchId: SketchId,
  label: string,
  splines: readonly (readonly Point[])[],
) {
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
  return sketchRequest(sketchId, label, points, entities);
}

/** One sketch of smooth closed splines, as an operation history. */
export function closedSplineSketchHistory(
  sketchId: SketchId,
  splines: readonly (readonly Point[])[],
): ModelingOperationHistoryPayload {
  return historyOf([closedSplineSketch(sketchId, "Spline Sketch", splines)]);
}

/**
 * Two squares of side `size` touching at one shared corner point: the
 * first from `origin`, the second from its top right corner.
 */
export function pointTouchingSquaresSketch(
  sketchId: SketchId,
  label: string,
  origin: Point,
  size: number,
) {
  const [x, y] = origin;
  const at: Record<string, Point> = {
    a: [x, y],
    b: [x + size, y],
    m: [x + size, y + size],
    d: [x, y + size],
    f: [x + 2 * size, y + size],
    g: [x + 2 * size, y + 2 * size],
    h: [x + size, y + 2 * size],
  };
  const points = Object.entries(at).map(([name, position]) =>
    sketchPoint(sketchId, `sketch_point_${name}`, position),
  );
  return sketchRequest(sketchId, label, points, [
    lineEntity(sketchId, "ab", "a", "b"),
    lineEntity(sketchId, "bm", "b", "m"),
    lineEntity(sketchId, "md", "m", "d"),
    lineEntity(sketchId, "da", "d", "a"),
    lineEntity(sketchId, "mf", "m", "f"),
    lineEntity(sketchId, "fg", "f", "g"),
    lineEntity(sketchId, "gh", "g", "h"),
    lineEntity(sketchId, "hm", "h", "m"),
  ]);
}

/** An 8-point lemniscate: one smooth closed spline crossing itself once. */
export const FIGURE_EIGHT = [...Array(8).keys()].map((k): Point => {
  const t = Math.PI / 8 + (k * Math.PI) / 4;
  return [
    Math.round(6 * Math.cos(t) * 1000) / 1000,
    Math.round(6 * Math.sin(t) * Math.cos(t) * 1000) / 1000,
  ];
});

/** A spline annulus: an outer and an inner smooth closed spline. */
export const SPLINE_ANNULUS: readonly (readonly Point[])[] = [
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
];

/** Waits until the sketch publishes `count` selectable regions. */
export async function sketchRegionTargets(
  page: Page,
  sketchId: string,
  count: number,
) {
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
        message: `The sketch publishes ${count} selectable regions.`,
        timeout: 30_000,
      },
    )
    .toBe(count);
  return targets;
}

/** Face targets the snapshot publishes for `bodyId`. */
export function bodyFaceCount(page: Page, bodyId: string) {
  return page.evaluate(
    (prefix) =>
      window.__cadaraDebug
        ?.getState()
        ?.selectableTargets.filter((target) => target.startsWith(prefix))
        .length ?? 0,
    `${bodyId}.face_`,
  );
}

export function snapshotDiagnosticsCount(page: Page) {
  return page.evaluate(
    () => window.__cadaraDebug?.getState()?.snapshotDiagnosticsCount ?? -1,
  );
}

/** Durable topology counts of a body, from the debug bridge. */
export function bodyTopology(page: Page, bodyId: string) {
  return page.evaluate((id) => {
    const body = window.__cadaraDebug
      ?.getState()
      ?.topologyDebug.bodies.find((entry) => entry.bodyId === id);
    return body
      ? { vertices: body.vertices, edges: body.edges, faces: body.faces }
      : null;
  }, bodyId);
}

/**
 * Review A-3 (T10c): the committed body is the exact prism (one side face
 * per boundary edge plus the two caps), and no region raised a new
 * document diagnostic (a failed profile face would add a `profile-…`
 * warning).
 */
export async function expectExactPrism(
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
