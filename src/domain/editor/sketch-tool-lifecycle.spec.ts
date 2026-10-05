import { describe, expect, test } from "vitest";
import type {
  SketchToolId,
  SketchToolLifecycle,
} from "@/core/sketch-tools/definition";
import { getRegisteredSketchToolDefinitions } from "@/core/sketch-tools/registry";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  confirmSketchDrawing,
  createNewSketchSession,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  escapeSketchDrawing,
  finalizeSketchDraw,
  focusSketchStyleTool,
  resolveSketchDrawingEscapeStep,
  startSketchDraw,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import { getSketchToolMarkerPointIds } from "@/domain/editor/sketch-session/display";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
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

// T11i (T11-D10, D13): the fit-point spline lifecycle.
describe("fit-point spline (T11i)", () => {
  type Session = ReturnType<typeof armed>;

  function place(session: Session, points: readonly [number, number][]) {
    return points.reduce(
      (current, point) =>
        current.status === "drawing"
          ? acceptSketchDraw(current, point)
          : startSketchDraw(current, point),
      session,
    );
  }

  function splines(session: Session) {
    return session.definition.entities.flatMap((entity) =>
      entity.kind === "spline" ? [entity] : [],
    );
  }

  test("2 points finalize on Escape and on Enter; 1 point cancels on Escape and Enter does nothing (T11-D10, review A-9)", () => {
    const one = place(armed("spline"), [[0, 0]]);
    expect(one.status).toBe("drawing");
    expect(escapeSketchDrawing(one), "1 point: Escape cancels.").toBe(
      "cancelDraft",
    );
    expect(confirmSketchDrawing(one), "1 point: Enter does nothing.").toBe(
      null,
    );
    expect(
      finalizeSketchDraw(one),
      "Finalizing below the minimum changes nothing.",
    ).toBe(one);

    const two = acceptSketchDraw(one, [4, 2]);
    expect(two.status).toBe("drawing");
    expect(two.toolPlacedPoints).toHaveLength(2);
    expect(escapeSketchDrawing(two), "2 points: Escape finalizes.").toBe(
      "finalizeDraft",
    );
    expect(confirmSketchDrawing(two), "2 points: Enter finalizes.").toBe(
      "finalizeDraft",
    );

    const finalized = finalizeSketchDraw(two);
    expect(splines(finalized), "One spline is committed.").toHaveLength(1);
    expect(finalized.definition.points.map(({ position }) => position)).toEqual(
      [
        [0, 0],
        [4, 2],
      ],
    );
    expect(finalized.activeTool, "Spline stays armed.").toBe("spline");
    expect(finalized.status).toBe("idle");
    expect(finalized.toolPlacedPoints).toEqual([]);
    expect(finalized.toolStagedEntities).toEqual([]);
    expect(
      escapeSketchDrawing(finalized),
      "With no draft, the next Escape leaves Spline.",
    ).toBe("exitTool");
    expect(confirmSketchDrawing(finalized)).toBe(null);
  });

  test("keeps adding fit points past 3, ignores a release on the last fit point, and commits every point", () => {
    const points: [number, number][] = [
      [0, 0],
      [1, 2],
      [3, 0],
      [4, 2],
      [6, 1],
    ];
    let session = place(armed("spline"), points.slice(0, 3));
    expect(session.status, "The third click does not commit.").toBe("drawing");
    expect(splines(session)).toEqual([]);

    const ignored = acceptSketchDraw(session, [3, 0]);
    expect(
      ignored.toolPlacedPoints,
      "A release on the last fit point is ignored.",
    ).toEqual(points.slice(0, 3));
    expect(ignored.status).toBe("drawing");
    expect(ignored.validationMessage).toBe(null);
    expect(ignored.definition).toBe(session.definition);

    session = place(ignored, points.slice(3));
    expect(session.toolPlacedPoints).toEqual(points);
    const finalized = finalizeSketchDraw(session);
    const [spline] = splines(finalized);
    expect(
      finalized.definition.points.map(({ position }) => position),
      "All 5 fit points are kept.",
    ).toEqual(points);
    expect(
      spline?.pointOccurrences.map((occurrence) => occurrence.pointId),
    ).toEqual(finalized.definition.points.map(({ pointId }) => pointId));
  });

  test("the preview refits a smooth owner curve through every placed point and the live pointer, not a polyline", () => {
    const placed: [number, number][] = [
      [0, 0],
      [1, 2],
      [3, 0],
      [4, 2],
    ];
    const live: [number, number] = [6, 1];
    const session = updateSketchPointer(place(armed("spline"), placed), live);
    const preview = session.toolStagedEntities.find(
      (entity) => entity.kind === "spline",
    );
    if (preview?.kind !== "spline") throw Error("Expected a spline preview.");

    const distanceTo = ([x, y]: readonly [number, number]) =>
      Math.min(...preview.points.map(([px, py]) => Math.hypot(px - x, py - y)));
    for (const point of [...placed, live]) {
      expect(
        distanceTo(point),
        `The preview passes through ${JSON.stringify(point)}.`,
      ).toBeLessThan(1e-9);
    }
    expect(
      preview.points.length,
      "Sampled curve, far more samples than fit points.",
    ).toBeGreaterThan(4 * (placed.length + 1));
    // The first span bends away from its chord (0,0)–(1,2).
    const chordDistance = ([x, y]: readonly [number, number]) =>
      Math.abs(2 * x - y) / Math.hypot(2, 1);
    expect(
      Math.max(...preview.points.slice(0, 17).map(chordDistance)),
      "The preview is a smooth curve, not the control polygon.",
    ).toBeGreaterThan(0.01);

    // The preview is exactly what finalizing at the live point commits.
    const committed = finalizeSketchDraw(acceptSketchDraw(session, live));
    expect(
      deriveSketchDisplayEntities(committed).find(
        (entity) => entity.kind === "spline",
      )?.points,
    ).toEqual(preview.points);
  });

  test("the finalize commit infers the start and end snaps; the last fit point's snap survives a later pointer move", () => {
    let session = acceptSketchDraw(
      startSketchDraw(armed("line"), [0, 0]),
      [10, 0],
    );
    const [line] = session.definition.entities;
    if (line?.kind !== "lineSegment") throw Error("Expected the line.");
    session = beginSketchTool(session, "spline");
    session = place(session, [
      [0, 0],
      [5, 6],
      [10, 0],
    ]);
    // The pointer moves on before Enter.
    session = updateSketchPointer(session, [20, 20]);
    const finalized = finalizeSketchDraw(session);
    const [spline] = splines(finalized);
    const fitPointIds = spline?.pointOccurrences.map(
      (occurrence) => occurrence.pointId,
    );
    expect(
      finalized.definition.points
        .filter(({ pointId }) => fitPointIds?.includes(pointId))
        .map(({ position }) => position),
    ).toEqual([
      [0, 0],
      [5, 6],
      [10, 0],
    ]);
    expect(
      finalized.definition.constraints
        .filter((constraint) => constraint.kind === "coincident")
        .map((constraint) =>
          constraint.kind === "coincident"
            ? [...constraint.pointIds].sort()
            : [],
        ),
      "Coincident with the line's start (start snap) and end (end snap).",
    ).toEqual([
      [line.startPointId, fitPointIds![0]!].sort(),
      [line.endPointId, fitPointIds![2]!].sort(),
    ]);
  });

  test("a restore keeps the placed fit points and drops a last-point snap whose point was undone (T11-D12)", () => {
    const empty = armed("spline");
    let session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(empty, "line"), [0, 0]),
      [10, 0],
    );
    session = place(beginSketchTool(session, "spline"), [
      [5, 6],
      [10.05, 0.05],
    ]);
    expect(
      session.fitPointEndSnap?.sources,
      "premise: the last fit point snapped onto the line end",
    ).toContainEqual(expect.objectContaining({ kind: "localPoint" }));

    // Undo the line: the draft keeps its positions, the stale snap goes.
    const restored = rebuildSessionForDefinition(session, {
      definition: empty.definition,
    });
    expect(restored.activeTool).toBe("spline");
    expect(restored.status).toBe("drawing");
    expect(restored.toolPlacedPoints).toEqual([
      [5, 6],
      [10, 0],
    ]);
    expect(restored.fitPointEndSnap ?? null).toBe(null);

    const finalized = finalizeSketchDraw(restored);
    expect(splines(finalized)).toHaveLength(1);
    const pointIds = new Set(
      finalized.definition.points.map(({ pointId }) => pointId),
    );
    expect(
      finalized.definition.constraints.flatMap((constraint) =>
        constraint.kind === "coincident" ? constraint.pointIds : [],
      ),
      "No inferred constraint references the undone point.",
    ).toEqual([]);
    expect(
      finalized.definition.points.every(({ pointId }) => pointIds.has(pointId)),
    ).toBe(true);
  });
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

