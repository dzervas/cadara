import { expect, test } from "vitest";

import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  ConstraintId,
  SketchEntityId,
  SketchId,
} from "@/contracts/shared/ids";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  getSketchAnnotationDescriptors,
  getSketchAnnotationListRows,
  isSketchAnnotationDrawnInViewport,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchAnnotationDescriptor,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { describeSketchSessionUnsatisfiedRequirements } from "@/domain/editor/sketch-session/internals";
import { buildCommittedDimensionOverlays } from "@/domain/editor/sketch-session/annotations";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

// T14b T-7, logic lane (descriptor seam `getSketchAnnotationDescriptors`): an
// arc's end bindings are constraint-class contextual descriptors (glyph
// Coincident), not dimension chips. Display only: they stay dimension records.
test("T14b T-7: a three-point arc's end bindings are Coincident constraint descriptors, not dimension chips", () => {
  let session = startSketchDraw(
    beginSketchTool(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      "threePointArc",
    ),
    [2, 0],
  );
  session = acceptSketchDraw(session, [-2, 0]);
  session = acceptSketchDraw(session, [0, 2]);
  const bindingIds = session.definition.dimensions
    .filter(
      (dimension) =>
        dimension.kind === "arcStartPointCoincident" ||
        dimension.kind === "arcEndPointCoincident",
    )
    .map((dimension) => dimension.dimensionId);
  expect(bindingIds, "premise: the arc authors two bindings").toHaveLength(2);

  const descriptors = getSketchAnnotationDescriptors(session);
  expect(
    descriptors.filter((descriptor) => descriptor.status === "dimension"),
    "No always-visible dimension chip.",
  ).toEqual([]);
  const bindings = descriptors.filter((descriptor) =>
    bindingIds.includes(descriptor.id as never),
  );
  expect(bindings).toHaveLength(2);
  for (const binding of bindings) {
    expect(binding.status).toBe("constraint");
    expect(binding.glyphKind).toBe("constraintCoincident");
    expect(binding.target.kind, "the record stays a dimension").toBe(
      "dimension",
    );
    expect(binding.visibleLabel).toBeUndefined();
    expect(binding.dragHandle).toBeUndefined();
  }
});

// --- T14e: the Constraints list model and the arc-binding viewport policy ---
// Logic lane (descriptor + list model seam: `getSketchAnnotationDescriptors`,
// `getSketchAnnotationListRows`, `isSketchAnnotationDrawnInViewport`).

function newSpecSession() {
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

function drawWith(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly SketchPoint[],
) {
  let next = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return beginSketchTool(next, "line");
}

/** Places a dimension on the targets and commits its value input. */
function commitDimension(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
  placement: SketchPoint,
  options: { driving?: true; value?: string } = {},
) {
  let next = beginSketchTool(session, "dimensionDistance");
  for (const target of targets)
    next = selectSketchConstraintTarget(next, target);
  next = pinSketchConstraintPreview(next, placement);
  if (options.driving) {
    const modeSwitch = next.toolPresentation?.floatingInput?.modeSwitch;
    expect(modeSwitch?.label, "premise: offered as a reference").toBe(
      "Make driving",
    );
    next = patchSketchConstraintValue(next, modeSwitch!.action.patch);
  }
  if (options.value !== undefined)
    next = patchSketchConstraintValue(next, { value: options.value });
  return patchSketchConstraintValue(next, { intent: "commitConstraintValue" });
}

function entityTarget(session: SketchSessionState, label: string) {
  const found = session.definition.entities.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`No entity ${label}`);
  return found.target;
}

