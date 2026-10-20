// T13c (logic lane, sketch-session constraint/dimension authoring seam):
// measured prefill (D5), retained conflicting edits (D6), the conflict
// explanation and its solver diagnostic targets (D7), the local Tangent tool
// and duplicate refusal (D8). Every row runs in a multi-entity sketch.
import { expect, test } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSession,
  clearActiveSketchTool,
  finishSketchGeometryDrag,
  getSketchAnnotationDescriptors,
  patchSketchConstraintValue,
  patchSketchEditToolValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchConstraintHover,
  updateSketchGeometryDrag,
  updateSketchPointer,
  withLiveSolveBasis,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createPlacedPointDimensionLine } from "@/domain/editor/sketch-session/annotations";
import { updateSketchReferenceProjection } from "@/domain/editor/sketch-session/references";
import { createSketchSessionFromSnapshot } from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";

function newSession() {
  return withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
}

function draw(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly SketchPoint[],
) {
  let next = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return beginSketchTool(next, "line");
}

/** A rectangle [1,1]–[5,4] and a circle (centre [12,1], r 2.5) far apart. */
function rectangleAndCircle() {
  let session = draw(newSession(), "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  session = draw(session, "circle", [
    [12, 1],
    [14.5, 1],
  ]);
  expect(session.definition.dimensions, "premise: no sizes").toEqual([]);
  expect(session.liveSolve?.accepted, "premise: solved").toBe(true);
  return session;
}

function entity(session: SketchSessionState, label: string) {
  const found = session.definition.entities.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`No entity ${label}`);
  return found;
}

function circleTarget(session: SketchSessionState) {
  return session.definition.entities.find(
    (candidate) => candidate.kind === "circle",
  )!.target;
}

/** Selects the targets and places (pins) the annotation: the value input opens. */
function openDimensionInput(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  targets: readonly PrimitiveRef[],
  placement: SketchPoint,
) {
  let next = beginSketchTool(session, toolId);
  for (const target of targets)
    next = selectSketchConstraintTarget(next, target);
  return pinSketchConstraintPreview(next, placement);
}

function prefilledValue(session: SketchSessionState) {
  const input = session.toolPresentation?.floatingInput;
  expect(input, "the value input is open").toBeTruthy();
  return Number(input!.value);
}

function commitValue(session: SketchSessionState) {
  return patchSketchConstraintValue(session, {
    intent: "commitConstraintValue",
  });
}

function positions(session: SketchSessionState) {
  return Object.fromEntries(
    session.definition.points.map((point) => [point.pointId, point.position]),
  );
}

function circleRadius(session: SketchSessionState) {
  const circle = session.definition.entities.find(
    (candidate) => candidate.kind === "circle",
  );
  return circle?.kind === "circle" ? circle.radius : NaN;
}

function unsatisfiedIds(session: SketchSessionState) {
  const snapshot = session.liveSolve!.solvedSnapshot;
  return [
    ...snapshot.constraintStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.constraintId] : [],
    ),
    ...snapshot.dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.dimensionId] : [],
    ),
  ].sort();
}

function requirementLabel(session: SketchSessionState, id: string) {
  return [
    ...session.definition.constraints.map((c) => [c.constraintId, c.label]),
    ...session.definition.dimensions.map((d) => [d.dimensionId, d.label]),
  ].find(([candidate]) => candidate === id)![1]!;
}

