// T17d (B3, [TECH] A-5; issue 03 "stale is never consumed as current",
// specification "Minimum failure feedback"). Logic lane; seams: the
// consumers of a committed sketch record — vector export
// (`buildSketchVectorExportModelFromSnapshot`), cross-sketch reference
// projection (`projectSketchExternalReferencesFromSnapshot`) and measurement
// (`deriveMeasurementViewModel`) — on records a real Finish produced (mock
// kernel with the production solver). A rejected solve (the T13e2 95°
// rectangle: its rejected snapshot collapses two sides to ≈ 0.76 µm) and a
// sketch held by the sketch-wide gate (a broken mirror) are refused by
// export and projection by label; measurement measures the held (authored)
// geometry and says so, and refuses a spline (only an accepted solve
// defines its curve). A current sketch is the control.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { SketchPoint } from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  finalizeSketchDraw,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchSessionDisplayRenderable,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { getSketchSessionDisplayRenderables } from "@/infrastructure/editor/sketch-session/display";
import { rebuildSessionForDefinition } from "@/core/editor/sketch-session/definition-authoring";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  eid,
  entityRef,
  mirroredSession,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import { buildSketchVectorExportModelFromSnapshot } from "@/core/export/sketch-vector-export-model";
import { deriveMeasurementViewModel } from "@/core/measure/measurement";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { normalizeWorkspaceSnapshot } from "@/core/modeling/modeling-service/normalization";
import { mapSketchPointToWorld } from "@/domain/modeling/occ/geometry";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { projectSketchExternalReferencesFromSnapshot } from "@/core/modeling/sketch-reference-projection";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

function draw(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly SketchPoint[],
) {
  let next = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return clearActiveSketchTool(
    toolId === "spline" ? finalizeSketchDraw(next) : next,
  );
}

/**
 * A rectangle [1,1]–[5,4] and a spline far from it (`attached`, T17d2: the
 * spline starts at the rectangle's top-right corner), in an entered session.
 */
function rectangleAndSpline(attached = false) {
  let session = enterSketchSession(
    withSketchSnapScale(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
  );
  session = draw(session, "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  session = draw(
    session,
    "spline",
    attached
      ? [
          [5, 4],
          [7, 6],
          [9, 4],
        ]
      : [
          [10, 1],
          [12, 3],
          [14, 1],
        ],
  );
  expect(session.liveSolve?.accepted, "premise: solved").toBe(true);
  return session;
}

/** The entity labelled `label` (`"the spline"`: the sketch's spline). */
const entityOf = (
  definition: { entities: readonly SketchEntityDefinition[] },
  label: string,
) =>
  definition.entities.find((entity) =>
    label === "the spline" ? entity.kind === "spline" : entity.label === label,
  )!;

/** T13e2: a driving 95° corner angle on the h/v rectangle (rejected). */
function withConflictingCornerAngle(session: SketchSessionState) {
  let next = beginSketchTool(session, "dimensionDistance");
  for (const label of ["Rectangle 1 bottom", "Rectangle 1 right"])
    next = selectSketchConstraintTarget(
      next,
      entityOf(session.definition, label).target as PrimitiveRef,
    );
  next = pinSketchConstraintPreview(next, [4, 2]);
  next = patchSketchConstraintValue(
    next,
    next.toolPresentation!.floatingInput!.modeSwitch!.action.patch,
  );
  const rejected = patchSketchConstraintValue(
    patchSketchConstraintValue(next, { value: "95" }),
    { intent: "commitConstraintValue" },
  );
  expect(rejected.liveSolve?.accepted, "premise: rejected").toBe(false);
  return rejected;
}

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let occ: Promise<OpenCascadeInstance> | null = null;
/** T17d2: the production OCC kernel adapter (`public/cadara-occ`). */
function occAdapter() {
  occ ??= (async () => {
    const module =
      (await import("../../../public/cadara-occ.js")) as unknown as {
        default: OpenCascadeModule;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const instance = occ;
  return new OpenCascadeKernelAdapter({
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        revisionId,
      }),
    getOpenCascadeInstance: () => instance,
  });
}

/**
 * Real Finishes of `definitions` (by label) into one document: the mock
 * kernel with the production solver, or (T17d2) the production OCC adapter.
 */
async function finished(
  definitions: Record<string, SketchSessionState>,
  adapter: MockKernelAdapter | OpenCascadeKernelAdapter = new MockKernelAdapter(
    {
      solverAdapter: new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        revisionId: null,
      }),
    },
  ),
) {
  const { plane } = (await new MockKernelAdapter().getDocumentSnapshot(request))
    .snapshot.document.sketches[0]!;
  const ids: Record<string, string> = {};
  for (const [label, session] of Object.entries(definitions)) {
    const before = (await adapter.getDocumentSnapshot(request)).snapshot;
    const commit = await adapter.commitSketch({
      ...request,
      baseRevisionId: before.document.revisionId,
      solverCorrelation: {
        requestId: `request_${label}`,
        projectionRequestId: `request_${label}:project`,
        validationRequestId: `request_${label}:validate`,
        solveRequestId: `request_${label}:solve`,
        regionRequestId: `request_${label}:regions`,
      },
      sketchId: null,
      sketchLabel: label,
      plane,
      definition: session.definition,
    } as never);
    expect(commit.revisionState.kind, `premise: ${label} finishes`).toBe(
      "accepted",
    );
    ids[label] = commit.sketchId!;
  }
  const { snapshot } = await adapter.getDocumentSnapshot(request);
  const recordOf = (label: string) =>
    snapshot.document.sketches.find((entry) => entry.sketchId === ids[label])!;
  return { snapshot, recordOf };
}