test("T14e T-17: the list puts problems first, each with its status text and the D7 explanation; the rest keep descriptor order", () => {
  let session = drawWith(newSpecSession(), "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  session = commitDimension(
    session,
    [entityTarget(session, "Rectangle 1 bottom")],
    [3, 0],
  );
  // A driving top length of 6 against the bottom's 4: a retained conflict.
  session = commitDimension(
    session,
    [entityTarget(session, "Rectangle 1 top")],
    [3, 5],
    { driving: true, value: "6" },
  );
  expect(session.liveSolve?.accepted, "premise: conflicting").toBe(false);
  const explanation = describeSketchSessionUnsatisfiedRequirements(session);
  expect(explanation, "premise: D7 explains the conflict").toMatch(
    /cannot be satisfied|conflict/,
  );

  const descriptors = getSketchAnnotationDescriptors(session);
  const problems = descriptors.filter((descriptor) => descriptor.problem);
  const others = descriptors.filter((descriptor) => !descriptor.problem);
  const top = session.definition.dimensions.at(-1)!;
  expect(
    problems.map((descriptor) => descriptor.id),
    "premise: the conflicting top length is a problem",
  ).toContain(top.dimensionId);
  expect(
    others.length,
    "premise: non-problem annotations exist",
  ).toBeGreaterThan(0);
  expect(
    descriptors.indexOf(problems.at(-1)!),
    "premise: a problem comes after a non-problem in descriptor order",
  ).toBeGreaterThan(descriptors.indexOf(others[0]!));

  const rows = getSketchAnnotationListRows(descriptors);
  expect(rows.map((row) => row.annotation.id)).toEqual([
    ...problems.map((descriptor) => descriptor.id),
    ...others.map((descriptor) => descriptor.id),
  ]);
  for (const row of rows.slice(0, problems.length)) {
    expect(row.annotation.problem).toEqual({
      status: "conflict",
      explanation,
    });
    expect(row.problemText, "status text with the reason").toBe(
      `Conflict: ${explanation}`,
    );
    expect(row.deletable).toBe(true);
  }
  for (const row of rows.slice(problems.length)) {
    expect(row.problemText).toBe(null);
    expect(row.deletable).toBe(true);
    expect(row.group).toBe(null);
  }
});

test("T14e Q1/A-9: arc end bindings are not drawn, list under their arc after the other rows, and offer no delete", () => {
  let session = drawWith(newSpecSession(), "threePointArc", [
    [2, 0],
    [-2, 0],
    [0, 2],
  ]);
  session = drawWith(session, "circle", [
    [10, 0],
    [12, 0],
  ]);
  const circle = session.definition.entities.find(
    (candidate) => candidate.kind === "circle",
  )!;
  session = commitDimension(session, [circle.target], [13, 2]);
  session = drawWith(session, "threePointArc", [
    [22, 0],
    [18, 0],
    [20, 2],
  ]);
  const arcs = session.definition.entities.filter(
    (candidate) => candidate.kind === "arc",
  );
  expect(arcs, "premise: two arcs").toHaveLength(2);
  const kinds = session.definition.dimensions.map(
    (dimension) => dimension.kind,
  );
  expect(kinds, "premise: the diameter is authored between the arcs").toEqual([
    "arcStartPointCoincident",
    "arcEndPointCoincident",
    "diameter",
    "arcStartPointCoincident",
    "arcEndPointCoincident",
  ]);

  const descriptors = getSketchAnnotationDescriptors(session);
  const bindingIds = session.definition.dimensions
    .filter((dimension) => dimension.kind !== "diameter")
    .map((dimension) => dimension.dimensionId as string);
  for (const descriptor of descriptors) {
    const isBinding = bindingIds.includes(descriptor.id);
    expect(
      isSketchAnnotationDrawnInViewport(descriptor),
      `${descriptor.label} ${isBinding ? "is not drawn" : "is drawn"}`,
    ).toBe(!isBinding);
    expect(descriptor.problem, "no problem here").toBeUndefined();
  }

  const rows = getSketchAnnotationListRows(descriptors);
  const diameter = session.definition.dimensions[2]!.dimensionId;
  expect(rows.map((row) => row.annotation.id)).toEqual([
    ...descriptors
      .filter((descriptor) => !bindingIds.includes(descriptor.id))
      .map((descriptor) => descriptor.id),
    ...bindingIds,
  ]);
  expect(
    rows.findIndex((row) => row.annotation.id === diameter),
    "the later-authored diameter lists before the first arc's bindings",
  ).toBeLessThan(rows.findIndex((row) => row.annotation.id === bindingIds[0]));
  const bindingRows = rows.filter((row) =>
    bindingIds.includes(row.annotation.id),
  );
  expect(
    bindingRows.map((row) => [row.group?.label, row.deletable]),
    "grouped under their arc, never deletable",
  ).toEqual([
    [arcs[0]!.label, false],
    [arcs[0]!.label, false],
    [arcs[1]!.label, false],
    [arcs[1]!.label, false],
  ]);
  expect(bindingRows[0]!.group?.key).toBe(bindingRows[1]!.group?.key);
  expect(bindingRows[1]!.group?.key).not.toBe(bindingRows[2]!.group?.key);
  expect(
    rows
      .filter((row) => !bindingIds.includes(row.annotation.id))
      .every((row) => row.deletable && row.group === null),
  ).toBe(true);
});

