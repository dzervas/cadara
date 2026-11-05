import { expect, test } from "vitest";
import { createFilletedHexagonSession } from "./filleted-hexagon-session.fixtures";
import { getSketchSessionDisplayDefinition } from "./session-definition";
import {
  beginSketchTool,
  selectSketchConstraintTarget,
  updateSketchConstraintHover,
  beginSketchConstraintToolFromSelection,
} from "./index";
import { authorSketchRequirement } from "./constraints";
import { getSketchEditOperatorResult } from "./edit-geometry-operations";
import { completeSketchEditOperation } from "./edit-tool-interaction";
import { getSketchMergePointsResult } from "./point-merge";
import { buildSketchMirrorPresentation } from "./mirror-editing";
import { getEditableAnnotationValue } from "./annotation-edit-presentation";
import { getEntityAnchor } from "./annotation-reference-geometry";
import { createSketchOffsetDerivationContribution } from "@/core/sketch-editing/operations";
import { createSessionCommitFactories } from "./tool-authoring";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchSessionState } from "./types";
import type { SketchEditToolId } from "@/core/sketch-edit-tools/definition";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";

function fixture() {
  const session = createFilletedHexagonSession();
  const display = getSketchSessionDisplayDefinition(session);
  const solvedSession = { ...session, definition: display, liveSolve: null };
  const sides = session.definition.entities.filter(
    (e) => e.kind === "lineSegment",
  );
  return { session, display, solvedSession, sides };
}

function operator(
  session: SketchSessionState,
  toolId: SketchEditToolId,
  targets: readonly import("@/core/editor/schema").PrimitiveRef[],
) {
  const armed = beginSketchTool(session, toolId);
  return {
    ...armed.activeEditTool!,
    selectedTargets: [...targets],
    toolValue: 0.05,
  };
}

// Geometry-only comparison: each invocation intentionally allocates fresh authored IDs.
function previewGeometry(
  result: ReturnType<typeof getSketchEditOperatorResult>,
) {
  return result.previewEntities.map(
    ({ id: _id, entityId: _entityId, ...geometry }) => geometry,
  );
}

test.each([
  "sketchFillet",
  "sketchChamfer",
  "sketchSlot",
  "sketchMirror",
  "sketchLinearPattern",
  "sketchCircularPattern",
  "sketchTransform",
] as const)(
  "%s previews and committed seeds use the displayed geometry without persisting the display overlay",
  (toolId) => {
    const { session, display, solvedSession, sides } = fixture();
    const targets =
      toolId === "sketchMirror"
        ? [
            sides[0]!.target,
            {
              kind: "sketchDatumReference" as const,
              sketchId: sides[0]!.target.sketchId,
              datumId: "yAxis" as const,
              geometryKind: "lineSegment" as const,
            },
          ]
        : (toolId === "sketchFillet" || toolId === "sketchChamfer"
            ? sides.slice(2, 4)
            : sides.slice(0, 1)
          ).map((e) => e.target);
    const tool = operator(session, toolId, targets);
    const actual = getSketchEditOperatorResult(session, tool);
    const expected = getSketchEditOperatorResult(solvedSession, tool);
    expect(actual.valid, actual.message ?? undefined).toBe(true);
    expect(expected.valid, expected.message ?? undefined).toBe(true);
    expect(previewGeometry(actual)).toEqual(previewGeometry(expected));
    const committed = completeSketchEditOperation(session, actual);
    const originalIds = new Set(session.definition.pointIds);
    const additions = (state: SketchSessionState) =>
      state.definition.points
        .filter((p) => !originalIds.has(p.pointId))
        .map((p) => p.position);
    expect(additions(committed)).toEqual(
      additions(completeSketchEditOperation(solvedSession, expected)),
    );
    expect(additions(committed).length).toBeGreaterThan(0);
    for (const original of session.definition.points) {
      const retained = committed.definition.points.find(
        (p) => p.pointId === original.pointId,
      );
      if (retained) expect(retained.position).toEqual(original.position);
    }
    expect(session.definition.points).not.toEqual(display.points);
  },
);

test.each(["hover", "pick"] as const)(
  "constraint %s resolves the displayed line witnesses",
  (seam) => {
    const { session, display, sides } = fixture();
    const target = sides[0]!.target;
    const armed = beginSketchTool(session, "dimensionDistance");
    const next =
      seam === "hover"
        ? updateSketchConstraintHover(armed, target)
        : selectSketchConstraintTarget(armed, target);
    const record =
      seam === "hover"
        ? next.constraintAuthoring!.hoverTarget
        : next.constraintAuthoring!.selectedTargets[0];
    const side = sides[0]!;
    expect(record!.line).toEqual({
      start: display.points.find((p) => p.pointId === side.startPointId)!
        .position,
      end: display.points.find((p) => p.pointId === side.endPointId)!.position,
    });
    expect(next.definition).toBe(session.definition);
  },
);