// T11h (T11-D11, D12, Q1): the Line chain and its reconcile on restore.
describe("Line chain (T11-D11)", () => {
  type Session = ReturnType<typeof armed>;

  function lines(session: Session) {
    return session.definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" ? [entity] : [],
    );
  }

  function anchorPointIds(session: Session) {
    return (session.drawStartSnap?.sources ?? []).flatMap((source) =>
      source.kind === "localPoint" ? [source.pointId] : [],
    );
  }

  function draw(session: Session, points: readonly [number, number][]) {
    return points.reduce(
      (current, point) =>
        current.status === "drawing"
          ? acceptSketchDraw(current, point)
          : startSketchDraw(current, point),
      session,
    );
  }

  test("continues from each committed end, reusing its point id with no join constraint", () => {
    const session = draw(armed("line"), [
      [20, 20],
      [30, 21],
      [31, 31],
      [42, 33],
    ]);
    const [first, second, third] = lines(session);

    expect(
      lines(session),
      "Three clicks after the start make three segments.",
    ).toHaveLength(3);
    expect(
      [second?.startPointId, third?.startPointId],
      "Each segment starts on the previous segment's end point (structural join).",
    ).toEqual([first?.endPointId, second?.endPointId]);
    expect(
      session.definition.points,
      "4 points for 3 joined segments.",
    ).toHaveLength(4);
    expect(
      session.definition.constraints.filter(
        (constraint) => constraint.kind === "coincident",
      ),
      "A structural join needs no coincident constraint.",
    ).toEqual([]);
    expect(session.activeTool, "Line stays armed.").toBe("line");
    expect(session.status, "The next segment is staged.").toBe("drawing");
    expect(session.pointerDownPoint, "The anchor is the last end.").toEqual([
      42, 33,
    ]);
    expect(
      anchorPointIds(session),
      "The anchor is a local-point start snap (review A-4).",
    ).toEqual([third?.endPointId]);
    expect(
      [...getSketchToolMarkerPointIds(session)],
      "The anchor point's marker shows (T11f seam).",
    ).toEqual([third?.endPointId]);
    expect(
      session.toolChain?.segments.map((segment) => segment.entityId),
    ).toEqual([first, second, third].map((line) => line?.entityId));
    expect(escapeSketchDrawing(session), "Escape ends the chain.").toBe(
      "endChain",
    );
    expect(confirmSketchDrawing(session), "Enter ends the chain.").toBe(
      "endChain",
    );
  });

  test("a click on the anchor (zero length) is ignored and the chain continues", () => {
    const chained = draw(armed("line"), [
      [20, 20],
      [30, 20],
    ]);
    const clicked = acceptSketchDraw(chained, [30, 20]);

    expect(clicked.definition, "Nothing is committed.").toBe(
      chained.definition,
    );
    expect(clicked.status).toBe("drawing");
    expect(clicked.pointerDownPoint).toEqual([30, 20]);
    expect(clicked.toolChain).toBe(chained.toolChain);
    expect(anchorPointIds(clicked)).toEqual(anchorPointIds(chained));

    const next = acceptSketchDraw(clicked, [30, 30]);
    expect(
      lines(next)[1]?.startPointId,
      "The chain goes on from the same anchor.",
    ).toBe(lines(chained)[0]?.endPointId);

    // The first segment's start behaves the same: no zero-length line.
    const started = startSketchDraw(armed("line"), [5, 5]);
    const again = acceptSketchDraw(started, [5, 5]);
    expect(again.definition).toBe(started.definition);
    expect(again.status).toBe("drawing");
    expect(again.pointerDownPoint).toEqual([5, 5]);
  });

  test("closing onto the chain's first point ends the chain and keeps Line armed (Q1)", () => {
    const closed = draw(armed("line"), [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
      [20, 20],
    ]);
    const segments = lines(closed);

    expect(segments).toHaveLength(4);
    expect(
      segments[3]?.endPointId,
      "The closing segment ends on the chain's first point id.",
    ).toBe(segments[0]?.startPointId);
    expect(
      closed.definition.points,
      "A closed 4-segment loop has 4 points.",
    ).toHaveLength(4);
    expect(closed.activeTool, "Line stays armed.").toBe("line");
    expect(closed.status, "The chain ended.").toBe("idle");
    expect(closed.toolChain ?? null).toBe(null);
    expect(escapeSketchDrawing(closed), "The next Escape leaves Line.").toBe(
      "exitTool",
    );
    expect(confirmSketchDrawing(closed)).toBe(null);
  });

  test("only a placed start (no segment yet) is a draft: Escape cancels, Enter does nothing", () => {
    const started = startSketchDraw(armed("line"), [5, 5]);

    expect(started.toolChain ?? null).toBe(null);
    expect(escapeSketchDrawing(started)).toBe("cancelDraft");
    expect(confirmSketchDrawing(started)).toBe(null);
  });

  test("re-activating Line restarts it and ends the chain (review A-7)", () => {
    const chained = draw(armed("line"), [
      [20, 20],
      [30, 20],
    ]);
    const restarted = beginSketchTool(chained, "line");

    expect(restarted.activeTool).toBe("line");
    expect(restarted.status).toBe("idle");
    expect(restarted.toolChain ?? null).toBe(null);
    expect(restarted.drawStartSnap).toBe(null);
    expect(restarted.definition).toBe(chained.definition);
  });
});