/** D7: the message names exactly the unsatisfied requirements, subject first. */
function expectConflictExplanation(
  session: SketchSessionState,
  subjectId: string,
) {
  const unsatisfied = unsatisfiedIds(session);
  expect(unsatisfied, "the subject is unsatisfied").toContain(subjectId);
  expect(unsatisfied.length, "a conflict involves others").toBeGreaterThan(1);
  const message = session.validationMessage ?? "";
  const named = [
    ...session.definition.constraints.map((c) => [c.constraintId, c.label]),
    ...session.definition.dimensions.map((d) => [d.dimensionId, d.label]),
  ]
    .filter(([, label]) => new RegExp(`\\b${label}\\b`).test(message))
    .map(([id]) => id!)
    .sort();
  expect(named, "the message names exactly the unsatisfied set").toEqual(
    unsatisfied,
  );
  expect(message.startsWith(requirementLabel(session, subjectId))).toBe(true);
  expect(message).toContain(" conflicts with ");
  expect(message).toContain(
    "The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
  const targets = session
    .liveSolve!.solvedSnapshot.diagnostics.filter(
      (diagnostic) => diagnostic.code === "solver-requirement-unsatisfied",
    )
    .map((diagnostic) =>
      diagnostic.target?.kind === "constraint"
        ? diagnostic.target.constraintId
        : diagnostic.target?.kind === "dimension"
          ? diagnostic.target.dimensionId
          : null,
    )
    .sort();
  expect(
    targets,
    "the solver diagnostic targets each unsatisfied requirement",
  ).toEqual(unsatisfied);
}

// O2: pinning opens the value box; hover must no longer retarget its preview.
test.each(["pin", "placement patch"])(
  "O2: %s freezes the dimension preview until cancellation",
  (placement) => {
    const session = rectangleAndCircle();
    const circle = circleTarget(session);
    const side = entity(session, "Rectangle 1 bottom").target;
    let next = selectSketchConstraintTarget(
      beginSketchTool(session, "dimensionDistance"),
      circle,
    );
    next = placement === "pin"
      ? pinSketchConstraintPreview(next, [15, 3])
      : patchSketchConstraintValue(next, {
          intent: "setConstraintAnnotationPlacement", point: [15, 3],
        });
    expect(next.toolPresentation?.floatingInput?.label).toBe("Diameter");
    const opened = next;
    for (const target of [side, null, circle]) {
      next = updateSketchConstraintHover(next, target);
      next = updateSketchPointer(next, [4, 6]);
      next = selectSketchConstraintTarget(next, side);
      expect(next.constraintAuthoring).toEqual(opened.constraintAuthoring);
      expect(next.toolPresentation).toEqual(opened.toolPresentation);
    }
    const cancelled = patchSketchConstraintValue(next, {
      intent: "cancelConstraintValue",
    });
    expect(cancelled.toolPresentation?.floatingInput).toBeNull();
    const picked = selectSketchConstraintTarget(cancelled, side);
    expect(picked.constraintAuthoring?.selectedTargets.map((entry) => entry.target))
      .toEqual([side]);
    expect(picked.toolPresentation?.overlays).not.toEqual(opened.toolPresentation?.overlays);
  },
);

// O3/D2: committing a dimension starts another pick cycle, not Select.
test.each(["dimensionDistance", "dimensionRadius"] as const)(
  "O3/D2: %s stays armed and authors the next dimension without reactivation",
  (toolId) => {
    const session = draw(rectangleAndCircle(), "circle", [[22, 1], [24, 1]]);
    const circles = session.definition.entities.filter((entry) => entry.kind === "circle");
    let next = openDimensionInput(session, toolId, [circles[0]!.target], [15, 3]);
    next = patchSketchConstraintValue(next, { value: "6" });
    next = commitValue(next);
    expect(next.definition.dimensions).toHaveLength(1);
    const firstDimension = next.definition.dimensions[0];
    expect(next.activeTool).toBe(toolId);
    expect(next.status).toBe("collectingTargets");
    expect(next.constraintAuthoring?.selectedTargets).toEqual([]);
    expect(next.constraintAuthoring?.isPreviewPinned).toBe(false);
    expect(next.toolPresentation?.floatingInput).toBeNull();
    next = selectSketchConstraintTarget(next, circles[1]!.target);
    next = pinSketchConstraintPreview(next, [25, 3]);
    expect(next.toolPresentation?.floatingInput?.label)
      .toBe(toolId === "dimensionRadius" ? "Radius" : "Diameter");
    next = patchSketchConstraintValue(next, { value: "8" });
    next = commitValue(next);
    expect(next.definition.dimensions).toHaveLength(2);
    expect(next.definition.dimensions[0]).toEqual(firstDimension);
    expect(next.definition.dimensions[1]).toMatchObject({
      kind: toolId === "dimensionRadius" ? "circleRadius" : "diameter",
      entityId: circles[1]!.entityId,
      value: createLiteralAuthoredValue(8),
    });
    expect(next.liveSolve?.accepted).toBe(true);
    expect(next.activeTool).toBe(toolId);
    expect(next.constraintAuthoring?.selectedTargets).toEqual([]);
    // Escape from the fresh pick cycle returns to Select as before.
    const cleared = clearActiveSketchTool(next);
    expect(cleared.activeTool).toBeNull();
    expect(cleared.constraintAuthoring).toBeNull();
  },
);

// --- D5: measured prefill -------------------------------------------------

test("T13c D5: Dimension on a rectangle side, a circle and the Radius variant opens prefilled with the measured value", () => {
  const session = rectangleAndCircle();
  const bottom = entity(session, "Rectangle 1 bottom").target;
  const right = entity(session, "Rectangle 1 right").target;
  expect(
    prefilledValue(
      openDimensionInput(session, "dimensionDistance", [bottom], [3, 0]),
    ),
  ).toBeCloseTo(4, 9);
  expect(
    prefilledValue(
      openDimensionInput(session, "dimensionDistance", [right], [6, 2]),
    ),
  ).toBeCloseTo(3, 9);
  const diameter = openDimensionInput(
    session,
    "dimensionDistance",
    [circleTarget(session)],
    [15, 3],
  );
  expect(diameter.toolPresentation?.floatingInput?.label).toBe("Diameter");
  expect(prefilledValue(diameter)).toBeCloseTo(5, 9);
  const radius = openDimensionInput(
    session,
    "dimensionRadius",
    [circleTarget(session)],
    [15, 3],
  );
  expect(radius.toolPresentation?.floatingInput?.label).toBe("Radius");
  expect(prefilledValue(radius)).toBeCloseTo(2.5, 9);
});

test("T13c D5: a line length and a line angle (degrees) are prefilled with their measured values", () => {
  let session = draw(rectangleAndCircle(), "line", [
    [20, 0],
    [23, 4],
  ]);
  session = draw(session, "line", [
    [20, -2],
    [26, -2 + 6 * Math.tan(Math.PI / 3)],
  ]);
  const [lengthLine, angleLine] = session.definition.entities.filter(
    (candidate) =>
      candidate.kind === "lineSegment" &&
      !candidate.label.startsWith("Rectangle"),
  );
  expect(
    prefilledValue(
      openDimensionInput(
        session,
        "dimensionDistance",
        [lengthLine!.target],
        [22, 3],
      ),
    ),
  ).toBeCloseTo(5, 9);
  const horizontal = draw(session, "line", [
    [30, 0],
    [36, 0],
  ]);
  const horizontalLine = horizontal.definition.entities.at(-1)!;
  const angle = openDimensionInput(
    horizontal,
    "dimensionDistance",
    [horizontalLine.target, angleLine!.target],
    [34, 3],
  );
  expect(angle.toolPresentation?.floatingInput?.label).toBe("Angle");
  expect(prefilledValue(angle)).toBeCloseTo(60, 6);
});

test("T13c D5: the prefill reads the live solve, not stale authored positions", () => {
  let session = rectangleAndCircle();
  const bottom = entity(session, "Rectangle 1 bottom").target;
  session = {
    ...session,
    documentVariables: [
      { variableId: "variable_w", name: "w", valueText: "4" },
    ] as SketchSessionState["documentVariables"],
  };
  let dimensioned = openDimensionInput(
    session,
    "dimensionDistance",
    [bottom],
    [3, 0],
  );
  dimensioned = commitValue(
    patchSketchConstraintValue(dimensioned, { value: "w" }),
  );
  expect(dimensioned.definition.dimensions).toHaveLength(1);
  // The variable changes: the live solve moves the geometry, the authored
  // definition still holds the old positions until an accepted change.
  const changed = {
    ...dimensioned,
    documentVariables: [
      { variableId: "variable_w", name: "w", valueText: "7" },
    ] as SketchSessionState["documentVariables"],
  };
  const live = withLiveSolveBasis(changed, changed.definition);
  expect(live.liveSolve?.accepted, "premise: the live solve is accepted").toBe(
    true,
  );
  const top = entity(live, "Rectangle 1 top");
  const authoredTop =
    top.kind === "lineSegment"
      ? live.definition.points
          .filter(
            (point) =>
              point.pointId === top.startPointId ||
              point.pointId === top.endPointId,
          )
          .map((point) => point.position)
      : [];
  expect(
    Math.abs(authoredTop[0]![0] - authoredTop[1]![0]),
    "premise: authored positions are stale",
  ).toBeCloseTo(4, 9);
  expect(
    prefilledValue(
      openDimensionInput(live, "dimensionDistance", [top.target], [3, 6]),
    ),
  ).toBeCloseTo(7, 4);
});

test("T13c D5: committing the untouched prefill authors a satisfied driving dimension and moves nothing", () => {
  let session = rectangleAndCircle();
  const before = positions(session);
  const radiusBefore = circleRadius(session);
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [circleTarget(session)],
      [15, 3],
    ),
  );
  expect(
    session.definition.dimensions.map((dimension) => dimension.kind),
  ).toEqual(["lineLength", "diameter"]);
  expect(session.liveSolve?.accepted).toBe(true);
  expect(
    session.liveSolve?.solvedSnapshot.dimensionStatuses.map(
      (status) => status.status,
    ),
  ).toEqual(["driving", "driving"]);
  expect(session.validationMessage).toBe(null);
  const after = positions(session);
  for (const [pointId, position] of Object.entries(before)) {
    expect(after[pointId]![0]).toBeCloseTo(position[0], 9);
    expect(after[pointId]![1]).toBeCloseTo(position[1], 9);
  }
  expect(circleRadius(session)).toBeCloseTo(radiusBefore, 9);
});

