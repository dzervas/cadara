import { describe, expect, test } from "vitest";

import type { DimensionId, SketchEntityId } from "@/contracts/shared/ids";
import type { SketchDimensionRef } from "@/contracts/shared/references";
import type { DimensionDefinition } from "@/contracts/sketch/schema";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import {
  eid,
  entityRef,
  mirroredSession,
  pid,
} from "@/domain/editor/sketch-mirror.fixtures";
import { getSketchSessionInvalidFeedback } from "./session-feedback";
import { rebuildSessionForDefinition } from "./definition-authoring";
import {
  beginSketchAnnotationEdit,
  beginSketchTool,
  getSketchAnnotationDescriptors,
  isSketchAnnotationInContext,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { commitSketchAnnotationEditValue } from "./annotation-editing";
import { getEscapeEvent } from "@/domain/editor/workbench-interactions";

// T16f, logic lane, seam: the sketch session (live solve, invalid feedback,
// Dimension tool, annotation edit, annotation descriptors and context) on
// the shared mirror fixture: seeds above y = 0 mirrored about a
// construction line by "mirror 1".

const SHARED_READOUT = "Shared with Radius 2 through mirror ‘mirror 1’";
const REFUSAL =
  "Already driven by Radius 2 (mirror ‘mirror 1’); edit that dimension instead.";

const radius = (
  dimensionId: string,
  entityId: string,
  value: number,
  label: string,
  reference = false,
): DimensionDefinition =>
  ({
    dimensionId: dimensionId as DimensionId,
    kind: "circleRadius",
    label,
    entityId,
    value: { source: "literal", value },
    ...(reference ? { reference: true } : {}),
  }) as DimensionDefinition;

function withDimensions(
  session: SketchSessionState,
  dimensions: readonly DimensionDefinition[],
) {
  return rebuildSessionForDefinition(session, {
    definition: {
      ...session.definition,
      dimensionIds: dimensions.map((entry) => entry.dimensionId),
      dimensions: [...dimensions],
    },
  });
}

function solvedRadius(session: SketchSessionState, entityId: string) {
  const entity = session.liveSolve!.solvedSnapshot.solvedEntities.find(
    (entry) => entry.entityId === entityId,
  ) as { solvedRadius?: number } | undefined;
  return entity?.solvedRadius;
}

const dimensionRef = (session: SketchSessionState, dimensionId: string) =>
  ({
    kind: "dimension",
    sketchId: session.sketchId ?? "sketch_draft",
    dimensionId,
  }) as SketchDimensionRef;

/** The mirrored fixture with a driving radius 2 on the seed circle `c`. */
function seededDriver() {
  const setup = mirroredSession("free");
  const copy = setup.outputOf("c").outputEntityId;
  const session = withDimensions(setup.session, [
    radius("dimension_seed", eid("c"), 2, "Radius 2"),
  ]);
  return { ...setup, session, copy };
}

/** The mirror's line deleted (its relationship stays, broken). */
function withoutAxis(session: SketchSessionState) {
  return rebuildSessionForDefinition(session, {
    definition: {
      ...session.definition,
      entityIds: session.definition.entityIds.filter(
        (id) => id !== eid("axis"),
      ),
      entities: session.definition.entities.filter(
        (entity) => entity.entityId !== eid("axis"),
      ),
    },
  });
}

/** The mirror's line collapsed onto one point: every record intact, the mirror failed. */
function withShortAxis(session: SketchSessionState) {
  const start = session.definition.points.find(
    (point) => point.pointId === pid("x0"),
  )!.position;
  return rebuildSessionForDefinition(session, {
    definition: {
      ...session.definition,
      points: session.definition.points.map((point) =>
        point.pointId === pid("x1") ? { ...point, position: start } : point,
      ),
    },
  });
}

/** The Dimension tool picks `entityId` and opens its value input. */
function pickAndPlace(
  session: SketchSessionState,
  entityId: SketchEntityId,
  toolId: SketchConstraintToolId = "dimensionRadius",
) {
  return pinSketchConstraintPreview(
    selectSketchConstraintTarget(
      beginSketchTool(session, toolId),
      entityRef(session, entityId),
    ),
    [6, 6],
  );
}

const patch = (session: SketchSessionState, value: Record<string, unknown>) =>
  patchSketchConstraintValue(session, value);

// Review A-12 / plan B1: persisted duplicates (a driving radius on the seed
// and one on its copy, as a T15-era document or a peer merge leaves them)
// stay ordinary solve rows on constructed definitions.
describe("T16f 12a/12b: persisted seed + copy driving radii (constructed definitions)", () => {
  test("12a: equal values solve; both driving; both radii 2", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const next = withDimensions(session, [
      radius("dimension_seed", eid("c"), 2, "Radius 2"),
      radius("dimension_copy", copy, 2, "Radius 3"),
    ]);
    const snapshot = next.liveSolve!.solvedSnapshot;
    expect(snapshot.status).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(snapshot.dimensionStatuses.map((entry) => entry.status)).toEqual([
      "driving",
      "driving",
    ]);
    expect(solvedRadius(next, eid("c"))).toBeCloseTo(2, 9);
    expect(solvedRadius(next, copy)).toBeCloseTo(2, 9);
    expect(next.liveSolve!.accepted).toBe(true);
    expect(getSketchSessionInvalidFeedback(next)).toBeNull();
  });

  test("12b: unequal values are a retained conflict; both unsatisfied; compromise radius; explained by the mirror", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const next = withDimensions(session, [
      radius("dimension_seed", eid("c"), 2, "Radius 2"),
      radius("dimension_copy", copy, 3, "Radius 3"),
    ]);
    const snapshot = next.liveSolve!.solvedSnapshot;
    expect(snapshot.status.solveState).toBe("partiallySolved");
    expect(snapshot.dimensionStatuses.map((entry) => entry.status)).toEqual([
      "unsatisfied",
      "unsatisfied",
    ]);
    expect(solvedRadius(next, eid("c"))).toBeCloseTo(2.5, 5);
    expect(solvedRadius(next, copy)).toBeCloseTo(2.5, 5);
    expect(next.liveRegions.status).toBe("unavailable");
    // T16f ([TECH] T16-13): was "Radius 2 (2 mm), Radius 3 (3 mm) conflict.
    // The sketch is invalid; … Change or delete one of them, or Undo."
    expect(getSketchSessionInvalidFeedback(next)).toBe(
      "Radius 2 (2 mm) and Radius 3 (3 mm) size the same mirrored shape (mirror ‘mirror 1’), so they conflict. The sketch is invalid; profiles from it are blocked. Change or delete one, make one a reference, or Undo.",
    );
  });
});