describe("Line chain reconcile on restore (T11-D12)", () => {
  type Session = ReturnType<typeof armed>;

  function lineIds(session: Session) {
    return session.definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" ? [entity.entityId] : [],
    );
  }

  function anchorPointIds(session: Session) {
    return (session.drawStartSnap?.sources ?? []).flatMap((source) =>
      source.kind === "localPoint" ? [source.pointId] : [],
    );
  }

  /** The definitions after the start click and after each of 3 segments. */
  function chainOfThree() {
    const definitions = [];
    let session = startSketchDraw(armed("line"), [20, 20]);
    definitions.push(session.definition);
    for (const point of [
      [30, 21],
      [31, 31],
      [42, 33],
    ] as const) {
      session = acceptSketchDraw(session, point);
      definitions.push(session.definition);
    }
    return { session: updateSketchPointer(session, [50, 40]), definitions };
  }

  test("Undo moves the anchor back to the previous end; Redo re-extends; records are kept", () => {
    const { session, definitions } = chainOfThree();
    const segments = session.toolChain!.segments;

    const undone = rebuildSessionForDefinition(session, {
      definition: definitions[2]!,
    });
    expect(undone.activeTool, "Line stays armed.").toBe("line");
    expect(undone.status).toBe("drawing");
    expect(
      undone.pointerDownPoint,
      "The anchor is the 2nd segment's end.",
    ).toEqual([31, 31]);
    expect(anchorPointIds(undone)).toEqual([segments[1]!.endPointId]);
    expect(
      undone.toolChain?.segments,
      "The records are kept for Redo.",
    ).toEqual(segments);
    expect(
      undone.toolStagedEntities,
      "The rubber band is restaged from the live pointer.",
    ).toMatchObject([{ kind: "line", start: [31, 31], end: [50, 40] }]);
    expect(undone.toolStagedEntities).toHaveLength(1);
    expect(escapeSketchDrawing(undone)).toBe("endChain");

    const twice = rebuildSessionForDefinition(undone, {
      definition: definitions[1]!,
    });
    expect(twice.pointerDownPoint).toEqual([30, 21]);
    expect(anchorPointIds(twice)).toEqual([segments[0]!.endPointId]);

    const redone = rebuildSessionForDefinition(twice, {
      definition: definitions[2]!,
    });
    expect(redone.pointerDownPoint, "Redo re-extends the prefix.").toEqual([
      31, 31,
    ]);
    expect(anchorPointIds(redone)).toEqual([segments[1]!.endPointId]);
    expect(redone.toolChain?.segments).toEqual(segments);
  });

  test("a new commit after Undo truncates the records to the committed prefix", () => {
    const { session, definitions } = chainOfThree();
    const segments = session.toolChain!.segments;
    const undone = rebuildSessionForDefinition(session, {
      definition: definitions[2]!,
    });

    const next = acceptSketchDraw(undone, [25, 40]);
    const added = next.definition.entities.find(
      (entity) =>
        entity.kind === "lineSegment" &&
        !segments.some((segment) => segment.entityId === entity.entityId),
    );
    if (added?.kind !== "lineSegment") throw Error("Expected the new segment.");

    expect(
      added.startPointId,
      "The new segment starts on the restored anchor.",
    ).toBe(segments[1]!.endPointId);
    expect(
      next.toolChain?.segments,
      "Records past the prefix are dropped.",
    ).toEqual([
      segments[0],
      segments[1],
      {
        entityId: added.entityId,
        startPointId: added.startPointId,
        endPointId: added.endPointId,
      },
    ]);
    expect(next.toolChain?.start).toEqual(session.toolChain?.start);
  });

  test("Undo past the first segment keeps Line armed with only the chain start; its deleted point id is dropped", () => {
    const { session, definitions } = chainOfThree();
    const firstStartId = session.toolChain!.start.pointId;

    const undone = rebuildSessionForDefinition(session, {
      definition: definitions[0]!,
    });
    expect(lineIds(undone)).toEqual([]);
    expect(undone.activeTool).toBe("line");
    expect(undone.status, "Only the chain start is placed.").toBe("drawing");
    expect(undone.pointerDownPoint).toEqual([20, 20]);
    expect(
      undone.drawStartSnap,
      "The start point no longer exists, so no snap keeps its id.",
    ).toBe(null);

    const next = acceptSketchDraw(undone, [30, 20]);
    const [line] = next.definition.entities;
    if (line?.kind !== "lineSegment") throw Error("Expected one line.");
    expect(line.startPointId, "A deleted point id is never reused.").not.toBe(
      firstStartId,
    );
    expect(
      [line.startPointId, line.endPointId].map(
        (pointId) =>
          next.definition.points.find((point) => point.pointId === pointId)
            ?.position,
      ),
    ).toEqual([
      [20, 20],
      [30, 20],
    ]);
    expect(
      next.toolChain?.start,
      "The chain restarts from the new segment.",
    ).toEqual({
      pointId: line.startPointId,
      position: [20, 20],
    });
  });

  test("a chain started on an existing point keeps that id after Undo past its first segment", () => {
    const existing = acceptSketchDraw(
      startSketchDraw(armed("line"), [0, 0]),
      [10, 0],
    );
    const fixtureLine = existing.definition.entities[0];
    if (fixtureLine?.kind !== "lineSegment") throw Error("Expected a line.");
    const before = beginSketchTool(existing, "line");
    const chained = acceptSketchDraw(startSketchDraw(before, [10, 0]), [20, 5]);
    expect(chained.toolChain?.start.pointId).toBe(fixtureLine.endPointId);

    const undone = rebuildSessionForDefinition(chained, {
      definition: before.definition,
    });
    expect(anchorPointIds(undone)).toEqual([fixtureLine.endPointId]);
    const next = acceptSketchDraw(undone, [20, -5]);
    expect(next.definition.entities.at(-1)).toMatchObject({
      kind: "lineSegment",
      startPointId: fixtureLine.endPointId,
    });
  });

  test("a discrete draft keeps its placed position but drops a start snap whose point was undone", () => {
    const withLine = acceptSketchDraw(
      startSketchDraw(armed("line"), [0, 0]),
      [10, 0],
    );
    const circleDraft = startSketchDraw(
      beginSketchTool(withLine, "circle"),
      [10, 0],
    );
    expect(
      circleDraft.drawStartSnap?.sources.some(
        (source) =>
          source.kind === "localPoint" || source.kind === "localEntity",
      ),
      "The circle centre snapped onto the line's end.",
    ).toBe(true);

    const undone = rebuildSessionForDefinition(circleDraft, {
      definition: { ...withLine.definition, ...emptyDefinitionGeometry() },
    });
    expect(undone.status, "The draft is kept.").toBe("drawing");
    expect(undone.pointerDownPoint, "Its raw position is kept.").toEqual([
      10, 0,
    ]);
    expect(undone.drawStartSnap, "A snap on a missing point is dropped.").toBe(
      null,
    );

    const committed = acceptSketchDraw(undone, [13, 0]);
    const knownPointIds = new Set(
      committed.definition.points.map((point) => point.pointId),
    );
    expect(
      committed.definition.constraints
        .flatMap((constraint) =>
          constraint.kind === "coincident" ? constraint.pointIds : [],
        )
        .filter((pointId) => !knownPointIds.has(pointId)),
      "No inferred constraint references an undone point.",
    ).toEqual([]);
    expect(committed.definition.entities.map((entity) => entity.kind)).toEqual([
      "circle",
    ]);
  });
});