// --- Circle diameter and rectangle width-only ------------------------------

test("T13c: a width-only rectangle dimension leaves the height free (a height drag changes height only)", () => {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  // O3/D2: leave the re-armed Dimension tool before testing a Select drag.
  session = clearActiveSketchTool(session);
  const corner = session.definition.points.find(
    (point) => point.position[0] === 5 && point.position[1] === 4,
  )!;
  let dragging = beginSketchGeometryDrag(session, corner.target, [5, 4]);
  for (let step = 1; step < 8; step += 1)
    dragging = updateSketchGeometryDrag(dragging, [5, 4 + (2 * step) / 8]);
  const released = finishSketchGeometryDrag(dragging, [5, 6]);
  const sideLength = (label: string) => {
    const side = entity(released, label);
    if (side.kind !== "lineSegment") return NaN;
    const [a, b] = [side.startPointId, side.endPointId].map(
      (pointId) =>
        released.definition.points.find((point) => point.pointId === pointId)!
          .position,
    );
    return Math.hypot(b![0] - a![0], b![1] - a![1]);
  };
  expect(sideLength("Rectangle 1 bottom"), "width held").toBeCloseTo(4, 6);
  expect(sideLength("Rectangle 1 right"), "height follows").toBeCloseTo(5, 3);
  expect(released.liveSolve?.accepted).toBe(true);
});

// --- D6/D7: retained conflicts with explanation ----------------------------

/**
 * T13e (D11): a determined quantity opens in Reference mode; the "Make
 * driving" switch authors it as a (redundant) driving dimension instead.
 */
function makeDriving(session: SketchSessionState) {
  const input = session.toolPresentation?.floatingInput;
  expect(input?.modeSwitch?.label, "premise: offered as a reference").toBe(
    "Make driving",
  );
  return patchSketchConstraintValue(session, input!.modeSwitch!.action.patch);
}

function rectangleWithBottomAndTopLengths() {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  session = commitValue(
    makeDriving(
      openDimensionInput(
        session,
        "dimensionDistance",
        [entity(session, "Rectangle 1 top").target],
        [3, 5],
      ),
    ),
  );
  expect(session.liveSolve?.accepted, "premise: redundant, consistent").toBe(
    true,
  );
  return session;
}