const REJECTED_EXPLANATION =
  "Its last solve was not accepted, so its geometry is not current. Edit the sketch to see why, then correct it, or Undo.";
const MIRROR_EXPLANATION =
  "Mirror ‘mirror 1’ is broken: its mirror line was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line, or remove the mirror from the Mirror panel.";

async function fixture() {
  const valid = rectangleAndSpline();
  const { session: mirrored } = mirroredSession("free");
  const result = await finished({
    "Valid rectangle": valid,
    "Rejected rectangle": withConflictingCornerAngle(valid),
    "Broken mirror": deleteSelectedSketchGeometry(
      enterSketchSession(mirrored),
      [entityRef(mirrored, eid("axis"))],
    ),
  });
  const rejected = result.recordOf("Rejected rectangle");
  // Premise: the stored rejected snapshot collapses the vertical sides.
  const solvedLength = (label: string) => {
    const entityId = entityOf(rejected.sketch.definition, label).entityId;
    const solved = rejected.sketch.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === entityId,
    );
    return solved?.kind === "lineSegment"
      ? Math.hypot(
          solved.endPosition[0] - solved.startPosition[0],
          solved.endPosition[1] - solved.startPosition[1],
        )
      : NaN;
  };
  expect(rejected.sketch.derivedValidity.state).toBe("invalid");
  expect(solvedLength("Rectangle 1 right")).toBeLessThan(1e-3);
  expect(result.recordOf("Valid rectangle").sketch.derivedValidity.state).toBe(
    "current",
  );
  expect(
    result.recordOf("Broken mirror").sketch.solvedSnapshot.failedDerivationIds
      ?.length,
    "premise: the mirror is held",
  ).toBe(1);
  return result;
}

test("vector export refuses a rejected sketch and a gate-held sketch as a whole, by label; a current sketch exports its solved lines (red on base: the rejected record exported its 0.76 µm sides)", async () => {
  const { snapshot, recordOf } = await fixture();
  const exportOf = (label: string) =>
    buildSketchVectorExportModelFromSnapshot(snapshot, {
      kind: "sketch",
      sketchId: recordOf(label).sketchId,
    } as never);
  expect(exportOf("Rejected rectangle")).toEqual({
    diagnostic: {
      code: "sketch-vector-sketch-not-current",
      severity: "error",
      message: `Sketch ‘Rejected rectangle’ was not exported because it is invalid. ${REJECTED_EXPLANATION}`,
      target: {
        kind: "sketch",
        sketchId: recordOf("Rejected rectangle").sketchId,
      },
    },
  });
  expect(exportOf("Broken mirror")).toEqual({
    diagnostic: {
      code: "sketch-vector-derived-failed",
      severity: "error",
      message: `Sketch ‘Broken mirror’ was not exported because it is invalid. ${MIRROR_EXPLANATION}`,
      target: { kind: "sketch", sketchId: recordOf("Broken mirror").sketchId },
    },
  });
  // Control: the current sketch exports its four sides at full length.
  const valid = exportOf("Valid rectangle");
  if ("diagnostic" in valid) throw new Error(valid.diagnostic.message);
  expect(
    valid.entities.flatMap((entity) =>
      entity.kind === "lineSegment"
        ? [
            Math.hypot(
              entity.end[0] - entity.start[0],
              entity.end[1] - entity.start[1],
            ),
          ]
        : [],
    ),
  ).toEqual([4, 3, 4, 3]);
});