describe("T16f: the Dimension tool on a mirror copy edits the shared driver", () => {
  test("picking the copy opens the seed's driving radius: prefilled, its own kind, explained; nothing authored", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace(session, copy);
    expect(opened.activeAnnotationEdit?.target).toEqual(
      dimensionRef(session, "dimension_seed"),
    );
    expect(opened.constraintAuthoring, "no new dimension is pending").toBe(
      null,
    );
    expect(opened.definition).toBe(session.definition);
    const input = opened.toolPresentation!.floatingInput!;
    expect(input.label).toBe("Radius");
    expect(input.value).toBe("2");
    expect(input.readout).toBe(SHARED_READOUT);
    expect(input.readOnly).toBeUndefined();
    expect(input.confirmLabel).toBe("Save");
    expect(input.secondaryAction, "no Make reference of the driver").toBe(
      undefined,
    );
    expect(input.modeSwitch).toEqual({
      label: "Add as reference instead",
      checked: false,
      action: {
        type: "patch",
        patch: { intent: "setSharedDimensionReference", reference: true },
      },
    });
  });

  test("Diameter (the Distance tool on a circle) routes to the seed's Radius, shown as Radius", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace(session, copy, "dimensionDistance");
    expect(opened.activeAnnotationEdit?.target).toEqual(
      dimensionRef(session, "dimension_seed"),
    );
    expect(opened.toolPresentation!.floatingInput!.label).toBe("Radius");
    expect(opened.toolPresentation!.floatingInput!.value).toBe("2");
  });

  test("the placement click path (setConstraintAnnotationPlacement) routes the same way", () => {
    const { session, copy } = seededDriver();
    const picked = selectSketchConstraintTarget(
      beginSketchTool(session, "dimensionRadius"),
      entityRef(session, copy),
    );
    const opened = patch(picked, {
      intent: "setConstraintAnnotationPlacement",
      point: [6, 6],
    });
    expect(opened.activeAnnotationEdit?.target).toEqual(
      dimensionRef(session, "dimension_seed"),
    );
  });

  test("commit edits only the driver (both circles follow); the Dimension tool stays armed", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace(session, copy);
    const committed = patch(patch(opened, { value: "3" }), {
      intent: "commitAnnotationValue",
    });
    expect(committed.definition.dimensions).toEqual([
      {
        ...session.definition.dimensions[0],
        value: { source: "literal", value: 3 },
      },
    ]);
    expect(solvedRadius(committed, eid("c"))).toBeCloseTo(3, 9);
    expect(solvedRadius(committed, copy)).toBeCloseTo(3, 9);
    expect(committed.activeAnnotationEdit).toBe(null);
    expect(committed.activeTool, "issue 04: the tool stays armed").toBe(
      "dimensionRadius",
    );
    expect(committed.constraintAuthoring).toMatchObject({
      toolId: "dimensionRadius",
      selectedTargets: [],
    });
    expect(committed.status).toBe("collectingTargets");
  });

  test("review R-3: clicking an annotation (the driver's own label) during the routed popup keeps the tool armed", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace(session, copy);
    const clicked = selectSketchAnnotation(opened);
    expect(clicked.activeAnnotationEdit).toBe(null);
    expect(clicked.definition).toBe(session.definition);
    expect(clicked.activeTool).toBe("dimensionRadius");
    expect(clicked.constraintAuthoring).toMatchObject({
      toolId: "dimensionRadius",
      selectedTargets: [],
    });
    // Control: an ordinary annotation edit stays a plain drop.
    const plain = selectSketchAnnotation(
      beginSketchAnnotationEdit(
        session,
        dimensionRef(session, "dimension_seed"),
      ),
    );
    expect(plain.activeTool).toBe(null);
    expect(plain.activeAnnotationEdit).toBe(null);
  });

  test("review R-4: a routed Save into a conflict keeps the mirror conflict text with the tool armed", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const duplicates = withDimensions(session, [
      radius("dimension_seed", eid("c"), 2, "Radius 2"),
      radius("dimension_copy", copy, 2, "Radius 3"),
    ]);
    const opened = pickAndPlace(duplicates, copy);
    expect(opened.activeAnnotationEdit?.target).toEqual(
      dimensionRef(duplicates, "dimension_seed"),
    );
    const committed = patch(patch(opened, { value: "3" }), {
      intent: "commitAnnotationValue",
    });
    expect(committed.activeTool).toBe("dimensionRadius");
    expect(committed.validationMessage).toBe(
      "Radius 2 (3 mm) and Radius 3 (2 mm) size the same mirrored shape (mirror ‘mirror 1’), so they conflict. The sketch is invalid; profiles from it are blocked. Change or delete one, make one a reference, or Undo.",
    );
  });

  test("cancel (and Escape) changes nothing and keeps the tool armed", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace(session, copy);
    const escape = getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: [],
      sketchSession: opened,
    });
    expect(escape).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "cancelAnnotationValue" },
    });
    const cancelled = patch(opened, { intent: "cancelAnnotationValue" });
    expect(cancelled.definition).toBe(session.definition);
    expect(cancelled.activeAnnotationEdit).toBe(null);
    expect(cancelled.activeTool).toBe("dimensionRadius");
    expect(cancelled.constraintAuthoring?.selectedTargets).toEqual([]);
  });

  test("“Add as reference instead” commits a reference on the copy; the driver is untouched; the tool stays armed", () => {
    const { session, copy } = seededDriver();
    const switched = patch(pickAndPlace(session, copy), {
      intent: "setSharedDimensionReference",
      reference: true,
    });
    const input = switched.toolPresentation!.floatingInput!;
    expect(input.label).toBe("Radius (reference)");
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("2");
    expect(input.confirmLabel).toBe("Add reference");
    expect(input.modeSwitch?.checked).toBe(true);
    expect(input.submitAction).toEqual({
      type: "patch",
      patch: { intent: "commitConstraintValue" },
    });
    expect(patch(switched, { value: "7" }), "read-only").toBe(switched);
    const committed = patch(switched, { intent: "commitConstraintValue" });
    expect(committed.definition.dimensions).toHaveLength(2);
    expect(committed.definition.dimensions[0]).toEqual(
      session.definition.dimensions[0],
    );
    expect(committed.definition.dimensions[1]).toMatchObject({
      kind: "circleRadius",
      entityId: copy,
      reference: true,
    });
    expect(
      committed.liveSolve!.solvedSnapshot.dimensionStatuses.map(
        (entry) => entry.status,
      ),
    ).toEqual(["driving", "driven"]);
    expect(committed.activeTool).toBe("dimensionRadius");
    expect(committed.activeAnnotationEdit).toBe(null);
    // Switching back restores the driver's edit.
    const back = patch(switched, {
      intent: "setSharedDimensionReference",
      reference: false,
    });
    expect(back.toolPresentation!.floatingInput!.label).toBe("Radius");
    expect(back.toolPresentation!.floatingInput!.readOnly).toBeUndefined();
  });

  test("control: a copy-only dimension (no driver) is authored on the copy as today and drives both", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const opened = pickAndPlace(session, copy);
    expect(opened.activeAnnotationEdit).toBe(null);
    expect(opened.constraintAuthoring?.isPreviewPinned).toBe(true);
    expect(opened.constraintAuthoring?.redundancy).toBe("independent");
    const committed = patch(patch(opened, { value: "3" }), {
      intent: "commitConstraintValue",
    });
    expect(committed.definition.dimensions).toEqual([
      expect.objectContaining({ kind: "circleRadius", entityId: copy }),
    ]);
    expect(solvedRadius(committed, eid("c"))).toBeCloseTo(3, 9);
    expect(solvedRadius(committed, copy)).toBeCloseTo(3, 9);
  });

  test("a reference on the seed is never the driver: the copy pick authors as today", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const next = withDimensions(session, [
      radius("dimension_seed_reference", eid("c"), 1, "Radius 2", true),
    ]);
    const opened = pickAndPlace(next, copy);
    expect(opened.activeAnnotationEdit).toBe(null);
    expect(opened.constraintAuthoring?.isPreviewPinned).toBe(true);
  });

  test.each([
    ["its line deleted", withoutAxis],
    [
      "its line shorter than τ (records intact: only the live solve's health says so)",
      withShortAxis,
    ],
  ])("a broken mirror (%s) does not route", (_, breakMirror) => {
    const { session, copy } = seededDriver();
    const broken = breakMirror(session);
    expect(
      broken.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise",
    ).toEqual([session.definition.derivedRelationships![0]!.derivationId]);
    const opened = pickAndPlace(broken, copy);
    expect(opened.activeAnnotationEdit).toBe(null);
    expect(opened.constraintAuthoring?.isPreviewPinned).toBe(true);
  });

  test("no live solve (health unknown) does not route", () => {
    const { session, copy } = seededDriver();
    const opened = pickAndPlace({ ...session, liveSolve: null }, copy);
    expect(opened.activeAnnotationEdit).toBe(null);
    expect(opened.constraintAuthoring?.isPreviewPinned).toBe(true);
  });
});