test("T13c D6/D7: a confirmed conflicting annotation edit is committed and explained; nothing else changes", () => {
  const session = rectangleWithBottomAndTopLengths();
  const top = session.definition.dimensions[1]!;
  let editing = beginSketchAnnotationEdit(session, {
    kind: "dimension",
    sketchId: session.sketchId!,
    dimensionId: top.dimensionId,
  } as Parameters<typeof beginSketchAnnotationEdit>[1]);
  expect(editing.activeAnnotationEdit, "premise: popup open").toBeTruthy();
  editing = patchSketchConstraintValue(editing, { value: "6" });
  const committed = patchSketchConstraintValue(editing, {
    intent: "commitAnnotationValue",
  });
  expect(committed.activeAnnotationEdit, "the popup closes").toBe(null);
  const edited = committed.definition.dimensions.find(
    (dimension) => dimension.dimensionId === top.dimensionId,
  );
  expect(edited && "value" in edited ? edited.value : null).toEqual({
    source: "literal",
    value: 6,
  });
  expect(
    committed.definition.dimensions.filter(
      (dimension) => dimension.dimensionId !== top.dimensionId,
    ),
    "no other dimension changed",
  ).toEqual(
    session.definition.dimensions.filter(
      (dimension) => dimension.dimensionId !== top.dimensionId,
    ),
  );
  expect(committed.definition.constraints).toEqual(
    session.definition.constraints,
  );
  expect(committed.liveSolve?.accepted).toBe(false);
  expectConflictExplanation(committed, top.dimensionId);
});

test("T13c D6: empty and unresolvable edits stay pending (nothing committed, popup open)", () => {
  const session = rectangleWithBottomAndTopLengths();
  const top = session.definition.dimensions[1]!;
  const open = beginSketchAnnotationEdit(session, {
    kind: "dimension",
    sketchId: session.sketchId!,
    dimensionId: top.dimensionId,
  } as Parameters<typeof beginSketchAnnotationEdit>[1]);
  for (const value of ["", "   ", "missingVariable"]) {
    const result = patchSketchConstraintValue(
      patchSketchConstraintValue(open, { value }),
      { intent: "commitAnnotationValue" },
    );
    expect(result.definition, `"${value}" commits nothing`).toBe(
      session.definition,
    );
    expect(
      result.activeAnnotationEdit,
      `"${value}" keeps the popup`,
    ).toBeTruthy();
  }
});

test("T13c D7: creating a conflicting dimension is retained and explained, with targeted solver diagnostics", () => {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  const conflicting = commitValue(
    patchSketchConstraintValue(
      makeDriving(
        openDimensionInput(
          session,
          "dimensionDistance",
          [entity(session, "Rectangle 1 top").target],
          [3, 5],
        ),
      ),
      { value: "6" },
    ),
  );
  const added = conflicting.definition.dimensions.at(-1)!;
  expect(conflicting.definition.dimensions).toHaveLength(2);
  expect(conflicting.liveSolve?.accepted).toBe(false);
  expect(conflicting.validationMessage).toContain(`${added.label} (6 mm)`);
  expectConflictExplanation(conflicting, added.dimensionId);
});

// --- D8: Tangent local↔local, refusals -------------------------------------

function tangentSketch() {
  let session = rectangleAndCircle();
  session = draw(session, "centerPointArc", [
    [30, 0],
    [32, 0],
    [28, 0],
  ]);
  session = draw(session, "line", [
    [26, 3],
    [34, 3],
  ]);
  return session;
}

function arcGeometry(session: SketchSessionState) {
  const arc = session.definition.entities.find(
    (candidate) => candidate.kind === "arc",
  )!;
  if (arc.kind !== "arc") throw new Error("arc");
  const at = (pointId: string) =>
    session.definition.points.find((point) => point.pointId === pointId)!
      .position;
  const center = at(arc.centerPointId);
  const start = at(arc.startPointId);
  return {
    arc,
    center,
    radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
  };
}

function tangentTool(
  session: SketchSessionState,
  first: PrimitiveRef,
  second: PrimitiveRef,
) {
  return selectSketchConstraintTarget(
    selectSketchConstraintTarget(
      beginSketchTool(session, "constraintTangent"),
      first,
    ),
    second,
  );
}

test("T13c D8: Tangent line↔arc authors the local tangent and solves to tangency; other geometry stays", () => {
  const session = tangentSketch();
  const line = session.definition.entities.at(-1)!;
  const { arc } = arcGeometry(session);
  const before = positions(session);
  const tangent = tangentTool(session, line.target, arc.target);
  const authored = tangent.definition.constraints.filter(
    (constraint) => !session.definition.constraints.includes(constraint),
  );
  expect(authored).toEqual([
    expect.objectContaining({
      kind: "tangent",
      entityIds: [line.entityId, arc.entityId],
      relation: "external",
    }),
  ]);
  expect(tangent.liveSolve?.accepted).toBe(true);
  expect(tangent.validationMessage).toBe(null);
  const { center, radius } = arcGeometry(tangent);
  if (line.kind !== "lineSegment") throw new Error("line");
  const [a, b] = [line.startPointId, line.endPointId].map(
    (pointId) =>
      tangent.definition.points.find((point) => point.pointId === pointId)!
        .position,
  );
  const length = Math.hypot(b![0] - a![0], b![1] - a![1]);
  const distance =
    Math.abs(
      (b![0] - a![0]) * (center[1] - a![1]) -
        (b![1] - a![1]) * (center[0] - a![0]),
    ) / length;
  expect(Math.abs(distance - radius), "line tangent to the arc").toBeLessThan(
    1e-6,
  );
  const after = positions(tangent);
  for (const point of session.definition.points.filter((candidate) =>
    candidate.label.startsWith("Rectangle"),
  )) {
    expect(after[point.pointId]).toEqual(before[point.pointId]);
  }
});

