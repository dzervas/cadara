/**
 * T17c3 (T17-21; T17b0 P-9, T17c review F-B). Logic lane; seam: the
 * authored-action owner (`SketchAuthoredActions`) around the real reducer
 * on an entered session (`createSketchActionOwnerFixture`): the label of
 * the action a completed intent commits. A pick that completes an action is
 * the armed tool's action, labelled by its name (base: the generic
 * "Viewport.selection Requested"); an Offset Create that waited for its
 * preview's certification is "Commit Offset" (base: "Effect.sketch Offset
 * Preview Published").
 */
import { describe, expect, test } from "vitest";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import { getToolById } from "@/core/tools/tool-registry";
import {
  eid,
  entityRef,
  pid,
  pointRef,
  seedDefinition,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  enterSketchSession,
  enterSketchSessionState,
} from "@/domain/editor/sketch-entry.fixtures";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";
import { SketchAuthoredActions } from "./sketch-authored-actions";
import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  EditorEvent,
  SketchEditorState,
} from "@/core/editor/state-machine";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";

const seeded = () =>
  rebuildSessionForDefinition(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    { definition: seedDefinition() },
  );

// Seed: line ab (a → b), circle c (centre c), spline s, arc ar, the
// construction line axis, the point u. (Pierce takes a projected curve and
// goes through the same rule; it has no local pick set here.)
const CONSTRAINT_PICKS: readonly [
  SketchConstraintToolId,
  string,
  (session: SketchSessionState) => PrimitiveRef[],
][] = [
  [
    "constraintCoincident",
    "Coincident",
    (s) => [pointRef(s, pid("a")), pointRef(s, pid("u"))],
  ],
  [
    "constraintCollinear",
    "Collinear",
    (s) => [entityRef(s, eid("ab")), entityRef(s, eid("axis"))],
  ],
  [
    "constraintParallel",
    "Parallel",
    (s) => [entityRef(s, eid("ab")), entityRef(s, eid("axis"))],
  ],
  [
    "constraintPerpendicular",
    "Perpendicular",
    (s) => [entityRef(s, eid("ab")), entityRef(s, eid("axis"))],
  ],
  [
    "constraintTangent",
    "Tangent",
    (s) => [entityRef(s, eid("ab")), entityRef(s, eid("c"))],
  ],
  [
    "constraintEqual",
    "Equal",
    (s) => [entityRef(s, eid("ab")), entityRef(s, eid("axis"))],
  ],
  ["constraintHorizontal", "Horizontal", (s) => [entityRef(s, eid("ab"))]],
  ["constraintVertical", "Vertical", (s) => [entityRef(s, eid("ab"))]],
  [
    "constraintConcentric",
    "Concentric",
    (s) => [entityRef(s, eid("c")), entityRef(s, eid("ar"))],
  ],
  [
    "constraintMidpoint",
    "Midpoint",
    (s) => [pointRef(s, pid("u")), entityRef(s, eid("ab"))],
  ],
  [
    "constraintNormal",
    "Normal",
    (s) => [
      entityRef(s, eid("ab")),
      entityRef(s, eid("c")),
      pointRef(s, pid("u")),
    ],
  ],
  [
    "constraintSymmetric",
    "Symmetric",
    (s) => [
      pointRef(s, pid("a")),
      pointRef(s, pid("b")),
      entityRef(s, eid("axis")),
    ],
  ],
  ["constraintFix", "Fix Geometry", (s) => [pointRef(s, pid("u"))]],
];