test("cross-sketch projection refuses an entity, a point and a whole sketch of a rejected or gate-held sketch by the source's label; a current source projects (red on base: the refusal named the reference id)", async () => {
  const { snapshot, recordOf } = await fixture();
  const project = (
    label: string,
    kind: "sketchEntity" | "sketchPoint" | "sketch",
  ) => {
    const record = recordOf(label);
    const line = entityOf(
      record.sketch.definition,
      label === "Broken mirror" ? "ab" : "Rectangle 1 right",
    );
    const source =
      kind === "sketch"
        ? { kind, sketchId: record.sketchId }
        : kind === "sketchEntity"
          ? { kind, sketchId: record.sketchId, entityId: line.entityId }
          : {
              kind,
              sketchId: record.sketchId,
              pointId:
                line.kind === "lineSegment" ? line.startPointId : undefined,
            };
    return projectSketchExternalReferencesFromSnapshot(snapshot, {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_t17d_projection",
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      sketchId: "sketch_t17d_target",
      plane: record.plane.frame,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-3,
      },
      references: [
        {
          referenceId: "reference_t17d",
          reference: {
            referenceId: "reference_t17d",
            kind: "sketchReference",
            label: "Projected",
            source,
          },
        },
      ],
    } as never).projectedReferences[0]!;
  };
  for (const [label, explanation] of [
    ["Rejected rectangle", REJECTED_EXPLANATION],
    ["Broken mirror", MIRROR_EXPLANATION],
  ] as const)
    for (const kind of ["sketchEntity", "sketchPoint", "sketch"] as const) {
      const projected = project(label, kind);
      expect(
        {
          status: projected.status,
          geometry: projected.geometry,
          diagnostics: projected.diagnostics.map((diagnostic) => [
            diagnostic.code,
            diagnostic.message,
          ]),
        },
        `${label} ${kind}`,
      ).toEqual({
        status: "unsupportedSource",
        geometry: [],
        diagnostics: [
          [
            "projection-source-derived-output-not-current",
            `Sketch ‘${label}’ can't be projected because it is invalid. ${explanation}`,
          ],
        ],
      });
    }
  // Control: the current source projects its line.
  expect(project("Valid rectangle", "sketchEntity").status).toBe("projected");
});

test("measurement measures a rejected sketch's held (authored) lines and spline and marks them, never reads the 0.76 µm rejected sides; a current sketch is unmarked (red on base: no mark, the spline measured from the rejected snapshot)", async () => {
  const { snapshot, recordOf } = await fixture();
  const measure = (label: string, ...entities: string[]) => {
    const record = recordOf(label);
    return deriveMeasurementViewModel({
      source: "measureTool",
      selection: entities.map((entity) => ({
        kind: "sketchEntity",
        sketchId: record.sketchId,
        entityId: entityOf(record.sketch.definition, entity).entityId,
      })) as PrimitiveRef[],
      snapshot,
    });
  };
  const HELD = `Sketch ‘Rejected rectangle’ is invalid, so this measures its held geometry (as authored), not a current solve. ${REJECTED_EXPLANATION}`;
  const right = measure("Rejected rectangle", "Rectangle 1 right");
  expect([right?.rows, right?.note]).toEqual([
    [{ id: "length", label: "Length", value: "3 mm" }],
    HELD,
  ]);
  const pair = measure(
    "Rejected rectangle",
    "Rectangle 1 right",
    "Rectangle 1 left",
  );
  expect([pair?.rows.find((row) => row.id === "distance"), pair?.note]).toEqual(
    [{ id: "distance", label: "Distance", value: "4 mm" }, HELD],
  );
  // Control: the current sketch's line and spline are measured, unmarked.
  const valid = measure("Valid rectangle", "Rectangle 1 right");
  expect([valid?.rows, valid?.note]).toEqual([
    [{ id: "length", label: "Length", value: "3 mm" }],
    null,
  ]);
  const validSpline = measure("Valid rectangle", "the spline");
  expect(validSpline?.rows.map((row) => row.id)).toEqual([
    "length",
    "closed",
    "fit-points",
  ]);
  expect(validSpline?.note).toBeNull();
  // T17d2 (T17d review A-3): the rejected sketch's spline is measured on its
  // held (authored) reconstruction, the curve part mode and sketch mode
  // draw, and marked; its fit points are where the valid sketch's are, so
  // it measures exactly what the valid spline measures.
  const spline = measure("Rejected rectangle", "the spline");
  expect([spline?.rows, spline?.note]).toEqual([validSpline?.rows, HELD]);
  expect(
    spline?.witnesses.map((witness) =>
      witness.kind === "polyline" ? witness.points : witness.position,
    ),
  ).toEqual(
    validSpline?.witnesses.map((witness) =>
      witness.kind === "polyline" ? witness.points : witness.position,
    ),
  );
});

