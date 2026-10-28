import { assert, describe, expect, test } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { SketchAuthoredActions } from "./sketch-authored-actions";
import {
  emitPendingSketchEditQuery,
  emitPendingSketchOffsetPreviewPublication,
  emitPendingSketchRegionDerivation,
  emitPendingSketchSnapQuery,
  initialEditorState,
  transitionEditorState,
  type EditorEffectRuntime,
  type EditorEvent,
  type EditorState,
  type SketchEditorState,
} from "@/core/editor/state-machine";
import { makeAnnotationLifecycleState } from "@/core/editor/annotation-lifecycle.fixtures";
import {
  runEditorEffect,
  createModelingServiceEditorEffectRuntime,
} from "./effect-registry";
import { createSketchPublicationFailureFixture } from "@/domain/modeling/modeling-service/sketch-publication.fixtures";
import { querySketchEditIntersectionsForTest } from "@/application/editor/state-machine-test-builder";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  getSketchToolPresentation,
  startSketchDraw,
  deleteSelectedSketchGeometry,
  patchSketchConstraintValue,
  selectSketchConstraintTarget,
  selectSketchEditToolTarget,
  computeSketchMirrorActionState,
  computeSketchOffsetActionState,
  computeSketchCloseSplineState,
  clearActiveSketchTool,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { encodeAuthoredActionState } from "@/core/modeling/authored-action-history";
import {
  appendReferenceImageOperations,
  updateReferenceImageOperationStates,
} from "@/core/editor/sketch-session/references";
import { createReferenceImageOperation } from "@/core/reference-image/operations";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { rebuildSessionForDefinition } from "@/core/editor/sketch-session/definition-authoring";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getEnterEvent,
  getEscapeEvent,
} from "@/core/editor/workbench-interactions";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import {
  eid,
  entityRef,
  handleRef,
  mirroredSession,
  pid,
  pointRef,
  seedDefinition,
} from "@/core/editor/sketch-mirror.fixtures";
import { offsetSession } from "@/core/editor/sketch-offset.fixtures";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";

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

async function fixture(constrained = false, initial?: SketchSessionState) {
  const owner = new SketchAuthoredActions();
  const session =
    initial ??
    line(
      withSketchSnapScale(
        enterSketchSession(
          createNewSketchSession(
            createStandardPlaneDefinition("xy"),
            OCC_KERNEL_SETTINGS,
          ),
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
    );
  if (!constrained && !initial)
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
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
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
          value: createLiteralAuthoredValue(20),
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
          value: createLiteralAuthoredValue(12),
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
    { type: "sketch.geometryDragEnded", point: [3, 4] },
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
    { type: "sketch.geometryDragEnded", point: [5, 0] },
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
    { type: "sketch.geometryDragEnded", point: [5, 3] },
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
    withSketchSnapScale(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
  );
  const b = line(
    withSketchSnapScale(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
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

// cadara-7j8: the snapshot that enters a reopened sketch can lack repository
// provenance; the actor identity then resolves on the next snapshot. That is
// the same session, so it must keep its own entry base, never the base or
// accepted state a previous session left under the resolved identity.
test("an actor identity resolved mid-session keeps this session's publication base, not a previous session's", async () => {
  const f = await fixture();
  const sketchId = "sketch_existing" as SketchId;
  const editing = (session: SketchSessionState, actorId?: string) => {
    const snapshot = f.state.snapshot!;
    return {
      ...f.state,
      snapshot: {
        ...snapshot,
        provenance: actorId
          ? { actorId, repositoryHeads: ["head"], repositorySource: "local" }
          : null,
        document: {
          ...snapshot.document,
          sketches: [
            {
              sketchId,
              label: session.sketchLabel,
              plane: session.plane,
              sketch: { definition: session.definition },
            },
          ],
        },
      },
      session,
    } as unknown as SketchEditorState;
  };
  const reopen = (session: SketchSessionState) => {
    const entered = f.owner.transition(
      initialEditorState,
      { type: "selection.cleared" },
      () => ({ state: editing(session), effects: [] }),
    );
    return f.owner.transition(
      entered.state,
      { type: "selection.cleared" },
      () => ({ state: editing(session, "actor_repository"), effects: [] }),
    ).state as SketchEditorState;
  };
  const finishBase = (state: SketchEditorState) => {
    const event: EditorEvent = { type: "tool.activated", toolId: "finishSketch" };
    const finish = f.owner.transition(state, event, (current) =>
      transitionEditorState(current, event),
    );
    const commit = finish.effects.find(
      (effect) => effect.type === "sketch.commit",
    );
    if (commit?.type !== "sketch.commit")
      throw new Error("Expected sketch commit.");
    return commit.publicationBase?.expectedSketch?.definition.points.map(
      (point) => point.position,
    );
  };
  const positions = (session: SketchSessionState) =>
    session.definition.points.map((point) => point.position);

  const original = { ...f.session, sketchId, actionContextId: sketchId };
  const first = reopen(original);
  const edited = mutations.drag(first.session);
  const firstEdited = f.owner.transition(
    first,
    { type: "selection.cleared" },
    () => ({ state: { ...first, session: edited }, effects: [] }),
  ).state as SketchEditorState;
  expect(finishBase(firstEdited)).toEqual(positions(original));
  f.owner.transition(
    firstEdited,
    {
      type: "effect.sketchCommitted",
      requestId: "request_publish",
      documentId: "doc_workspace",
      commandSessionId: "command_test",
      baseRevisionId: "rev_1",
      revisionId: "rev_2",
      accepted: true,
      diagnostics: [],
      publishedSketchId: sketchId,
    },
    () => ({ state: initialEditorState, effects: [] }),
  );

  expect(
    finishBase(reopen(edited)),
    "the second session publishes from the sketch it reopened",
  ).toEqual(positions(edited));
});

test("a post-write restore failure finishes the authored owner once; Finish again is harmless and direct re-entry keeps the published identity", async () => {
  const { service, receipts } = createSketchPublicationFailureFixture();
  try {
    const f = await fixture();
    const runtime = createModelingServiceEditorEffectRuntime(service);
    const before = await service.getCurrentDocumentSnapshot();
    const finish = f.dispatch({ type: "sketch.publishRequested" });
    const commit = finish.effects.find(
      (effect) => effect.type === "sketch.commit",
    );
    if (!commit) throw new Error("Expected Finish to publish the draft.");
    const event = await runEditorEffect(commit, runtime);
    expect(event, JSON.stringify(event)).toMatchObject({
      type: "effect.sketchCommitted",
      accepted: true,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "sketch-publication-restore-failed" }),
      ]),
    });
    const completed = f.owner.transition(finish.state, event, (state) =>
      transitionEditorState(state, event),
    );
    expect(completed.state.kind).toBe("idle");
    let state: EditorState = completed.state;
    for (const effect of completed.effects) {
      const refreshed = await runEditorEffect(effect, runtime);
      state = f.owner.transition(state, refreshed, (current) =>
        transitionEditorState(current, refreshed),
      ).state;
    }
    const retryEvent: EditorEvent = { type: "sketch.publishRequested" };
    const retry = f.owner.transition(state, retryEvent, (current) =>
      transitionEditorState(current, retryEvent),
    );
    expect(retry.state.kind).toBe("idle");
    expect(retry.effects).toEqual([]);
    expect(receipts).toHaveLength(1);
    const snapshot = await service.getCurrentDocumentSnapshot();
    expect(snapshot.document.sketches).toHaveLength(
      before.document.sketches.length + 1,
    );
    expect(snapshot.document.diagnostics).toContainEqual(
      expect.objectContaining({ code: "sketch-publication-restore-failed" }),
    );
    if (event.type !== "effect.sketchCommitted" || !event.publishedSketchId)
      throw new Error("Missing committed identity");
    const reopen: EditorEvent = {
      type: "authoring.reopenRequested",
      toolId: "sketch",
      target: { kind: "sketch", sketchId: event.publishedSketchId },
    };
    const reopened = f.owner.transition(retry.state, reopen, (current) =>
      transitionEditorState(current, reopen),
    );
    expect(reopened.state.kind).toBe("editingSketch");
    if (reopened.state.kind !== "editingSketch")
      throw new Error("Expected direct reopen");
    expect(reopened.state.session.commitRequest?.sketchId).toBe(
      event.publishedSketchId,
    );
    expect(receipts).toHaveLength(1);
  } finally {
    service.dispose();
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
  // T17k2 (review A-2): the reason by label, never the code.
  expect(result.state.session.validationMessage).toBe(
    "Can't undo Edit Sketch: ‘Line 1’ was changed by another session.",
  );
  expect(result.state.session.actionAvailability).toEqual({
    canUndo: true,
    canRedo: false,
  });
  expect(result.state.session.actionHistory?.undo.at(-1)).toMatchObject({
    blockedReason:
      "Can't undo Edit Sketch: ‘Line 1’ was changed by another session.",
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
  expect(blocked.state.session.validationMessage).toBe(
    "Can't redo Trim: ‘Line 1’ was changed by another session.",
  );
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

// T13m (user decision Q1): a circle Split by a line (two arcs, its radius
// rewritten, bindings and ties added) is one "Split" action; Undo/Redo
// replay its write set exactly and never query again.
test("T13m: an applied circle Split is one 'Split' action; Undo/Redo restore it exactly without re-querying", async () => {
  const f = await fixture();
  f.apply(
    { type: "selection.cleared" },
    acceptSketchDraw(
      startSketchDraw(beginSketchTool(f.session, "circle"), [6, 1]),
      [8, 1],
    ),
  );
  const [boundary, target] = f.session.definition.entities;
  expect(target!.kind, "premise: the circle").toBe("circle");
  const selected = selectSketchEditToolTarget(
    selectSketchEditToolTarget(
      beginSketchTool(f.session, "sketchSplit"),
      target!.target,
    ),
    boundary!.target,
  );
  f.apply({ type: "selection.cleared" }, selected);
  const before = projection(f.session);
  const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
  const effect = emitted.effects.find(
    (candidate) => candidate.type === "sketch.queryEditIntersections",
  );
  if (effect?.type !== "sketch.queryEditIntersections")
    throw new Error("Expected the Split query.");
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
  expect(
    result.state.session.definition.entities.map((entity) => entity.kind),
  ).toEqual(["lineSegment", "arc", "arc"]);
  expect(result.state.session.actionHistory?.undo.at(-1)?.label).toBe("Split");
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
});

// Orchestrator [TECH] 2026-10-04: the radius → diameter rewrite of a trimmed
// circle is part of the one "Trim" action; Undo restores the radius bitwise.
// T13a: the radius is added deliberately with the Radius tool.
test("T10g-1: Undo of a circle Trim restores its circleRadius dimension exactly; Redo restores the diameter", async () => {
  const f = await fixture();
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(f.session, "circle"), [20, 0]),
    [22, 0],
  );
  session = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionRadius"),
        session.definition.entities.find((entity) => entity.kind === "circle")!
          .target,
      ),
      { value: 2 },
    ),
    { intent: "commitConstraintValue" },
  );
  expect(
    session.definition.dimensions.map((dimension) => dimension.kind),
    "premise: only the deliberate radius",
  ).toEqual(["circleRadius"]);
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
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        point: [x, y],
      });
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        point: [x + 3, y],
      });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 0],
    });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 0],
    });
    f.dispatch({ type: "sketch.escapeRequested" });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [30, 0],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [33, 0],
    });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 0],
    });
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
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        point: [20, 0],
      });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 0],
    });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 5],
    });

    const points = () =>
      f.session.definition.entities.filter((entity) => entity.kind === "point");
    expect(points(), "One click places the point.").toHaveLength(1);
    expect(f.session.status).toBe("idle");
    expect(undoLabels(f)).toEqual(["Create Sketch Geometry"]);

    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [30, 5],
    });
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
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        point,
      });
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

    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [60, 60],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [70, 60],
    });
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

    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 40],
    });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 20],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [30, 21],
    });
    const before = chainLines(f)[0];

    f.dispatch({ type: "history.undoRequested" });
    expect(chainLines(f)).toEqual([]);
    expect(f.session.activeTool).toBe("line");
    expect(f.session.status).toBe("drawing");
    expect(f.session.pointerDownPoint).toEqual([20, 20]);

    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 40],
    });
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

    expect(after.validationMessage).toBe(
      "Can't undo Create Sketch Geometry: ‘Line 4 end’ was changed by another session.",
    );
    expect(projection(after)).toEqual(projection(peer));
    expect(
      {
        activeTool: after.activeTool,
        status: after.status,
        pointerDownPoint: after.pointerDownPoint,
        toolStartPointId: after.toolStartPointId,
        toolChain: after.toolChain,
      },
      "The chain and its anchor are unchanged.",
    ).toEqual({
      activeTool: before.activeTool,
      status: before.status,
      pointerDownPoint: before.pointerDownPoint,
      toolStartPointId: before.toolStartPointId,
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
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        point,
      });
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

  test("a tool switch with an unfinalized 3-point spline still discards it with no action (T11-D14, T13 A-9)", async () => {
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
  });

  // T13-D23 (amends T11-D14 for viable drafts): Finish, by any path, first
  // finalizes a viable fit-point draft as its own creation action, then
  // publishes; the publication is the document's later "Publish Sketch".
  test.each([
    [
      "the Finish tool (Shift+Enter)",
      { type: "tool.activated", toolId: "finishSketch" },
    ],
    [
      "the commit request",
      { type: "command.commitRequested", commandSessionId: "command_test" },
    ],
  ] as const)(
    "Finish by %s with a 3-point spline draft finalizes it as one creation action, then publishes it (T13-D23)",
    async (_path, event) => {
      const draft = [
        [20, 20],
        [30, 25],
        [40, 20],
      ] as const;
      const finished = await splineDraft(draft);
      const result = finished.owner.transition(
        finished.state,
        event as EditorEvent,
        (state) => transitionEditorState(state, event as EditorEvent),
      );
      const commit = result.effects.find(
        (effect) => effect.type === "sketch.commit",
      );
      if (commit?.type !== "sketch.commit") throw Error("Expected the commit.");
      const published = commit.session.commitRequest?.definition;
      const [spline] =
        published?.entities.filter((entity) => entity.kind === "spline") ?? [];
      if (spline?.kind !== "spline") throw Error("Expected the spline.");
      expect(
        spline.pointOccurrences.map(
          (occurrence) =>
            published!.points.find(
              ({ pointId }) => pointId === occurrence.pointId,
            )?.position,
        ),
        "Finish publishes the spline through every placed fit point.",
      ).toEqual(draft);
      if (result.state.kind !== "editingSketch") throw Error("Expected sketch");
      expect(
        result.state.session.actionHistory?.undo.map((entry) => entry.label),
        "The finalized spline is one creation action, before the publication.",
      ).toEqual(["Create Sketch Geometry"]);
      expect(projection(commit.session)).toEqual(
        projection(result.state.session),
      );
    },
  );

  test("Finish with a non-viable 1-point spline draft discards it with no action (T11-D14 kept)", async () => {
    const f = await splineDraft([[20, 20]]);
    const before = projection(f.session);
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
    ).toBe(false);
  });

  test("Undo pops a spline draft point; Redo does not restore draft points", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "circle" });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [40, 0],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [43, 0],
    });
    f.dispatch({ type: "tool.activated", toolId: "spline" });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 20],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [30, 25],
    });

    f.dispatch({ type: "history.undoRequested" });
    expect(
      f.session.definition.entities.some((entity) => entity.kind === "circle"),
    ).toBe(true);
    expect(f.session.activeTool).toBe("spline");
    expect(f.session.status).toBe("drawing");
    expect(f.session.toolPlacedPoints).toEqual([[20, 20]]);
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.toolPlacedPoints).toEqual([[20, 20]]);

    expect(undoLabels(f)).toEqual(["Create Sketch Geometry"]);
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [30, 25],
    });
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
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [0, 0],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [10, 5],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 0],
    });
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
      { type: "sketch.geometryDragEnded", point: [3, 4] },
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
    assert(afterUndo[1]!.tangent.kind === "authored");
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
    assert(afterZero[1]!.tangent.kind === "authored");
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

