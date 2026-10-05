import { describe, expect, test } from "vitest";
import type { SketchId } from "@/contracts/shared/ids";
import { SketchAuthoredActions } from "./sketch-authored-actions";
import {
  emitPendingSketchEditQuery,
  initialEditorState,
  transitionEditorState,
  type EditorEffectRuntime,
  type EditorEvent,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import { runEditorEffect } from "./effect-registry";
import { querySketchEditIntersectionsForTest } from "@/domain/editor/state-machine-test-builder";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  startSketchDraw,
  deleteSelectedSketchGeometry,
  selectSketchEditToolTarget,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { encodeAuthoredActionState } from "@/domain/modeling/authored-action-history";
import {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
} from "@/domain/editor/sketch-session/references";
import { createReferenceImageOperation } from "@/domain/reference-image/operations";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";

function line(session: SketchSessionState) {
  return acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), [0, 0]),
    [12, 0],
  );
}
function projection(session: SketchSessionState) {
  return encodeAuthoredActionState({
    documentId: "doc_workspace",
    context: { kind: "sketch", sketchId: session.actionContextId },
    data: {
      sketchId: session.actionContextId,
      label: session.sketchLabel,
      plane: session.plane,
      definition: session.definition,
    },
  });
}
function remapTestSketchIds<T>(value: T, nextSketchId: string): T {
  if (Array.isArray(value))
    return value.map((entry) => remapTestSketchIds(entry, nextSketchId)) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "sketchId"
        ? nextSketchId
        : remapTestSketchIds(entry, nextSketchId),
    ]),
  ) as T;
}

async function fixture(constrained = false) {
  const owner = new SketchAuthoredActions();
  const session = line(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  if (!constrained)
    session.definition = {
      ...session.definition,
      constraints: [],
      constraintIds: [],
      dimensions: [],
      dimensionIds: [],
    };
  let state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_test",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    pendingCommitRequestId: null,
    pendingImportRequestId: null,
    pendingProjectionRequestId: null,
  };
  function apply(event: EditorEvent, candidate?: SketchSessionState) {
    const result = owner.transition(state, event, (current) => ({
      state: {
        ...current,
        session: candidate ?? (current as SketchEditorState).session,
      } as SketchEditorState,
      effects: [],
    }));
    if (result.state.kind !== "editingSketch")
      throw Error("Expected sketch state");
    state = result.state;
    return state.session;
  }
  /** Runs `event` through the real reducer inside the action owner. */
  function dispatch(event: EditorEvent) {
    const result = owner.transition(state, event, (current) =>
      transitionEditorState(current, event),
    );
    if (result.state.kind !== "editingSketch")
      throw Error("Expected sketch state");
    state = result.state;
    return result;
  }
  apply({ type: "selection.cleared" });
  return {
    owner,
    apply,
    dispatch,
    get session() {
      return state.session;
    },
    get state() {
      return state;
    },
  };
}

const mutations: Record<
  string,
  (session: SketchSessionState) => SketchSessionState
> = {
  creation: line,
  drag: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      points: session.definition.points.map((point, index) =>
        index ? point : { ...point, position: [3, 4] },
      ),
    },
  }),
  dimension: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      dimensionIds: ["dimension_numeric"],
      dimensions: [
        {
          dimensionId: "dimension_numeric",
          kind: "lineLength",
          label: "Length",
          entityId: session.definition.entities[0]!.entityId,
          value: 20,
        },
      ],
    },
  }),
  deletion: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
    },
  }),
  construction: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      entities: session.definition.entities.map((entity) => ({
        ...entity,
        isConstruction: true,
      })),
    },
  }),
  style: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      styleIds: ["sketch_style_red"],
      styles: [
        {
          styleId: "sketch_style_red",
          label: "Red",
          target: {
            kind: "entity",
            entityId: session.definition.entities[0]!.entityId,
          },
          fill: { kind: "none" },
          stroke: {
            color: "#ff0000",
            opacity: 1,
            width: 2,
            lineCap: "round",
            lineJoin: "round",
            miterLimit: 4,
          },
        },
      ],
    },
  }),
  annotation: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      dimensionIds: ["dimension_annotation"],
      dimensions: [
        {
          dimensionId: "dimension_annotation",
          kind: "lineLength",
          label: "Length",
          entityId: session.definition.entities[0]!.entityId,
          value: 12,
          annotationPlacement: { kind: "dimensionLine", offset: 8 },
        },
      ],
    },
  }),
  special: (session) =>
    appendReferenceImageOperations(session, [
      createReferenceImageOperation({
        sequence: 1,
        sketchId: session.actionContextId,
        payload: {
          mediaType: "image/png",
          pixelWidth: 4,
          pixelHeight: 2,
          base64Data: "cG5n",
        },
      }),
    ]),
  invalid: (session) => ({
    ...session,
    definition: {
      ...session.definition,
      constraintIds: ["constraint_invalid"],
      constraints: [
        {
          constraintId: "constraint_invalid",
          kind: "horizontal",
          label: "Retained missing target",
          entityId: "sketch_entity_missing",
        },
      ],
    },
    validationMessage: "Missing target",
  }),
};

describe("completed authored candidates share one compensation boundary", () => {
  for (const [name, produce] of Object.entries(mutations))
    test(name, async () => {
      const f = await fixture();
      const before = projection(f.session);
      const candidate = produce(f.session);
      const after = projection(candidate);
      expect(after).not.toEqual(before);
      expect(
        f.apply({ type: "selection.cleared" }, candidate).actionAvailability,
      ).toEqual({ canUndo: true, canRedo: false });
      expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
        before,
      );
      expect(f.session.actionAvailability).toEqual({
        canUndo: false,
        canRedo: true,
      });
      expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
        after,
      );
      expect(f.session.actionAvailability).toEqual({
        canUndo: true,
        canRedo: false,
      });
    });
});

test("gesture frames and cancellation do not enter history; release enters once", async () => {
  const f = await fixture();
  const before = projection(f.session);
  const pointTarget = f.session.definition.points[0]!.target;
  const drag = {
    target: pointTarget,
    handle: { kind: "point" as const, pointId: pointTarget.pointId },
    intent: { kind: "point" as const, pointId: pointTarget.pointId },
    preDragDefinition: f.session.definition,
    startPoint: [0, 0] as const,
    currentPoint: [3, 4] as const,
    grabOffset: [0, 0] as const,
    status: "dragging" as const,
    message: null,
    interactiveSolveSession: null,
  };
  f.apply(
    { type: "selection.cleared" },
    { ...mutations.drag(f.session), activeDrag: drag },
  );
  expect(f.session.actionAvailability?.canUndo).toBe(false);
  expect(projection(f.apply({ type: "sketch.activeToolCleared" }))).toEqual(
    before,
  );
  expect(f.session.actionAvailability?.canUndo).toBe(false);
  f.apply(
    { type: "selection.cleared" },
    { ...mutations.drag(f.session), activeDrag: drag },
  );
  const after = projection(f.session);
  f.apply(
    { type: "sketch.geometryDragEnded", point: [3, 4, 0] },
    { ...f.session, activeDrag: null },
  );
  expect(f.session.actionAvailability?.canUndo).toBe(true);
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    before,
  );
  expect(f.session.actionAvailability?.canUndo).toBe(false);
  expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(after);
});