test("T17d2 (T17d review A-3): a held spline whose authored fit points define no spline (a degenerate span) is refused by measurement, saying so", async () => {
  const valid = rectangleAndSpline();
  const spline = entityOf(valid.definition, "the spline");
  if (spline.kind !== "spline") throw new Error("premise: spline");
  const [, second, third] = orderedSplineOccurrences(spline)!;
  const at = valid.definition.points.find(
    (point) => point.pointId === third!.pointId,
  )!.position;
  const { snapshot, recordOf } = await finished({
    "Degenerate spline": {
      ...valid,
      definition: {
        ...valid.definition,
        points: valid.definition.points.map((point) =>
          point.pointId === second!.pointId
            ? { ...point, position: at }
            : point,
        ),
      },
    } as SketchSessionState,
  });
  const record = recordOf("Degenerate spline");
  expect(record.sketch.derivedValidity.state, "premise").toBe("invalid");
  const measured = deriveMeasurementViewModel({
    source: "measureTool",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: record.sketchId,
        entityId: spline.entityId,
      },
    ] as PrimitiveRef[],
    snapshot,
  });
  expect([measured?.rows, measured?.witnesses, measured?.note]).toEqual([
    [],
    [],
    `Sketch ‘Degenerate spline’ is invalid, so ‘${spline.label}’ is not measured: its held fit points do not define a spline. ${REJECTED_EXPLANATION}`,
  ]);
});

/**
 * T17d2 (T17d review R-1). The part-mode render record of `entityId` in
 * `record`, and the sketch-mode display renderable of the same entity after
 * re-entry (its own stroke, not the overconstraint diagnostic overlay).
 */
function drawnInBothModes(
  snapshot: Awaited<ReturnType<typeof finished>>["snapshot"],
  record: Awaited<
    ReturnType<typeof finished>
  >["snapshot"]["document"]["sketches"][number],
) {
  const entered = enterSketchSession(
    createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS),
  );
  const sketchMode = getSketchSessionDisplayRenderables(entered);
  const pointsOf = (
    geometry:
      | RenderableEntityRecord["geometry"]
      | SketchSessionDisplayRenderable["geometry"],
  ): readonly (readonly number[])[] =>
    geometry.kind === "polyline"
      ? geometry.points
      : geometry.kind === "marker"
        ? [geometry.position]
        : [];
  return {
    entered,
    part: (kind: "sketchEntity" | "sketchPoint", id: string) => {
      const found = snapshot.document.render.records.filter(
        (entry) =>
          entry.binding.target.kind === kind &&
          entry.binding.target.sketchId === record.sketchId &&
          (kind === "sketchEntity"
            ? (entry.binding.target as { entityId: string }).entityId
            : (entry.binding.target as { pointId: string }).pointId) === id,
      );
      expect(found, `one part-mode record of ${id}`).toHaveLength(1);
      return pointsOf(found[0]!.geometry);
    },
    sketch: (kind: "sketchEntity" | "sketchPoint", id: string) => {
      const found = sketchMode.filter(
        (entry) =>
          entry.target?.kind === kind &&
          (kind === "sketchEntity"
            ? (entry.target as { entityId: string }).entityId
            : (entry.target as { pointId: string }).pointId) === id &&
          entry.diagnosticStyle === undefined &&
          entry.markerLayer === undefined,
      );
      expect(found, `one sketch-mode renderable of ${id}`).toHaveLength(1);
      return pointsOf(found[0]!.geometry);
    },
  };
}

const lengthOf = (points: readonly (readonly number[])[]) =>
  Math.hypot(
    points[1]![0]! - points[0]![0]!,
    points[1]![1]! - points[0]![1]!,
    points[1]![2]! - points[0]![2]!,
  );

/** Every point of `actual` within 1e-9 of the same point of `expected`. */
function expectSamePoints(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
  message: string,
) {
  expect(actual.length, message).toBe(expected.length);
  const worst = Math.max(
    0,
    ...actual.map((point, index) =>
      Math.hypot(
        ...point.map((value, axis) => value - expected[index]![axis]!),
      ),
    ),
  );
  expect(worst, message).toBeLessThan(1e-9);
}

/** Points of a circle or arc polyline all at `radius` from `center`. */
function expectOnCircle(
  points: readonly (readonly number[])[],
  center: readonly number[],
  radius: number,
  message: string,
) {
  for (const point of points)
    expect(
      Math.hypot(point[0]! - center[0]!, point[1]! - center[1]!),
      message,
    ).toBeCloseTo(radius, 9);
}

/** Every point of `points` within `tolerance` of the polyline `along`. */
function expectAlong(
  points: readonly (readonly number[])[],
  along: readonly (readonly number[])[],
  tolerance: number,
  message: string,
) {
  const toSegment = (
    point: readonly number[],
    a: readonly number[],
    b: readonly number[],
  ) => {
    const [dx, dy] = [b[0]! - a[0]!, b[1]! - a[1]!];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0]! - a[0]!) * dx + (point[1]! - a[1]!) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    return Math.hypot(point[0]! - a[0]! - t * dx, point[1]! - a[1]! - t * dy);
  };
  for (const point of points)
    expect(
      Math.min(
        ...along
          .slice(1)
          .map((end, index) => toSegment(point, along[index]!, end)),
      ),
      message,
    ).toBeLessThan(tolerance);
}