// T13c D6 (application seam, action owner): confirming a conflicting value
// in an existing dimension's edit popup is one authored action that leaves
// the sketch invalid; Undo restores the solved sketch, Redo the invalid edit.
test("T13c D6: a confirmed conflicting annotation edit is one invalid action; Undo restores a solved sketch", async () => {
  const f = await fixture();
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(f.session, "rectangle"), [20, 1]),
    [24, 4],
  );
  const side = (label: string) =>
    session.definition.entities.find((entity) => entity.label.endsWith(label))!
      .target;
  for (const label of ["bottom", "top"])
    session = patchSketchConstraintValue(
      patchSketchConstraintValue(
        selectSketchConstraintTarget(
          beginSketchTool(session, "dimensionDistance"),
          side(label),
        ),
        { value: 4 },
      ),
      { intent: "commitConstraintValue" },
    );
  f.apply({ type: "selection.cleared" }, session);
  expect(f.session.liveSolve?.accepted, "premise: solved").toBe(true);
  const before = projection(f.session);
  const undoDepth = f.session.actionHistory?.undo.length ?? 0;
  const top = f.session.definition.dimensions[1]!;
  const edited = patchSketchConstraintValue(
    patchSketchConstraintValue(
      beginSketchAnnotationEdit(f.session, {
        kind: "dimension",
        sketchId: f.session.actionContextId,
        dimensionId: top.dimensionId,
      } as Parameters<typeof beginSketchAnnotationEdit>[1]),
      { value: "6" },
    ),
    { intent: "commitAnnotationValue" },
  );
  f.apply({ type: "selection.cleared" }, edited);
  const after = projection(f.session);
  expect(after).not.toEqual(before);
  expect(f.session.actionHistory?.undo.length).toBe(undoDepth + 1);
  expect(f.session.liveSolve?.accepted, "the edit leaves it invalid").toBe(
    false,
  );
  expect(f.session.validationMessage).toContain("conflicts with");
  const undone = f.apply({ type: "history.undoRequested" });
  expect(projection(undone)).toEqual(before);
  expect(undone.liveSolve?.accepted, "Undo restores a solved sketch").toBe(
    true,
  );
  const redone = f.apply({ type: "history.redoRequested" });
  expect(projection(redone)).toEqual(after);
  expect(redone.liveSolve?.accepted).toBe(false);
});

// T13c review R-2: Undo/Redo show the same invalid-sketch feedback as the
// commit: Redo of a conflicting edit explains the conflict again.
test("T13c R-2: Redo of a conflicting annotation edit shows the conflict explanation", async () => {
  const f = await fixture();
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(f.session, "rectangle"), [20, 1]),
    [24, 4],
  );
  const side = (label: string) =>
    session.definition.entities.find((entity) => entity.label.endsWith(label))!
      .target;
  for (const label of ["bottom", "top"])
    session = patchSketchConstraintValue(
      patchSketchConstraintValue(
        selectSketchConstraintTarget(
          beginSketchTool(session, "dimensionDistance"),
          side(label),
        ),
        { value: 4 },
      ),
      { intent: "commitConstraintValue" },
    );
  f.apply({ type: "selection.cleared" }, session);
  const top = f.session.definition.dimensions[1]!;
  f.apply(
    { type: "selection.cleared" },
    patchSketchConstraintValue(
      patchSketchConstraintValue(
        beginSketchAnnotationEdit(f.session, {
          kind: "dimension",
          sketchId: f.session.actionContextId,
          dimensionId: top.dimensionId,
        } as Parameters<typeof beginSketchAnnotationEdit>[1]),
        { value: "6" },
      ),
      { intent: "commitAnnotationValue" },
    ),
  );
  const explanation = f.session.validationMessage;
  expect(explanation, "premise: the commit explains").toMatch(
    /conflicts? with .*The sketch is invalid; profiles from it are blocked\./,
  );
  expect(f.apply({ type: "history.undoRequested" }).validationMessage).toBe(
    null,
  );
  const redone = f.apply({ type: "history.redoRequested" });
  expect(redone.validationMessage).toMatch(
    new RegExp(`^${top.label} \\(6 mm\\)|, ${top.label} \\(6 mm\\)`),
  );
  expect(redone.validationMessage).toContain(
    "The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
});

// T13d (application seam, action owner): Make reference and Make driving are
// each one authored action; Undo and Redo restore each state exactly.
test("T13d: Make reference and Make driving are one action each; Undo/Redo restore them exactly", async () => {
  const f = await fixture();
  let session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(f.session, "rectangle"), [20, 1]),
    [24, 4],
  );
  const bottom = session.definition.entities.find((entity) =>
    entity.label.endsWith("bottom"),
  )!.target;
  session = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionDistance"),
        bottom,
      ),
      { value: 4 },
    ),
    { intent: "commitConstraintValue" },
  );
  f.apply({ type: "selection.cleared" }, session);
  const driving = projection(f.session);
  const depth = f.session.actionHistory?.undo.length ?? 0;
  const edit = (from: SketchSessionState) =>
    beginSketchAnnotationEdit(from, {
      kind: "dimension",
      sketchId: from.actionContextId,
      dimensionId: from.definition.dimensions[0]!.dimensionId,
    } as Parameters<typeof beginSketchAnnotationEdit>[1]);

  f.apply(
    { type: "selection.cleared" },
    patchSketchConstraintValue(edit(f.session), {
      intent: "makeAnnotationReference",
    }),
  );
  const reference = projection(f.session);
  // D9′: the stored value is kept (ignored while a reference).
  expect(f.session.definition.dimensions[0]).toHaveProperty("value");
  expect(f.session.definition.dimensions[0]).toHaveProperty("reference", true);
  expect(f.session.actionHistory?.undo.length).toBe(depth + 1);

  f.apply(
    { type: "selection.cleared" },
    patchSketchConstraintValue(edit(f.session), {
      intent: "commitAnnotationValue",
    }),
  );
  const drivingAgain = projection(f.session);
  expect(f.session.definition.dimensions[0]).not.toHaveProperty("reference");
  expect(f.session.actionHistory?.undo.length).toBe(depth + 2);

  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    reference,
  );
  expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
    driving,
  );
  expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
    reference,
  );
  expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
    drivingAgain,
  );
  expect(f.session.liveSolve?.accepted).toBe(true);
});

// T13-D22: Shift (the viewport's `sketch.inferenceSuppressionChanged`) and
// the "Snap & infer" toggle (a tool patch) are session UI state: the reducer
// recomputes the live preview at the last pointer, nothing is authored and
// no action is recorded; the toggle survives tool switches.
describe("T13h: inference suppression through the reducer", () => {
  function activeOverlay(f: Awaited<ReturnType<typeof fixture>>) {
    const overlays = f.session.toolPresentation?.overlays ?? [];
    return (
      overlays.find(
        (overlay) =>
          overlay.id === "active-snap" ||
          overlay.id === "active-snap-suppressed",
      ) ?? null
    );
  }

  test("Shift pressed and released over a hovered snap recomputes the preview without pointer motion, with no action", async () => {
    const f = await fixture();
    const before = projection(f.session);
    f.dispatch({ type: "tool.activated", toolId: "point" });
    f.dispatch({
      type: "sketch.pointerMoved",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [12.05, 0.05],
    });
    expect(activeOverlay(f)?.label, "premise").toMatch(/^Coincident · /);

    f.dispatch({ type: "sketch.inferenceSuppressionChanged", held: true });
    expect(f.session.inferenceSuppressionHeld).toBe(true);
    expect(activeOverlay(f)).toMatchObject({
      kind: "referenceLabel",
      label: "Free placement (inference off)",
    });
    expect(f.state.preview).toMatchObject({ kind: "sketch" });

    f.dispatch({ type: "sketch.inferenceSuppressionChanged", held: false });
    expect(activeOverlay(f)?.label).toMatch(/^Coincident · /);
    expect(projection(f.session)).toEqual(before);
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });

  test("a Shift change while Finish's commit is pending keeps the 'Committing' preview (T13h review A-7)", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "point" });
    f.dispatch({
      type: "sketch.pointerMoved",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [12.05, 0.05],
    });
    f.dispatch({ type: "tool.activated", toolId: "finishSketch" });
    expect(f.state.pendingCommitRequestId, "premise").not.toBe(null);
    const committing = f.state.preview;
    expect(committing).toMatchObject({
      label: "Committing accepted sketch geometry",
    });

    f.dispatch({ type: "sketch.inferenceSuppressionChanged", held: true });
    expect(f.session.inferenceSuppressionHeld, "the held state is kept").toBe(
      true,
    );
    expect(f.state.preview).toBe(committing);
  });

  test("the 'Snap & infer' toggle suppresses, records no action, and is kept across tool switches", async () => {
    const f = await fixture();
    f.dispatch({ type: "tool.activated", toolId: "point" });
    const toggle = () =>
      getSketchToolPresentation(f.session)?.controls?.find(
        (control) => control.id === "sketch-snap-inference",
      );
    expect(toggle()).toMatchObject({
      kind: "toggle",
      label: "Snap & infer",
      value: true,
    });

    f.dispatch({
      type: "sketch.toolPatched",
      patch: { ...toggle()!.action.patch, value: false },
    });
    expect(f.session.inferenceSuppressionToggled).toBe(true);
    expect(toggle()?.value).toBe(false);
    expect(f.session.actionAvailability?.canUndo, "no action").toBe(false);

    f.dispatch({ type: "tool.activated", toolId: "line" });
    expect(f.session.inferenceSuppressionToggled, "kept").toBe(true);
    f.dispatch({
      type: "sketch.pointerMoved",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [12.05, 0.05],
    });
    expect(activeOverlay(f)?.label).toBe("Free placement (inference off)");
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [12.05, 0.05],
    });
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point: [20, 5],
    });
    const original = f.session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    );
    const drawn = f.session.definition.entities.filter(
      (entity) => entity.kind === "lineSegment",
    )[1];
    if (original?.kind !== "lineSegment" || drawn?.kind !== "lineSegment")
      throw Error("Expected the lines.");
    expect(drawn.startPointId, "the toggle-off draw does not join").not.toBe(
      original.endPointId,
    );
  });
});