// T11h review fixes (R-1, A-1, A-2, A-5, A-6).
describe("Line chain review fixes", () => {
  type Session = ReturnType<typeof armed>;

  function chained() {
    return acceptSketchDraw(
      acceptSketchDraw(startSketchDraw(armed("line"), [20, 20]), [30, 20]),
      [30, 30],
    );
  }

  function anchorPointIds(session: Session) {
    return (session.drawStartSnap?.sources ?? []).flatMap((source) =>
      source.kind === "localPoint" ? [source.pointId] : [],
    );
  }

  function expectNoChain(session: Session, message: string) {
    expect(session.toolChain ?? null, message).toBe(null);
    expect(escapeSketchDrawing(session), message).not.toBe("endChain");
    expect(confirmSketchDrawing(session), message).toBe(null);
    const rebuilt = rebuildSessionForDefinition(session, {
      definition: session.definition,
    });
    expect(rebuilt.status, `${message}: a restore does not restage`).toBe(
      session.status,
    );
    expect(rebuilt.toolStagedEntities).toEqual([]);
  }

  test("R-1: a style focus mid-chain ends the chain; Escape leaves, Enter does nothing, a restore does not restage", () => {
    const focused = focusSketchStyleTool(chained(), [], "stroke");

    expect(focused.activeTool, "premise: Line stays the active tool").toBe(
      "line",
    );
    expectNoChain(focused, "style focus");
    expect(escapeSketchDrawing(focused)).toBe("exitTool");
  });

  test("R-1: selecting a non-editable annotation mid-chain ends the chain", () => {
    const session = chained();
    const line = session.definition.entities[0]!;
    const withConstraint: Session = {
      ...session,
      definition: {
        ...session.definition,
        constraintIds: ["constraint_horizontal"],
        constraints: [
          {
            constraintId: "constraint_horizontal",
            kind: "horizontal",
            label: "Horizontal",
            entityId: line.entityId,
          },
        ],
      },
    };
    const selected = beginSketchAnnotationEdit(withConstraint, {
      kind: "constraint",
      sketchId: line.target.sketchId,
      constraintId: "constraint_horizontal",
    });

    expect(selected.activeAnnotationEdit, "premise: not editable").toBe(null);
    expect(selected.activeTool, "premise: Line stays the active tool").toBe(
      "line",
    );
    expectNoChain(selected, "annotation select");
  });

  test("R-1: a draft started from idle never continues a stale chain; Undo anchors at the fresh start", () => {
    const old = chained();
    // Any path that leaves stale records on an idle Line.
    const stale: Session = {
      ...old,
      status: "idle",
      pointerDownPoint: null,
      livePoint: null,
      toolStagedEntities: [],
      drawStartSnap: null,
    };
    const started = startSketchDraw(stale, [100, 100]);
    expect(started.toolChain ?? null).toBe(null);
    const next = acceptSketchDraw(started, [110, 100]);
    const fresh = next.definition.entities.at(-1);
    if (fresh?.kind !== "lineSegment") throw Error("Expected a line.");

    expect(next.toolChain?.start.pointId).toBe(fresh.startPointId);
    expect(next.toolChain?.segments).toHaveLength(1);

    const undone = rebuildSessionForDefinition(next, {
      definition: started.definition,
    });
    expect(
      undone.pointerDownPoint,
      "Undo of the fresh segment anchors at the fresh start, not the old chain's end.",
    ).toEqual([100, 100]);
  });

  test("A-6: deleting geometry mid-chain clears the chain", () => {
    const session = chained();
    const deleted = deleteSelectedSketchGeometry(session, [
      session.definition.entities[0]!.target,
    ]);

    expect(deleted.activeTool).toBe(null);
    expect(deleted.toolChain ?? null).toBe(null);
  });

  test("A-5: the construction toggle mid-chain ends the chain; Line re-armed starts afresh", () => {
    const session = chained();
    const toggled = beginSketchTool(session, "construction");

    expect(toggled.toolChain ?? null).toBe(null);
    expect(toggled.definition).toBe(session.definition);
    const rearmed = beginSketchTool(toggled, "line");
    expect(rearmed.status).toBe("idle");
    expect(rearmed.toolChain ?? null).toBe(null);
    expect(rearmed.constructionModifierActive).toBe(true);
  });

  test("A-1: the anchor follows the last segment's current end point id", () => {
    const session = chained();
    const last = session.definition.entities.at(-1);
    if (last?.kind !== "lineSegment") throw Error("Expected a line.");
    const first = session.definition.entities[0];
    if (first?.kind !== "lineSegment") throw Error("Expected a line.");
    // The last segment now ends on the first segment's start point.
    const replaced = {
      ...session.definition,
      entities: session.definition.entities.map((entity) =>
        entity.entityId === last.entityId
          ? { ...last, endPointId: first.startPointId }
          : entity,
      ),
    };

    const restored = rebuildSessionForDefinition(session, {
      definition: replaced,
    });
    expect(restored.pointerDownPoint).toEqual([20, 20]);
    expect(anchorPointIds(restored)).toEqual([first.startPointId]);
  });

  test("A-2: a zero-length chain rubber band is not an error", () => {
    const session = chained();
    expect(session.validationMessage, "right after a commit").toBe(null);
    expect(session.toolPresentation?.validation ?? []).toEqual([]);

    const ignored = acceptSketchDraw(session, [30, 30]);
    expect(ignored.definition).toBe(session.definition);
    expect(ignored.validationMessage, "after an ignored anchor click").toBe(
      null,
    );
    expect(ignored.toolPresentation?.validation ?? []).toEqual([]);
    expect(ignored.status).toBe("drawing");

    const moved = updateSketchPointer(ignored, [40, 35]);
    expect(moved.validationMessage).toBe(null);
    expect(moved.toolStagedEntities).toMatchObject([
      { kind: "line", start: [30, 30], end: [40, 35] },
    ]);
  });
});

function emptyDefinitionGeometry() {
  return {
    points: [],
    pointIds: [],
    entities: [],
    entityIds: [],
    constraints: [],
    constraintIds: [],
  };
}