/**
 * Part mode draws every non-construction curve and point of `record` where
 * the re-entered sketch mode draws it: lines and splines point for point;
 * circles and arcs (sampled at other densities) on the same circle, arcs
 * from the same ends along the same side.
 */
function expectPartModeDrawsSketchMode(
  snapshot: Awaited<ReturnType<typeof finished>>["snapshot"],
  record: Awaited<
    ReturnType<typeof finished>
  >["snapshot"]["document"]["sketches"][number],
) {
  const drawn = drawnInBothModes(snapshot, record);
  const { definition } = record.sketch;
  const at = (pointId: string) => drawn.sketch("sketchPoint", pointId)[0]!;
  for (const point of definition.points.filter(
    (entry) => !entry.isConstruction,
  ))
    expectSamePoints(
      drawn.part("sketchPoint", point.pointId),
      drawn.sketch("sketchPoint", point.pointId),
      `${record.label}: point ${point.label}`,
    );
  const kinds: string[] = [];
  for (const entity of definition.entities) {
    if (entity.isConstruction || entity.kind === "point") continue;
    kinds.push(entity.kind);
    const part = drawn.part("sketchEntity", entity.entityId);
    const message = `${record.label}: ${entity.label}`;
    if (entity.kind === "circle") {
      expectOnCircle(part, at(entity.centerPointId), entity.radius, message);
      expectOnCircle(
        drawn.sketch("sketchEntity", entity.entityId),
        at(entity.centerPointId),
        entity.radius,
        message,
      );
    } else if (entity.kind === "arc") {
      const center = at(entity.centerPointId);
      const start = at(entity.startPointId);
      const radius = Math.hypot(start[0]! - center[0]!, start[1]! - center[1]!);
      expectOnCircle(part, center, radius, message);
      const sketch = drawn.sketch("sketchEntity", entity.entityId);
      expectSamePoints(
        [part[0]!, part.at(-1)!],
        [sketch[0]!, sketch.at(-1)!],
        `${message}: ends`,
      );
      expectAlong(part, sketch, radius * 0.05, `${message}: same side`);
    } else
      expectSamePoints(
        part,
        // A degenerate spline (T17c3) is drawn through its fit points; sketch
        // mode keeps the repeated one, part mode draws it once.
        drawn
          .sketch("sketchEntity", entity.entityId)
          .filter(
            (point, index, all) =>
              index === 0 || String(point) !== String(all[index - 1]),
          ),
        message,
      );
  }
  return { kinds, drawn };
}