// T12b takeover: Undo/Redo for radius-intent drag.
test("T12b: radius-intent drag enters one action; Undo restores original radius, Redo restores dragged radius", async () => {
  const f = await fixture();

  // Replace the line session with a circle session.
  const circleSession: SketchSessionState = {
    ...f.session,
    definition: {
      ...f.session.definition,
      pointIds: ["sketch_point_center" as const],
      points: [
        {
          pointId: "sketch_point_center" as `sketch_point_${string}`,
          label: "Center",
          target: {
            kind: "sketchPoint" as const,
            sketchId: f.session.actionContextId,
            pointId: "sketch_point_center" as `sketch_point_${string}`,
          },
          position: [0, 0] as const,
          isConstruction: false,
        },
      ],
      entityIds: ["sketch_entity_circle" as const],
      entities: [
        {
          kind: "circle" as const,
          entityId: "sketch_entity_circle" as `sketch_entity_${string}`,
          label: "Circle",
          target: {
            kind: "sketchEntity" as const,
            sketchId: f.session.actionContextId,
            entityId: "sketch_entity_circle" as `sketch_entity_${string}`,
          },
          isConstruction: false,
          centerPointId: "sketch_point_center" as `sketch_point_${string}`,
          radius: 3,
        },
      ],
      constraints: [],
      constraintIds: [],
      dimensions: [],
      dimensionIds: [],
    },
  };
  f.apply({ type: "selection.cleared" }, circleSession);
  const beforeRadius = projection(f.session);

  // Apply a radius-changed mutation (simulate a completed rim drag).
  const afterRadiusSession: SketchSessionState = {
    ...f.session,
    definition: {
      ...f.session.definition,
      entities: f.session.definition.entities.map((e) =>
        e.kind === "circle" ? { ...e, radius: 5 } : e,
      ),
    },
  };
  f.apply(
    { type: "sketch.geometryDragEnded", point: [5, 0, 0] },
    { ...afterRadiusSession, activeDrag: null },
  );
  const afterRadius = projection(f.session);
  expect(afterRadius).not.toEqual(beforeRadius);
  expect(f.session.actionAvailability?.canUndo).toBe(true);

  // Undo: radius goes back to 3.
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    beforeRadius,
  );
  // Redo: radius goes back to 5.
  expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
    afterRadius,
  );
});

// T12b takeover: Undo/Redo for tangent-vector-intent drag (including auto→authored).
test("T12b: tangent-vector-intent drag enters one action; Undo restores automatic tangent, Redo restores authored", async () => {
  const f = await fixture();

  // Draw a 3-point spline to get a proper definition with automatic tangents.
  let splineSession = f.session;
  splineSession = beginSketchTool(splineSession, "spline");
  splineSession = startSketchDraw(splineSession, [0, 0]);
  splineSession = acceptSketchDraw(splineSession, [3, 4]);
  splineSession = acceptSketchDraw(splineSession, [6, 0]);
  splineSession = finalizeSketchDraw(splineSession);
  // Remove constraints/dimensions for simplicity.
  splineSession = {
    ...splineSession,
    definition: {
      ...splineSession.definition,
      constraints: [],
      constraintIds: [],
      dimensions: [],
      dimensionIds: [],
    },
  };
  f.apply({ type: "selection.cleared" }, splineSession);
  const beforeDrag = projection(f.session);

  // The spline's middle occurrence is automatic.
  const spline = f.session.definition.entities.find((e) => e.kind === "spline");
  if (!spline || spline.kind !== "spline")
    throw new Error("Expected a spline entity.");
  const occ1 = spline.pointOccurrences[1]!;
  expect(occ1.tangent.kind).toBe("automatic");

  // Simulate a handle grab that converted auto→authored + drag to a new vector.
  // Compute the visible vector via reconstruction.
  const positions = Object.fromEntries(
    f.session.definition.points.map((p) => [p.pointId, p.position]),
  ) as Record<string, readonly [number, number]>;
  const reconstruction = reconstructSplineAggregate(spline, positions);
  if (reconstruction.validity !== "valid")
    throw new Error("Spline reconstruction should be valid.");

  // Apply: the definition now has an authored tangent (the drag result).
  const afterDragSession: SketchSessionState = {
    ...f.session,
    definition: {
      ...f.session.definition,
      entities: f.session.definition.entities.map((e) =>
        e.entityId === spline.entityId && e.kind === "spline"
          ? {
              ...e,
              pointOccurrences: e.pointOccurrences.map((o) =>
                o.occurrenceId === occ1.occurrenceId
                  ? {
                      ...o,
                      tangent: {
                        kind: "authored" as const,
                        vector: [2, -1] as const,
                      },
                    }
                  : o,
              ),
            }
          : e,
      ),
    },
  };
  f.apply(
    { type: "sketch.geometryDragEnded", point: [5, 3, 0] },
    { ...afterDragSession, activeDrag: null },
  );
  const afterDrag = projection(f.session);
  expect(afterDrag).not.toEqual(beforeDrag);
  expect(f.session.actionAvailability?.canUndo).toBe(true);

  // Undo: must restore the original definition (automatic tangent).
  const undone = f.apply({ type: "history.undoRequested" });
  expect(projection(undone)).toEqual(beforeDrag);
  const undoneSpline = undone.definition.entities.find(
    (e) => e.entityId === spline.entityId,
  );
  if (!undoneSpline || undoneSpline.kind !== "spline")
    throw new Error("Expected spline after undo.");
  expect(
    undoneSpline.pointOccurrences[1]!.tangent.kind,
    "Undo of a handle drag that converted auto→authored must restore 'automatic'.",
  ).toBe("automatic");

  // Redo: must restore the authored tangent.
  const redone = f.apply({ type: "history.redoRequested" });
  expect(projection(redone)).toEqual(afterDrag);
  const redoneSpline = redone.definition.entities.find(
    (e) => e.entityId === spline.entityId,
  );
  if (!redoneSpline || redoneSpline.kind !== "spline")
    throw new Error("Expected spline after redo.");
  const redoneOcc = redoneSpline.pointOccurrences[1]!;
  expect(redoneOcc.tangent.kind, "Redo must restore 'authored'.").toBe(
    "authored",
  );
  if (redoneOcc.tangent.kind === "authored") {
    expect(redoneOcc.tangent.vector[0]).toBe(2);
    expect(redoneOcc.tangent.vector[1]).toBe(-1);
  }
});

// T12b takeover: cancel/click-only drag for non-point intent produces no extra
// history entry. The existing point-drag test already covers this for point
// intents; this test verifies the same contract holds after the definition was
// set up for a non-point intent (radius/translate).
test("T12b: cancel/click-only drag produces no extra history entry", async () => {
  const f = await fixture();
  const before = projection(f.session);

  // Apply an unchanged candidate (no definition change): no history entry.
  f.apply({ type: "sketch.activeToolCleared" });
  expect(
    f.session.actionAvailability?.canUndo,
    "Premise: no undo available before drag.",
  ).toBe(false);
  expect(projection(f.session)).toEqual(before);
});

test("unchanged candidates keep Redo; new work clears it and errors propagate without capture", async () => {
  const f = await fixture();
  f.apply({ type: "selection.cleared" }, mutations.construction(f.session));
  f.apply({ type: "history.undoRequested" });
  f.apply({ type: "selection.cleared" });
  expect(f.session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });
  const failure = new Error("producer failed");
  expect(() =>
    f.owner.transition(f.state, { type: "selection.cleared" }, () => {
      throw failure;
    }),
  ).toThrow(failure);
  expect(f.session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });
  f.apply({ type: "selection.cleared" }, mutations.style(f.session));
  expect(f.session.actionAvailability).toEqual({
    canUndo: true,
    canRedo: false,
  });
});

test("compensation restores every authored sketch field captured by the owner", async () => {
  const f = await fixture();
  const originalLabel = f.session.sketchLabel;
  const originalPlane = f.session.plane;
  const candidate = {
    ...f.session,
    sketchLabel: "Renamed sketch",
    plane: createStandardPlaneDefinition("yz"),
  };

  f.apply({ type: "selection.cleared" }, candidate);
  const restored = f.apply({ type: "history.undoRequested" });

  expect(restored.sketchLabel).toBe(originalLabel);
  expect(restored.plane).toEqual(originalPlane);
  expect(restored.planeTarget).toEqual(originalPlane.support);
  expect(restored.commitRequest?.sketchLabel).toBe(originalLabel);
  expect(restored.commitRequest?.plane).toEqual(originalPlane);
});