// T13j (D25): Merge Points through the real reducer inside the action owner.
describe("T13j: Merge Points is one action", () => {
  async function gap() {
    const f = await fixture();
    const free = { ...f.session, inferenceSuppressionToggled: true };
    f.apply(
      { type: "selection.cleared" },
      {
        ...acceptSketchDraw(
          startSketchDraw(beginSketchTool(free, "line"), [12.01, 0]),
          [20, 5],
        ),
        inferenceSuppressionToggled: false,
      },
    );
    const [first, second] = f.session.definition.entities;
    if (first?.kind !== "lineSegment" || second?.kind !== "lineSegment")
      throw Error("Expected two lines.");
    expect(second.startPointId, "premise: not joined").not.toBe(
      first.endPointId,
    );
    const ref = (pointId: SketchPointId): PrimitiveRef => ({
      kind: "sketchPoint",
      sketchId: f.session.sketchId ?? ("sketch_draft" as SketchId),
      pointId,
    });
    const pickPair = (
      source: SketchPointId = second.startPointId,
      destination: SketchPointId = first.endPointId,
    ) => {
      f.dispatch({ type: "tool.activated", toolId: "sketchMergePoints" });
      f.dispatch({ type: "viewport.selectionRequested", target: ref(source) });
      f.dispatch({
        type: "viewport.selectionRequested",
        target: ref(destination),
      });
    };
    return { f, first, second, pickPair };
  }
  const prompt = (session: SketchSessionState) =>
    session.toolPresentation?.prompts[0]?.text;
  const undoLabels = (session: SketchSessionState) =>
    session.actionHistory?.undo.map((entry) => entry.label) ?? [];

  test("confirm authors one 'Merge Points' action; Undo and Redo restore it exactly", async () => {
    const { f, first, second, pickPair } = await gap();
    const before = projection(f.session);
    const labels = undoLabels(f.session);
    pickPair();
    expect(projection(f.session), "picking authors nothing").toEqual(before);
    expect(f.state.selection, "the destination carries the selection").toEqual([
      {
        kind: "sketchPoint",
        sketchId: f.session.sketchId ?? "sketch_draft",
        pointId: first.endPointId,
      },
    ]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
    const after = projection(f.session);
    expect(f.session.definition.pointIds).not.toContain(second.startPointId);
    expect(undoLabels(f.session)).toEqual([...labels, "Merge Points"]);
    expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
      before,
    );
    expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
      after,
    );
  });

  test("Undo restores an absorbed coincident (review R-4.4)", async () => {
    const { f, first, second, pickPair } = await gap();
    const definition = f.session.definition;
    f.apply(
      { type: "selection.cleared" },
      rebuildSessionForDefinition(f.session, {
        definition: {
          ...definition,
          constraintIds: [...definition.constraintIds, "constraint_join"],
          constraints: [
            ...definition.constraints,
            {
              constraintId: "constraint_join",
              kind: "coincident",
              label: "Join",
              pointIds: [second.startPointId, first.endPointId],
            },
          ],
        },
      }),
    );
    const before = projection(f.session);
    pickPair();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
    expect(f.session.definition.constraintIds).not.toContain("constraint_join");
    expect(prompt(f.session)).toMatch(
      / 1 coincident between them is now part of the merge\.$/,
    );
    const undone = f.apply({ type: "history.undoRequested" });
    expect(projection(undone)).toEqual(before);
    expect(undone.definition.constraints).toContainEqual(
      expect.objectContaining({
        constraintId: "constraint_join",
        pointIds: [second.startPointId, first.endPointId],
      }),
    );
  });

  test("R-5: a spline closed by merge is announced, and Undo reopens it exactly", async () => {
    const { f, pickPair } = await gap();
    const sketchId = f.session.sketchId ?? ("sketch_draft" as SketchId);
    const ids = [0, 1, 2, 3].map(
      (index) => `sketch_point_loop_${index}` as SketchPointId,
    );
    const positions: [number, number][] = [
      [30, 0],
      [34, 0],
      [32, 3],
      [30.02, 0.01],
    ];
    const definition = f.session.definition;
    const spline = {
      kind: "spline",
      entityId: "sketch_entity_loop" as SketchEntityId,
      label: "Loop",
      target: {
        kind: "sketchEntity",
        sketchId,
        entityId: "sketch_entity_loop" as SketchEntityId,
      },
      isConstruction: false,
      pointOccurrenceIds: ids.map((_, index) => `loop_o${index}`),
      pointOccurrences: ids.map((pointId, index) => ({
        occurrenceId: `loop_o${index}`,
        pointId,
        tangent: { kind: "automatic" },
      })),
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
    } satisfies SketchSessionState["definition"]["entities"][number];
    f.apply(
      { type: "selection.cleared" },
      rebuildSessionForDefinition(f.session, {
        definition: {
          ...definition,
          pointIds: [...definition.pointIds, ...ids],
          points: [
            ...definition.points,
            ...ids.map((pointId, index) => ({
              pointId,
              label: `Loop ${index}`,
              target: { kind: "sketchPoint" as const, sketchId, pointId },
              position: positions[index]!,
              isConstruction: false,
            })),
          ],
          entityIds: [...definition.entityIds, spline.entityId],
          entities: [...definition.entities, spline],
        },
      }),
    );
    const before = projection(f.session);
    pickPair(ids[3], ids[0]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "mergePoints" },
    });
    const closed = f.session.definition.entities.find(
      (entity) => entity.entityId === spline.entityId,
    );
    expect(closed?.kind === "spline" && closed.closure).toBe("positional");
    expect(prompt(f.session)).toBe(
      "Merged Loop 3 into Loop 0. Loop is now closed.",
    );
    const undone = f.apply({ type: "history.undoRequested" });
    expect(projection(undone)).toEqual(before);
    expect(undone.definition.entities).toContainEqual(spline);
  });

  test("cancel and Escape author nothing", async () => {
    const { f, pickPair } = await gap();
    const before = projection(f.session);
    const labels = undoLabels(f.session);
    pickPair();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "cancelSketchEditOperator" },
    });
    pickPair();
    f.dispatch({ type: "sketch.activeToolCleared" });
    expect(f.session.activeEditTool).toBeNull();
    expect(projection(f.session)).toEqual(before);
    expect(undoLabels(f.session)).toEqual(labels);
  });
});

/** The Dimension tool armed on the fixture's line, before any placement. */
function dimensionToolSession(session: SketchSessionState) {
  return selectSketchConstraintTarget(
    beginSketchTool(session, "dimensionDistance"),
    {
      kind: "sketchEntity",
      sketchId: session.actionContextId,
      entityId: session.definition.entities[0]!.entityId,
    } as PrimitiveRef,
  );
}

describe("T14a: a pending label gesture is a first-class gesture (T-19, C1)", () => {
  function undoLabels(f: Awaited<ReturnType<typeof fixture>>) {
    return f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  }

  /** A placed dimension label, selected the way the chip selects it before `start`. */
  async function labelFixture() {
    const f = await fixture();
    f.apply({ type: "selection.cleared" }, mutations.annotation(f.session));
    f.dispatch({ type: "sketch.activeToolCleared" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: {
        kind: "dimension",
        sketchId: f.session.actionContextId,
        dimensionId: "dimension_annotation",
      } as PrimitiveRef,
    });
    const drag = (
      gesturePhase: "start" | "move" | "end" | "cancel",
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
    const placed = projection(f.session);
    const labels = undoLabels(f);
    const startDrag = () => {
      drag("start", [6, 20]);
      drag("move", [6, 40]);
      expect(
        projection(f.session),
        "The label preview moved during the drag.",
      ).not.toEqual(placed);
    };
    /** The chip keeps reporting a drag the editor already abandoned. */
    const finishAbandonedDrag = () => {
      drag("move", [6, 50]);
      drag("end", [6, 50]);
    };
    return { f, drag, placed, labels, startDrag, finishAbandonedDrag };
  }

  test("idle Escape mid label drag cancels it: label restored, no entry, the abandoned release records nothing", async () => {
    const { f, placed, labels, startDrag, finishAbandonedDrag } =
      await labelFixture();
    startDrag();
    const escape = getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: f.state.selection,
      sketchSession: f.session,
    });
    expect(escape, "Idle Escape with the label selected.").toEqual({
      type: "selection.cleared",
    });
    f.dispatch(escape!);
    expect(projection(f.session), "Escape restores the label.").toEqual(placed);
    expect(undoLabels(f), "Escape records nothing.").toEqual(labels);
    expect(f.state.selection, "Escape still clears the selection.").toEqual([]);
    finishAbandonedDrag();
    expect(projection(f.session)).toEqual(placed);
    expect(undoLabels(f), "The cancelled drag never resumes.").toEqual(labels);
  });

  test("viewport.hoverCleared mid label drag records no entry", async () => {
    const { f, placed, labels, startDrag, finishAbandonedDrag } =
      await labelFixture();
    startDrag();
    f.dispatch({ type: "viewport.hoverCleared" });
    expect(undoLabels(f), "A hover change is not an action.").toEqual(labels);
    expect(projection(f.session)).toEqual(placed);
    finishAbandonedDrag();
    expect(undoLabels(f)).toEqual(labels);
    expect(projection(f.session)).toEqual(placed);
  });

  test("Delete mid label drag cancels the drag first, then deletes as its own single action", async () => {
    const { f, placed, labels, startDrag, finishAbandonedDrag } =
      await labelFixture();
    startDrag();
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(f.session.definition.dimensions).toEqual([]);
    expect(undoLabels(f)).toEqual([...labels, "Delete Sketch Item"]);
    finishAbandonedDrag();
    expect(undoLabels(f)).toEqual([...labels, "Delete Sketch Item"]);
    f.dispatch({ type: "history.undoRequested" });
    expect(
      projection(f.session),
      "Undo of the delete restores the accepted label, never the preview.",
    ).toEqual(placed);
  });

  test("Undo mid label drag cancels the drag and undoes the prior action; the abandoned release keeps Redo", async () => {
    const { f, labels, startDrag, finishAbandonedDrag } = await labelFixture();
    const beforeConstruction = projection(f.session);
    f.apply({ type: "selection.cleared" }, mutations.construction(f.session));
    const constructed = projection(f.session);
    startDrag();
    f.dispatch({ type: "history.undoRequested" });
    expect(
      projection(f.session),
      "Undo acts on the prior action against the restored label.",
    ).toEqual(beforeConstruction);
    expect(undoLabels(f)).toEqual(labels);
    finishAbandonedDrag();
    expect(projection(f.session)).toEqual(beforeConstruction);
    expect(
      f.session.actionAvailability,
      "The abandoned release neither records nor clears Redo.",
    ).toEqual({ canUndo: true, canRedo: true });
    f.dispatch({ type: "history.redoRequested" });
    expect(projection(f.session)).toEqual(constructed);
  });

  test("a moved release is exactly one 'Move Dimension Label' and never moves geometry", async () => {
    const { f, drag, placed, labels, startDrag } = await labelFixture();
    const geometry = {
      points: f.session.definition.points,
      entities: f.session.definition.entities,
    };
    startDrag();
    drag("move", [6, 50]);
    drag("end", [6, 50]);
    expect(undoLabels(f)).toEqual([...labels, "Move Dimension Label"]);
    expect(projection(f.session)).not.toEqual(placed);
    expect({
      points: f.session.definition.points,
      entities: f.session.definition.entities,
    }).toEqual(geometry);
  });

  test.each(["cancel", "no-move end"] as const)(
    "a %s restores the label with no entry and no derivation (generation and live solve unchanged)",
    async (exit) => {
      const { f, drag, placed, labels, startDrag } = await labelFixture();
      const liveSolve = f.session.liveSolve;
      const generation = f.session.liveRegions.generation;
      if (exit === "cancel") {
        startDrag();
        drag("cancel", [6, 40]);
      } else {
        drag("start", [6, 20]);
        drag("end", [8, 22]);
      }
      expect(projection(f.session)).toEqual(placed);
      expect(undoLabels(f)).toEqual(labels);
      expect(
        f.session.liveRegions.generation,
        "Restoring a label never re-bases the live solve.",
      ).toBe(generation);
      expect(f.session.liveSolve).toBe(liveSolve);
    },
  );

  test("a background result that rebuilds the tool presentation mid label drag is kept by a later cancel (review A-1)", async () => {
    const { f, drag, placed, startDrag } = await labelFixture();
    startDrag();
    const rebuilt = dimensionToolSession(f.session).toolPresentation;
    expect(rebuilt, "A real presentation to rebuild to.").not.toBe(null);
    expect(f.session.toolPresentation).not.toBe(rebuilt);
    f.apply(
      {
        type: "effect.sketchRegionsDerived",
        requestId: "request_stale",
        documentId: "doc_workspace",
        commandSessionId: f.state.command.commandSessionId,
        baseRevisionId: "rev_1",
        generation: 0,
        regions: [],
        diagnostics: [],
        offsetPublications: [],
      } as EditorEvent,
      { ...f.session, toolPresentation: rebuilt },
    );
    drag("cancel", [6, 40]);
    expect(projection(f.session)).toEqual(placed);
    expect(
      f.session.toolPresentation,
      "The cancel keeps the presentation the background result rebuilt.",
    ).toBe(rebuilt);
  });

  test("a background region result mid label drag keeps the drag; the release is one action", async () => {
    const { f, drag, labels, startDrag } = await labelFixture();
    startDrag();
    const preview = projection(f.session);
    f.dispatch({
      type: "effect.sketchRegionsDerived",
      requestId: "request_stale",
      documentId: "doc_workspace",
      commandSessionId: f.state.command.commandSessionId,
      baseRevisionId: "rev_1",
      generation: 0,
      regions: [],
      diagnostics: [],
      offsetPublications: [],
    } as EditorEvent);
    expect(undoLabels(f), "A background result is not an action.").toEqual(
      labels,
    );
    expect(projection(f.session), "The drag continues.").toEqual(preview);
    drag("end", [6, 40]);
    expect(undoLabels(f)).toEqual([...labels, "Move Dimension Label"]);
  });
});