test("T13c D8: Tangent arc↔circle authors the local tangent and solves to tangency", () => {
  let session = tangentSketch();
  session = draw(session, "circle", [
    [30, 6],
    [31.5, 6],
  ]);
  const circle = session.definition.entities.at(-1)!;
  const { arc } = arcGeometry(session);
  const tangent = tangentTool(session, arc.target, circle.target);
  expect(
    tangent.definition.constraints.filter(
      (constraint) => !session.definition.constraints.includes(constraint),
    ),
  ).toEqual([
    expect.objectContaining({
      kind: "tangent",
      entityIds: [arc.entityId, circle.entityId],
      relation: "external",
    }),
  ]);
  expect(tangent.liveSolve?.accepted).toBe(true);
  const { center, radius } = arcGeometry(tangent);
  const solvedCircle = tangent.definition.entities.find(
    (candidate) => candidate.entityId === circle.entityId,
  )!;
  if (solvedCircle.kind !== "circle") throw new Error("circle");
  const circleCenter = tangent.definition.points.find(
    (point) => point.pointId === solvedCircle.centerPointId,
  )!.position;
  expect(
    Math.abs(
      Math.hypot(circleCenter[0] - center[0], circleCenter[1] - center[1]) -
        (radius + solvedCircle.radius),
    ),
    "externally tangent",
  ).toBeLessThan(1e-6);
});

test("T13c D8: Tangent line↔line is refused with an explanation and authors nothing", () => {
  const session = rectangleAndCircle();
  const refused = tangentTool(
    session,
    entity(session, "Rectangle 1 bottom").target,
    entity(session, "Rectangle 1 right").target,
  );
  expect(refused.definition).toBe(session.definition);
  expect(refused.toolPresentation?.validation?.[0]?.message).toBe("Tangent needs a circle or arc.");
  expect(refused.activeTool, "the tool stays armed").toBe("constraintTangent");
  expect(refused.constraintAuthoring?.selectedTargets).toEqual([]);
});

test("T13c D8: a user Tangent on a fillet pair is refused as already constrained and authors nothing", () => {
  let session = rectangleAndCircle();
  const bottom = entity(session, "Rectangle 1 bottom");
  const right = entity(session, "Rectangle 1 right");
  session = selectSketchEditToolTarget(
    selectSketchEditToolTarget(
      beginSketchTool(session, "sketchFillet"),
      bottom.target,
    ),
    right.target,
  );
  session = patchSketchEditToolValue(session, { value: 0.5 });
  session = patchSketchEditToolValue(session, {
    intent: "commitSketchEditOperator",
  });
  const { arc } = arcGeometry(session);
  const filletTangent = session.definition.constraints.find(
    (constraint) =>
      constraint.kind === "tangent" &&
      constraint.entityIds.includes(bottom.entityId) &&
      constraint.entityIds.includes(arc.entityId),
  );
  expect(
    filletTangent,
    "premise: the fillet authored the tangent",
  ).toBeTruthy();
  const refused = tangentTool(session, bottom.target, arc.target);
  expect(refused.definition).toBe(session.definition);
  expect(refused.toolPresentation?.validation?.[0]?.message).toBe(
    `Already constrained: ${filletTangent!.label}`,
  );
  // Selection order does not matter.
  expect(
    tangentTool(session, arc.target, bottom.target).toolPresentation?.validation?.[0]?.message,
  ).toBe(`Already constrained: ${filletTangent!.label}`);
});

test("T13c D8: any constraint tool refuses an exact duplicate (Horizontal on a rectangle side)", () => {
  const session = rectangleAndCircle();
  const bottom = entity(session, "Rectangle 1 bottom");
  const existing = session.definition.constraints.find(
    (constraint) =>
      constraint.kind === "horizontal" &&
      constraint.entityId === bottom.entityId,
  )!;
  const refused = selectSketchConstraintTarget(
    beginSketchTool(session, "constraintHorizontal"),
    bottom.target,
  );
  expect(refused.definition).toBe(session.definition);
  expect(refused.toolPresentation?.validation?.[0]?.message).toBe(
    `Already constrained: ${existing.label}`,
  );
});

test("T13c: the annotation descriptors still expose the committed diameter (circle dimensions default to diameter)", () => {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [circleTarget(session)],
      [15, 3],
    ),
  );
  const [dimension] = session.definition.dimensions;
  expect(dimension).toEqual(
    expect.objectContaining({
      kind: "diameter",
      value: { source: "literal", value: expect.closeTo(5, 9) },
    }),
  );
  expect(
    getSketchAnnotationDescriptors(session).some(
      (descriptor) =>
        descriptor.target.kind === "dimension" &&
        descriptor.target.dimensionId === dimension!.dimensionId,
    ),
  ).toBe(true);
});

// --- Review R-1: reversed picks keep the placed dimension line -------------