describe("T16f: no commit authors a second driver of a mirrored quantity", () => {
  function copyReference() {
    const { session, copy } = seededDriver();
    const next = withDimensions(session, [
      ...session.definition.dimensions,
      radius("dimension_copy_reference", copy, 2, "Radius 3", true),
    ]);
    return { session: next, copy };
  }

  test("O6: Make driving of a mirrored reference refuses and offers explicit driver replacement", () => {
    const { session } = copyReference();
    const editing = beginSketchAnnotationEdit(
      session,
      dimensionRef(session, "dimension_copy_reference"),
    );
    const refused = commitSketchAnnotationEditValue(editing, {
      ...editing.activeAnnotationEdit!,
      pendingValue: { source: "literal", value: 2 },
    });
    expect(refused.definition).toBe(session.definition);
    expect(refused.activeAnnotationEdit?.target).toEqual(
      dimensionRef(session, "dimension_copy_reference"),
    );
    expect(refused.toolPresentation?.validation?.[0]?.message).toContain("Radius 2");
    const offer = refused.toolPresentation!.floatingInput!.secondaryAction!;
    expect(offer.label).toBe("Make those references");
    const replaced = patch(refused, offer.action.patch);
    expect(
      replaced.definition.dimensions.find(
        (d) => d.dimensionId === "dimension_seed",
      ),
    ).toHaveProperty("reference", true);
    expect(
      replaced.definition.dimensions.find(
        (d) => d.dimensionId === "dimension_copy_reference",
      ),
    ).not.toHaveProperty("reference");
    expect(replaced.liveSolve?.accepted).toBe(true);
  });

  test("Fix on the copy circle (it authors a diameter) is refused and opens the driver's edit; the tool stays armed after", () => {
    const { session, copy } = seededDriver();
    const refused = selectSketchConstraintTarget(
      beginSketchTool(session, "constraintFix"),
      entityRef(session, copy),
    );
    expect(refused.definition).toBe(session.definition);
    expect(refused.activeAnnotationEdit?.target).toEqual(
      dimensionRef(session, "dimension_seed"),
    );
    expect(refused.toolPresentation?.validation?.[0]?.message).toBe(REFUSAL);
    // Review R-2: Fix has no value of its own, so no "Add as reference
    // instead" (it would commit a driving Fix of the centre).
    const input = refused.toolPresentation!.floatingInput!;
    expect(input.modeSwitch).toBeUndefined();
    expect(input.label).toBe("Radius");
    expect(input.readout).toBe(SHARED_READOUT);
    expect(
      patch(refused, {
        intent: "setSharedDimensionReference",
        reference: true,
      }),
      "the switch intent does nothing",
    ).toBe(refused);
    const cancelled = patch(refused, { intent: "cancelAnnotationValue" });
    expect(cancelled.activeTool).toBe("constraintFix");
    expect(cancelled.definition).toBe(session.definition);
    // Save edits the driver only (no Fix constraint is authored).
    const saved = patch(patch(refused, { value: "3" }), {
      intent: "commitAnnotationValue",
    });
    expect(saved.definition.constraints).toEqual(
      session.definition.constraints,
    );
    expect(saved.definition.dimensions).toEqual([
      {
        ...session.definition.dimensions[0],
        value: { source: "literal", value: 3 },
      },
    ]);
    expect(saved.activeTool).toBe("constraintFix");
  });

  test("control: Make driving of a reference with no driver still commits (T13d)", () => {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    const next = withDimensions(session, [
      radius("dimension_copy_reference", copy, 2, "Radius 3", true),
    ]);
    const committed = patch(
      beginSketchAnnotationEdit(
        next,
        dimensionRef(next, "dimension_copy_reference"),
      ),
      { intent: "commitAnnotationValue" },
    );
    expect(committed.definition.dimensions[0]).not.toHaveProperty("reference");
  });
});