test("T17d2: part mode draws a rejected sketch (T13e2 95° rectangle with a spline from its corner) as sketch mode does on re-entry — held sides 3 and 4 mm, the authored spline reconstruction, the authored points — never the rejected solve; measurement measures that spline (red on base: part mode drew the rejected solve)", async () => {
  const valid = rectangleAndSpline(true);
  const adapter = occAdapter();
  const { snapshot, recordOf } = await finished(
    {
      "Valid rectangle": valid,
      "Rejected rectangle": withConflictingCornerAngle(valid),
    },
    adapter,
  );
  try {
    const record = recordOf("Rejected rectangle");
    expect(record.sketch.derivedValidity.state, "premise").toBe("invalid");
    const { kinds, drawn } = expectPartModeDrawsSketchMode(snapshot, record);
    expect(kinds).toEqual([
      "lineSegment",
      "lineSegment",
      "lineSegment",
      "lineSegment",
      "spline",
    ]);
    expect(drawn.entered.liveSolve?.accepted, "premise: re-entry rejects").toBe(
      false,
    );
    expect(
      ["bottom", "right", "top", "left"].map((side) =>
        lengthOf(
          drawn.part(
            "sketchEntity",
            entityOf(record.sketch.definition, `Rectangle 1 ${side}`).entityId,
          ),
        ),
      ),
      "the held sides, not the rejected 2.73 mm / 0.76 µm ones",
    ).toEqual([4, 3, 4, 3]);
    // The spline is the authored reconstruction (the valid sketch's curve).
    const spline = entityOf(record.sketch.definition, "the spline");
    if (spline.kind !== "spline") throw new Error("premise: spline");
    expectSamePoints(
      drawn.part("sketchEntity", spline.entityId),
      tessellateCubicSpans(
        reconstructSplineAggregate(
          spline,
          Object.fromEntries(
            record.sketch.definition.points.map((point) => [
              point.pointId,
              point.position,
            ]),
          ),
        ).spans,
      ).map(([x, y]) => [x, y, 0]),
      "the authored spline reconstruction",
    );
    // Premise: the rejected solve moved the spline (its first fit point is
    // the rectangle's corner), so drawing it would differ.
    const rejectedSpline = record.sketch.solvedSnapshot.solvedEntities.find(
      (entry) => entry.entityId === spline.entityId,
    );
    if (rejectedSpline?.kind !== "spline") throw new Error("premise: solved");
    const rejectedPoints = tessellateCubicSpans(
      rejectedSpline.reconstruction.spans,
    );
    const drawnSpline = drawn.part("sketchEntity", spline.entityId);
    expect(
      Math.max(
        ...rejectedPoints.map(([x, y], index) =>
          Math.hypot(x - drawnSpline[index]![0]!, y - drawnSpline[index]![1]!),
        ),
      ),
      "premise: the rejected solve moved the spline",
    ).toBeGreaterThan(1e-3);
    // Measurement agrees with the display (T17d review A-3): the held
    // spline measures what the valid sketch's spline (same authored fit
    // points, accepted) measures, marked.
    const measure = (label: string) =>
      deriveMeasurementViewModel({
        source: "measureTool",
        selection: [
          {
            kind: "sketchEntity",
            sketchId: recordOf(label).sketchId,
            entityId: entityOf(recordOf(label).sketch.definition, "the spline")
              .entityId,
          },
        ] as PrimitiveRef[],
        snapshot,
      });
    const held = measure("Rejected rectangle");
    const accepted = measure("Valid rectangle");
    expect(accepted?.note, "premise: the valid spline is current").toBeNull();
    expect(held?.rows).toEqual(accepted?.rows);
    expect(held?.note).toMatch(
      /^Sketch ‘Rejected rectangle’ is invalid, so this measures its held geometry \(as authored\)/,
    );
    expect(
      held?.witnesses.map((witness) => "points" in witness && witness.points),
    ).toEqual(
      accepted?.witnesses.map(
        (witness) => "points" in witness && witness.points,
      ),
    );
  } finally {
    adapter.dispose();
  }
}, 240_000);

/** The solved minus the held position of `pointId` (0: the solve kept it). */
function solveMoved(
  record: Awaited<
    ReturnType<typeof finished>
  >["snapshot"]["document"]["sketches"][number],
  pointId: string,
) {
  const held = record.sketch.definition.points.find(
    (point) => point.pointId === pointId,
  )!.position;
  const solved = record.sketch.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === pointId,
  )!.solvedPosition;
  return Math.hypot(solved[0] - held[0], solved[1] - held[1]);
}