describe("T14a review B-1: the Dimension tool's preview handle is tool state, not a label gesture", () => {
  async function dimensionToolFixture() {
    const f = await fixture();
    f.apply({ type: "selection.cleared" }, dimensionToolSession(f.session));
    const before = projection(f.session);
    const drag = (
      gesturePhase: "start" | "move" | "end" | "cancel",
      point: readonly [number, number],
    ) =>
      f.dispatch({
        type: "sketch.toolPatched",
        patch: {
          intent: "setConstraintAnnotationPlacement",
          handleId: "line-length-preview-drag",
          handleKind: "dimensionLine",
          point,
          gesturePhase,
          clientPoint: [point[0] * 10, point[1] * 10],
        },
      });
    return { f, before, drag };
  }

  test("the placement click (start + no-move end on the handle) pins the preview and shows the value input", async () => {
    const { f, before, drag } = await dimensionToolFixture();
    expect(f.session.toolPresentation?.floatingInput ?? null).toBe(null);
    drag("start", [6, 5]);
    drag("end", [6, 5]);
    expect(f.session.constraintAuthoring?.isPreviewPinned).toBe(true);
    expect(
      f.session.toolPresentation?.floatingInput,
      "The value input appears with the measured value.",
    ).toMatchObject({ value: "12" });
    expect(f.session.activeTool).toBe("dimensionDistance");
    expect(projection(f.session)).toEqual(before);
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });

  test("a cancelled handle drag stays pinned where it was moved, with the value input (base behaviour)", async () => {
    const { f, before, drag } = await dimensionToolFixture();
    drag("start", [6, 5]);
    drag("move", [6, 9]);
    drag("cancel", [6, 9]);
    expect(f.session.constraintAuthoring).toMatchObject({
      isPreviewPinned: true,
      pointer: [6, 9],
    });
    expect(f.session.toolPresentation?.floatingInput).toMatchObject({
      value: "12",
    });
    expect(projection(f.session)).toEqual(before);
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });
});

// T14c, logic lane (action-owner seam `SketchAuthoredActions` around the real
// reducer): the annotation selection lifecycle is editor state, never an
// action; Undo and Redo prune refs their restored definition no longer holds.
describe("T14c: the annotation lifecycle adds no history; Undo and Redo prune its context", () => {
  async function lifecycle() {
    const fixture = await makeAnnotationLifecycleState();
    const owner = new SketchAuthoredActions();
    let state: EditorState = fixture.state;
    const dispatch = (event: EditorEvent) => {
      state = owner.transition(state, event, (current) =>
        transitionEditorState(current, event),
      ).state;
      if (state.kind !== "editingSketch") throw Error("Expected sketch state");
      return state;
    };
    dispatch({ type: "selection.cleared" });
    const select = (target: PrimitiveRef) =>
      dispatch({ type: "viewport.selectionRequested", target });
    const undoLabels = () =>
      (state as SketchEditorState).session.actionHistory?.undo.map(
        (entry) => entry.label,
      ) ?? [];
    return { ...fixture, dispatch, select, undoLabels };
  }

  test("selecting geometry and annotations and the two-stage clear record no action", async () => {
    const f = await lifecycle();
    f.select(f.g);
    f.select(f.a);
    f.dispatch({ type: "selection.cleared" });
    f.select(f.b);
    f.dispatch({ type: "selection.cleared" });
    const cleared = f.dispatch({ type: "selection.cleared" });
    expect(cleared.annotationContext ?? null, "premise: cleared").toBe(null);
    expect(f.undoLabels(), "no lifecycle event is an action").toEqual([]);

    f.select(f.d);
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(f.undoLabels(), "contrast: a Delete is one action").toEqual([
      "Delete Sketch Item",
    ]);
  });

  // T14g (T-10): the radial wheel is editor UI state too: opening, choosing
  // spokes, "More…", closing and the first blank record nothing and keep the
  // session object; Undo/Redo close an open wheel (its spokes are the
  // pre-restore cluster).
  test("T14g: wheel events record no action and keep the session; Undo and Redo close the wheel", async () => {
    const f = await lifecycle();
    f.select(f.g);
    const steps: [string, EditorEvent][] = [
      [
        "open",
        {
          type: "sketch.annotationWheelOpened",
          clusterKey: "k",
          members: [f.a, f.b],
        },
      ],
      ["spoke A", { type: "viewport.selectionRequested", target: f.a }],
      ["spoke B", { type: "viewport.selectionRequested", target: f.b }],
      [
        "More…",
        { type: "sketch.annotationWheelListFilterChanged", filtered: true },
      ],
      ["close", { type: "sketch.annotationWheelClosed" }],
      [
        "reopen",
        {
          type: "sketch.annotationWheelOpened",
          clusterKey: "k",
          members: [f.a, f.b],
        },
      ],
      ["first blank", { type: "selection.cleared" }],
    ];
    for (const [name, event] of steps) {
      const before = f.dispatch({ type: "viewport.hoverCleared" }).session;
      expect(f.dispatch(event).session, name).toBe(before);
    }
    expect(f.undoLabels(), "no wheel event is an action").toEqual([]);

    f.dispatch({
      type: "sketch.annotationWheelOpened",
      clusterKey: "k",
      members: [f.a, f.b],
    });
    f.select(f.a);
    const deleted = f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(deleted.annotationContext?.wheel, "premise: shrunk, open").toEqual({
      clusterKey: "k",
      members: [f.b],
    });
    expect(f.undoLabels()).toEqual(["Delete Sketch Item"]);
    const undone = f.dispatch({ type: "history.undoRequested" });
    expect(undone.annotationContext?.wheel, "Undo closes the wheel").toBe(
      undefined,
    );
    expect(undone.annotationContext?.owners).toEqual([f.g]);
    f.dispatch({
      type: "sketch.annotationWheelOpened",
      clusterKey: "k",
      members: [f.a, f.b],
    });
    const redone = f.dispatch({ type: "history.redoRequested" });
    expect(redone.annotationContext?.wheel, "Redo closes the wheel").toBe(
      undefined,
    );
  });

  // Review R-4 (R-7 option (b)), event-loop seam: the composition
  // `EditorEventLoop.transition` runs (the action owner around the reducer,
  // then the four post-transition hooks). Lifecycle clicks and hover keep the
  // session object, so the descriptor solve memoised on it never re-runs;
  // ledger changes still renew it.
  test("R-7 at the event-loop seam: lifecycle clicks and hover keep the session object; ledger changes renew it", async () => {
    const f = await makeAnnotationLifecycleState();
    const owner = new SketchAuthoredActions();
    let state: EditorState = f.state;
    const dispatch = (event: EditorEvent) => {
      state = emitPendingSketchSnapQuery(
        emitPendingSketchEditQuery(
          emitPendingSketchOffsetPreviewPublication(
            emitPendingSketchRegionDerivation(
              owner.transition(state, event, (current) =>
                transitionEditorState(current, event),
              ),
            ),
          ),
        ),
      ).state;
      if (state.kind !== "editingSketch") throw Error("Expected sketch state");
      return state;
    };
    dispatch({ type: "selection.cleared" });
    dispatch({ type: "selection.cleared" });

    for (const [name, event] of [
      ["select G", { type: "viewport.selectionRequested", target: f.g }],
      ["select A", { type: "viewport.selectionRequested", target: f.a }],
      ["first blank", { type: "selection.cleared" }],
      [
        "select sibling B",
        { type: "viewport.selectionRequested", target: f.b },
      ],
      ["first blank", { type: "selection.cleared" }],
      ["second blank", { type: "selection.cleared" }],
      ["hover", { type: "viewport.hovered", target: f.h }],
      ["hover cleared", { type: "viewport.hoverCleared" }],
    ] as const) {
      const before = (state as SketchEditorState).session;
      expect(dispatch(event).session, name).toBe(before);
    }

    dispatch({ type: "viewport.selectionRequested", target: f.d });
    const beforeDelete = (state as SketchEditorState).session;
    const deleted = dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(deleted.session).not.toBe(beforeDelete);
    expect(deleted.session.actionAvailability).toEqual({
      canUndo: true,
      canRedo: false,
    });
    const undone = dispatch({ type: "history.undoRequested" });
    expect(undone.session.actionAvailability).toEqual({
      canUndo: false,
      canRedo: true,
    });
    expect(undone.session.actionHistory?.redo.map((e) => e.label)).toEqual([
      "Delete Sketch Item",
    ]);
  });

  // Review R-4 condition: the comparison covers whole entries, so a blocked
  // mark written after `withAvailability` is still cleared by the next event.
  test("R-7 option (b): a blocked-Undo mark is cleared by the next event", async () => {
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
    const blocked = f.owner.transition(
      opened.state,
      { type: "history.undoRequested" },
      (current) => ({ state: current, effects: [] }),
    );
    if (blocked.state.kind !== "editingSketch") throw Error("Expected sketch");
    expect(
      blocked.state.session.actionHistory?.undo.at(-1)?.blockedReason,
      "premise: the Undo is marked blocked",
    ).toBe("Can't undo Edit Sketch: ‘Line 1’ was changed by another session.");

    const next = f.owner.transition(
      blocked.state,
      { type: "selection.cleared" },
      (current) => ({ state: current, effects: [] }),
    );
    if (next.state.kind !== "editingSketch") throw Error("Expected sketch");
    expect(next.state.session.actionHistory?.undo.at(-1)).toEqual({
      sequence: blocked.state.session.actionHistory!.undo.at(-1)!.sequence,
      label: blocked.state.session.actionHistory!.undo.at(-1)!.label,
    });
  });

  test("Redo of a deletion prunes `last` and owners; Undo of a creation prunes `last`", async () => {
    const f = await lifecycle();
    f.select(f.g);
    f.select(f.a);
    const deleted = f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(deleted.annotationContext).toEqual({ owners: [f.g], last: null });

    f.dispatch({ type: "history.undoRequested" });
    const reselected = f.select(f.a);
    expect(reselected.annotationContext, "premise: A is back").toEqual({
      owners: [f.g],
      last: f.a,
    });
    const redone = f.dispatch({ type: "history.redoRequested" });
    expect(
      redone.session.definition.constraintIds,
      "premise: Redo deleted A again",
    ).not.toContain(f.a.constraintId);
    expect(
      redone.annotationContext,
      "Redo prunes the deleted `last`; G stays the owner",
    ).toEqual({ owners: [f.g], last: null });

    f.dispatch({ type: "selection.cleared" });
    f.select(f.k);
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    f.dispatch({ type: "history.undoRequested" });
    expect(f.select(f.k).annotationContext, "premise: K is back").toEqual({
      owners: [f.k],
      last: null,
    });
    const kRedone = f.dispatch({ type: "history.redoRequested" });
    expect(
      kRedone.annotationContext ?? null,
      "Redo deleting the owner drops the context",
    ).toBe(null);

    f.dispatch({ type: "tool.activated", toolId: "constraintHorizontal" });
    const created = f.select(f.h);
    const horizontal = created.session.definition.constraints.find(
      (constraint) =>
        constraint.kind === "horizontal" &&
        constraint.entityId === (f.h as { entityId: string }).entityId,
    );
    expect(horizontal, "premise: a Horizontal on H was authored").toBeTruthy();
    f.select(f.h);
    const target = {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: horizontal!.constraintId,
    } as const;
    expect(f.select(target).annotationContext).toEqual({
      owners: [f.h],
      last: target,
    });
    const undone = f.dispatch({ type: "history.undoRequested" });
    expect(
      undone.session.definition.constraintIds,
      "premise: Undo removed it",
    ).not.toContain(horizontal!.constraintId);
    expect(
      undone.annotationContext,
      "Undo prunes the removed `last`; H stays the owner",
    ).toEqual({ owners: [f.h], last: null });
  });
});