test.each([
  ["dimensionDistance", "horizontal", [23, 4], [1, 1], [12, -6]],
  ["dimensionDistance", "vertical", [23, 4], [1, 1], [-6, 2.5]],
  ["dimensionHorizontal", "horizontal", [23, 4], [1, 1], [12, -6]],
  ["dimensionVertical", "vertical", [23, 4], [1, 1], [-6, 2.5]],
] as const)(
  "T13c R-1: %s %s picked in reverse draws the dimension line where it was placed",
  (toolId, axis, firstPick, secondPick, pointer) => {
    const session = draw(rectangleAndCircle(), "line", [
      [20, 0],
      [23, 4],
    ]);
    const pointAt = (xy: readonly [number, number]) =>
      session.definition.points.find(
        (point) => point.position[0] === xy[0] && point.position[1] === xy[1],
      )!;
    const committed = commitValue(
      openDimensionInput(
        session,
        toolId,
        [pointAt(firstPick).target, pointAt(secondPick).target],
        pointer,
      ),
    );
    const dimension = committed.definition.dimensions.at(-1)!;
    if (!("pointIds" in dimension)) throw new Error("point pair dimension");
    expect(
      dimension.kind === "distance" ? dimension.axis : axis,
      "premise: the pointer chose the axis",
    ).toBe(axis);
    expect(
      dimension.pointIds[0],
      "premise: the pair is stored in axis order (swapped)",
    ).toBe(pointAt(secondPick).pointId);
    const at = (pointId: string) =>
      committed.definition.points.find((point) => point.pointId === pointId)!
        .position;
    const line = createPlacedPointDimensionLine(
      at(dimension.pointIds[0]),
      at(dimension.pointIds[1]),
      axis,
      dimension.annotationPlacement,
    );
    expect(axis === "horizontal" ? line.start[1] : line.start[0]).toBeCloseTo(
      axis === "horizontal" ? pointer[1] : pointer[0],
      9,
    );
  },
);

// --- Review R-2: reopen of an invalid sketch explains it -------------------