describe("T17c3: a completed pick is labelled by its tool", () => {
  test.each(CONSTRAINT_PICKS)(
    "%s: the last pick commits one action labelled with the tool's name (%s)",
    async (toolId, name, picks) => {
      expect(getToolById(toolId).name, "the registry's display name").toBe(
        name,
      );
      const f = await createSketchActionOwnerFixture(seeded());
      const before = f.session.definition.constraints.length;
      f.dispatch({ type: "tool.activated", toolId });
      for (const target of picks(f.session))
        f.dispatch({ type: "viewport.selectionRequested", target });
      expect(
        f.session.definition.constraints.length,
        "premise: the constraint is authored",
      ).toBe(before + 1);
      expect(f.undoLabels()).toEqual([name]);
    },
  );

  test("a Construction pick (the toggle) is one 'Construction' action", async () => {
    const f = await createSketchActionOwnerFixture(seeded());
    f.dispatch({ type: "tool.activated", toolId: "construction" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("ab")),
    });
    expect(
      f.session.definition.entities.find(
        (entity) => entity.entityId === eid("ab"),
      )?.isConstruction,
      "premise: toggled",
    ).toBe(true);
    expect(f.undoLabels()).toEqual(["Construction"]);
  });

  test("review F-4: the SVG Rendering toggle is one 'SVG Rendering' action", async () => {
    const f = await createSketchActionOwnerFixture(seeded());
    f.dispatch({ type: "tool.activated", toolId: "svgRendering" });
    expect(
      f.session.definition.svgRenderingEnabled,
      "premise: toggled on",
    ).toBe(true);
    expect(f.undoLabels()).toEqual(["SVG Rendering"]);
  });

  test("an Offset Create pressed before the preview is certified commits with the publication, as one 'Commit Offset' action", async () => {
    let drawn = startSketchDraw(
      beginSketchTool(
        enterSketchSession(
          createNewSketchSession(
            createStandardPlaneDefinition("xy"),
            OCC_KERNEL_SETTINGS,
          ),
        ),
        "spline",
      ),
      [0, 0],
    );
    for (const point of [
      [1, 0.6],
      [2, -0.4],
    ] as const)
      drawn = acceptSketchDraw(drawn, point);
    const f = await createSketchActionOwnerFixture(
      clearActiveSketchTool(finalizeSketchDraw(drawn)),
    );
    const seed = f.session.definition.entities[0]!;
    f.dispatch({ type: "tool.activated", toolId: "offset" });
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, seed.entityId),
    });
    f.dispatch({ type: "sketch.toolPatched", patch: { value: 0.2 } });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "commitOffset" },
    });
    expect(
      f.session.activeEditTool?.offsetPublication,
      "premise: Create waits for the preview's certification",
    ).toMatchObject({ status: "pending", commitRequested: true });
    expect(f.undoLabels(), "nothing is committed while pending").toEqual([]);
    await f.settle();
    expect(
      f.session.definition.derivedRelationships?.map((entry) => entry.kind),
      "premise: the offset is committed",
    ).toEqual(["offset"]);
    expect(f.undoLabels()).toEqual(["Commit Offset"]);
  }, 60_000);
});

// T17k2 (T17k F-4, review advisory): the labels a user reads in the history
// strip are names, never generated from an intent or an event type (base:
// "Patch Sketch Style", "Commit Sketch Edit Operator", "Make Annotation
// Reference").
describe("T17k2: style, edit-operator and reference actions are named", () => {
  const rectangle = () =>
    clearActiveSketchTool(
      acceptSketchDraw(
        startSketchDraw(
          beginSketchTool(
            enterSketchSession(
              createNewSketchSession(
                createStandardPlaneDefinition("xy"),
                OCC_KERNEL_SETTINGS,
              ),
            ),
            "rectangle",
          ),
          [0, 0],
        ),
        [6, 4],
      ),
    );
  const side = (session: SketchSessionState, name: string) =>
    session.definition.entities.find(
      (entity) => entity.label === `Rectangle 1 ${name}`,
    )!.target;

  test("a Stroke panel change is one 'Stroke' action", async () => {
    const f = await createSketchActionOwnerFixture(seeded());
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("ab")),
    });
    f.dispatch({ type: "tool.activated", toolId: "stroke" });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "patchSketchStyle",
        field: "strokeEnabled",
        value: true,
      },
    });
    expect(
      f.session.definition.entities.find(
        (entity) => entity.entityId === eid("ab"),
      )?.style,
      "premise: the style is authored",
    ).toMatchObject({ strokeEnabled: true });
    expect(f.undoLabels()).toEqual(["Stroke"]);
  });

  test.each([
    ["sketchFillet", "Sketch Fillet"],
    ["sketchChamfer", "Sketch Chamfer"],
  ] as const)(
    "%s: the confirmed operator is one action named by its tool (%s)",
    async (toolId, name) => {
      const f = await createSketchActionOwnerFixture(rectangle());
      const entities = f.session.definition.entities.length;
      f.dispatch({ type: "tool.activated", toolId });
      for (const target of [
        side(f.session, "bottom"),
        side(f.session, "right"),
      ])
        f.dispatch({ type: "viewport.selectionRequested", target });
      f.dispatch({ type: "sketch.toolPatched", patch: { value: 1 } });
      f.dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "commitSketchEditOperator" },
      });
      expect(
        f.session.definition.entities.length,
        "premise: the corner is replaced",
      ).toBeGreaterThan(entities);
      expect(f.undoLabels()).toEqual([name]);
    },
  );

  test("the dimension popup's Make reference is one 'Make Reference' action", async () => {
    let session = rectangle();
    session = patchSketchConstraintValue(
      pinSketchConstraintPreview(
        selectSketchConstraintTarget(
          beginSketchTool(session, "dimensionDistance"),
          side(session, "bottom"),
        ),
        [3, -1],
      ),
      { intent: "commitConstraintValue" },
    );
    const f = await createSketchActionOwnerFixture(
      clearActiveSketchTool(session),
    );
    const dimension = f.session.definition.dimensions[0]!;
    f.dispatch({
      type: "sketch.annotationEditRequested",
      target: {
        kind: "dimension",
        sketchId: f.session.actionContextId,
        dimensionId: dimension.dimensionId,
      } as Extract<PrimitiveRef, { kind: "dimension" }>,
    });
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "makeAnnotationReference" },
    });
    expect(
      isReferenceDimension(f.session.definition.dimensions[0]!),
      "premise: the dimension is now a reference",
    ).toBe(true);
    expect(f.undoLabels()).toEqual(["Make Reference"]);
  });
});