test.each(["explicit", "preselection"] as const)(
  "%s Fix authors the displayed witnesses",
  (seam) => {
    const { session, display, sides } = fixture();
    const targets = [sides[0]!.target, sides[2]!.target];
    const actual =
      seam === "explicit"
        ? authorSketchRequirement(session, {
            tool: "constraintFix",
            targets: [targets[0]!],
            mode: "driving",
            value: null,
          })
        : beginSketchConstraintToolFromSelection(
            session,
            "constraintFix",
            targets,
          ).session;
    const added = actual.definition.constraints.filter(
      (c) => !session.definition.constraintIds.includes(c.constraintId),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const constraint of added) {
      expect(constraint.kind).toBe("fixPoint");
      if (constraint.kind !== "fixPoint")
        throw new Error("Expected fixed point witness");
      expect(constraint.position).toEqual(
        display.points.find((p) => p.pointId === constraint.pointId)!.position,
      );
    }
  },
);

test("merge arrows follow the displayed source and destination but the merge mutation remains authored", () => {
  const { session, display, sides } = fixture();
  const points = [sides[0]!.startPointId, sides[3]!.startPointId].map(
    (id) => session.definition.points.find((p) => p.pointId === id)!,
  );
  const tool = operator(
    session,
    "sketchMergePoints",
    points.map((p) => p.target),
  );
  const result = getSketchMergePointsResult(session, tool);
  expect(result.valid, result.message ?? undefined).toBe(true);
  const arrow = result.previewEntities[0]!;
  expect(arrow.kind).toBe("polyline");
  if (arrow.kind !== "polyline") throw new Error("Expected merge arrow");
  expect(arrow.points.slice(0, 2)).toEqual(
    points.map(
      (p) => display.points.find((d) => d.pointId === p.pointId)!.position,
    ),
  );
  for (const point of result.definition!.points) {
    expect(point.position).toEqual(
      session.definition.points.find((p) => p.pointId === point.pointId)!
        .position,
    );
  }
});

test("mirror confirmation clears the displayed sketch bounds", () => {
  const { session, solvedSession, sides } = fixture();
  const tool = operator(session, "sketchMirror", [
    sides[0]!.target,
    {
      kind: "sketchDatumReference",
      sketchId: sides[0]!.target.sketchId,
      datumId: "yAxis",
      geometryKind: "lineSegment",
    },
  ]);
  // Isolate the bounds scan from the independent copy-generation seed seam.
  const staged = getSketchEditOperatorResult(solvedSession, tool);
  expect(staged.valid).toBe(true);
  expect(
    buildSketchMirrorPresentation(session, tool, null, staged).floatingInput!
      .anchor,
  ).toEqual(
    buildSketchMirrorPresentation(solvedSession, tool, null, staged)
      .floatingInput!.anchor,
  );
});

test("offset distance popup anchors to its displayed fallback seed", () => {
  const { session, display, sides } = fixture();
  const result = createSketchOffsetDerivationContribution({
    definition: display,
    entityIds: [sides[0]!.entityId],
    distance: 0.1,
    side: "left",
    sequence: 3,
    factories: createSessionCommitFactories(3, sides[0]!.target.sketchId),
    modelingTolerance: session.modelingTolerance,
    documentVariables: session.documentVariables,
  });
  expect(result.valid, result.message ?? undefined).toBe(true);
  const relationship = result.contribution!.derivedRelationships![0]!;
  // The fallback seed anchor is also the popup contract before outputs exist.
  const pending = {
    ...relationship,
    outputs: [],
    distance: createLiteralAuthoredValue(0.1),
  };
  const definition = { ...session.definition, derivedRelationships: [pending] };
  const state = {
    ...session,
    definition,
    liveSolve: { ...session.liveSolve!, sourceDefinition: definition },
  };
  const editable = getEditableAnnotationValue(state, {
    kind: "offsetDistance",
    derivationId: relationship.derivationId,
  });
  expect(editable!.anchor).toMatchObject({
    kind: "sketchPoint",
    point: getEntityAnchor(display, sides[0]!.entityId),
  });
});

test("Cancel and Undo of a display-seeded corner edit restore authored bytes", async () => {
  const { session, sides } = fixture();
  const f = await createSketchActionOwnerFixture(session);
  await f.settle();
  const authored = JSON.stringify(stableJsonValue(f.session.definition));
  const stage = () => {
    f.dispatch({ type: "tool.activated", toolId: "sketchChamfer" });
    for (const side of sides.slice(2, 4))
      f.dispatch({ type: "viewport.selectionRequested", target: side.target });
    f.dispatch({ type: "sketch.toolPatched", patch: { value: 0.05 } });
  };
  stage();
  f.dispatch({
    type: "sketch.toolPatched",
    patch: { intent: "cancelSketchEditOperator" },
  });
  expect(JSON.stringify(stableJsonValue(f.session.definition))).toBe(authored);
  stage();
  f.dispatch({
    type: "sketch.toolPatched",
    patch: { intent: "commitSketchEditOperator" },
  });
  await f.settle();
  expect(f.undoLabels()).toHaveLength(1);
  f.dispatch({ type: "history.undoRequested" });
  await f.settle();
  expect(JSON.stringify(stableJsonValue(f.session.definition))).toBe(authored);
});