test("T14e Q1/T-17: a problem binding is drawn and listed first (still without delete); status text without an explanation", () => {
  const arc: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft" as SketchId,
    entityId: "sketch_entity_arc" as SketchEntityId,
  };
  const descriptor = (
    id: string,
    overrides: Partial<SketchAnnotationDescriptor> = {},
  ): SketchAnnotationDescriptor => ({
    id,
    target: {
      kind: "constraint",
      sketchId: "sketch_draft" as SketchId,
      constraintId: id as ConstraintId,
    },
    glyphKind: "constraintCoincident",
    anchor: { kind: "sketchPoint", point: [0, 0], offset: { x: 0, y: 0 } },
    affectedGeometryRefs: [],
    label: id,
    detail: id,
    status: "constraint",
    ...overrides,
  });
  const binding = { arc, arcLabel: "Arc 1" };
  const plain = descriptor("plain");
  const quietBinding = descriptor("quiet_binding", { arcBinding: binding });
  const blocked = descriptor("blocked", {
    problem: { status: "blocked", explanation: "The offset failed." },
  });
  const problemBinding = descriptor("problem_binding", {
    arcBinding: binding,
    problem: { status: "error", explanation: null },
  });

  expect(isSketchAnnotationDrawnInViewport(quietBinding)).toBe(false);
  expect(isSketchAnnotationDrawnInViewport(problemBinding)).toBe(true);
  expect(isSketchAnnotationDrawnInViewport(blocked)).toBe(true);
  expect(isSketchAnnotationDrawnInViewport(plain)).toBe(true);

  const rows = getSketchAnnotationListRows([
    plain,
    quietBinding,
    blocked,
    problemBinding,
  ]);
  expect(
    rows.map((row) => [row.annotation.id, row.problemText, row.deletable]),
  ).toEqual([
    ["blocked", "Blocked: The offset failed.", true],
    ["problem_binding", "Error", false],
    ["plain", null, true],
    ["quiet_binding", null, false],
  ]);
  expect(rows[1]!.group).toEqual({
    key: getPrimitiveRefKey(arc),
    label: "Arc 1",
  });
});