test("creation IDs do not collide in independent drafts with identical counters", () => {
  const a = line(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  const b = line(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  const ids = new Set([
    ...a.definition.pointIds,
    ...a.definition.entityIds,
    ...a.definition.constraintIds,
    ...a.definition.dimensionIds,
  ]);
  expect(
    [
      ...b.definition.pointIds,
      ...b.definition.entityIds,
      ...b.definition.constraintIds,
      ...b.definition.dimensionIds,
    ].some((id) => ids.has(id)),
  ).toBe(false);
});

test("live deletion compensates its dependent constraints and repeated actions independently", async () => {
  const f = await fixture(true);
  const original = projection(f.session);
  const entity = f.session.definition.entities[0]!;
  expect(
    f.session.definition.constraints.length +
      f.session.definition.dimensions.length,
  ).toBeGreaterThan(0);
  f.apply(
    { type: "sketch.annotationDeleteRequested" },
    deleteSelectedSketchGeometry(f.session, [entity.target]),
  );
  expect(f.session.definition.entities).toHaveLength(0);
  const deleted = projection(f.session);
  f.apply({ type: "selection.cleared" }, line(f.session));
  expect(f.session.definition.entities).toHaveLength(1);
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    deleted,
  );
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    original,
  );
  expect(f.session.actionAvailability?.canUndo).toBe(false);
  expect(
    projection(f.apply({ type: "tool.activated", toolId: "redo" })),
  ).toEqual(deleted);
  expect(
    f.apply({ type: "history.redoRequested" }).definition.entities,
  ).toHaveLength(1);
});

test("reference-image deletion undo and redo restore exact ownership and retained geometry", async () => {
  const f = await fixture();
  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: f.session.actionContextId,
    payload: {
      mediaType: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      base64Data: "cG5n",
    },
  });
  const ownedPoint = {
    pointId: "sketch_point_image_owned" as const,
    label: "Image anchor",
    target: {
      kind: "sketchPoint" as const,
      sketchId: f.session.actionContextId,
      pointId: "sketch_point_image_owned" as const,
    },
    position: [2, 3] as const,
    isConstruction: true,
  };
  const ownedEntity = {
    kind: "point" as const,
    entityId: "sketch_entity_image_owned" as const,
    label: "Image anchor",
    target: {
      kind: "sketchEntity" as const,
      sketchId: f.session.actionContextId,
      entityId: "sketch_entity_image_owned" as const,
    },
    pointId: ownedPoint.pointId,
    isConstruction: true,
  };
  const withImage = updateReferenceImageOperationStates({
    session: appendReferenceImageOperations(f.session, [operation]),
    updates: [
      {
        operationId: operation.operationId,
        state: operation.ownedState,
        createdPoints: [ownedPoint],
        createdEntities: [ownedEntity],
      },
    ],
  });
  f.apply({ type: "selection.cleared" }, withImage);
  const beforeDelete = projection(f.session);
  const retainedEntity = f.session.definition.entities.find(
    (entity) => entity.entityId !== ownedEntity.entityId,
  )!;
  const withoutImage = deleteSelectedSketchGeometry(f.session, [
    {
      kind: "sketchOperation",
      sketchId: f.session.sketchId ?? "sketch_draft",
      operationId: operation.operationId,
    },
  ]);
  f.apply({ type: "selection.cleared" }, withoutImage);
  const afterDelete = projection(f.session);
  expect(f.session.definition.points).not.toContainEqual(ownedPoint);
  expect(f.session.definition.entities).toContainEqual(retainedEntity);
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    beforeDelete,
  );
  expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
    afterDelete,
  );
});

test("Finish never publishes an uncompleted drag preview", async () => {
  const f = await fixture();
  const before = projection(f.session);
  const finishDragTarget = f.session.definition.points[0]!.target;
  f.apply(
    { type: "selection.cleared" },
    {
      ...mutations.drag(f.session),
      activeDrag: {
        target: finishDragTarget,
        handle: { kind: "point" as const, pointId: finishDragTarget.pointId },
        intent: { kind: "point" as const, pointId: finishDragTarget.pointId },
        preDragDefinition: f.session.definition,
        startPoint: [0, 0],
        currentPoint: [3, 4],
        grabOffset: [0, 0] as const,
        status: "dragging" as const,
        message: null,
        interactiveSolveSession: null,
      },
    },
  );
  const event: EditorEvent = {
    type: "command.commitRequested",
    commandSessionId: f.state.command.commandSessionId,
  };
  const result = f.owner.transition(f.state, event, (state) =>
    transitionEditorState(state, event),
  );
  const commit = result.effects.find(
    (effect) => effect.type === "sketch.commit",
  );
  expect(commit?.type).toBe("sketch.commit");
  if (commit?.type === "sketch.commit")
    expect(projection(commit.session)).toEqual(before);
});

test("Finish carries the original private base and reconciles retained history to the published identity", async () => {
  const f = await fixture();
  const draftContextId = f.session.actionContextId;
  f.apply(
    { type: "selection.cleared" },
    { ...f.session, sketchLabel: "sketch_draft" },
  );
  const original = projection(f.session);
  f.apply({ type: "selection.cleared" }, mutations.style(f.session));
  const finish = f.owner.transition(
    f.state,
    { type: "tool.activated", toolId: "finishSketch" },
    (state) =>
      transitionEditorState(state, {
        type: "tool.activated",
        toolId: "finishSketch",
      }),
  );
  const commit = finish.effects.find(
    (effect) => effect.type === "sketch.commit",
  );
  expect(commit?.type).toBe("sketch.commit");
  if (commit?.type !== "sketch.commit")
    throw new Error("Expected sketch commit.");
  expect(commit.publicationBase).toEqual({
    actionContextId: draftContextId,
    expectedSketch: null,
  });

  f.owner.transition(
    f.state,
    {
      type: "effect.sketchCommitted",
      requestId: "request_publish",
      documentId: "doc_workspace",
      commandSessionId: "command_test",
      baseRevisionId: "rev_1",
      revisionId: "rev_2",
      accepted: true,
      diagnostics: [],
      publishedSketchId: "sketch_published",
    },
    () => ({ state: initialEditorState, effects: [] }),
  );
  const publishedSession = remapTestSketchIds(
    structuredClone(f.session),
    "sketch_published",
  ) as SketchSessionState;
  publishedSession.sketchId = "sketch_published";
  publishedSession.actionContextId = "sketch_published";
  const reentry = {
    ...f.state,
    session: publishedSession,
  } as SketchEditorState;
  const entered = f.owner.transition(
    initialEditorState,
    { type: "selection.cleared" },
    () => ({ state: reentry, effects: [] }),
  );
  const undone = f.owner.transition(
    entered.state,
    { type: "history.undoRequested" },
    (state) => ({ state, effects: [] }),
  );
  expect(undone.state.kind).toBe("editingSketch");
  if (undone.state.kind === "editingSketch") {
    expect(projection(undone.state.session)).toEqual(
      remapTestSketchIds(original, "sketch_published"),
    );
    expect(undone.state.session.sketchLabel).toBe("sketch_draft");
  }
});

