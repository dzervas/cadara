import { createFilletedHexagonSession } from "./filleted-hexagon-session.fixtures";
import { expect, test } from "vitest";
import { getSketchAnnotationDescriptors } from "./annotation-descriptors";
import {
  beginSketchTool,
  startSketchDraw,
  acceptSketchDraw,
  withLiveSolveBasis,
  getSketchSessionLiveRegionBasis,
  publishSketchLiveRegions,
} from "./index";
import {
  getSketchSessionDisplayDefinition,
  getSketchSessionDerivationSettings,
} from "./session-definition";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { tessellateBoundaryLoop } from "@/contracts/sketch/region-boundary-curves";
import { applySolvedSketchToDefinition } from "./definition-patches";
import { previewSketchPlacement } from "./drawing-pointer";
import { reconcileSketchToolDraft } from "./tool-placement";
import { getSketchToolPresentation } from "./tool-presentation";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";


test.each([true, false])(
  "a filleted circle-constrained hexagon displays its solved region without rewriting authored geometry (equal sides: %s)",
  async (equalSides) => {
    let session = createFilletedHexagonSession(equalSides);
    const definition = session.definition;
    const authored = JSON.stringify(definition);
    const basis = getSketchSessionLiveRegionBasis(session)!;
    const derived = await createSketchArrangementDeriver(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    ).derive({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      ...basis,
    });
    expect(derived.regions).toHaveLength(1);
    session = publishSketchLiveRegions(
      session,
      derived.regions,
      derived.diagnostics,
    );
    const boundary = tessellateBoundaryLoop(
      session.liveRegions.boundaryBasis!,
      derived.regions[0]!.loops[0]!,
    );
    if ("kind" in boundary) throw new Error(boundary.message);
    const solved = session.liveSolve!.solvedSnapshot;
    const endpoints = solved.solvedEntities.flatMap((e) =>
      e.kind === "lineSegment" ? [e.startPosition, e.endPosition] : [],
    );
    for (const point of endpoints) {
      expect(
        Math.min(
          ...boundary.map((p) => Math.hypot(p[0] - point[0], p[1] - point[1])),
        ),
      ).toBeLessThan(1e-6);
    }
    const display = getSketchSessionDisplayDefinition(session);
    let maxAuthoredDelta = 0;
    for (const point of solved.solvedPoints) {
      const original = definition.points.find(
        (p) => p.pointId === point.pointId,
      )!;
      maxAuthoredDelta = Math.max(
        maxAuthoredDelta,
        Math.hypot(
          original.position[0] - point.solvedPosition[0],
          original.position[1] - point.solvedPosition[1],
        ),
      );
    }
    if (equalSides) {
      expect(
        maxAuthoredDelta,
        "the regression must exercise a solve that moved the authored fillet",
      ).toBeGreaterThan(1e-3);
    }
    for (const point of solved.solvedPoints) {
      expect(
        display.points.find((p) => p.pointId === point.pointId)!.position,
      ).toEqual(point.solvedPosition);
    }
    expect(session.definition).toBe(definition);
    expect(JSON.stringify(session.definition)).toBe(authored);
    const alreadySolved = applySolvedSketchToDefinition(
      definition,
      solved,
      getSketchSessionDerivationSettings(session),
    );
    const displayedAgain = getSketchSessionDisplayDefinition(
      withLiveSolveBasis(
        { ...session, definition: alreadySolved },
        alreadySolved,
        solved,
      ),
    );
    expect(displayedAgain.points).toEqual(display.points);
    const preAppliedSession = { ...session, definition: alreadySolved };
    expect(
      getSketchAnnotationDescriptors(session).map((d) => d.anchor),
    ).toEqual(
      getSketchAnnotationDescriptors(preAppliedSession).map((d) => d.anchor),
    );
    const overlays = getSketchToolPresentation({
      ...session,
      activeTool: null,
    })!.overlays;
    expect(overlays!.length).toBeGreaterThan(0);
    expect(overlays).toEqual(
      getSketchToolPresentation({ ...preAppliedSession, activeTool: null })!
        .overlays,
    );
    expect(
      getSketchSessionDisplayDefinition({
        ...session,
        liveSolve: { ...session.liveSolve!, accepted: false },
      }).points,
    ).toEqual(definition.points);
    expect(
      getSketchSessionDisplayDefinition({
        ...session,
        definition: { ...definition },
      }).points,
    ).toEqual(definition.points);
  },
);