describe("T16f: persisted duplicates are explained, never changed", () => {
  function duplicates(copyValue: number) {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("c").outputEntityId;
    return withDimensions(session, [
      radius("dimension_seed", eid("c"), 2, "Radius 2"),
      radius("dimension_copy", copy, copyValue, "Radius 3"),
    ]);
  }

  test("either popup says what else sizes the shape; editing one edits only that record", () => {
    const session = duplicates(2);
    const seedEdit = beginSketchAnnotationEdit(
      session,
      dimensionRef(session, "dimension_seed"),
    );
    expect(seedEdit.toolPresentation!.floatingInput!.readout).toBe(
      "Also sized by Radius 3 through mirror ‘mirror 1’; both must match",
    );
    expect(
      seedEdit.toolPresentation!.floatingInput!.modeSwitch?.action.patch,
      "Make reference stays offered by the mode switch",
    ).toEqual({ intent: "makeAnnotationReference" });
    const copyEdit = beginSketchAnnotationEdit(
      session,
      dimensionRef(session, "dimension_copy"),
    );
    expect(copyEdit.toolPresentation!.floatingInput!.readout).toBe(
      "Also sized by Radius 2 through mirror ‘mirror 1’; both must match",
    );
    const edited = patch(patch(copyEdit, { value: "4" }), {
      intent: "commitAnnotationValue",
    });
    expect(edited.definition.dimensions[0]).toEqual(
      session.definition.dimensions[0],
    );
    expect(edited.definition.dimensions[1]).toMatchObject({
      dimensionId: "dimension_copy",
      value: { source: "literal", value: 4 },
    });
    expect(edited.validationMessage).toBe(
      "Radius 3 (4 mm) and Radius 2 (2 mm) size the same mirrored shape (mirror ‘mirror 1’), so they conflict. The sketch is invalid; profiles from it are blocked. Change or delete one, make one a reference, or Undo.",
    );
  });

  test.each([
    ["its line deleted", withoutAxis],
    ["its line shorter than τ", withShortAxis],
  ])(
    "a broken mirror (%s) explains neither (no shared readout, no mirror conflict text)",
    (_, breakMirror) => {
      const broken = breakMirror(duplicates(3));
      const edit = beginSketchAnnotationEdit(
        broken,
        dimensionRef(broken, "dimension_seed"),
      );
      expect(edit.toolPresentation!.floatingInput!.readout).toBeUndefined();
      expect(getSketchSessionInvalidFeedback(broken)).not.toContain(
        "size the same mirrored shape",
      );
    },
  );
});

