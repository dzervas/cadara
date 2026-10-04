import { describe, expect, test } from "vitest";
import type {
  SketchToolId,
  SketchToolLifecycle,
} from "@/core/sketch-tools/definition";
import { getRegisteredSketchToolDefinitions } from "@/core/sketch-tools/registry";
import {
  acceptSketchDraw,
  beginSketchTool,
  confirmSketchDrawing,
  createNewSketchSession,
  escapeSketchDrawing,
  resolveSketchDrawingEscapeStep,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

// T11g (T11-D9, D10, D19, D20): the lifecycle metadata of every drawing
// tool and the Escape/Enter steps an armed tool takes.

const expectedLifecycles: Record<SketchToolId, SketchToolLifecycle> = {
  point: "discrete",
  line: "chain",
  midpointLine: "discrete",
  rectangle: "discrete",
  centerPointRectangle: "discrete",
  alignedRectangle: "discrete",
  circle: "discrete",
  threePointCircle: "discrete",
  centerPointArc: "discrete",
  threePointArc: "discrete",
  tangentArc: "discrete",
  ellipse: "discrete",
  ellipticalArc: "discrete",
  conic: "discrete",
  bezierCurve: "discrete",
  inscribedPolygon: "discrete",
  circumscribedPolygon: "discrete",
  spline: { kind: "fitPoints", minimum: 2 },
  controlPointSpline: "discrete",
  profileText: "discrete",
};

function armed(toolId: SketchToolId) {
  return beginSketchTool(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    toolId,
  );
}

test("every registered drawing tool declares its lifecycle (T11-D9)", () => {
  const actual = Object.fromEntries(
    getRegisteredSketchToolDefinitions().map((definition) => [
      definition.metadata.id,
      definition.lifecycle,
    ]),
  );

  expect(
    actual,
    "Line chains, Spline takes fit points (minimum 2) and every other tool, including the control-point spline, is discrete.",
  ).toEqual(expectedLifecycles);
  expect(Object.keys(actual)).toHaveLength(20);
});

test("the Escape step order is chain end, finalize, cancel, exit (T11-D10)", () => {
  const rows = [
    [{ chainActive: true, finalizable: true, incomplete: true }, "endChain"],
    [{ chainActive: true, finalizable: false, incomplete: false }, "endChain"],
    [
      { chainActive: false, finalizable: true, incomplete: true },
      "finalizeDraft",
    ],
    [
      { chainActive: false, finalizable: true, incomplete: false },
      "finalizeDraft",
    ],
    [
      { chainActive: false, finalizable: false, incomplete: true },
      "cancelDraft",
    ],
    [{ chainActive: false, finalizable: false, incomplete: false }, "exitTool"],
  ] as const;

  for (const [draft, step] of rows) {
    expect(resolveSketchDrawingEscapeStep(draft), JSON.stringify(draft)).toBe(
      step,
    );
  }
});

describe("Escape and Enter on every armed drawing tool", () => {
  for (const toolId of Object.keys(expectedLifecycles) as SketchToolId[]) {
    test(toolId, () => {
      const session = armed(toolId);
      expect(
        escapeSketchDrawing(session),
        "An armed tool with no draft leaves for Select.",
      ).toBe("exitTool");
      expect(confirmSketchDrawing(session), "Enter has nothing to do.").toBe(
        null,
      );

      const clicked = startSketchDraw(session, [1, 1]);
      if (toolId === "point") {
        expect(
          clicked.status,
          "Point completes on its click, so no draft is left.",
        ).toBe("idle");
        expect(escapeSketchDrawing(clicked)).toBe("exitTool");
        return;
      }

      expect(clicked.status, "The first click starts a draft.").toBe("drawing");
      expect(
        escapeSketchDrawing(clicked),
        "Escape cancels the incomplete draft.",
      ).toBe("cancelDraft");
      expect(
        confirmSketchDrawing(clicked),
        "Enter does not cancel or commit an incomplete draft (review A-9).",
      ).toBe(null);
    });
  }
});

test("before T11i a 2-point spline draft cancels on Escape and Enter does nothing", () => {
  // The spline still commits on its third click until T11i, so the finalize
  // step cannot apply yet (review A-12).
  const twoPoints = acceptSketchDraw(
    startSketchDraw(armed("spline"), [0, 0]),
    [4, 2],
  );

  expect(twoPoints.status).toBe("drawing");
  expect(twoPoints.toolPlacedPoints).toHaveLength(2);
  expect(escapeSketchDrawing(twoPoints)).toBe("cancelDraft");
  expect(confirmSketchDrawing(twoPoints)).toBe(null);
});

test("Point commits one point entity on a single click (T11-D19)", () => {
  const session = startSketchDraw(armed("point"), [1, 2]);

  expect(
    session.definition.entities.map((entity) => entity.kind),
    "One click creates exactly one point entity.",
  ).toEqual(["point"]);
  expect(session.definition.points).toHaveLength(1);
  expect(session.definition.points[0]?.position).toEqual([1, 2]);
  expect(session.activeTool, "Point stays armed.").toBe("point");
  expect(session.toolStagedEntities, "No draft preview is left.").toEqual([]);
  expect(
    session.commitRequest?.definition.entities.map((entity) => entity.kind),
  ).toEqual(["point"]);

  const second = startSketchDraw(session, [3, 4]);
  expect(
    second.definition.entities.map((entity) => entity.kind),
    "The next click places the next point.",
  ).toEqual(["point", "point"]);
});

test("a single Point click keeps snap inference: coincident on an endpoint, midpoint on a line (T11-D19, review V-4)", () => {
  let session = acceptSketchDraw(
    startSketchDraw(armed("line"), [0, 0]),
    [10, 0],
  );
  const line = session.definition.entities.find(
    (entity) => entity.kind === "lineSegment",
  );
  if (line?.kind !== "lineSegment") throw Error("Expected the line fixture.");
  session = beginSketchTool(session, "point");

  const newConstraints = (before: typeof session, after: typeof session) =>
    after.definition.constraints.filter(
      (constraint) =>
        !before.definition.constraints.some(
          (existing) => existing.constraintId === constraint.constraintId,
        ),
    );
  const lastPoint = (current: typeof session) =>
    current.definition.points.at(-1)!;

  // Near the line's end point: snapped onto it and made coincident.
  const onEnd = startSketchDraw(session, [10.05, 0.05]);
  expect(lastPoint(onEnd).position).toEqual([10, 0]);
  expect(
    newConstraints(session, onEnd).map((constraint) => ({
      kind: constraint.kind,
      pointIds:
        constraint.kind === "coincident"
          ? [...constraint.pointIds].sort()
          : null,
    })),
    "The one click infers exactly one coincident with the line's end point.",
  ).toEqual([
    {
      kind: "coincident",
      pointIds: [line.endPointId, lastPoint(onEnd).pointId].sort(),
    },
  ]);

  // Near the line's midpoint: snapped onto it with a midpoint constraint.
  const onMiddle = startSketchDraw(onEnd, [5, 0.05]);
  expect(lastPoint(onMiddle).position).toEqual([5, 0]);
  expect(
    newConstraints(onEnd, onMiddle),
    "The one click infers exactly one midpoint constraint on the line.",
  ).toMatchObject([
    {
      kind: "midpoint",
      point: { kind: "localPoint", pointId: lastPoint(onMiddle).pointId },
      line: { kind: "localEntity", entityId: line.entityId },
    },
  ]);
});