test("T17d2 review R-1: part mode draws a rejected sketch's circles, arc and degenerate spline held, as sketch mode does, where the rejected solve moved their centres, radius and fit points", async () => {
  let shapes = rectangleAndSpline(true);
  // A circle centred on the conflicting corner, a circle through it (its
  // radius is driven by the corner) and a 3-point arc from a corner.
  shapes = draw(shapes, "circle", [
    [5, 4],
    [5.5, 4],
  ]);
  shapes = draw(shapes, "circle", [
    [8, 8],
    [5, 4],
  ]);
  shapes = draw(shapes, "threePointArc", [
    [5, 1],
    [5, 3],
    [6, 2],
  ]);
  // The corner on the second circle (radius 5 through it).
  const through = shapes.definition.entities.filter(
    (entity) => entity.kind === "circle",
  )[1]!;
  const topRight = entityOf(shapes.definition, "Rectangle 1 right");
  if (topRight.kind !== "lineSegment") throw new Error("premise: line");
  shapes = rebuildSessionForDefinition(shapes, {
    definition: {
      ...shapes.definition,
      constraintIds: [
        ...shapes.definition.constraintIds,
        "constraint_t17d2_corner_on_circle" as never,
      ],
      constraints: [
        ...shapes.definition.constraints,
        {
          constraintId: "constraint_t17d2_corner_on_circle" as never,
          kind: "pointOnCurve",
          label: "Corner on circle",
          point: { kind: "localPoint", pointId: topRight.endPointId },
          curve: { kind: "localEntity", entityId: through.entityId },
        },
      ],
    },
  });
  expect(shapes.liveSolve?.accepted, "premise: the shapes solve").toBe(true);
  const rejectedShapes = withConflictingCornerAngle(shapes);
  // The spline from the corner with its second fit point authored onto the
  // first (a degenerate span), in the rejected rectangle.
  const rejected = withConflictingCornerAngle(rectangleAndSpline(true));
  const spline = entityOf(rejected.definition, "the spline");
  if (spline.kind !== "spline") throw new Error("premise: spline");
  const [first, second] = orderedSplineOccurrences(spline)!;
  const corner = rejected.definition.points.find(
    (point) => point.pointId === first!.pointId,
  )!.position;
  const degenerate = {
    ...rejected,
    definition: {
      ...rejected.definition,
      points: rejected.definition.points.map((point) =>
        point.pointId === second!.pointId
          ? { ...point, position: corner }
          : point,
      ),
    },
  } as SketchSessionState;
  const adapter = occAdapter();
  const { snapshot, recordOf } = await finished(
    {
      "Rejected shapes": rejectedShapes,
      "Rejected degenerate spline": degenerate,
    },
    adapter,
  );
  try {
    const shapesRecord = recordOf("Rejected shapes");
    expect(shapesRecord.sketch.derivedValidity.state, "premise").toBe(
      "invalid",
    );
    const { definition, solvedSnapshot } = shapesRecord.sketch;
    const circles = definition.entities.filter(
      (entity) => entity.kind === "circle",
    );
    const arc = definition.entities.find((entity) => entity.kind === "arc");
    if (circles.length !== 2 || arc?.kind !== "arc")
      throw new Error("premise: two circles and an arc");
    const solvedOf = (entityId: string) =>
      solvedSnapshot.solvedEntities.find(
        (entry) => entry.entityId === entityId,
      );
    // Premises: the rejected solve moved what is drawn held.
    expect(
      circles.some(
        (circle) =>
          circle.kind === "circle" &&
          solveMoved(shapesRecord, circle.centerPointId) > 1e-3,
      ),
      "premise: the solve moved a circle's centre",
    ).toBe(true);
    expect(
      circles.some((circle) => {
        const solved = solvedOf(circle.entityId);
        return (
          circle.kind === "circle" &&
          solved?.kind === "circle" &&
          Math.abs(solved.solvedRadius - circle.radius) > 1e-3
        );
      }),
      "premise: the solve changed a circle's radius",
    ).toBe(true);
    for (const pointId of [arc.centerPointId, arc.startPointId, arc.endPointId])
      expect(
        solveMoved(shapesRecord, pointId),
        "premise: the solve moved the arc",
      ).toBeGreaterThan(1e-3);
    const { kinds } = expectPartModeDrawsSketchMode(snapshot, shapesRecord);
    expect(kinds).toEqual([
      "lineSegment",
      "lineSegment",
      "lineSegment",
      "lineSegment",
      "spline",
      "circle",
      "circle",
      "arc",
    ]);

    const degenerateRecord = recordOf("Rejected degenerate spline");
    expect(degenerateRecord.sketch.derivedValidity.state, "premise").toBe(
      "invalid",
    );
    expect(
      solveMoved(degenerateRecord, first!.pointId),
      "premise: the solve moved the spline's first fit point",
    ).toBeGreaterThan(1e-3);
    const drawn = expectPartModeDrawsSketchMode(snapshot, degenerateRecord);
    expect(drawn.kinds).toContain("spline");
    expect(
      drawn.drawn.part("sketchEntity", spline.entityId)[0],
      "the degenerate spline starts at the held corner",
    ).toEqual([corner[0], corner[1], 0]);
  } finally {
    adapter.dispose();
  }
}, 300_000);

test("T17d2 review R-2: a spline whose reconstruction is invalid (a crafted file: endSpanParameterLengths.start = -1) is not drawn in part mode, as in sketch mode, and the document snapshot still normalizes (red on base: a 0-point polyline broke it)", async () => {
  const valid = rectangleAndSpline(true);
  const definition = structuredClone(valid.definition);
  const spline = definition.entities.find((entity) => entity.kind === "spline");
  if (spline?.kind !== "spline") throw new Error("premise: spline");
  (spline as { endSpanParameterLengths?: unknown }).endSpanParameterLengths = {
    start: -1,
  };
  const adapter = occAdapter();
  const { snapshot, recordOf } = await finished(
    { Crafted: { ...valid, definition } as SketchSessionState },
    adapter,
  );
  try {
    const record = recordOf("Crafted");
    expect(record.sketch.derivedValidity.state, "premise").toBe("invalid");
    const records = (sketchId: string, entityId?: string) =>
      snapshot.document.render.records.filter(
        (entry) =>
          entry.binding.target.kind === "sketchEntity" &&
          entry.binding.target.sketchId === sketchId &&
          (entityId === undefined ||
            (entry.binding.target as { entityId: string }).entityId ===
              entityId),
      );
    expect(
      records(record.sketchId, spline.entityId),
      "the spline is not drawn",
    ).toEqual([]);
    expect(records(record.sketchId).length, "the sides are drawn").toBe(4);
    expect(
      getSketchSessionDisplayRenderables(
        enterSketchSession(
          createSketchSessionFromSnapshot(record, OCC_KERNEL_SETTINGS),
        ),
      ).filter(
        (entry) =>
          entry.target?.kind === "sketchEntity" &&
          (entry.target as { entityId: string }).entityId === spline.entityId,
      ),
      "sketch mode draws nothing for it either",
    ).toEqual([]);
    expect(() => normalizeWorkspaceSnapshot(snapshot)).not.toThrow();
  } finally {
    adapter.dispose();
  }
}, 300_000);