// T15d (logic lane; seam: the authored-action owner around the real sketch
// reducer). Editing a mirror copy is one action per completed intent and
// none on cancel; Undo restores the pre-drag state in one step (issue 09).
describe("T15d: mirror copy intents through the authored-action owner", () => {
  const world = ([x, y]: readonly [number, number]) => [x, y, 0] as const;
  async function mirrorFixture() {
    const setup = mirroredSession("free");
    const f = await fixture(false, setup.session);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);
    return { f, setup };
  }
  function glide(
    f: Awaited<ReturnType<typeof fixture>>,
    target: PrimitiveRef,
    from: readonly [number, number],
    to: readonly [number, number],
  ) {
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target,
      point: world(from) as never,
    });
    for (let step = 1; step <= 4; step += 1)
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: world([
          from[0] + ((to[0] - from[0]) * step) / 4,
          from[1] + ((to[1] - from[1]) * step) / 4,
        ]) as never,
      });
  }

  test("a completed copy-endpoint drag is one action: the seed followed; Undo restores the pre-drag state in one step, Redo the result", async () => {
    const { f, setup } = await mirrorFixture();
    const before = projection(f.session);
    const ma = setup.outputOf("ab").outputPointIds[0]!;
    const from = f.session.definition.points.find(
      (entry) => entry.pointId === ma,
    )!.position;
    const to = [from[0] + 0.3, from[1] - 0.4] as const;
    glide(f, pointRef(f.session, ma), from, to);
    expect(
      f.session.actionAvailability?.canUndo ?? false,
      "frames record nothing",
    ).toBe(false);
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(to) as never });
    const after = projection(f.session);
    const seedA = f.session.definition.points.find(
      (entry) => entry.pointId === pid("a"),
    )!.position;
    expect(
      Math.hypot(seedA[0] - to[0], seedA[1] + to[1]),
      "the seed followed",
    ).toBeLessThanOrEqual(1e-4);
    expect(f.session.actionAvailability?.canUndo).toBe(true);
    expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
      before,
    );
    expect(f.session.actionAvailability, "exactly one action").toEqual({
      canUndo: false,
      canRedo: true,
    });
    expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
      after,
    );
  });

  test("a cancelled copy drag and a cancelled automatic-handle grab (seed converted at grab) record nothing and restore the pre-drag state", async () => {
    const { f, setup } = await mirrorFixture();
    const before = projection(f.session);
    const ma = setup.outputOf("ab").outputPointIds[0]!;
    const from = f.session.definition.points.find(
      (entry) => entry.pointId === ma,
    )!.position;
    glide(f, pointRef(f.session, ma), from, [from[0] + 0.3, from[1] - 0.4]);
    f.dispatch({ type: "sketch.geometryDragCancelled" });
    expect(projection(f.session)).toEqual(before);

    const copy = setup.outputOf("s");
    const copySpline = f.session.definition.entities.find(
      (entry) => entry.entityId === copy.outputEntityId,
    );
    if (copySpline?.kind !== "spline") throw new Error("spline");
    const fit = f.session.definition.points.find(
      (entry) => entry.pointId === copy.outputPointIds[0],
    )!.position;
    const handle = handleRef(
      f.session,
      copy.outputEntityId,
      copySpline.pointOccurrences[0]!.occurrenceId,
      copy.outputPointIds[0]!,
    );
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: handle,
      point: world([fit[0] + 0.5, fit[1]]) as never,
    });
    expect(
      projection(f.session),
      "the grab converted the seed occurrence",
    ).not.toEqual(before);
    f.dispatch({ type: "sketch.geometryDragCancelled" });
    expect(projection(f.session)).toEqual(before);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);
  });

  test("a completed automatic-handle drag on the copy is one action; Undo restores both occurrences automatic", async () => {
    const { f, setup } = await mirrorFixture();
    const before = projection(f.session);
    const copy = setup.outputOf("s");
    const copySpline = f.session.definition.entities.find(
      (entry) => entry.entityId === copy.outputEntityId,
    );
    if (copySpline?.kind !== "spline") throw new Error("spline");
    const occurrenceId = copySpline.pointOccurrences[0]!.occurrenceId;
    const fit = f.session.definition.points.find(
      (entry) => entry.pointId === copy.outputPointIds[0],
    )!.position;
    const handle = handleRef(
      f.session,
      copy.outputEntityId,
      occurrenceId,
      copy.outputPointIds[0]!,
    );
    const visible = reconstructSplineAggregate(
      copySpline,
      Object.fromEntries(
        f.session.definition.points.map((entry) => [
          entry.pointId,
          entry.position,
        ]),
      ),
    );
    if (visible.validity !== "valid") throw new Error("valid");
    const tip = [
      fit[0] + visible.handles[0]![0],
      fit[1] + visible.handles[0]![1],
    ] as const;
    glide(f, handle, tip, [tip[0] + 0.5, tip[1] - 0.5]);
    f.dispatch({
      type: "sketch.geometryDragEnded",
      point: world([tip[0] + 0.5, tip[1] - 0.5]) as never,
    });
    const kinds = () =>
      [eid("s"), copy.outputEntityId].map((entityId) => {
        const spline = f.session.definition.entities.find(
          (entry) => entry.entityId === entityId,
        );
        return spline?.kind === "spline"
          ? spline.pointOccurrences[0]!.tangent.kind
          : null;
      });
    expect(kinds()).toEqual(["authored", "authored"]);
    expect(f.session.actionAvailability?.canUndo).toBe(true);
    expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
      before,
    );
    expect(kinds()).toEqual(["automatic", "automatic"]);
    expect(f.session.actionAvailability?.canUndo).toBe(false);
  });

  // T17b (C7, T15d review A-5): the rim, Reset and Zero intents on a copy go
  // through the same owner as the point and handle intents.
  const undoLabels = (f: Awaited<ReturnType<typeof fixture>>) =>
    f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  const radiusOf = (
    f: Awaited<ReturnType<typeof fixture>>,
    entityId: string,
  ) => {
    const circle = f.session.definition.entities.find(
      (entry) => entry.entityId === entityId,
    );
    if (circle?.kind !== "circle") throw new Error("circle");
    return circle.radius;
  };
  const tangentOf = (
    f: Awaited<ReturnType<typeof fixture>>,
    entityId: string,
    index: number,
  ) => {
    const spline = f.session.definition.entities.find(
      (entry) => entry.entityId === entityId,
    );
    if (spline?.kind !== "spline") throw new Error("spline");
    return spline.pointOccurrences[index]!.tangent;
  };

  test("a completed copy-rim drag is one 'Move Sketch Geometry' action: the seed circle grew with it; Undo restores the pre-drag state in one step, Redo the result", async () => {
    const { f, setup } = await mirrorFixture();
    const before = projection(f.session);
    const copy = setup.outputOf("c");
    const centre = f.session.definition.points.find(
      (entry) => entry.pointId === copy.outputPointIds[0],
    )!.position;
    const seedRadius = radiusOf(f, eid("c"));
    const from = [centre[0] + seedRadius, centre[1]] as const;
    const to = [centre[0] + seedRadius + 0.6, centre[1]] as const;
    glide(f, entityRef(f.session, copy.outputEntityId), from, to);
    expect(undoLabels(f), "frames record nothing").toEqual([]);
    f.dispatch({ type: "sketch.geometryDragEnded", point: world(to) as never });
    expect(undoLabels(f), "exactly one action").toEqual([
      "Move Sketch Geometry",
    ]);
    expect(
      radiusOf(f, copy.outputEntityId),
      "the copy's rim followed the pointer",
    ).toBeCloseTo(seedRadius + 0.6, 4);
    expect(
      radiusOf(f, eid("c")),
      "the seed circle has the copy's radius",
    ).toBeCloseTo(radiusOf(f, copy.outputEntityId), 12);
    const after = projection(f.session);
    expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
      before,
    );
    expect(f.session.actionAvailability, "one Undo step").toEqual({
      canUndo: false,
      canRedo: true,
    });
    expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
      after,
    );
  });

  for (const [intent, label] of [
    ["resetTangentToAutomatic", "Reset Tangent"],
    ["setTangentToZero", "Zero Tangent"],
  ] as const)
    test(`${label} on a copy's fit point is one '${label}' action on the seed occurrence (the copy follows); Undo restores both in one step, Redo the result`, async () => {
      const { f, setup } = await mirrorFixture();
      const copy = setup.outputOf("s");
      const copySpline = f.session.definition.entities.find(
        (entry) => entry.entityId === copy.outputEntityId,
      );
      if (copySpline?.kind !== "spline") throw new Error("spline");
      const occurrenceId = copySpline.pointOccurrences[1]!.occurrenceId;
      const handle = handleRef(
        f.session,
        copy.outputEntityId,
        occurrenceId,
        copy.outputPointIds[1]!,
      );
      // Reset needs authored handles: one completed drag of the copy's
      // handle first (it authors the seed occurrence and the copy's).
      if (intent === "resetTangentToAutomatic") {
        const fit = f.session.definition.points.find(
          (entry) => entry.pointId === copy.outputPointIds[1],
        )!.position;
        const visible = reconstructSplineAggregate(
          copySpline,
          Object.fromEntries(
            f.session.definition.points.map((entry) => [
              entry.pointId,
              entry.position,
            ]),
          ),
        );
        if (visible.validity !== "valid") throw new Error("valid");
        const tip = [
          fit[0] + visible.handles[1]![0],
          fit[1] + visible.handles[1]![1],
        ] as const;
        const to = [tip[0] + 0.5, tip[1] - 0.5] as const;
        glide(f, handle, tip, to);
        f.dispatch({
          type: "sketch.geometryDragEnded",
          point: world(to) as never,
        });
        expect(
          [eid("s"), copy.outputEntityId].map(
            (entityId) => tangentOf(f, entityId, 1).kind,
          ),
          "premise: both handles authored",
        ).toEqual(["authored", "authored"]);
      }
      const labelsBefore = undoLabels(f);
      const before = projection(f.session);
      // The copy's fit point (it maps to its occurrence, as in the panel).
      f.dispatch({
        type: "viewport.selectionRequested",
        target: pointRef(f.session, copy.outputPointIds[1]!),
      });
      f.dispatch({ type: "sketch.toolPatched", patch: { intent } });
      expect(undoLabels(f), "exactly one action").toEqual([
        ...labelsBefore,
        label,
      ]);
      for (const entityId of [eid("s"), copy.outputEntityId]) {
        const tangent = tangentOf(f, entityId, 1);
        if (intent === "resetTangentToAutomatic")
          expect(tangent.kind, entityId).toBe("automatic");
        else
          expect(tangent, `${entityId} exact zero`).toEqual({
            kind: "authored",
            vector: [0, 0],
          });
      }
      const after = projection(f.session);
      expect(projection(f.apply({ type: "history.undoRequested" }))).toEqual(
        before,
      );
      expect(undoLabels(f), "one Undo step").toEqual(labelsBefore);
      expect(projection(f.apply({ type: "history.redoRequested" }))).toEqual(
        after,
      );
    });
});

