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
import { expect, test } from "vitest";

import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchEntityDefinition } from "@/contracts/sketch/schema";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  finalizeSketchDraw,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  eid,
  entityRef,
  mirroredSession,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import { buildSketchVectorExportModelFromSnapshot } from "@/domain/export/sketch-vector-export-model";
import { deriveMeasurementViewModel } from "@/domain/measure/measurement";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { projectSketchExternalReferencesFromSnapshot } from "@/domain/modeling/sketch-reference-projection";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

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

/** A rectangle [1,1]–[5,4] and a spline far from it, in an entered session. */
function rectangleAndSpline() {
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
  session = draw(session, "spline", [
    [10, 1],
    [12, 3],
    [14, 1],
  ]);
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

/** Real Finishes of `definitions` (by label) into one mock document. */
async function finished(definitions: Record<string, SketchSessionState>) {
  const adapter = new MockKernelAdapter({
    solverAdapter: new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      revisionId: null,
    }),
  });
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
      plane: before.document.sketches[0]!.plane,
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
  "Its last solve was not accepted, so its geometry is not current. Edit the sketch to see why, then correct it or Undo.";
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

test("measurement measures a rejected sketch's held (authored) lines and marks them, refuses its spline, never reads the 0.76 µm rejected sides; a current sketch is unmarked (red on base: no mark, the spline measured from the rejected snapshot)", async () => {
  const { snapshot, recordOf } = await fixture();
  const measure = (label: string, ...entities: string[]) => {
    const record = recordOf(label);
    return deriveMeasurementViewModel({
      activeToolId: "measure",
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
  const spline = measure("Rejected rectangle", "the spline");
  const splineLabel = entityOf(
    recordOf("Rejected rectangle").sketch.definition,
    "the spline",
  ).label;
  expect([spline?.rows, spline?.witnesses, spline?.note]).toEqual([
    [],
    [],
    `Sketch ‘Rejected rectangle’ is invalid, so ‘${splineLabel}’ is not measured: its curve is only defined by an accepted solve. ${REJECTED_EXPLANATION}`,
  ]);
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
});