describe("T16f: linked highlights and context through healthy mirrors", () => {
  const keys = (refs: readonly PrimitiveRef[] | undefined) =>
    (refs ?? []).map(getPrimitiveRefKey);

  test("a dimension on a mirror participant links its counterparts; health-gated", () => {
    const { session, copy } = seededDriver();
    const descriptor = (from: SketchSessionState) =>
      getSketchAnnotationDescriptors(from).find(
        (entry) => entry.id === "dimension_seed",
      )!;
    expect(keys(descriptor(session).affectedGeometryRefs)).toEqual(
      keys([entityRef(session, eid("c"))]),
    );
    expect(keys(descriptor(session).linkedGeometryRefs)).toEqual(
      keys([entityRef(session, copy)]),
    );
    expect(
      descriptor({ ...session, liveSolve: null }).linkedGeometryRefs,
      "no live solve: health unknown",
    ).toBeUndefined();
    const broken = {
      ...session,
      liveSolve: {
        ...session.liveSolve!,
        solvedSnapshot: {
          ...session.liveSolve!.solvedSnapshot,
          failedDerivationIds: [
            session.definition.derivedRelationships![0]!.derivationId,
          ],
        },
      },
    };
    expect(descriptor(broken).linkedGeometryRefs).toBeUndefined();
  });

  test("selecting the copy brings the seed's dimension into context", () => {
    const { session, copy } = seededDriver();
    const target = dimensionRef(session, "dimension_seed");
    expect(
      isSketchAnnotationInContext(session, target, [entityRef(session, copy)]),
    ).toBe(true);
    expect(
      isSketchAnnotationInContext(session, target, [
        entityRef(session, eid("ab")),
      ]),
      "control: unrelated geometry",
    ).toBe(false);
    expect(
      isSketchAnnotationInContext({ ...session, liveSolve: null }, target, [
        entityRef(session, copy),
      ]),
    ).toBe(false);
  });
});