function displayedVertex(session: ReturnType<typeof createFilletedHexagonSession>) {
  const side = session.definition.entities.find(
    (e) => e.kind === "lineSegment",
  )!;
  const point = session.definition.points.find(
    (p) => p.pointId === side.startPointId,
  )!;
  const position = session.liveSolve!.solvedSnapshot.solvedPoints.find(
    (p) => p.pointId === point.pointId,
  )!.solvedPosition;
  expect(
    Math.hypot(
      position[0] - point.position[0],
      position[1] - point.position[1],
    ),
  ).toBeGreaterThan(0.01);
  return { point, position };
}

test("placement and draft reconciliation join the displayed solved vertex at close zoom", () => {
  const session = { ...createFilletedHexagonSession(), sketchUnitsPerPixel: 0.0001 };
  const { point, position } = displayedVertex(session);
  const inference = previewSketchPlacement(session, position)!;
  expect(inference.position).toEqual(position);
  expect(inference.requirements).toContainEqual(
    expect.objectContaining({
      subject: "point",
      kind: "joins",
      pointId: point.pointId,
    }),
  );
  const drawing = startSketchDraw(session, position);
  const restored = reconcileSketchToolDraft(drawing);
  expect(restored.toolPlacements![0]!.position).toEqual(position);
  expect(restored.toolPlacements![0]!.requirements).toContainEqual(
    expect.objectContaining({
      subject: "point",
      kind: "joins",
      pointId: point.pointId,
    }),
  );
  expect(restored.definition).toBe(session.definition);
  const committed = acceptSketchDraw(restored, [
    position[0] - 0.2,
    position[1] - 0.3,
  ]);
  const line = committed.definition.entities.at(-1)!;
  expect(line.kind).toBe("lineSegment");
  if (line.kind !== "lineSegment") throw new Error("Expected the joined line");
  expect(line.startPointId).toBe(point.pointId);
});

test("a tangent arc starts and reconciles along the displayed solved source", () => {
  const polygon = { ...createFilletedHexagonSession(), sketchUnitsPerPixel: 0.0001 };
  const { point: corner } = displayedVertex(polygon);
  // Build the open source independently of the snapping path under test.
  const tail = acceptSketchDraw(startSketchDraw(polygon, [-2, -2]), [
    -2.2, -2.3,
  ]);
  const line = tail.definition.entities.at(-1)!;
  if (line.kind !== "lineSegment")
    throw new Error("Expected an open line source");
  const definition = {
    ...tail.definition,
    pointIds: tail.definition.pointIds.filter((id) => id !== line.startPointId),
    points: tail.definition.points.filter((p) => p.pointId !== line.startPointId),
    entities: tail.definition.entities.map((e) =>
      e.entityId === line.entityId ? { ...line, startPointId: corner.pointId } : e,
    ),
  };
  const withTail = withLiveSolveBasis({ ...tail, definition }, definition);
  expect(withTail.liveSolve!.accepted).toBe(true);
  const session = beginSketchTool(withTail, "tangentArc");
  const position = session.liveSolve!.solvedSnapshot.solvedPoints.find(
    (p) => p.pointId === line.endPointId,
  )!.solvedPosition;
  const inference = previewSketchPlacement(session, position)!;
  const source = session.liveSolve!.solvedSnapshot.solvedEntities.find(
    (e) => e.entityId === inference.tangentSourceEntityId,
  )!;
  expect(source.kind).toBe("lineSegment");
  if (source.kind !== "lineSegment")
    throw new Error("Expected a line tangent source");
  const fromStart =
    Math.hypot(
      source.startPosition[0] - position[0],
      source.startPosition[1] - position[1],
    ) < 1e-6;
  const delta = fromStart
    ? [
        source.startPosition[0] - source.endPosition[0],
        source.startPosition[1] - source.endPosition[1],
      ]
    : [
        source.endPosition[0] - source.startPosition[0],
        source.endPosition[1] - source.startPosition[1],
      ];
  const length = Math.hypot(...delta);
  const drawing = startSketchDraw(session, position);
  const restored = reconcileSketchToolDraft(drawing);
  for (const state of [drawing, restored]) {
    expect(state.status).toBe("drawing");
    expect(state.toolSettings.tangentDirectionX).toBeCloseTo(
      delta[0]! / length,
      10,
    );
    expect(state.toolSettings.tangentDirectionY).toBeCloseTo(
      delta[1]! / length,
      10,
    );
  }
});