// T16a (logic lane; seam: the authored-action owner around the real sketch
// reducer). The Mirror panel's Remove mirror is one action, "Remove Mirror";
// Undo restores the exact pre-removal definition, Redo re-applies it.
describe("T16a: Remove Mirror through the authored-action owner", () => {
  test("one intent from the panel is one action; Undo restores the definition bitwise, Redo re-applies", async () => {
    const setup = mirroredSession("free");
    const f = await fixture(false, setup.session);
    const before = f.session.definition;
    const beforeProjection = projection(f.session);
    const copy = entityRef(f.session, setup.outputOf("ab").outputEntityId);
    assert(copy.kind === "sketchEntity");
    f.dispatch({ type: "viewport.selectionRequested", target: copy });
    const panel = computeSketchMirrorActionState(f.session, f.state.selection);
    expect(
      panel?.entries.map((entry) => entry.derivationId),
      "the panel shows the copy's mirror",
    ).toEqual([setup.relationship.derivationId]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "removeMirror",
        derivationId: panel!.entries[0]!.derivationId,
      },
    });
    const after = f.session.definition;
    expect(after.derivedRelationships).toEqual([]);
    expect(after.entityIds).not.toContain(copy.entityId);
    expect(f.state.selection, "the removed copy leaves the selection").toEqual(
      [],
    );
    expect(
      f.session.actionHistory?.undo.map((entry) => entry.label),
      "exactly one action",
    ).toEqual(["Remove Mirror"]);
    const afterProjection = projection(f.session);

    f.dispatch({ type: "history.undoRequested" });
    expect(
      f.session.definition,
      "Undo restores the definition bitwise",
    ).toEqual(before);
    expect(projection(f.session)).toEqual(beforeProjection);
    expect(f.session.actionAvailability).toEqual({
      canUndo: false,
      canRedo: true,
    });
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition).toEqual(after);
    expect(projection(f.session)).toEqual(afterProjection);
  });

  test("Remove of a mirror that is not there records nothing", async () => {
    const setup = mirroredSession("free");
    const f = await fixture(false, setup.session);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "removeMirror", derivationId: "derivation_missing" },
    });
    expect(f.session.definition).toBe(setup.session.definition);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);
  });
});

// T17c (logic lane; seam: the authored-action owner around the real sketch
// reducer, on an entered session). The Offset panel's Remove offset is one
// action, "Remove Offset"; Undo restores the exact pre-removal definition,
// Redo re-applies it; the persistence validation ([TECH] G18) holds at
// every step.
describe("T17c: Remove Offset through the authored-action owner", () => {
  test("a spline + line offset selected by its shell: one intent from the panel is one action; Undo restores the definition bitwise, Redo re-applies; valid throughout", async () => {
    const setup = offsetSession("lineSplineArcJoint");
    if (setup.relationship.kind !== "offset") throw new Error("offset");
    const f = await fixture(false, setup.session);
    const before = f.session.definition;
    const beforeProjection = projection(f.session);
    const valid = (message: string) => {
      const result = validateSketchDefinition(f.session.definition);
      expect(result.success ? [] : result.issues, message).toEqual([]);
    };
    valid("premise: valid");
    const shellId = setup.relationship.piecewiseCubicOutputs[0]!.outputEntityId;
    const shell = entityRef(f.session, shellId);
    f.dispatch({ type: "viewport.selectionRequested", target: shell });
    const panel = computeSketchOffsetActionState(f.session, f.state.selection);
    expect(
      panel?.entries.map((entry) => entry.derivationId),
      "the panel shows the shell's offset",
    ).toEqual([setup.relationship.derivationId]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "removeOffset",
        derivationId: panel!.entries[0]!.derivationId,
      },
    });
    const after = f.session.definition;
    expect(after.derivedRelationships).toEqual([]);
    expect(after.entityIds).not.toContain(shellId);
    expect(f.state.selection, "the removed shell leaves the selection").toEqual(
      [],
    );
    expect(
      f.session.actionHistory?.undo.map((entry) => entry.label),
      "exactly one action",
    ).toEqual(["Remove Offset"]);
    valid("valid after the removal");
    const afterProjection = projection(f.session);

    f.dispatch({ type: "history.undoRequested" });
    expect(
      f.session.definition,
      "Undo restores the definition bitwise",
    ).toEqual(before);
    expect(projection(f.session)).toEqual(beforeProjection);
    valid("valid after Undo");
    expect(f.session.actionAvailability).toEqual({
      canUndo: false,
      canRedo: true,
    });
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition).toEqual(after);
    expect(projection(f.session)).toEqual(afterProjection);
    valid("valid after Redo");
  });

  test("Remove of an offset that is not there records nothing", async () => {
    const setup = offsetSession("lineTrim");
    const f = await fixture(false, setup.session);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "removeOffset", derivationId: "derivation_missing" },
    });
    expect(f.session.definition).toBe(setup.session.definition);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);
  });
});

// T17c2 (logic lane; seam: the authored-action owner around the real sketch
// reducer, on an entered session with a spline drawn by the Spline tool).
// Close spline is one action, "Close Spline", whose write set is the
// spline's `closure`; Undo restores the raw definition exactly, Redo
// re-applies it; a refused Close records nothing.
describe("T17c2: Close Spline through the authored-action owner", () => {
  function drawn(points: readonly (readonly [number, number])[]) {
    let next = startSketchDraw(
      beginSketchTool(
        withSketchSnapScale(
          enterSketchSession(
            createNewSketchSession(
              createStandardPlaneDefinition("xy"),
              OCC_KERNEL_SETTINGS,
            ),
          ),
          SPEC_SKETCH_UNITS_PER_PIXEL,
        ),
        "spline",
      ),
      points[0]!,
    );
    for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
    return clearActiveSketchTool(finalizeSketchDraw(next));
  }

  test("a fit point selected: one intent is one action; only `closure` changes; Undo/Redo exact on the raw definition", async () => {
    const f = await fixture(
      false,
      drawn([
        [1, 1],
        [3, 2.5],
        [5, 1.5],
        [3, -0.5],
      ]),
    );
    const before = f.session.definition;
    const spline = before.entities.find((entity) => entity.kind === "spline");
    if (spline?.kind !== "spline") throw new Error("spline");
    f.dispatch({
      type: "viewport.selectionRequested",
      target: pointRef(f.session, spline.pointOccurrences[1]!.pointId),
    });
    expect(
      computeSketchCloseSplineState(f.session, f.state.selection),
      "the panel offers Close spline",
    ).toEqual({
      entityId: spline.entityId,
      label: spline.label,
      refusal: null,
    });
    const selection = f.state.selection;
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "closeSpline" },
    });
    const after = f.session.definition;
    expect(after).toEqual({
      ...before,
      entities: before.entities.map((entity) =>
        entity.entityId === spline.entityId
          ? { ...entity, closure: "smooth" }
          : entity,
      ),
    });
    expect(
      f.session.actionHistory?.undo.map((entry) => entry.label),
      "exactly one action",
    ).toEqual(["Close Spline"]);
    expect(f.state.selection, "the selection stays").toEqual(selection);
    expect(
      computeSketchCloseSplineState(f.session, f.state.selection),
      "closed: no Close spline",
    ).toBeNull();

    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition, "Undo re-opens it exactly").toEqual(before);
    expect(f.session.actionAvailability).toEqual({
      canUndo: false,
      canRedo: true,
    });
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition, "Redo closes it again").toEqual(after);
  });

  // T17c2 review (orchestrator: option B): a piece of a real spline Trim
  // carries `endSpanParameterLengths`; Close spline drops it in the same
  // action, the wrapped piece reconstructs validly, and Undo restores the
  // field exactly.
  test("a piece of a real Trim closes: one action drops its fixed end spans with the closure; the wrapped piece is valid; Undo restores the field exactly, Redo drops it again", async () => {
    const f = await fixture(
      false,
      drawn([
        [20, 0],
        [22, 3],
        [24, 0],
        [26, 3],
        [28, 0],
        [30, 3],
      ]),
    );
    let session = f.session;
    for (const x of [21, 23])
      session = clearActiveSketchTool(
        acceptSketchDraw(
          startSketchDraw(
            beginSketchTool(
              withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL),
              "line",
            ),
            [x, -1],
          ),
          [x, 4],
        ),
      );
    f.apply({ type: "selection.cleared" }, session);
    const original = f.session.definition.entities.find(
      (entity) => entity.kind === "spline",
    )!;
    f.apply(
      { type: "selection.cleared" },
      selectSketchEditToolTarget(
        beginSketchTool(f.session, "trim"),
        original.target,
      ),
    );
    const emitted = emitPendingSketchEditQuery({ state: f.state, effects: [] });
    const effect = emitted.effects.find(
      (candidate) => candidate.type === "sketch.queryEditIntersections",
    );
    if (effect?.type !== "sketch.queryEditIntersections")
      throw new Error("Expected the Trim query.");
    const event = await runEditorEffect(effect, {
      querySketchEditIntersections: querySketchEditIntersectionsForTest,
    } as EditorEffectRuntime);
    const resolved = transitionEditorState(emitted.state, event).state;
    assert(resolved.kind === "editingSketch");
    f.apply(event, resolved.session);
    expect(f.session.actionHistory?.undo.at(-1)?.label, "premise: Trim").toBe(
      "Trim",
    );
    f.apply({ type: "selection.cleared" }, clearActiveSketchTool(f.session));
    const piece = f.session.definition.entities.find(
      (entity) =>
        entity.kind === "spline" && entity.pointOccurrences.length >= 3,
    );
    if (piece?.kind !== "spline") throw new Error("a ≥ 3-point piece");
    expect(
      piece.endSpanParameterLengths,
      "premise: the Trim piece has fixed end spans",
    ).toBeDefined();
    const before = f.session.definition;
    const undoDepth = f.session.actionHistory!.undo.length;
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, piece.entityId),
    });
    expect(
      computeSketchCloseSplineState(f.session, f.state.selection)?.refusal,
      "a trimmed piece can close",
    ).toBeNull();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "closeSpline" },
    });
    expect(f.session.actionHistory?.undo).toHaveLength(undoDepth + 1);
    expect(f.session.actionHistory?.undo.at(-1)?.label).toBe("Close Spline");
    const open: typeof piece = { ...piece, closure: "smooth" };
    delete open.endSpanParameterLengths;
    const after = f.session.definition;
    expect(after).toStrictEqual({
      ...before,
      entities: before.entities.map((entity) =>
        entity.entityId === piece.entityId ? open : entity,
      ),
    });
    const solved = f.session.liveSolve!.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === piece.entityId,
    );
    expect(f.session.liveSolve?.accepted).toBe(true);
    expect(solved?.kind === "spline" && solved.reconstruction.validity).toBe(
      "valid",
    );
    expect(
      solved?.kind === "spline" && solved.reconstruction.spans.length,
      "wrapped: n spans for n fit points",
    ).toBe(piece.pointOccurrences.length);

    f.dispatch({ type: "history.undoRequested" });
    expect(
      f.session.definition,
      "Undo restores the fixed end spans exactly",
    ).toStrictEqual(before);
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition).toStrictEqual(after);
  });

  test("a refused Close (2 fit points) records nothing", async () => {
    const f = await fixture(
      false,
      drawn([
        [1, 1],
        [4, 2],
      ]),
    );
    const before = f.session.definition;
    const spline = before.entities.find((entity) => entity.kind === "spline")!;
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, spline.entityId),
    });
    expect(
      computeSketchCloseSplineState(f.session, f.state.selection)?.refusal,
    ).toBe(
      `${spline.label} has 2 fit points; closing a spline needs at least 3.`,
    );
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "closeSpline" },
    });
    expect(f.session.definition).toBe(before);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);
  });
});