test("T13c R-2: reopening a sketch with conflicting dimensions shows the explanation", () => {
  const sketch = makeSketchFixture();
  sketch.point("e", 3, 4);
  sketch.point("f", 3, 10);
  sketch.line("l", "e", "f");
  sketch.point("g", 10, 0);
  sketch.point("h", 14, 0);
  sketch.line("m", "g", "h");
  sketch.lineLength("l", 2);
  sketch.lineLength("l", 9);
  const opened = withSketchSnapScale(
    createSketchSessionFromSnapshot(
      sketchSnapshotRecordForTest(
        sketch.build(),
        [],
        createStandardPlaneDefinition("xy"),
      ),
      OCC_KERNEL_SETTINGS,
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  // Reopen with no references bases the session on its projections now.
  const reopened = updateSketchReferenceProjection(opened, [], []);
  expect(reopened.liveSolve?.accepted, "premise: invalid").toBe(false);
  expect(reopened.validationMessage).toBe(
    "dimension_0 (2 mm), dimension_1 (9 mm) conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
});

// --- T13e2: conflicts the solver used to accept -----------------------------

/** Every line of the authored definition, as its length. */
function authoredLineLengths(session: SketchSessionState) {
  const at = (pointId: string) =>
    session.definition.points.find((point) => point.pointId === pointId)!
      .position;
  return session.definition.entities.flatMap((candidate) => {
    if (candidate.kind !== "lineSegment") return [];
    const start = at(candidate.startPointId);
    const end = at(candidate.endPointId);
    return [Math.hypot(end[0] - start[0], end[1] - start[1])];
  });
}

/** The largest distance a live-solve point moved from its authored position. */
function liveSolveLargestMove(session: SketchSessionState) {
  const authored = positions(session);
  return Math.max(
    ...session.liveSolve!.solvedSnapshot.solvedPoints.map((entry) => {
      const start = authored[entry.pointId]!;
      return Math.hypot(
        entry.solvedPosition[0] - start[0],
        entry.solvedPosition[1] - start[1],
      );
    }),
  );
}

/**
 * T13e2 (decision 4): the explanation names the just-committed requirement
 * first, even when the conflict left it satisfied, then exactly the
 * unsatisfied requirements; the solver diagnostics target the latter.
 */
function expectCommittedConflictExplanation(
  session: SketchSessionState,
  subjectId: string,
  subjectText: string,
) {
  const message = session.validationMessage ?? "";
  expect(message.startsWith(`${subjectText} conflicts with `), message).toBe(
    true,
  );
  const others = unsatisfiedIds(session).filter((id) => id !== subjectId);
  expect(
    others.length,
    "the conflict involves other requirements",
  ).toBeGreaterThan(0);
  const named = [
    ...session.definition.constraints.map((c) => [c.constraintId, c.label]),
    ...session.definition.dimensions.map((d) => [d.dimensionId, d.label]),
  ]
    .filter(
      ([id, label]) =>
        id !== subjectId && new RegExp(`\\b${label}\\b`).test(message),
    )
    .map(([id]) => id!)
    .sort();
  expect(named, "the message then names exactly the unsatisfied set").toEqual(
    others,
  );
  expect(message).toContain(
    "The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
}

test("T13e2: a conflicting 95° corner angle on a rectangle is a rejected, explained edit naming the angle first; no side collapses", () => {
  const session = rectangleAndCircle();
  const opened = openDimensionInput(
    session,
    "dimensionDistance",
    [
      entity(session, "Rectangle 1 bottom").target,
      entity(session, "Rectangle 1 right").target,
    ],
    [4, 2],
  );
  // The corner angle of an h/v rectangle is determined (T13e D11; before
  // T13e2 the probe read it independent because a collapsed side absorbed
  // the trial).
  expect(opened.constraintAuthoring?.redundancy).toBe("determined");
  const committed = commitValue(
    patchSketchConstraintValue(makeDriving(opened), { value: "95" }),
  );
  const angle = committed.definition.dimensions.at(-1)!;
  expect(angle.kind).toBe("lineAngle");
  expect(committed.liveSolve?.accepted, "the conflict is rejected").toBe(false);
  expect(unsatisfiedIds(committed).length).toBeGreaterThan(0);
  expectCommittedConflictExplanation(
    committed,
    angle.dimensionId,
    `${angle.label} (95°)`,
  );
  expect(positions(committed), "the authored geometry is unchanged").toEqual(
    positions(session),
  );
  for (const sideLength of authoredLineLengths(committed))
    expect(sideLength).toBeGreaterThan(
      session.solverTolerances.minimumSegmentLength,
    );

  // The same explanation for an annotation edit of a satisfied angle.
  const square = commitValue(
    patchSketchConstraintValue(
      makeDriving(
        openDimensionInput(
          session,
          "dimensionDistance",
          [
            entity(session, "Rectangle 1 bottom").target,
            entity(session, "Rectangle 1 right").target,
          ],
          [4, 2],
        ),
      ),
      { value: "90" },
    ),
  );
  expect(square.liveSolve?.accepted, "premise: 90° is consistent").toBe(true);
  const right = square.definition.dimensions.at(-1)!;
  const edited = patchSketchConstraintValue(
    patchSketchConstraintValue(
      beginSketchAnnotationEdit(square, {
        kind: "dimension",
        sketchId: square.sketchId!,
        dimensionId: right.dimensionId,
      } as Parameters<typeof beginSketchAnnotationEdit>[1]),
      { value: "95" },
    ),
    { intent: "commitAnnotationValue" },
  );
  expect(edited.liveSolve?.accepted).toBe(false);
  expectCommittedConflictExplanation(
    edited,
    right.dimensionId,
    `${right.label} (95°)`,
  );
  expect(positions(edited)).toEqual(positions(square));
});

test("T13e2: a diameter conflicting with a circle tangent to both sides of a height-sized rectangle is rejected with no large move", () => {
  let session = draw(newSession(), "rectangle", [
    [0, 0],
    [6, 4],
  ]);
  session = draw(session, "circle", [
    [3, 2],
    [4.8, 2],
  ]);
  for (const side of ["Rectangle 1 bottom", "Rectangle 1 top"])
    session = beginSketchTool(
      tangentTool(session, entity(session, side).target, circleTarget(session)),
      "line",
    );
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 right").target],
      [7, 2],
    ),
  );
  expect(session.liveSolve?.accepted, "premise: the slot solves").toBe(true);
  const opened = openDimensionInput(
    session,
    "dimensionDistance",
    [circleTarget(session)],
    [5, 5],
  );
  expect(opened.constraintAuthoring?.redundancy).toBe("determined");
  const gap = prefilledValue(opened);
  const committed = commitValue(
    patchSketchConstraintValue(makeDriving(opened), {
      value: String(gap + 0.016),
    }),
  );
  const added = committed.definition.dimensions.at(-1)!;
  expect(added.kind).toBe("diameter");
  expect(committed.liveSolve?.accepted, "the conflict is rejected").toBe(false);
  expect(
    committed.validationMessage?.startsWith(`${added.label} (`),
    committed.validationMessage ?? "",
  ).toBe(true);
  expect(positions(committed), "the authored geometry is unchanged").toEqual(
    positions(session),
  );
  // Before T13e2 this commit was accepted and moved the geometry ≈ 7 m.
  expect(liveSolveLargestMove(committed)).toBeLessThan(10);
});

test("T13e2: a diameter conflicting with a slot held by parallel lines and a line distance is rejected with no large move", () => {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 4);
  sketch.point("b1", 6, 4);
  sketch.point("c", 3, 2);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  sketch.circle("circle", "c", 2);
  const base = sketch.definition();
  const lines = [
    { kind: "localEntity", entityId: "sketch_entity_A" },
    { kind: "localEntity", entityId: "sketch_entity_B" },
  ];
  const constraints = [
    {
      constraintId: "constraint_slot_parallel",
      kind: "parallel",
      label: "Parallel",
      entityIds: ["sketch_entity_A", "sketch_entity_B"],
    },
    ...["A", "B"].map((line) => ({
      constraintId: `constraint_slot_tangent_${line}`,
      kind: "tangent",
      label: `Tangent ${line}`,
      entityIds: [`sketch_entity_${line}`, "sketch_entity_circle"],
      relation: "external",
    })),
  ] as unknown as typeof base.constraints;
  const dimensions = [
    {
      dimensionId: "dimension_slot_gap",
      kind: "lineDistance",
      label: "Gap",
      lines,
      value: createLiteralAuthoredValue(4),
    },
  ] as unknown as typeof base.dimensions;
  const opened = updateSketchReferenceProjection(
    withSketchSnapScale(
      createSketchSessionFromSnapshot(
        sketchSnapshotRecordForTest(
          {
            ...sketch.build(),
            definition: {
              ...base,
              constraintIds: constraints.map((entry) => entry.constraintId),
              constraints,
              dimensionIds: dimensions.map((entry) => entry.dimensionId),
              dimensions,
            },
          },
          [],
          createStandardPlaneDefinition("xy"),
        ),
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
    [],
    [],
  );
  expect(opened.liveSolve?.accepted, "premise: the slot solves").toBe(true);
  const committed = commitValue(
    patchSketchConstraintValue(
      makeDriving(
        openDimensionInput(
          opened,
          "dimensionDistance",
          [circleTarget(opened)],
          [5, 5],
        ),
      ),
      { value: "4.1" },
    ),
  );
  const added = committed.definition.dimensions.at(-1)!;
  expect(added.kind).toBe("diameter");
  expect(committed.liveSolve?.accepted, "the conflict is rejected").toBe(false);
  expect(
    committed.validationMessage?.startsWith(`${added.label} (4.1 mm)`),
    committed.validationMessage ?? "",
  ).toBe(true);
  expect(positions(committed)).toEqual(positions(opened));
  // Before T13e2 this commit was accepted and moved the geometry ≈ 3 m.
  expect(liveSolveLargestMove(committed)).toBeLessThan(10);
});

test("T13e2 (review R-1): a satisfied, unrelated commit into an already invalid sketch is not blamed for the existing conflict", () => {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  const invalid = commitValue(
    patchSketchConstraintValue(
      makeDriving(
        openDimensionInput(
          session,
          "dimensionDistance",
          [entity(session, "Rectangle 1 top").target],
          [3, 5],
        ),
      ),
      { value: "6" },
    ),
  );
  expect(invalid.liveSolve?.accepted, "premise: two widths conflict").toBe(
    false,
  );
  const conflict = unsatisfiedIds(invalid);

  // The far circle at its current diameter: satisfied and independent.
  const committed = commitValue(
    openDimensionInput(
      invalid,
      "dimensionDistance",
      [circleTarget(invalid)],
      [15, 3],
    ),
  );
  const diameter = committed.definition.dimensions.at(-1)!;
  expect(diameter.kind).toBe("diameter");
  expect(unsatisfiedIds(committed), "the conflict is unchanged").toEqual(
    conflict,
  );
  const message = committed.validationMessage ?? "";
  expect(message, "the unrelated diameter is not named").not.toContain(
    diameter.label,
  );
  for (const id of conflict)
    expect(message, "every conflicting requirement is named").toContain(
      requirementLabel(committed, id),
    );
  expect(
    message,
    "the base wording: the conflicting set conflicts, no subject",
  ).toContain(
    " conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
  expect(message).not.toContain(" conflicts with ");
});

test("T13e2 (re-review A-2): an annotation edit of a satisfied, unrelated dimension in an already invalid sketch is not blamed for the existing conflict", () => {
  let session = rectangleAndCircle();
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [circleTarget(session)],
      [15, 3],
    ),
  );
  const diameter = session.definition.dimensions.at(-1)!;
  expect(diameter.kind).toBe("diameter");
  session = commitValue(
    openDimensionInput(
      session,
      "dimensionDistance",
      [entity(session, "Rectangle 1 bottom").target],
      [3, 0],
    ),
  );
  const invalid = commitValue(
    patchSketchConstraintValue(
      makeDriving(
        openDimensionInput(
          session,
          "dimensionDistance",
          [entity(session, "Rectangle 1 top").target],
          [3, 5],
        ),
      ),
      { value: "6" },
    ),
  );
  expect(invalid.liveSolve?.accepted, "premise: two widths conflict").toBe(
    false,
  );
  const conflict = unsatisfiedIds(invalid);
  const edited = patchSketchConstraintValue(
    patchSketchConstraintValue(
      beginSketchAnnotationEdit(invalid, {
        kind: "dimension",
        sketchId: invalid.sketchId!,
        dimensionId: diameter.dimensionId,
      } as Parameters<typeof beginSketchAnnotationEdit>[1]),
      { value: "6" },
    ),
    { intent: "commitAnnotationValue" },
  );
  expect(unsatisfiedIds(edited), "the conflict is unchanged").toEqual(conflict);
  const message = edited.validationMessage ?? "";
  expect(message, "the edited diameter is not named").not.toContain(
    diameter.label,
  );
  expect(message).not.toContain(" conflicts with ");
  for (const id of conflict)
    expect(message).toContain(requirementLabel(edited, id));
});

// T17j2 (Category 4 flow): with the Distance tool's first target picked, the
// preview runs from it to the pointer (or the hovered second target). Its
// drag handle is a wide, pointer-catching hit line in the viewport, so while
// targets are still being picked the preview must carry none: the next pick
// reaches the canvas. Once both targets are chosen (placement), it has one.
test("T17j2: a point-dimension preview is labelled in every phase but not draggable until both targets are picked; the placement preview is", () => {
  const session = rectangleAndCircle();
  const corner = (index: number) => session.definition.points[index]!;
  const [first, second] = [corner(0), corner(2)];
  expect(
    Math.hypot(
      first.position[0] - second.position[0],
      first.position[1] - second.position[1],
    ),
    "premise: two distinct corners",
  ).toBeGreaterThan(1);
  const previewHandles = (state: SketchSessionState) => {
    const lines = (state.toolPresentation?.overlays ?? []).filter(
      (overlay) => overlay.kind === "dimensionLine",
    );
    expect(lines, "the preview dimension line is drawn").toHaveLength(1);
    expect(
      lines.every(
        (overlay) => overlay.kind === "dimensionLine" && overlay.labelled,
      ),
      "the preview keeps its kind label in every phase (review A-1)",
    ).toBe(true);
    return lines.map((overlay) =>
      overlay.kind === "dimensionLine" ? (overlay.dragHandle ?? null) : null,
    );
  };
  for (const toolId of [
    "dimensionDistance",
    "dimensionHorizontal",
    "dimensionVertical",
  ] as const) {
    let next = selectSketchConstraintTarget(
      beginSketchTool(session, toolId),
      first.target,
    );
    next = updateSketchPointer(next, second.position);
    expect(
      previewHandles(next),
      `${toolId}: one target, pointer on the second point`,
    ).toEqual([null]);
    next = updateSketchConstraintHover(next, second.target);
    expect(
      previewHandles(next),
      `${toolId}: one target, the second point hovered`,
    ).toEqual([null]);
    next = selectSketchConstraintTarget(next, second.target);
    next = updateSketchPointer(next, [3, 6]);
    expect(
      previewHandles(next)[0]?.kind,
      `${toolId}: both targets picked, the placement preview is draggable`,
    ).toBe("dimensionLine");
  }
});