test("T17d2: part mode draws a sketch held by a broken mirror (axis deleted) as sketch mode does — seeds and held copies (line, circle, spline, arc) where the definition holds them", async () => {
  const { session: mirrored, relationship } = mirroredSession("free");
  const adapter = occAdapter();
  const { snapshot, recordOf } = await finished(
    {
      "Broken mirror": deleteSelectedSketchGeometry(
        enterSketchSession(mirrored),
        [entityRef(mirrored, eid("axis"))],
      ),
    },
    adapter,
  );
  try {
    const record = recordOf("Broken mirror");
    expect(record.sketch.derivedValidity.state, "premise").toBe("invalid");
    expect(
      record.sketch.solvedSnapshot.failedDerivationIds,
      "premise: the mirror is held",
    ).toEqual([relationship.derivationId]);
    const { kinds } = expectPartModeDrawsSketchMode(snapshot, record);
    for (const kind of ["lineSegment", "circle", "spline", "arc"])
      expect(
        kinds.filter((entry) => entry === kind).length,
        `seed and held copy: ${kind}`,
      ).toBeGreaterThanOrEqual(2);
  } finally {
    adapter.dispose();
  }
}, 240_000);

test("T17d2: a current sketch is drawn exactly as before — from its accepted solve, bitwise, even where the authored positions differ", async () => {
  const valid = rectangleAndSpline();
  // Authored off the solve: the top-right corner 0.5 right of where the
  // horizontal/vertical sides allow, so the accepted solve moves it.
  const corner = entityOf(valid.definition, "Rectangle 1 right");
  if (corner.kind !== "lineSegment") throw new Error("premise: line");
  const offSolve = {
    ...valid,
    definition: {
      ...valid.definition,
      points: valid.definition.points.map((point) =>
        point.pointId === corner.endPointId
          ? {
              ...point,
              position: [point.position[0] + 0.5, point.position[1]] as const,
            }
          : point,
      ),
    },
  } as SketchSessionState;
  const adapter = occAdapter();
  const { snapshot, recordOf } = await finished(
    { "Valid rectangle": offSolve },
    adapter,
  );
  try {
    const record = recordOf("Valid rectangle");
    const { definition, solvedSnapshot, derivedValidity } = record.sketch;
    expect(derivedValidity.state, "premise").toBe("current");
    const solvedAt = new Map(
      solvedSnapshot.solvedPoints.map(
        (point) => [point.pointId, point.solvedPosition] as const,
      ),
    );
    expect(
      definition.points.filter(
        (point) =>
          solvedAt.get(point.pointId)![0] !== point.position[0] ||
          solvedAt.get(point.pointId)![1] !== point.position[1],
      ).length,
      "premise: the solve moved authored points",
    ).toBeGreaterThan(0);
    const records = snapshot.document.render.records.filter(
      (entry) =>
        (entry.binding.target.kind === "sketchEntity" ||
          entry.binding.target.kind === "sketchPoint") &&
        entry.binding.target.sketchId === record.sketchId,
    );
    // The geometry the base build draws: the solved records, point for
    // point, through the same plane mapping.
    const world = (point: readonly [number, number]) =>
      mapSketchPointToWorld(record.plane, point);
    const expected = [
      ...solvedSnapshot.solvedEntities.flatMap((entity) =>
        entity.kind === "lineSegment"
          ? [[world(entity.startPosition), world(entity.endPosition)]]
          : entity.kind === "spline"
            ? [tessellateCubicSpans(entity.reconstruction.spans).map(world)]
            : [],
      ),
      ...definition.points.flatMap((point) =>
        point.isConstruction ? [] : [[world(solvedAt.get(point.pointId)!)]],
      ),
    ];
    expect(
      definition.entities.filter((entity) => entity.isConstruction),
      "premise: no construction curve",
    ).toEqual([]);
    expect(
      records.map((entry) =>
        entry.geometry.kind === "polyline"
          ? entry.geometry.points
          : entry.geometry.kind === "marker"
            ? [entry.geometry.position]
            : null,
      ),
    ).toStrictEqual(expected);
  } finally {
    adapter.dispose();
  }
}, 240_000);
