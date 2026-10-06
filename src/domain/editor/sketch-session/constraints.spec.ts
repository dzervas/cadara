// T13c (logic lane, sketch-session constraint/dimension authoring seam):
// measured prefill (D5), retained conflicting edits (D6), the conflict
// explanation and its solver diagnostic targets (D7), the local Tangent tool
// and duplicate refusal (D8). Every row runs in a multi-entity sketch.
import { expect, test } from "vitest";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSession,
  finishSketchGeometryDrag,
  getSketchAnnotationDescriptors,
  patchSketchConstraintValue,
  patchSketchEditToolValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchGeometryDrag,
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
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";

function newSession() {
  return createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
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
  expect(refused.validationMessage).toBe("Tangent needs a circle or arc.");
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
  expect(refused.validationMessage).toBe(
    `Already constrained: ${filletTangent!.label}`,
  );
  // Selection order does not matter.
  expect(
    tangentTool(session, arc.target, bottom.target).validationMessage,
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
  expect(refused.validationMessage).toBe(
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
  const opened = createSketchSessionFromSnapshot(
    sketchSnapshotRecordForTest(
      sketch.build(),
      [],
      createStandardPlaneDefinition("xy"),
    ),
    OCC_KERNEL_SETTINGS,
  );
  // Reopen with no references bases the session on its projections now.
  const reopened = updateSketchReferenceProjection(opened, [], []);
  expect(reopened.liveSolve?.accepted, "premise: invalid").toBe(false);
  expect(reopened.validationMessage).toBe(
    "dimension_0 (2 mm), dimension_1 (9 mm) conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );
});