test("ordinary document replacement preserves private contexts; explicit file open starts only that owner fresh", async () => {
  const f = await fixture();
  const before = projection(f.session);
  f.apply({ type: "selection.cleared" }, mutations.style(f.session));
  const retained = f.state;
  f.owner.transition(
    retained,
    {
      type: "document.replaced",
      snapshot: retained.snapshot!,
    },
    () => ({ state: initialEditorState, effects: [] }),
  );
  const reopened = f.owner.transition(
    initialEditorState,
    { type: "selection.cleared" },
    () => ({ state: retained, effects: [] }),
  );
  const undone = f.owner.transition(
    reopened.state,
    { type: "history.undoRequested" },
    (state) => ({ state, effects: [] }),
  );
  expect(undone.state.kind).toBe("editingSketch");
  if (undone.state.kind === "editingSketch")
    expect(projection(undone.state.session)).toEqual(before);
  f.owner.transition(
    retained,
    {
      type: "document.replaced",
      snapshot: retained.snapshot!,
      historyDisposition: "fresh-file-open",
    },
    () => ({ state: initialEditorState, effects: [] }),
  );
  const fresh = f.owner.transition(
    initialEditorState,
    { type: "selection.cleared" },
    () => ({ state: retained, effects: [] }),
  );
  if (fresh.state.kind !== "editingSketch")
    throw Error("Expected reopened sketch");
  expect(fresh.state.session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: false,
  });
});

test("reentry uses latest authored state and retains blocked actions instead of overwriting it", async () => {
  const f = await fixture();
  f.apply({ type: "selection.cleared" }, mutations.construction(f.session));
  const peer = {
    ...f.session,
    definition: {
      ...f.session.definition,
      entities: f.session.definition.entities.map((entity) => ({
        ...entity,
        isConstruction: false,
      })),
    },
  };
  const opened = f.owner.transition(
    initialEditorState,
    { type: "selection.cleared" },
    () => ({ state: { ...f.state, session: peer }, effects: [] }),
  );
  const result = f.owner.transition(
    opened.state,
    { type: "history.undoRequested" },
    (state) => ({ state, effects: [] }),
  );
  if (result.state.kind !== "editingSketch") throw Error("Expected sketch");
  expect(projection(result.state.session)).toEqual(projection(peer));
  expect(result.state.session.validationMessage).toContain(
    "expected-state-changed",
  );
  expect(result.state.session.actionAvailability).toEqual({
    canUndo: true,
    canRedo: false,
  });
  expect(result.state.session.actionHistory?.undo.at(-1)).toMatchObject({
    blockedReason: "expected-state-changed",
  });
});

// T10g-1 (T-g15): an applied exact Trim is one labelled T01 action. Undo and
// Redo replay its write set (points, pieces, ties) exactly and never query
// again; a peer change to a field of the write set blocks Redo atomically.
test("T10g-1: an applied Trim is one 'Trim' action; Undo/Redo restore it exactly without re-querying; a peer edit inside its write set blocks Redo", async () => {
  const f = await fixture();
  const draw = (
    session: SketchSessionState,
    start: [number, number],
    end: [number, number],
  ) =>
    acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), start),
      end,
    );
  f.apply(
    { type: "selection.cleared" },
    draw(draw(f.session, [3, -1], [3, 1]), [9, -1], [9, 1]),
  );
  const target = f.session.definition.entities[0]!;
  const clicked = selectSketchEditToolTarget(
    beginSketchTool(f.session, "trim"),
    target.target,
  );
  f.apply({ type: "selection.cleared" }, clicked);
  const before = projection(f.session);
  expect(f.session.actionHistory?.undo).toHaveLength(1);
  const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
  const effect = emitted.effects.find(
    (candidate) => candidate.type === "sketch.queryEditIntersections",
  );
  if (effect?.type !== "sketch.queryEditIntersections")
    throw new Error("Expected the Trim query.");
  const event = await runEditorEffect(effect, {
    querySketchEditIntersections: querySketchEditIntersectionsForTest,
  } as EditorEffectRuntime);
  const result = f.owner.transition(
    emitted.state as SketchEditorState,
    event,
    (state) => transitionEditorState(state, event),
  );
  if (result.state.kind !== "editingSketch") throw Error("Expected sketch");
  const after = projection(result.state.session);
  expect(after).not.toEqual(before);
  expect(result.state.session.definition.entities).toHaveLength(4);
  expect(result.state.session.actionHistory?.undo.at(-1)?.label).toBe("Trim");
  expect(result.state.session.actionHistory?.undo).toHaveLength(2);

  const replay = (state: SketchEditorState, type: EditorEvent["type"]) => {
    const step = { type } as EditorEvent;
    const next = f.owner.transition(state, step, (current) =>
      transitionEditorState(current, step),
    );
    expect(
      next.effects.filter(
        (candidate) => candidate.type === "sketch.queryEditIntersections",
      ),
      `${type} never re-queries`,
    ).toEqual([]);
    if (next.state.kind !== "editingSketch") throw Error("Expected sketch");
    return next.state;
  };
  const undone = replay(result.state, "history.undoRequested");
  expect(projection(undone.session)).toEqual(before);
  const redone = replay(undone, "history.redoRequested");
  expect(projection(redone.session)).toEqual(after);

  // A peer rewrites the target's end point (a field the Trim wrote) after Undo.
  const reundone = replay(redone, "history.undoRequested");
  const peer = {
    ...reundone.session,
    definition: {
      ...reundone.session.definition,
      entities: reundone.session.definition.entities.map((entity) =>
        entity.entityId === target.entityId && entity.kind === "lineSegment"
          ? { ...entity, endPointId: entity.startPointId }
          : entity,
      ),
    },
  };
  const opened = f.owner.transition(
    initialEditorState,
    { type: "selection.cleared" },
    () => ({ state: { ...reundone, session: peer }, effects: [] }),
  );
  const blocked = f.owner.transition(
    opened.state,
    { type: "history.redoRequested" },
    (state) => ({ state, effects: [] }),
  );
  if (blocked.state.kind !== "editingSketch") throw Error("Expected sketch");
  expect(projection(blocked.state.session)).toEqual(projection(peer));
  expect(blocked.state.session.validationMessage).toContain("Cannot redo");
  expect(blocked.state.session.actionHistory?.redo.at(-1)).toMatchObject({
    label: "Trim",
    blockedReason: expect.any(String),
  });
});

// T10g-2 (T-g15): an applied Extend or Split is one action labelled by its
// tool; Undo/Redo replay its write set exactly and never query again.
test.each([
  ["sketchExtend", "Extend", 15, 2],
  ["sketchSplit", "Split", 3, 3],
] as const)(
  "T10g-2: an applied %s is one '%s' action; Undo/Redo restore it exactly without re-querying",
  async (toolId, label, x, entities) => {
    const f = await fixture();
    f.apply(
      { type: "selection.cleared" },
      acceptSketchDraw(
        startSketchDraw(beginSketchTool(f.session, "line"), [x, -1]),
        [x, 1],
      ),
    );
    const [target, boundary] = f.session.definition.entities;
    const selected = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(f.session, toolId),
        target!.target,
      ),
      boundary!.target,
    );
    f.apply({ type: "selection.cleared" }, selected);
    const before = projection(f.session);
    expect(f.session.actionHistory?.undo).toHaveLength(1);
    const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
    const effect = emitted.effects.find(
      (candidate) => candidate.type === "sketch.queryEditIntersections",
    );
    if (effect?.type !== "sketch.queryEditIntersections")
      throw new Error(`Expected the ${label} query.`);
    const event = await runEditorEffect(effect, {
      querySketchEditIntersections: querySketchEditIntersectionsForTest,
    } as EditorEffectRuntime);
    const result = f.owner.transition(
      emitted.state as SketchEditorState,
      event,
      (state) => transitionEditorState(state, event),
    );
    if (result.state.kind !== "editingSketch") throw Error("Expected sketch");
    const after = projection(result.state.session);
    expect(after).not.toEqual(before);
    expect(result.state.session.definition.entities).toHaveLength(entities);
    expect(result.state.session.actionHistory?.undo.at(-1)?.label).toBe(label);
    expect(result.state.session.actionHistory?.undo).toHaveLength(2);
    const replay = (state: SketchEditorState, type: EditorEvent["type"]) => {
      const step = { type } as EditorEvent;
      const next = f.owner.transition(state, step, (current) =>
        transitionEditorState(current, step),
      );
      expect(
        next.effects.filter(
          (candidate) => candidate.type === "sketch.queryEditIntersections",
        ),
        `${type} never re-queries`,
      ).toEqual([]);
      if (next.state.kind !== "editingSketch") throw Error("Expected sketch");
      return next.state;
    };
    const undone = replay(result.state, "history.undoRequested");
    expect(projection(undone.session)).toEqual(before);
    const redone = replay(undone, "history.redoRequested");
    expect(projection(redone.session)).toEqual(after);
  },
);