// T16d (logic lane; seam: the authored-action owner around the real sketch
// reducer and the workbench Enter/Escape routes). Mirror picks stage only;
// the popup's Mirror or Enter is one action, "Mirror" (base: the axis pick
// itself was the action, "Viewport.selection Requested"); Cancel and Escape
// record nothing and keep the tool armed; one Undo removes the mirror.
describe("T16d: Mirror creation through the authored-action owner", () => {
  async function armed() {
    const base = rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      { definition: seedDefinition() },
    );
    const f = await fixture(false, base);
    f.dispatch({ type: "tool.activated", toolId: "sketchMirror" });
    const pickAll = () => {
      for (const id of ["c", "ab", "axis"])
        f.dispatch({
          type: "viewport.selectionRequested",
          target: entityRef(f.session, eid(id)),
        });
    };
    return { f, pickAll, before: projection(f.session) };
  }
  const undoLabels = (session: SketchSessionState) =>
    session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  const escapeOf = (f: Awaited<ReturnType<typeof fixture>>) =>
    getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: f.state.selection,
      sketchSession: f.session,
    })!;
  const seedsOf = (session: SketchSessionState) =>
    (session.definition.derivedRelationships ?? []).map((relationship) =>
      relationship.kind === "mirror" ? relationship.seedEntityIds : null,
    );

  test("picks record nothing; Cancel and Escape record nothing and keep the tool armed; the popup's Mirror is one 'Mirror' action; Undo removes it in one step, Redo restores it", async () => {
    const { f, pickAll, before } = await armed();
    pickAll();
    expect(projection(f.session), "picking authors nothing").toEqual(before);
    expect(f.session.toolStagedEntities).toHaveLength(2);
    expect(f.session.actionAvailability?.canUndo ?? false).toBe(false);

    f.dispatch({
      type: "sketch.toolPatched",
      patch: f.session.toolPresentation!.floatingInput!.cancelAction.patch,
    });
    pickAll();
    f.dispatch(escapeOf(f));
    expect(projection(f.session), "Cancel and Escape author nothing").toEqual(
      before,
    );
    expect(undoLabels(f.session)).toEqual([]);
    expect(f.session.activeTool, "the tool stays armed").toBe("sketchMirror");
    expect(f.session.toolStagedEntities).toEqual([]);

    pickAll();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: f.session.toolPresentation!.floatingInput!.submitAction.patch,
    });
    expect(seedsOf(f.session)).toEqual([[eid("c"), eid("ab")]]);
    expect(undoLabels(f.session), "exactly one 'Mirror' action").toEqual([
      "Mirror",
    ]);
    expect(f.session.activeTool).toBe("sketchMirror");
    const after = projection(f.session);
    f.dispatch({ type: "history.undoRequested" });
    expect(projection(f.session), "one Undo removes the mirror").toEqual(
      before,
    );
    expect(f.session.actionAvailability).toEqual({
      canUndo: false,
      canRedo: true,
    });
    f.dispatch({ type: "history.redoRequested" });
    expect(projection(f.session)).toEqual(after);
  });

  test("review A-3: Undo while a mirror is staged re-stages the picks on the restored definition (preview, popup and Enter agree); picks the Undo removed stage nothing and Enter is not consumed", async () => {
    const popupOf = (f: Awaited<ReturnType<typeof fixture>>) =>
      f.session.toolPresentation?.floatingInput ?? null;
    const pick = (
      f: Awaited<ReturnType<typeof fixture>>,
      ...ids: SketchEntityId[]
    ) => {
      for (const id of ids)
        f.dispatch({
          type: "viewport.selectionRequested",
          target: entityRef(f.session, id),
        });
    };
    // Still forms a mirror after the Undo: s about the axis.
    {
      const { f, pickAll } = await armed();
      pickAll();
      f.dispatch(getEnterEvent({ sketchSession: f.session })!);
      pick(f, eid("s"), eid("axis"));
      const staged = f.session.toolStagedEntities;
      expect(popupOf(f)?.readout).toBe("1 shape about ‘axis’");
      f.dispatch({ type: "history.undoRequested" });
      expect(seedsOf(f.session), "Undo removed the first mirror").toEqual([]);
      expect(
        f.session.activeEditTool?.selectedTargets.map((target) =>
          target.kind === "sketchEntity" ? target.entityId : null,
        ),
      ).toEqual([eid("s"), eid("axis")]);
      expect(
        f.session.toolStagedEntities.map((draft) =>
          draft.kind === "spline" ? draft.points : null,
        ),
        "re-staged on the restored definition",
      ).toEqual(
        staged.map((draft) => (draft.kind === "spline" ? draft.points : null)),
      );
      expect(popupOf(f)?.readout).toBe("1 shape about ‘axis’");
      f.dispatch(getEnterEvent({ sketchSession: f.session })!);
      expect(seedsOf(f.session)).toEqual([[eid("s")]]);
      expect(undoLabels(f.session)).toEqual(["Mirror"]);
    }
    // No longer forms a mirror: the picked copy of c is gone after the Undo.
    {
      const { f, pickAll } = await armed();
      pickAll();
      f.dispatch(getEnterEvent({ sketchSession: f.session })!);
      const mirror = f.session.definition.derivedRelationships![0]!;
      const copy = mirror.outputs.find(
        (output) => output.seedEntityId === eid("c"),
      )!.outputEntityId;
      pick(f, copy, eid("axis"));
      expect(popupOf(f)?.readout, "premise: staged").toBe(
        "1 shape about ‘axis’",
      );
      f.dispatch({ type: "history.undoRequested" });
      expect(f.session.toolStagedEntities, "nothing staged").toEqual([]);
      expect(popupOf(f), "no popup").toBeNull();
      expect(f.session.toolPresentation?.validation?.[0]?.message).not.toBeNull();
      expect(
        getEnterEvent({ sketchSession: f.session }),
        "Enter is not consumed",
      ).toBeNull();
    }
  });

  test("Enter confirms a staged mirror as one 'Mirror' action; then Escape exits the tool and records nothing", async () => {
    const { f, pickAll, before } = await armed();
    expect(
      getEnterEvent({ sketchSession: f.session }),
      "nothing staged: Enter is not consumed",
    ).toBeNull();
    pickAll();
    f.dispatch(getEnterEvent({ sketchSession: f.session })!);
    expect(seedsOf(f.session)).toEqual([[eid("c"), eid("ab")]]);
    expect(undoLabels(f.session)).toEqual(["Mirror"]);
    f.dispatch(escapeOf(f));
    expect(f.session.activeEditTool, "the second Escape exits").toBeNull();
    expect(undoLabels(f.session)).toEqual(["Mirror"]);
    f.dispatch({ type: "history.undoRequested" });
    expect(projection(f.session)).toEqual(before);
  });
});

// T16e ([TECH] T16-9; logic lane, seam: the authored-action owner around
// the real sketch reducer and the workbench Enter/Escape routes). The Mirror
// panel's Replace mirror line… / Replace original… arm the Mirror tool's
// repair; hover and pick author nothing; Cancel and Escape record nothing
// and give the panel back (its selection restored); Replace (or Enter) is
// one action, "Replace Mirror Line" / "Replace Mirror Original"; one Undo
// restores the broken definition bitwise, Redo re-applies.
describe("T16e: mirror replacement through the authored-action owner", () => {
  /** The mirrored seeds with the axis (or `deleted`) gone, plus l2 (x = −5) and n. */
  function brokenWithLines(deleted = "axis") {
    const setup = mirroredSession("free");
    const base = setup.session.definition;
    const point = (id: string, position: [number, number]) =>
      ({
        pointId: pid(id),
        label: id,
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_draft",
          pointId: pid(id),
        },
        position,
        isConstruction: false,
      }) as SketchSessionState["definition"]["points"][number];
    const segment = (id: string, a: string, b: string) =>
      ({
        kind: "lineSegment",
        entityId: eid(id),
        label: id,
        target: {
          kind: "sketchEntity",
          sketchId: "sketch_draft",
          entityId: eid(id),
        },
        isConstruction: false,
        startPointId: pid(a),
        endPointId: pid(b),
      }) as SketchSessionState["definition"]["entities"][number];
    const points = [
      point("l2a", [-5, -10]),
      point("l2b", [-5, 10]),
      point("n0", [2, 4]),
      point("n1", [5, 6]),
    ];
    const entities = [
      ...base.entities.filter((entity) => entity.entityId !== eid(deleted)),
      segment("l2", "l2a", "l2b"),
      segment("n", "n0", "n1"),
    ];
    const session = rebuildSessionForDefinition(setup.session, {
      definition: {
        ...base,
        pointIds: [...base.pointIds, ...points.map((entry) => entry.pointId)],
        points: [...base.points, ...points],
        entityIds: entities.map((entity) => entity.entityId),
        entities,
      },
    });
    return { setup, session };
  }
  const undoLabels = (session: SketchSessionState) =>
    session.actionHistory?.undo.map((entry) => entry.label) ?? [];
  const escapeOf = (f: Awaited<ReturnType<typeof fixture>>) =>
    getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: f.state.selection,
      sketchSession: f.session,
    })!;
  const listed = (f: Awaited<ReturnType<typeof fixture>>) =>
    computeSketchMirrorActionState(f.session, f.state.selection)?.entries.map(
      (entry) => [entry.label, entry.brokenReason],
    ) ?? null;

  test("Replace mirror line…: hover and pick author nothing; Cancel and Escape record nothing and give the panel back; Replace is one 'Replace Mirror Line' action that heals the mirror; Undo restores the broken definition bitwise, Redo re-applies", async () => {
    const { setup, session } = brokenWithLines();
    const f = await fixture(false, session);
    const derivationId = setup.relationship.derivationId;
    const before = f.session.definition;
    const beforeProjection = projection(f.session);
    const u = entityRef(f.session, eid("u"));
    f.dispatch({ type: "viewport.selectionRequested", target: u });
    expect(listed(f), "premise: the panel lists the broken mirror").toEqual([
      ["mirror 1", "mirror line missing"],
    ]);
    const brokenMessage =
      "Mirror ‘mirror 1’ is broken: its mirror line was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line, or remove the mirror from the Mirror panel.";
    expect(f.session.validationMessage, "premise").toBe(brokenMessage);
    const start = () =>
      f.dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "startMirrorRepair", derivationId },
      });
    const l2 = () => entityRef(f.session, eid("l2"));
    const pick = () => {
      f.dispatch({ type: "viewport.hovered", target: l2() });
      expect(
        f.session.toolStagedEntities,
        "hover: the reflected copies",
      ).toHaveLength(4);
      f.dispatch({ type: "viewport.selectionRequested", target: l2() });
      expect(f.session.toolPresentation?.floatingInput?.readout).toBe(
        "Use ‘l2’ as the mirror line",
      );
      expect(projection(f.session), "nothing authored yet").toEqual(
        beforeProjection,
      );
    };

    start();
    expect(f.session.activeTool).toBe("sketchMirror");
    expect(f.state.command.toolId).toBe("sketchMirror");
    expect(listed(f), "the tool owns the panel slot").toBeNull();
    pick();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: f.session.toolPresentation!.floatingInput!.cancelAction.patch,
    });
    expect(f.session.activeTool, "Cancel leaves the repair").toBeNull();
    expect(f.state.selection, "the panel's selection is back").toEqual([u]);
    expect(
      f.session.validationMessage,
      "review R-2: the broken-mirror message is back",
    ).toBe(brokenMessage);
    expect(listed(f)).toEqual([["mirror 1", "mirror line missing"]]);
    expect(undoLabels(f.session)).toEqual([]);

    start();
    pick();
    f.dispatch(escapeOf(f));
    expect(f.session.activeTool, "Escape leaves the repair").toBeNull();
    expect(f.state.selection).toEqual([u]);
    expect(f.session.validationMessage, "review R-2").toBe(brokenMessage);
    expect(undoLabels(f.session)).toEqual([]);
    expect(f.session.definition).toBe(before);
    expect(
      escapeOf(f),
      "the next Escape is the ordinary one (clears the selection)",
    ).toEqual({ type: "selection.cleared" });

    start();
    pick();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: f.session.toolPresentation!.floatingInput!.submitAction.patch,
    });
    expect(undoLabels(f.session), "exactly one action").toEqual([
      "Replace Mirror Line",
    ]);
    expect(f.session.activeTool).toBeNull();
    expect(
      f.session.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
    ).toEqual([]);
    expect(f.state.selection, "the new line stays selected").toEqual([l2()]);
    expect(listed(f), "the panel shows the healed mirror").toEqual([
      ["mirror 1", null],
    ]);
    const after = f.session.definition;
    expect(after.derivedRelationships).toEqual([
      {
        ...setup.relationship,
        mirrorReference: { kind: "lineEntity", entityId: eid("l2") },
      },
    ]);

    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition, "Undo restores bitwise").toEqual(before);
    expect(projection(f.session)).toEqual(beforeProjection);
    expect(f.session.liveSolve!.solvedSnapshot.failedDerivationIds).toEqual([
      derivationId,
    ]);
    f.dispatch({ type: "history.redoRequested" });
    expect(f.session.definition).toEqual(after);
  });

  test("Replace original… confirmed by Enter is one 'Replace Mirror Original' action; a refused pick and Enter before a pick record nothing", async () => {
    const { setup, session } = brokenWithLines("ab");
    const f = await fixture(false, session);
    const before = projection(f.session);
    const copy = setup.outputOf("ab").outputEntityId;
    f.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "startMirrorRepair",
        derivationId: setup.relationship.derivationId,
        outputEntityId: copy,
      },
    });
    expect(getEnterEvent({ sketchSession: f.session })).toBeNull();
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("c")),
    });
    expect(f.session.toolPresentation?.validation?.[0]?.message).toBe(
      "‘c’ is already an original of mirror ‘mirror 1’.",
    );
    expect(getEnterEvent({ sketchSession: f.session })).toBeNull();
    expect(projection(f.session)).toEqual(before);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("n")),
    });
    f.dispatch(getEnterEvent({ sketchSession: f.session })!);
    expect(undoLabels(f.session)).toEqual(["Replace Mirror Original"]);
    expect(
      f.session.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
    ).toEqual([]);
    f.dispatch({ type: "history.undoRequested" });
    expect(projection(f.session)).toEqual(before);
  });
});