test.each([
  { offset: [0, 0] as SketchPoint },
  { offset: [0.0002, -0.0003] as SketchPoint },
])(
  "a small drag preserves the visible grab offset $offset and Undo restores authored bytes",
  async ({ offset }) => {
    const initial = { ...createFilletedHexagonSession(), sketchUnitsPerPixel: 0.0001 };
    const { point, position } = displayedVertex(initial);
    const f = await createSketchActionOwnerFixture(initial);
    await f.settle();
    const definition = f.session.definition;
    // The action ledger reconstructs records, so compare canonical authored bytes.
    const authored = JSON.stringify(stableJsonValue(definition));
    const down: SketchPoint = [
      position[0] - offset[0],
      position[1] - offset[1],
    ];
    const start = () =>
      f.dispatch({
        type: "sketch.geometryDragStarted",
        target: point.target,
        point: down,
      });
    start();
    expect(f.session.activeDrag).not.toBeNull();
    expect(f.session.activeDrag!.preDragDefinition).toBe(definition);
    expect(f.session.activeDrag!.grabOffset[0]).toBeCloseTo(offset[0], 12);
    expect(f.session.activeDrag!.grabOffset[1]).toBeCloseTo(offset[1], 12);
    f.dispatch({ type: "sketch.geometryDragCancelled" });
    expect(JSON.stringify(stableJsonValue(f.session.definition))).toBe(
      authored,
    );
    start();
    const end: SketchPoint = [down[0] + 0.002, down[1]];
    for (const delta of [0.0005, 0.001, 0.002]) {
      const cursor: SketchPoint = [down[0] + delta, down[1]];
      f.dispatch({ type: "sketch.geometryDragMoved", point: cursor });
      for (
        let resume = 0;
        f.session.activeDrag?.pendingSolve && resume < 16;
        resume++
      ) {
        f.dispatch({ type: "sketch.geometryDragMoved", point: cursor });
      }
      expect(f.session.activeDrag?.acceptedFrame).toBe(true);
      const visible = getSketchSessionDisplayDefinition(f.session).points.find(
        (p) => p.pointId === point.pointId,
      )!.position;
      expect(
        Math.hypot(
          visible[0] - (cursor[0] + offset[0]),
          visible[1] - (cursor[1] + offset[1]),
        ),
      ).toBeLessThan(1e-4);
    }
    f.dispatch({ type: "sketch.geometryDragEnded", point: end });
    await f.settle();
    expect(f.session.liveSolve!.accepted).toBe(true);
    const moved = getSketchSessionDisplayDefinition(f.session).points.find(
      (p) => p.pointId === point.pointId,
    )!.position;
    expect(
      Math.hypot(
        moved[0] - (end[0] + offset[0]),
        moved[1] - (end[1] + offset[1]),
      ),
    ).toBeLessThan(1e-4);
    expect(f.undoLabels()).toHaveLength(1);
    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(JSON.stringify(stableJsonValue(f.session.definition))).toBe(
      authored,
    );
  },
);