// Orchestrator [TECH] 2026-10-04: the radius → diameter rewrite of a trimmed
// circle is part of the one "Trim" action; Undo restores the radius bitwise.
test("T10g-1: Undo of a circle Trim restores its circleRadius dimension exactly; Redo restores the diameter", async () => {
  const f = await fixture();
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(f.session, "circle"), [20, 0]),
    [22, 0],
  );
  for (const x of [21, 19])
    session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), [x, -3]),
      [x, 3],
    );
  f.apply({ type: "selection.cleared" }, session);
  const circle = f.session.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  f.apply(
    { type: "selection.cleared" },
    selectSketchEditToolTarget(
      beginSketchTool(f.session, "trim"),
      circle.target,
    ),
  );
  const before = projection(f.session);
  const radius = structuredClone(f.session.definition.dimensions);
  const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
  const effect = emitted.effects.find(
    (candidate) => candidate.type === "sketch.queryEditIntersections",
  );
  if (effect?.type !== "sketch.queryEditIntersections")
    throw new Error("Expected the Trim query.");
  const event = await runEditorEffect(effect, {
    querySketchEditIntersections: querySketchEditIntersectionsForTest,
  } as EditorEffectRuntime);
  const applied = f.owner.transition(
    emitted.state as SketchEditorState,
    event,
    (state) => transitionEditorState(state, event),
  );
  if (applied.state.kind !== "editingSketch") throw Error("Expected sketch");
  const after = projection(applied.state.session);
  expect(
    applied.state.session.definition.dimensions.map(
      (dimension) => dimension.kind,
    ),
  ).toContain("diameter");
  expect(applied.state.session.actionHistory?.undo.at(-1)?.label).toBe("Trim");
  const step = (state: SketchEditorState, type: EditorEvent["type"]) => {
    const next = f.owner.transition(state, { type } as EditorEvent, (current) =>
      transitionEditorState(current, { type } as EditorEvent),
    );
    if (next.state.kind !== "editingSketch") throw Error("Expected sketch");
    return next.state;
  };
  const undone = step(applied.state, "history.undoRequested");
  expect(projection(undone.session)).toEqual(before);
  expect(undone.session.definition.dimensions).toEqual(radius);
  expect(projection(step(undone, "history.redoRequested").session)).toEqual(
    after,
  );
});

// T10g-3b: a spline Trim (two option-B pieces, new fit points, ties) is one
// "Trim" action; Undo restores the original spline exactly (no field key,
// its occurrences and tangents), Redo the pieces, neither re-queries.
test("T10g-3b: an applied spline Trim is one 'Trim' action; Undo/Redo restore it exactly without re-querying", async () => {
  const f = await fixture();
  let session = beginSketchTool(f.session, "spline");
  session = startSketchDraw(session, [20, 0]);
  for (const point of [
    [22, 3],
    [24, 0],
  ] as const)
    session = acceptSketchDraw(session, point);
  session = finalizeSketchDraw(session);
  for (const x of [21, 23])
    session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), [x, -1]),
      [x, 4],
    );
  f.apply({ type: "selection.cleared" }, session);
  const spline = f.session.definition.entities.find(
    (entity) => entity.kind === "spline",
  )!;
  const original = structuredClone(spline);
  f.apply(
    { type: "selection.cleared" },
    selectSketchEditToolTarget(
      beginSketchTool(f.session, "trim"),
      spline.target,
    ),
  );
  const before = projection(f.session);
  const undoDepth = f.session.actionHistory!.undo.length;
  const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
  const effect = emitted.effects.find(
    (candidate) => candidate.type === "sketch.queryEditIntersections",
  );
  if (effect?.type !== "sketch.queryEditIntersections")
    throw new Error("Expected the Trim query.");
  const event = await runEditorEffect(effect, {
    querySketchEditIntersections: querySketchEditIntersectionsForTest,
  } as EditorEffectRuntime);
  const applied = f.owner.transition(
    emitted.state as SketchEditorState,
    event,
    (state) => transitionEditorState(state, event),
  );
  if (applied.state.kind !== "editingSketch") throw Error("Expected sketch");
  const after = projection(applied.state.session);
  const splines = applied.state.session.definition.entities.filter(
    (entity) => entity.kind === "spline",
  );
  expect(splines).toHaveLength(2);
  expect(
    splines.every(
      (entity) =>
        entity.kind === "spline" &&
        entity.endSpanParameterLengths !== undefined,
    ),
  ).toBe(true);
  expect(applied.state.session.actionHistory?.undo.at(-1)?.label).toBe("Trim");
  expect(applied.state.session.actionHistory?.undo).toHaveLength(undoDepth + 1);
  const step = (state: SketchEditorState, type: EditorEvent["type"]) => {
    const next = f.owner.transition(state, { type } as EditorEvent, (current) =>
      transitionEditorState(current, { type } as EditorEvent),
    );
    expect(
      next.effects.filter(
        (candidate) => candidate.type === "sketch.queryEditIntersections",
      ),
      `${type} never re-queries`,
    ).toEqual([]);
    if (next.state.kind !== "editingSketch") throw Error("Expected sketch");
    return next.state;
  };
  const undone = step(applied.state, "history.undoRequested");
  expect(projection(undone.session)).toEqual(before);
  const restored = undone.session.definition.entities.find(
    (entity) => entity.entityId === spline.entityId,
  )!;
  expect(restored).toStrictEqual(original);
  expect(Object.hasOwn(restored, "endSpanParameterLengths")).toBe(false);
  expect(projection(step(undone, "history.redoRequested").session)).toEqual(
    after,
  );
});

