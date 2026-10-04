import { describe, expect, test } from "vitest";
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
  apply({ type: "selection.cleared" });
  return {
    owner,
    apply,
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
  const drag = {
    target: f.session.definition.points[0]!.target,
    startPoint: [0, 0] as const,
    currentPoint: [3, 4] as const,
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
  f.apply(
    { type: "selection.cleared" },
    {
      ...mutations.drag(f.session),
      activeDrag: {
        target: f.session.definition.points[0]!.target,
        startPoint: [0, 0],
        currentPoint: [3, 4],
        status: "dragging",
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