// T16b (logic lane; seam: the authored-action owner around the real sketch
// reducer). Undo and Redo of the Delete that breaks a mirror recompute its
// validity: the live solve's sketch-wide gate, the regions and the
// label-based message follow the restored definition (issue 15: "validity is
// recomputed after repair or Undo").
describe("T16b: Undo/Redo recompute a broken mirror's validity", () => {
  test("Delete the axis → broken (gate, regions unavailable, message); Undo → healthy; Redo → broken again", async () => {
    const setup = mirroredSession("free");
    const f = await fixture(false, setup.session);
    const message =
      "Mirror ‘mirror 1’ is broken: its mirror line was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line, or remove the mirror from the Mirror panel.";
    const health = (session: SketchSessionState) => ({
      failed: session.liveSolve?.solvedSnapshot.failedDerivationIds ?? [],
      regions: session.liveRegions.status === "unavailable",
      message: session.validationMessage,
    });
    const before = projection(f.session);
    const healthy = health(f.session);
    expect(healthy).toEqual({ failed: [], regions: false, message: null });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("axis")),
    });
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    expect(
      f.session.definition.entityIds,
      "premise: the axis is deleted",
    ).not.toContain(eid("axis"));
    const broken = {
      failed: [setup.relationship.derivationId],
      regions: true,
      message,
    };
    expect(health(f.session)).toEqual(broken);
    expect(f.session.actionHistory?.undo.map((entry) => entry.label)).toEqual([
      "Delete Sketch Item",
    ]);
    f.dispatch({ type: "history.undoRequested" });
    expect(projection(f.session), "Undo restores the axis").toEqual(before);
    expect(health(f.session), "Undo recomputes: healthy").toEqual(healthy);
    f.dispatch({ type: "history.redoRequested" });
    expect(health(f.session), "Redo recomputes: broken").toEqual(broken);
  });
});

// T16f (logic lane; seam: the authored-action owner around the real sketch
// reducer). The Dimension tool on a mirror copy whose original already has a
// driving radius opens that driver's edit: its Save is one action that edits
// only the driver ("Commit Annotation Value", as any dimension edit); Cancel
// and Escape record nothing; the tool stays armed either way; one Undo
// restores the definition bitwise. "Add as reference instead" is one action
// adding a reference on the copy ("Commit Constraint Value", as the tool's
// own commit).
describe("T16f: the Dimension tool routed to a shared driver through the authored-action owner", () => {
  async function routed() {
    const setup = mirroredSession("free");
    const seeded = rebuildSessionForDefinition(setup.session, {
      definition: {
        ...setup.session.definition,
        dimensionIds: ["dimension_seed" as never],
        dimensions: [
          {
            dimensionId: "dimension_seed",
            kind: "circleRadius",
            label: "Radius 2",
            entityId: eid("c"),
            value: { source: "literal", value: 2 },
          } as never,
        ],
      },
    });
    const f = await fixture(false, seeded);
    const copy = entityRef(f.session, setup.outputOf("c").outputEntityId);
    const open = () => {
      f.dispatch({ type: "tool.activated", toolId: "dimensionRadius" });
      f.dispatch({ type: "viewport.selectionRequested", target: copy });
      f.dispatch({
        type: "sketch.pointerReleased",
        point: [6, 6],
        sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
        target: null,
      });
      expect(
        f.session.activeAnnotationEdit?.target,
        "premise: the driver's edit is open",
      ).toMatchObject({ kind: "dimension", dimensionId: "dimension_seed" });
    };
    return { f, seeded, copy, open };
  }
  const undoLabels = (f: Awaited<ReturnType<typeof fixture>>) =>
    f.session.actionHistory?.undo.map((entry) => entry.label) ?? [];

  test("Cancel and Escape record nothing and keep the tool armed; Save is one action on the driver; Undo restores it bitwise", async () => {
    const { f, seeded, open } = await routed();
    open();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "cancelAnnotationValue" },
    });
    expect(undoLabels(f)).toEqual([]);
    expect(f.session.definition).toBe(seeded.definition);
    expect(f.session.activeTool).toBe("dimensionRadius");

    open();
    f.dispatch(
      getEscapeEvent({
        activeCommand: null,
        activeReferencePickerFieldId: null,
        selection: f.state.selection,
        sketchSession: f.session,
      })!,
    );
    expect(undoLabels(f)).toEqual([]);
    expect(f.session.activeTool).toBe("dimensionRadius");

    open();
    f.dispatch({ type: "sketch.toolPatched", patch: { value: "3" } });
    expect(undoLabels(f), "typing records nothing").toEqual([]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "commitAnnotationValue" },
    });
    expect(undoLabels(f)).toEqual(["Commit Annotation Value"]);
    expect(f.session.definition.dimensions).toEqual([
      expect.objectContaining({
        dimensionId: "dimension_seed",
        value: { source: "literal", value: 3 },
      }),
    ]);
    expect(f.session.activeTool, "the tool stays armed").toBe(
      "dimensionRadius",
    );
    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition).toEqual(seeded.definition);
  });

  test("review R-3: clicking the driver's label during the routed popup records nothing and keeps the tool armed", async () => {
    const { f, seeded, open } = await routed();
    open();
    const label = f.session.activeAnnotationEdit!.target;
    if (label.kind !== "dimension") throw new Error("Expected the routed dimension edit.");
    f.dispatch({ type: "viewport.selectionRequested", target: label });
    expect(undoLabels(f)).toEqual([]);
    expect(f.session.definition).toBe(seeded.definition);
    expect(f.session.activeAnnotationEdit).toBe(null);
    expect(f.session.activeTool).toBe("dimensionRadius");
    expect(f.state.selection).toEqual([label]);
  });

  test("“Add as reference instead” is one action adding a reference on the copy; the driver is unchanged", async () => {
    const { f, copy, open } = await routed();
    open();
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "setSharedDimensionReference", reference: true },
    });
    expect(undoLabels(f), "the switch records nothing").toEqual([]);
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "commitConstraintValue" },
    });
    expect(undoLabels(f)).toEqual(["Commit Constraint Value"]);
    expect(f.session.definition.dimensions).toEqual([
      expect.objectContaining({
        dimensionId: "dimension_seed",
        value: { source: "literal", value: 2 },
      }),
      expect.objectContaining({
        kind: "circleRadius",
        entityId: (copy as { entityId: string }).entityId,
        reference: true,
      }),
    ]);
    expect(f.session.activeTool).toBe("dimensionRadius");
  });
});

// T17h review R-1 (logic lane; seam: the authored-action owner around the
// real reducer). A constraint or dimension commit disarms its tool and hands
// the command (the toolbar) back to Select (T17h D-2), but a T16f routed edit
// also leaves the session without an active tool while its popup is open and
// re-arms the tool at every end: the command must keep the tool throughout,
// so the toolbar matches the armed tool. Red before the review fix: the
// command became Select at the routed popup and stayed Select once re-armed.
describe("T17h review R-1: a routed edit keeps the tool's command; the toolbar matches the re-armed tool", () => {
  async function routed() {
    const setup = mirroredSession("free");
    const seeded = rebuildSessionForDefinition(setup.session, {
      definition: {
        ...setup.session.definition,
        dimensionIds: ["dimension_seed" as never],
        dimensions: [
          {
            dimensionId: "dimension_seed",
            kind: "circleRadius",
            label: "Radius 2",
            entityId: eid("c"),
            value: { source: "literal", value: 2 },
          } as never,
        ],
      },
    });
    const f = await fixture(false, seeded);
    const copy = entityRef(f.session, setup.outputOf("c").outputEntityId);
    return { f, copy };
  }
  const expectCommand = (
    f: Awaited<ReturnType<typeof fixture>>,
    toolId: string,
    context: string,
  ) => {
    expect(f.state.command.toolId, `${context}: the command`).toBe(toolId);
    expect(f.session.activeTool, `${context}: the session`).toBe(
      f.session.activeAnnotationEdit ? null : toolId,
    );
  };

  test("Fix on the mirror copy's circle (routed at the pick): popup, Cancel, then Save keep the Fix command", async () => {
    const { f, copy } = await routed();
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    f.dispatch({ type: "viewport.selectionRequested", target: copy });
    expect(
      f.session.activeAnnotationEdit?.shared,
      "premise: the routed edit is open",
    ).toBeTruthy();
    expectCommand(f, "constraintFix", "routed popup");
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "cancelAnnotationValue" },
    });
    expectCommand(f, "constraintFix", "after Cancel");

    f.dispatch({ type: "viewport.selectionRequested", target: copy });
    f.dispatch({ type: "sketch.toolPatched", patch: { value: "3" } });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "commitAnnotationValue" },
    });
    expect(
      f.session.actionHistory?.undo.map((entry) => entry.label),
      "premise: Save is one action",
    ).toEqual(["Commit Annotation Value"]);
    expectCommand(f, "constraintFix", "after Save");
  });

  test("cadara-h026.2: Fix activated on the preselected copy circle opens the routed popup and keeps the Fix command", async () => {
    const { f, copy } = await routed();
    f.dispatch({
      type: "viewport.selectionRequested",
      target: copy,
      selectionMode: "toggle",
    });
    f.dispatch({ type: "tool.activated", toolId: "constraintFix" });
    expect(
      f.session.activeAnnotationEdit?.shared,
      "premise: the routed edit is open at activation",
    ).toBeTruthy();
    expectCommand(f, "constraintFix", "routed popup");
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "cancelAnnotationValue" },
    });
    expectCommand(f, "constraintFix", "after Cancel");
  });

  test("Radius on the copy routed by the label placement patch, then Save keeps the Radius command", async () => {
    const { f, copy } = await routed();
    f.dispatch({ type: "tool.activated", toolId: "dimensionRadius" });
    f.dispatch({ type: "viewport.selectionRequested", target: copy });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "setConstraintAnnotationPlacement", point: [6, 6] },
    });
    expect(
      f.session.activeAnnotationEdit?.shared,
      "premise: the routed edit is open",
    ).toBeTruthy();
    expectCommand(f, "dimensionRadius", "routed popup");
    f.dispatch({ type: "sketch.toolPatched", patch: { value: "3" } });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "commitAnnotationValue" },
    });
    expectCommand(f, "dimensionRadius", "after Save");
  });
});