// T17k2 review RQ-3. "Import Image" through the real reducer (the picked
// images join the private draft: one action, nothing published); the
// special-mode events and the last fallback through the owner seam with a
// stub reducer that authors one point (the owner labels whatever event
// changed the authored state; base: "Special Mode Click Requested", …,
// "Effect.sketch Special Mode Effect Completed", or the event type).
describe("T17k2 review: Import Image, special-mode actions and the fallback are named", () => {
  test("picked reference images are one private 'Import Image' action; Undo removes them", async () => {
    const f = await createSketchActionOwnerFixture(seeded());
    const images = f.session.definition.referenceImages?.length ?? 0;
    f.dispatch({
      type: "sketch.referenceImagePayloadsPicked",
      payloads: [
        {
          mediaType: "image/png",
          fileName: "reference.png",
          pixelWidth: 4,
          pixelHeight: 2,
          base64Data: "cG5n",
        },
      ],
    });
    expect(
      f.session.definition.referenceImages?.length,
      "premise: the image joins the draft",
    ).toBe(images + 1);
    expect(f.undoLabels()).toEqual(["Import Image"]);
    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition.referenceImages?.length ?? 0).toBe(images);
  });

  test.each([
    [
      { type: "sketch.specialModeClickRequested", point: [0, 0], target: null },
      "Edit Sketch Operation",
    ],
    [
      {
        type: "sketch.specialModeDoubleClickRequested",
        point: [0, 0],
        target: null,
      },
      "Edit Sketch Operation",
    ],
    [
      {
        type: "sketch.specialModePanelActionInvoked",
        action: { kind: "invoke", actionId: "fixture" },
      },
      "Edit Sketch Operation",
    ],
    [
      {
        type: "effect.sketchSpecialModeEffectCompleted",
        requestId: "request_fixture",
        documentId: "doc_workspace",
        commandSessionId: "command_fixture",
        baseRevisionId: "rev_fixture",
        effectId: "fixture",
        payload: {},
      },
      "Edit Sketch Operation",
    ],
    [{ type: "sketch.connectedSelectionRequested" }, "Edit Sketch"],
  ] as unknown as [EditorEvent, string][])(
    "%o authoring the sketch is labelled %s",
    async (event, label) => {
      const owner = new SketchAuthoredActions();
      const snapshot = await createSeedDocumentSnapshot();
      const entered = {
        ...enterSketchSessionState(seeded(), {
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
        }),
        snapshot,
      };
      const opened = owner.transition(
        entered,
        { type: "selection.cleared" },
        (state) => ({ state, effects: [] }),
      ).state as SketchEditorState;
      const authored = owner.transition(opened, event, (state) => {
        const sketch = state as SketchEditorState;
        const point = {
          ...sketch.session.definition.points[0]!,
          pointId: "sketch_point_t17k2_stub" as SketchPointId,
          label: "stub",
        };
        const definition = {
          ...sketch.session.definition,
          points: [...sketch.session.definition.points, point],
          pointIds: [...sketch.session.definition.pointIds, point.pointId],
        };
        return {
          state: {
            ...sketch,
            session: { ...sketch.session, definition },
          },
          effects: [],
        };
      }).state as SketchEditorState;
      expect(
        authored.session.actionHistory?.undo.map((entry) => entry.label),
      ).toEqual([label]);
    },
  );
});
