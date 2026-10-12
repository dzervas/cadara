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
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

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
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
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