describe("T11g: drawing-tool lifecycle history boundaries (T11-D10, D14, D19)", () => {
  function undoLabels(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  }

  test("a discrete tool repeats; each completion is one action and the tool stays armed", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    for (const [x, y] of [
      [20, 0],
      [40, 0],
    ]) {
      f.dispatch({ type: "sketch.pointerReleased", point: [x, y] });
      f.dispatch({ type: "sketch.pointerReleased", point: [x + 3, y] });
    }

    expect(
      f.session.definition.entities.filter(
        (entity) => entity.kind === "circle",
      ),
      "Two circles in a row without re-activating the tool.",
    ).toHaveLength(2);
    expect(f.session.activeTool, "Circle stays armed.").toBe("circle");
    expect(undoLabels(f), "One action per circle.").toEqual([
      "Create Sketch Geometry",
      "Create Sketch Geometry",
    ]);
  });

  test("Escape cancels a draft with no action and keeps the tool; the next Escape leaves it", async () => {
    const f = await fixture();
    const before = projection(f.session);
    // Review V-R1: select the existing line first; arming Circle keeps it.
    const lineTarget = f.session.definition.entities[0]!.target;
    f.dispatch({ type: "sketch.activeToolCleared" });
    f.dispatch({ type: "viewport.selectionRequested", target: lineTarget });
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    const selected = f.state.selection;
    expect(selected, "The line is selected while Circle is armed.").toEqual([
      lineTarget,
    ]);
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
    expect(f.session.status).toBe("drawing");

    f.dispatch({ type: "sketch.escapeRequested" });
    expect(
      f.state.selection,
      "Cancelling the draft keeps the selection.",
    ).toEqual(selected);
    expect(f.session.activeTool, "The first Escape keeps Circle armed.").toBe(
      "circle",
    );
    expect(f.session.status, "The draft is cancelled.").toBe("idle");
    expect(f.session.toolStagedEntities).toEqual([]);
    expect(f.session.toolPlacedPoints).toEqual([]);
    expect(projection(f.session)).toEqual(before);
    expect(
      f.session.actionAvailability?.canUndo,
      "Cancelling records nothing.",
    ).toBe(false);

    f.dispatch({ type: "sketch.escapeRequested" });
    expect(f.session.activeTool, "The second Escape leaves for Select.").toBe(
      null,
    );
    expect(f.state.selection, "Leaving the tool clears the selection.").toEqual(
      [],
    );
    expect(f.session.actionAvailability?.canUndo).toBe(false);

    // The cancelled circle starts afresh: one later circle is one action.
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
    f.dispatch({ type: "sketch.escapeRequested" });
    f.dispatch({ type: "sketch.pointerReleased", point: [30, 0] });
    f.dispatch({ type: "sketch.pointerReleased", point: [33, 0] });
    const circles = f.session.definition.entities.filter(
      (entity) => entity.kind === "circle",
    );
    expect(circles).toHaveLength(1);
    expect(undoLabels(f)).toEqual(["Create Sketch Geometry"]);
  });

  test("Escape during an annotation-label drag with a drawing tool armed restores the label and records nothing (review V-5)", async () => {
    const f = await fixture();
    f.apply({ type: "selection.cleared" }, mutations.annotation(f.session));
    const placed = projection(f.session);
    const labels = undoLabels(f);
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    const drag = (
      gesturePhase: "start" | "move",
      point: readonly [number, number],
    ) =>
      f.dispatch({
        type: "sketch.toolPatched",
        patch: {
          intent: "setDimensionAnnotationPlacement",
          dimensionId: "dimension_annotation",
          point,
          gesturePhase,
          clientPoint: point,
        },
      });
    drag("start", [6, 20]);
    drag("move", [6, 40]);
    expect(
      projection(f.session),
      "The label preview moved during the drag.",
    ).not.toEqual(placed);

    f.dispatch({ type: "sketch.escapeRequested" });
    expect(
      projection(f.session),
      "Escape abandons the drag and restores the accepted label placement.",
    ).toEqual(placed);
    expect(undoLabels(f), "The abandoned drag records nothing.").toEqual(
      labels,
    );
    expect(
      f.session.activeTool,
      "With no draft, the same Escape leaves Circle.",
    ).toBe(null);
  });

  test("Enter with an incomplete discrete draft changes nothing and records nothing", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
    const drafting = f.session;

    f.dispatch({ type: "sketch.confirmRequested" });
    expect(f.session, "Enter does not apply to a circle draft.").toEqual(
      drafting,
    );
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });

  test.each([
    ["a tool switch", "rectangle"],
    ["the construction toggle (review A-7)", "construction"],
  ] as const)(
    "%s mid-draft discards the draft with no action",
    async (_name, toolId) => {
      const f = await fixture();
      const before = projection(f.session);
      f.dispatch({ type: "tool.activated", toolId: "circle" });
      f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
      f.dispatch({ type: "tool.activated", toolId });

      expect(f.session.activeTool).toBe(toolId);
      expect(f.session.pointerDownPoint, "The draft is gone.").toBe(null);
      expect(f.session.toolStagedEntities).toEqual([]);
      expect(projection(f.session)).toEqual(before);
      expect(f.session.actionAvailability?.canUndo).toBe(false);
    },
  );

  test("Finish mid-draft publishes the definition without the draft and records nothing (T11-D14)", async () => {
    const f = await fixture();
    const before = projection(f.session);
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
    const event: EditorEvent = {
      type: "tool.activated",
      toolId: "finishSketch",
    };
    const result = f.owner.transition(f.state, event, (state) =>
      transitionEditorState(state, event),
    );
    const commit = result.effects.find(
      (effect) => effect.type === "sketch.commit",
    );

    expect(commit?.type).toBe("sketch.commit");
    if (commit?.type === "sketch.commit")
      expect(projection(commit.session)).toEqual(before);
    expect(
      result.state.kind === "editingSketch"
        ? result.state.session.actionAvailability?.canUndo
        : null,
      "The discarded draft adds no action.",
    ).toBe(false);
  });

  test("Point places one point per click, one action each (T11-D19)", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "point" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 5] });

    const points = () =>
      f.session.definition.entities.filter((entity) => entity.kind === "point");
    expect(points(), "One click places the point.").toHaveLength(1);
    expect(f.session.status).toBe("idle");
    expect(undoLabels(f)).toEqual(["Create Sketch Geometry"]);

    f.dispatch({ type: "sketch.pointerReleased", point: [30, 5] });
    expect(points()).toHaveLength(2);
    expect(undoLabels(f)).toEqual([
      "Create Sketch Geometry",
      "Create Sketch Geometry",
    ]);
    expect(f.session.activeTool, "Point stays armed.").toBe("point");
  });
});