// T17j (F-1; issue 10's approved delta label drag), logic lane (descriptor
// seam `getSketchAnnotationDescriptors` + `patchSketchDimensionAnnotationPlacement`):
// the viewport now writes a label drag's placement at the label's own
// descriptor anchor plus the pointer's sketch displacement since the grab.
// For every draggable dimension kind, placing at the label's own anchor
// changes nothing (no jump when a drag starts), and a displacement moves
// the label the way its placement allows. cadara-bmy0: every dimension-line
// label follows the pointer in 2D (the offset and its position along the
// line), including point-to-origin, point-to-axis-datum and point-to-axis
// (point-line) distances; red before: pointDatumDistance had no drag handle
// and every label followed only the offset.
test("T17j F-1: for every draggable dimension kind a placement at the label's own anchor changes nothing, and a displacement moves the label as its placement allows", () => {
  const fresh = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  const line = (session: SketchSessionState, a: SketchPoint, b: SketchPoint) =>
    acceptSketchDraw(startSketchDraw(beginSketchTool(session, "line"), a), b);
  let session = line(fresh, [0, 0], [4, 0]);
  session = line(session, [-1, 1], [-1, 4]);
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [8, 1]),
    [10, 1],
  );
  session = line(session, [0, 6], [4, 6]);
  const [lineA, lineB, circle, lineC] = session.definition.entities;
  if (
    lineA?.kind !== "lineSegment" ||
    lineB?.kind !== "lineSegment" ||
    !circle ||
    !lineC
  )
    throw new Error("premise: three lines and a circle");
  const aPoints = [lineA.startPointId, lineA.endPointId] as const;
  const local = (entityId: SketchEntityId) =>
    ({ kind: "localEntity", entityId }) as const;
  const dimensions = [
    { kind: "lineLength", entityId: lineA.entityId },
    { kind: "distance", axis: "aligned", pointIds: aPoints },
    { kind: "horizontalDistance", pointIds: aPoints },
    {
      kind: "pointDatumDistance",
      axis: "horizontal",
      point: { kind: "localPoint", pointId: lineA.endPointId },
      datum: { kind: "sketchDatum", datum: "origin" },
    },
    {
      kind: "pointDatumDistance",
      axis: "vertical",
      point: { kind: "localPoint", pointId: lineB.endPointId },
      datum: { kind: "sketchDatum", datum: "xAxis" },
    },
    {
      kind: "linePointDistance",
      line: { kind: "sketchDatum", datum: "xAxis" },
      point: { kind: "localPoint", pointId: lineB.endPointId },
    },
    {
      kind: "lineDistance",
      lines: [local(lineA.entityId), local(lineC.entityId)],
    },
    { kind: "circleRadius", entityId: circle.entityId },
    { kind: "diameter", entityId: circle.entityId },
    {
      kind: "lineAngle",
      lines: [local(lineA.entityId), local(lineB.entityId)],
    },
  ].map((dimension, index) => ({
    ...dimension,
    dimensionId: `dimension_t17j_${index}_${dimension.kind}`,
    label: dimension.kind,
    reference: true as const,
  }));
  session = {
    ...session,
    definition: {
      ...session.definition,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
    } as unknown as SketchSessionState["definition"],
  };
  const anchorOf = (state: SketchSessionState, id: string) => {
    const descriptor = getSketchAnnotationDescriptors(state).find(
      (candidate) => candidate.id === id,
    )!;
    expect(descriptor.dragHandle, `${id} is draggable`).toBeDefined();
    expect(descriptor.anchor.kind).toBe("sketchPoint");
    return descriptor.anchor.point as SketchPoint;
  };
  const place = (state: SketchSessionState, id: string, point: SketchPoint) =>
    patchSketchDimensionAnnotationPlacement(state, {
      intent: "setDimensionAnnotationPlacement",
      dimensionId: id,
      point,
    });
  const delta: SketchPoint = [0.7, 0.9];
  const close = (actual: SketchPoint, expected: SketchPoint, message: string) =>
    expect(
      Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
      message,
    ).toBeLessThan(1e-9);
  for (const { dimensionId: id, kind } of dimensions) {
    // A first placement off the default, then the label's own anchor.
    const placed = place(session, id, kind === "lineAngle" ? [2, 2] : [3, 2]);
    const anchor = anchorOf(placed, id);
    const restarted = place(placed, id, anchor);
    close(anchorOf(restarted, id), anchor, `${kind}: no jump at the grab`);
    const moved = anchorOf(
      place(placed, id, [anchor[0] + delta[0], anchor[1] + delta[1]]),
      id,
    );
    switch (kind) {
      case "lineAngle": {
        // The lines' corner is their intersection (-1, 0).
        const radius = (point: SketchPoint) =>
          Math.hypot(point[0] + 1, point[1]);
        expect(radius(moved), kind).toBeCloseTo(
          radius([anchor[0] + delta[0], anchor[1] + delta[1]]),
          9,
        );
        break;
      }
      default:
        // The label follows the pointer along its line and across it (a
        // radius or diameter turns to the pointer and slides along it).
        close(moved, [anchor[0] + delta[0], anchor[1] + delta[1]], kind);
    }
  }
  // cadara-bmy0: a point-to-axis-datum distance measures to the point's
  // perpendicular foot on the axis: its datum extension line starts there,
  // not at the origin. Line B's end (-1, 4) to the X axis: the foot (-1, 0).
  const axisDatum = buildCommittedDimensionOverlays(
    session,
    session.definition,
  ).find(
    (overlay) => overlay.id === "dimension_t17j_4_pointDatumDistance-overlay",
  );
  expect(
    axisDatum?.kind === "dimensionLine" &&
      axisDatum.extensionLines?.map((line) => line.start),
    "extension lines from the point and from its foot on the X axis",
  ).toEqual([
    [-1, 4],
    [-1, 0],
  ]);
});

test("unsupported constraint diagnostics reach annotation and list explanations", () => {
  const session = drawWith(newSpecSession(), "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  const live = session.liveSolve!;
  const constraintId = session.definition.constraints[0]!.constraintId;
  const message =
    "Unsupported operand combination: no solver rows were admitted.";
  const unsupported = {
    ...session,
    liveSolve: {
      ...live,
      solvedSnapshot: {
        ...live.solvedSnapshot,
        status: {
          solveState: "failed" as const,
          constraintState: "inconsistent" as const,
        },
        constraintStatuses: [{ constraintId, status: "conflicting" as const }],
        diagnostics: [
          {
            code: "unsupported-constraint-operands",
            severity: "error" as const,
            message,
            target: { kind: "constraint" as const, constraintId },
          },
        ],
      },
    },
  };
  const descriptors = getSketchAnnotationDescriptors(unsupported);
  expect(descriptors.find((d) => d.id === constraintId)?.problem).toEqual({
    status: "conflict",
    explanation: message,
  });
  expect(
    getSketchAnnotationListRows(descriptors).find(
      (r) => r.annotation.id === constraintId,
    )?.problemText,
  ).toBe(`Conflict: ${message}`);
});