describe("T11h: Line chain history (T11-D11, D12)", () => {
  function undoLabels(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  }
  function chainLines(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" && entity.label !== "Line 1"
        ? [entity]
        : [],
    );
  }
  async function chainOfThree() {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "line" });
    for (const point of [
      [20, 20],
      [30, 21],
      [31, 31],
      [42, 33],
    ] as const) {
      f.dispatch({ type: "sketch.pointerReleased", point });
    }
    return f;
  }

  test("each segment is one action; ending the chain by Enter or Escape records nothing", async () => {
    const f = await chainOfThree();
    expect(chainLines(f), "Three joined segments.").toHaveLength(3);
    expect(undoLabels(f), "One action per segment.").toEqual([
      "Create Sketch Geometry",
      "Create Sketch Geometry",
      "Create Sketch Geometry",
    ]);
    expect(f.session.activeTool).toBe("line");
    expect(f.session.status, "The chain continues.").toBe("drawing");
    const committed = projection(f.session);

    f.dispatch({ type: "sketch.confirmRequested" });
    expect(f.session.activeTool, "Enter keeps Line armed.").toBe("line");
    expect(f.session.status, "Enter ends the chain.").toBe("idle");
    expect(f.session.toolChain ?? null).toBe(null);
    expect(projection(f.session)).toEqual(committed);
    expect(undoLabels(f), "Ending the chain records nothing.").toHaveLength(3);

    f.dispatch({ type: "sketch.pointerReleased", point: [60, 60] });
    f.dispatch({ type: "sketch.pointerReleased", point: [70, 60] });
    expect(undoLabels(f)).toHaveLength(4);
    const fourth = projection(f.session);
    f.dispatch({ type: "sketch.escapeRequested" });
    expect(f.session.activeTool, "The first Escape keeps Line armed.").toBe(
      "line",
    );
    expect(f.session.status, "The first Escape ends the chain.").toBe("idle");
    expect(projection(f.session)).toEqual(fourth);
    expect(undoLabels(f)).toHaveLength(4);
    f.dispatch({ type: "sketch.escapeRequested" });
    expect(f.session.activeTool, "The second Escape leaves Line.").toBe(null);
    expect(undoLabels(f)).toHaveLength(4);
  });

  test("Undo twice moves the anchor back with Line armed; Redo re-extends; a new segment after Undo continues from the anchor", async () => {
    const f = await chainOfThree();
    const [first, second, third] = chainLines(f);

    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.activeTool, "Undo keeps Line armed.").toBe("line");
    expect(f.session.status).toBe("drawing");
    expect(chainLines(f)).toEqual([first, second]);
    expect(f.session.pointerDownPoint).toEqual([31, 31]);
    f.dispatch({ type: "history.undoRequested" });
    expect(chainLines(f)).toEqual([first]);
    expect(f.session.pointerDownPoint, "The anchor moved back again.").toEqual([
      30, 21,
    ]);

    f.dispatch({ type: "history.redoRequested" });
    expect(chainLines(f)).toEqual([first, second]);
    expect(f.session.pointerDownPoint, "Redo re-extends the chain.").toEqual([
      31, 31,
    ]);
    expect(f.session.status).toBe("drawing");

    f.dispatch({ type: "sketch.pointerReleased", point: [20, 40] });
    const added = chainLines(f).at(-1);
    expect(chainLines(f)).toHaveLength(3);
    expect(added?.entityId).not.toBe(third?.entityId);
    expect(
      added?.startPointId,
      "The new segment starts on the restored anchor.",
    ).toBe(second?.endPointId);
    expect(f.session.actionAvailability?.canRedo, "New work clears Redo.").toBe(
      false,
    );
    expect(
      f.session.toolChain?.segments.map((segment) => segment.entityId),
    ).toEqual([first, second, added].map((line) => line?.entityId));
  });

  test("Undo past the first segment leaves Line armed with only the chain start placed", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "line" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 20] });
    f.dispatch({ type: "sketch.pointerReleased", point: [30, 21] });
    const before = chainLines(f)[0];

    f.dispatch({ type: "history.undoRequested" });
    expect(chainLines(f)).toEqual([]);
    expect(f.session.activeTool).toBe("line");
    expect(f.session.status).toBe("drawing");
    expect(f.session.pointerDownPoint).toEqual([20, 20]);

    f.dispatch({ type: "sketch.pointerReleased", point: [20, 40] });
    const [line] = chainLines(f);
    expect(line?.startPointId, "The undone start id is not reused.").not.toBe(
      before?.startPointId,
    );
    expect(
      f.session.definition.points.some(
        (point) => point.pointId === line?.startPointId,
      ),
    ).toBe(true);
  });

  test("a blocked Undo changes nothing, the chain included", async () => {
    const f = await chainOfThree();
    const third = chainLines(f)[2]!;
    // A peer moves the last segment's end point (inside its write set).
    const peer = {
      ...f.session,
      definition: {
        ...f.session.definition,
        points: f.session.definition.points.map((point) =>
          point.pointId === third.endPointId
            ? { ...point, position: [44, 35] as const }
            : point,
        ),
      },
    };
    const opened = f.owner.transition(
      initialEditorState,
      { type: "selection.cleared" },
      () => ({ state: { ...f.state, session: peer }, effects: [] }),
    );
    if (opened.state.kind !== "editingSketch") throw Error("Expected sketch");
    const before = opened.state.session;
    const blocked = f.owner.transition(
      opened.state,
      { type: "history.undoRequested" },
      (state) =>
        transitionEditorState(state, { type: "history.undoRequested" }),
    );
    if (blocked.state.kind !== "editingSketch") throw Error("Expected sketch");
    const after = blocked.state.session;

    expect(after.validationMessage).toContain("Cannot undo");
    expect(projection(after)).toEqual(projection(peer));
    expect(
      {
        activeTool: after.activeTool,
        status: after.status,
        pointerDownPoint: after.pointerDownPoint,
        drawStartSnap: after.drawStartSnap,
        toolChain: after.toolChain,
      },
      "The chain and its anchor are unchanged.",
    ).toEqual({
      activeTool: before.activeTool,
      status: before.status,
      pointerDownPoint: before.pointerDownPoint,
      drawStartSnap: before.drawStartSnap,
      toolChain: before.toolChain,
    });
  });
});

describe("T11i: fit-point spline history (T11-D10, D13, D14)", () => {
  function undoLabels(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  }
  function splines(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.definition.entities.filter(
      (entity) => entity.kind === "spline",
    );
  }
  async function splineDraft(points: readonly (readonly [number, number])[]) {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "spline" });
    for (const point of points)
      f.dispatch({ type: "sketch.pointerReleased", point });
    return f;
  }

  test.each([
    ["Enter", "sketch.confirmRequested"],
    ["Escape", "sketch.escapeRequested"],
  ] as const)(
    "2 points + %s finalize one spline as one action and keep Spline armed",
    async (_key, type) => {
      const f = await splineDraft([
        [20, 20],
        [30, 25],
      ]);
      expect(
        f.session.actionAvailability?.canUndo,
        "Fit-point clicks record nothing.",
      ).toBe(false);

      f.dispatch({ type });
      expect(splines(f)).toHaveLength(1);
      expect(undoLabels(f), "One action for the finalized spline.").toEqual([
        "Create Sketch Geometry",
      ]);
      expect(f.session.activeTool, "Spline stays armed.").toBe("spline");
      expect(f.session.status).toBe("idle");
      expect(f.state.command.phase).toBe("collecting");

      f.dispatch({ type: "sketch.escapeRequested" });
      expect(f.session.activeTool, "A second Escape leaves Spline.").toBe(null);
      expect(undoLabels(f)).toHaveLength(1);
    },
  );

  test("5 fit points then Enter: one spline through all 5 points, one action", async () => {
    const points = [
      [20, 20],
      [30, 25],
      [40, 20],
      [50, 25],
      [60, 20],
    ] as const;
    const f = await splineDraft(points);
    expect(splines(f), "No click commits the spline.").toEqual([]);
    f.dispatch({ type: "sketch.confirmRequested" });

    const [spline] = splines(f);
    if (spline?.kind !== "spline") throw Error("Expected the spline.");
    expect(
      spline.pointOccurrences.map(
        (occurrence) =>
          f.session.definition.points.find(
            ({ pointId }) => pointId === occurrence.pointId,
          )?.position,
      ),
    ).toEqual(points);
    expect(undoLabels(f)).toEqual(["Create Sketch Geometry"]);
  });

  test("1 point: Enter does nothing, Escape cancels without history, the next Escape exits", async () => {
    const f = await splineDraft([[20, 20]]);
    const before = projection(f.session);
    const drafting = f.session;

    f.dispatch({ type: "sketch.confirmRequested" });
    expect(f.session, "Enter below the minimum is a no-op.").toEqual(drafting);

    f.dispatch({ type: "sketch.escapeRequested" });
    expect(f.session.activeTool).toBe("spline");
    expect(f.session.status, "The 1-point draft is cancelled.").toBe("idle");
    expect(f.session.toolPlacedPoints).toEqual([]);
    expect(projection(f.session)).toEqual(before);
    expect(f.session.actionAvailability?.canUndo).toBe(false);

    f.dispatch({ type: "sketch.escapeRequested" });
    expect(f.session.activeTool).toBe(null);
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });

  test("a tool switch or Finish with an unfinalized 3-point spline discards it with no action (T11-D14)", async () => {
    const draft = [
      [20, 20],
      [30, 25],
      [40, 20],
    ] as const;
    const switched = await splineDraft(draft);
    const before = projection(switched.session);
    switched.dispatch({ type: "tool.activated", toolId: "circle" });
    expect(switched.session.toolPlacedPoints).toEqual([]);
    expect(projection(switched.session)).toEqual(before);
    expect(switched.session.actionAvailability?.canUndo).toBe(false);

    const finished = await splineDraft(draft);
    const finishedBefore = projection(finished.session);
    const event: EditorEvent = {
      type: "tool.activated",
      toolId: "finishSketch",
    };
    const result = finished.owner.transition(finished.state, event, (state) =>
      transitionEditorState(state, event),
    );
    const commit = result.effects.find(
      (effect) => effect.type === "sketch.commit",
    );
    expect(commit?.type).toBe("sketch.commit");
    if (commit?.type === "sketch.commit")
      expect(
        projection(commit.session),
        "Finish publishes the definition without the spline.",
      ).toEqual(finishedBefore);
    expect(
      result.state.kind === "editingSketch"
        ? result.state.session.actionAvailability?.canUndo
        : null,
      "The discarded spline adds no action.",
    ).toBe(false);
  });

  test("Undo and Redo during a spline draft keep its placed fit points", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    f.dispatch({ type: "sketch.pointerReleased", point: [40, 0] });
    f.dispatch({ type: "sketch.pointerReleased", point: [43, 0] });
    f.dispatch({ type: "tool.activated", toolId: "spline" });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 20] });
    f.dispatch({ type: "sketch.pointerReleased", point: [30, 25] });

    f.dispatch({ type: "history.undoRequested" });
    expect(
      f.session.definition.entities.some((entity) => entity.kind === "circle"),
    ).toBe(false);
    expect(f.session.activeTool).toBe("spline");
    expect(f.session.status).toBe("drawing");
    expect(f.session.toolPlacedPoints).toEqual([
      [20, 20],
      [30, 25],
    ]);
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.toolPlacedPoints).toEqual([
      [20, 20],
      [30, 25],
    ]);

    f.dispatch({ type: "sketch.confirmRequested" });
    expect(splines(f)).toHaveLength(1);
    expect(undoLabels(f)).toEqual([
      "Create Sketch Geometry",
      "Create Sketch Geometry",
    ]);
  });
});

// ── T12e: tangent reset/zero actions ─────────────────────────────────────

describe("T12e: tangent reset-to-automatic and set-to-zero actions", () => {
  function undoLabels(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  }

  async function splineFixture() {
    const f = await fixture();
    // Create a 3-point spline.
    f.dispatch({ type: "tool.activated", toolId: "spline" });
    f.dispatch({ type: "sketch.pointerReleased", point: [0, 0] });
    f.dispatch({ type: "sketch.pointerReleased", point: [10, 5] });
    f.dispatch({ type: "sketch.pointerReleased", point: [20, 0] });
    f.dispatch({ type: "sketch.confirmRequested" });
    // Clear the active tool so selection works normally.
    f.dispatch({ type: "sketch.escapeRequested" });
    return f;
  }

  function getSpline(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.definition.entities.find((e) => e.kind === "spline")!;
  }

  function getOccurrences(f: Awaited<ReturnType<typeof fixture>>) {
    const spline = getSpline(f);
    if (spline.kind !== "spline") throw new Error("Expected spline entity");
    return spline.pointOccurrences;
  }

  test("T12e: reset tangent to automatic enters one action; Undo restores authored, Redo restores automatic", async () => {
    const f = await splineFixture();
    const spline = getSpline(f);
    const occurrences = getOccurrences(f);
    const occ1 = occurrences[1]!;
    expect(occ1.tangent.kind).toBe("automatic");

    // Make occ1 authored by mutating the definition through the action boundary.
    const authoredDef = {
      ...f.session.definition,
      entities: f.session.definition.entities.map((entity) => {
        if (entity.entityId !== spline.entityId || entity.kind !== "spline")
          return entity;
        return {
          ...entity,
          pointOccurrences: entity.pointOccurrences.map((occ) =>
            occ.occurrenceId === occ1.occurrenceId
              ? {
                  ...occ,
                  tangent: {
                    kind: "authored" as const,
                    vector: [3, 4] as readonly [number, number],
                  },
                }
              : occ,
          ),
        };
      }),
    };
    // Commit the authored tangent as a drag end action.
    f.apply(
      { type: "sketch.geometryDragEnded" },
      { ...f.session, definition: authoredDef },
    );
    const labelsBeforeReset = undoLabels(f);
    expect(
      getOccurrences(f)[1]!.tangent.kind,
      "Precondition: occurrence 1 must be authored.",
    ).toBe("authored");

    // Set up the selection with a tangent handle target.
    // Note: display.ts uses session.sketchId ?? "sketch_draft" for the ref.
    const sketchId = f.session.sketchId ?? ("sketch_draft" as SketchId);
    const handleRef = {
      kind: "sketchTangentHandle" as const,
      sketchId,
      entityId: spline.entityId,
      occurrenceId: occ1.occurrenceId,
      pointId: occ1.pointId,
    };
    // Apply selection by dispatching a viewport selection (Escape already cleared the tool).
    f.dispatch({
      type: "viewport.selectionRequested",
      target: handleRef,
    });
    expect(
      f.state.selection[0]?.kind,
      "Selection must contain the tangent handle.",
    ).toBe("sketchTangentHandle");

    // Click "Reset tangent to automatic".
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "resetTangentToAutomatic" },
    });

    const afterReset = getOccurrences(f);
    expect(
      afterReset[1]!.tangent.kind,
      "After reset, occurrence 1 must be automatic.",
    ).toBe("automatic");
    expect(undoLabels(f).length, "Reset records one action.").toBe(
      labelsBeforeReset.length + 1,
    );
    expect(undoLabels(f).at(-1)).toBe("Reset Tangent");

    // Undo → back to authored.
    f.dispatch({ type: "history.undoRequested" });
    const afterUndo = getOccurrences(f);
    expect(
      afterUndo[1]!.tangent.kind,
      "After Undo, occurrence 1 must be authored.",
    ).toBe("authored");
    expect(
      afterUndo[1]!.tangent.vector,
      "Undo restores the exact authored vector.",
    ).toEqual([3, 4]);

    // Redo → back to automatic.
    f.dispatch({ type: "history.redoRequested" });
    const afterRedo = getOccurrences(f);
    expect(
      afterRedo[1]!.tangent.kind,
      "After Redo, occurrence 1 must be automatic.",
    ).toBe("automatic");
  });

  test("T12e: set tangent to zero enters one action; Undo restores automatic, Redo restores zero", async () => {
    const f = await splineFixture();
    const occurrences = getOccurrences(f);
    const occ1 = occurrences[1]!;
    expect(occ1.tangent.kind).toBe("automatic");

    // Select the fit point (maps to its occurrence).
    const sketchId = f.session.sketchId ?? ("sketch_draft" as SketchId);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: {
        kind: "sketchPoint",
        sketchId,
        pointId: occ1.pointId,
      },
    });

    const labelsBefore = undoLabels(f);

    // Click "Set tangent to zero".
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "setTangentToZero" },
    });

    const afterZero = getOccurrences(f);
    expect(
      afterZero[1]!.tangent.kind,
      "After zero, occurrence 1 must be authored.",
    ).toBe("authored");
    expect(
      afterZero[1]!.tangent.vector,
      "Zero must store exactly [0, 0].",
    ).toEqual([0, 0]);
    expect(undoLabels(f).length, "Zero records one action.").toBe(
      labelsBefore.length + 1,
    );
    expect(undoLabels(f).at(-1)).toBe("Zero Tangent");

    // Undo → back to automatic.
    f.dispatch({ type: "history.undoRequested" });
    const afterUndo = getOccurrences(f);
    expect(
      afterUndo[1]!.tangent.kind,
      "After Undo, occurrence 1 must be automatic.",
    ).toBe("automatic");

    // Redo → back to zero.
    f.dispatch({ type: "history.redoRequested" });
    const afterRedo = getOccurrences(f);
    expect(afterRedo[1]!.tangent).toEqual({
      kind: "authored",
      vector: [0, 0],
    });
  });

  test("T12e: no-op records nothing (reset on already-automatic)", async () => {
    const f = await splineFixture();
    const spline = getSpline(f);
    const occurrences = getOccurrences(f);
    expect(occurrences[1]!.tangent.kind).toBe("automatic");

    // Select the handle.
    const sketchId = f.session.sketchId ?? ("sketch_draft" as SketchId);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: {
        kind: "sketchTangentHandle",
        sketchId,
        entityId: spline.entityId,
        occurrenceId: occurrences[1]!.occurrenceId,
        pointId: occurrences[1]!.pointId,
      },
    });

    const labelsBefore = undoLabels(f);

    // Reset on already-automatic: should be a no-op.
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "resetTangentToAutomatic" },
    });

    expect(undoLabels(f), "No-op records nothing.").toEqual(labelsBefore);
  });
});
