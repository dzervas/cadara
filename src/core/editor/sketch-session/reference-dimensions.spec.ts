// T13d (logic lane, sketch-session annotation seam): Make reference / Make
// driving from the dimension's edit popup, the reference's "(value)" label
// following the geometry under a drag, refusal of redundant Make driving,
// and Finish → publish → reopen through the mock and
// OCC kernel adapters. Every row runs in a rectangle + circle sketch.
import { expect, test } from "vitest";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { DimensionDefinition } from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  finishSketchGeometryDrag,
  getSketchAnnotationDescriptors,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { openSketchSessionFromSelection } from "@/core/editor/sketch-session-controller";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  requireSketchDefinition,
  validateSketchDefinition,
} from "@/contracts/sketch/runtime-schema";
import { solveSketchDefinitionCore } from "@/core/sketch-solver";
import { getSketchSessionDerivationSettings } from "./session-definition";
import {
  resolveSketchDefinitionForSolve,
  SKETCH_NOT_SOLVED_YET,
} from "./session-live-solve";

function draw(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly SketchPoint[],
) {
  let next = startSketchDraw(beginSketchTool(session, toolId), points[0]!);
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return beginSketchTool(next, "line");
}

/** A rectangle [1,1]–[5,4] and a circle (centre [12,1], r 2.5). */
function rectangleAndCircle(
  session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  ),
) {
  let next = draw(session, "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  next = draw(next, "circle", [
    [12, 1],
    [14.5, 1],
  ]);
  expect(next.liveSolve?.accepted, "premise: solved").toBe(true);
  return next;
}

function entity(session: SketchSessionState, label: string) {
  const found = session.definition.entities.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`No entity ${label}`);
  return found;
}

function circle(session: SketchSessionState) {
  return session.definition.entities.find(
    (candidate) => candidate.kind === "circle",
  )!;
}

function dimensionWith(
  session: SketchSessionState,
  toolId: Parameters<typeof beginSketchTool>[1],
  targets: readonly PrimitiveRef[],
  placement: SketchPoint,
  value?: string,
) {
  let next = beginSketchTool(session, toolId);
  for (const target of targets)
    next = selectSketchConstraintTarget(next, target);
  next = pinSketchConstraintPreview(next, placement);
  if (value !== undefined) next = patchSketchConstraintValue(next, { value });
  return beginSketchTool(
    patchSketchConstraintValue(next, { intent: "commitConstraintValue" }),
    "line",
  );
}

/** Rectangle + circle with a driving diameter (5) and a driving width (4). */
function dimensioned() {
  let session = rectangleAndCircle();
  session = dimensionWith(
    session,
    "dimensionDistance",
    [circle(session).target],
    [15, 3],
  );
  session = dimensionWith(
    session,
    "dimensionDistance",
    [entity(session, "Rectangle 1 bottom").target],
    [3, 0],
  );
  expect(session.definition.dimensions.map((d) => d.kind)).toEqual([
    "diameter",
    "lineLength",
  ]);
  return session;
}

function openEdit(session: SketchSessionState, dimension: DimensionDefinition) {
  return beginSketchAnnotationEdit(session, {
    kind: "dimension",
    sketchId: session.sketchId ?? "sketch_draft",
    dimensionId: dimension.dimensionId,
  } as Parameters<typeof beginSketchAnnotationEdit>[1]);
}

function makeReference(session: SketchSessionState, index: number) {
  const editing = openEdit(session, session.definition.dimensions[index]!);
  const input = editing.toolPresentation?.floatingInput;
  expect(input?.modeSwitch?.checked).toBe(true);
  return patchSketchConstraintValue(editing, input!.modeSwitch!.action.patch);
}

function radiusOf(session: SketchSessionState) {
  const found = circle(session);
  return found.kind === "circle" ? found.radius : NaN;
}

function rimDrag(session: SketchSessionState, to: SketchPoint) {
  const found = circle(session);
  const centre = session.definition.points.find(
    (point) => found.kind === "circle" && point.pointId === found.centerPointId,
  )!.position;
  const rim: SketchPoint = [centre[0] + radiusOf(session), centre[1]];
  return finishSketchGeometryDrag(
    beginSketchGeometryDrag(session, found.target, rim, {
      kind: "rim",
      entityId: found.entityId,
    }),
    to,
  );
}

function descriptor(session: SketchSessionState, index: number) {
  const id = session.definition.dimensions[index]!.dimensionId;
  return getSketchAnnotationDescriptors(session).find(
    (entry) => entry.id === id,
  )!;
}

test("T13d: Make reference marks the dimension in one commit; the label shows the measured value in parentheses and the drag is free", () => {
  const session = dimensioned();
  expect(
    radiusOf(rimDrag(session, [16, 1])),
    "premise: the driving diameter holds the rim",
  ).toBeCloseTo(2.5, 6);

  const reference = makeReference(session, 0);
  const diameter = reference.definition.dimensions[0]!;
  expect(isReferenceDimension(diameter)).toBe(true);
  // D9′ (review A-2): the stored value is kept untouched and ignored.
  expect(diameter, "the stored value is kept").toEqual({
    ...session.definition.dimensions[0],
    reference: true,
  });
  expect(reference.definition.dimensions[1], "the width is untouched").toBe(
    session.definition.dimensions[1],
  );
  expect(reference.activeAnnotationEdit, "the popup closes").toBeNull();
  expect(reference.liveSolve?.accepted).toBe(true);
  expect(reference.validationMessage).toBeNull();
  expect(
    reference.liveSolve?.solvedSnapshot.dimensionStatuses[0],
  ).toMatchObject({ status: "driven", solvedValue: expect.closeTo(5, 9) });
  expect(descriptor(reference, 0)).toMatchObject({
    visibleLabel: "(5.00)",
    reference: true,
  });
  expect(descriptor(reference, 0).detail).toBe("(5.00) mm reference diameter");
  expect(descriptor(session, 0).visibleLabel, "premise: driving label").toBe(
    "5.00",
  );

  const dragged = rimDrag(reference, [16, 1]);
  expect(radiusOf(dragged), "a reference does not hold the rim").toBeCloseTo(
    4,
    6,
  );
  expect(dragged.liveSolve?.accepted).toBe(true);
  expect(
    descriptor(dragged, 0).visibleLabel,
    "the measured value follows",
  ).toBe("(8.00)");
  expect(
    isReferenceDimension(dragged.definition.dimensions[0]!),
    "the drag keeps it a reference",
  ).toBe(true);
});

test("T13d: a reference's popup shows its measured value read-only and Make driving commits the measured value, holding the geometry again", () => {
  const dragged = rimDrag(makeReference(dimensioned(), 0), [16, 1]);
  const editing = openEdit(dragged, dragged.definition.dimensions[0]!);
  const input = editing.toolPresentation?.floatingInput;
  expect(input).toMatchObject({
    label: "Diameter (reference)",
    readout: "Measured 8.00 mm",
    readOnly: true,
    hideSubmit: true,
    value: "8",
  });
  expect(input?.secondaryAction, "no Make reference on a reference").toBe(
    undefined,
  );
  const driving = patchSketchConstraintValue(editing, {
    intent: "commitAnnotationValue",
  });
  const diameter = driving.definition.dimensions[0]!;
  expect(isReferenceDimension(diameter)).toBe(false);
  expect(diameter.kind === "diameter" && diameter.value).toEqual({
    source: "literal",
    value: expect.closeTo(8, 9),
  });
  expect(driving.liveSolve?.accepted).toBe(true);
  expect(radiusOf(driving), "nothing moves").toBeCloseTo(4, 6);
  expect(descriptor(driving, 0).visibleLabel).toBe("8.00");
  expect(
    radiusOf(rimDrag(driving, [18, 1])),
    "the driving diameter holds the rim again",
  ).toBeCloseTo(4, 6);
});

test("O5: reference input ignores typing; Make driving stages editing and switching back discards the draft", () => {
  const source = dimensioned();
  const session = patchSketchConstraintValue(
    openEdit(source, source.definition.dimensions[0]!),
    { intent: "makeAnnotationReference" },
  );
  const editing = openEdit(session, session.definition.dimensions[0]!);
  expect(patchSketchConstraintValue(editing, { value: "9" })).toBe(editing);
  const staged = patchSketchConstraintValue(editing, {
    intent: "makeAnnotationDriving",
  });
  expect(staged.definition).toBe(session.definition);
  expect(staged.toolPresentation?.floatingInput?.readOnly).toBeUndefined();
  expect(staged.toolPresentation?.floatingInput?.hideSubmit).toBeUndefined();
  expect(staged.toolPresentation?.floatingInput?.modeSwitch?.checked).toBe(
    true,
  );
  const typed = patchSketchConstraintValue(staged, { value: "9" });
  const back = patchSketchConstraintValue(typed, {
    intent: "makeAnnotationReference",
  });
  expect(back.definition).toBe(session.definition);
  expect(back.toolPresentation?.floatingInput?.value).toBe("5");
  expect(back.toolPresentation?.floatingInput?.hideSubmit).toBe(true);
  const saved = patchSketchConstraintValue(typed, {
    intent: "commitAnnotationValue",
  });
  expect(isReferenceDimension(saved.definition.dimensions[0]!)).toBe(false);
  expect(radiusOf(saved)).toBeCloseTo(4.5, 6);
  expect(saved.liveSolve?.accepted).toBe(true);
});

test("O6: redundant Make driving refuses without mutation and offers atomic replacement of only conflicting dimensions", () => {
  let session = dimensioned();
  session = dimensionWith(
    session,
    "dimensionDistance",
    [entity(session, "Rectangle 1 top").target],
    [3, 5],
  );
  const top = session.definition.dimensions[2]!;
  const editing = openEdit(session, top);
  const refused = patchSketchConstraintValue(editing, {
    intent: "makeAnnotationDriving",
  });
  expect(refused.definition).toBe(session.definition);
  expect(refused.commitRequest).toBe(session.commitRequest);
  expect(refused.toolPresentation?.validation?.[0]?.message).toContain(
    session.definition.dimensions[1]!.label,
  );
  expect(refused.toolPresentation?.validation?.[0]?.message).not.toContain(
    session.definition.dimensions[0]!.label,
  );
  expect(refused.toolPresentation?.floatingInput?.readOnly).toBe(true);
  const offer = refused.toolPresentation?.floatingInput?.secondaryAction;
  expect(offer?.label).toBe("Make those references");
  const replaced = patchSketchConstraintValue(refused, offer!.action.patch);
  expect(isReferenceDimension(replaced.definition.dimensions[0]!)).toBe(false);
  expect(isReferenceDimension(replaced.definition.dimensions[1]!)).toBe(true);
  expect(isReferenceDimension(replaced.definition.dimensions[2]!)).toBe(false);
  expect(replaced.liveSolve?.accepted).toBe(true);
  expect(replaced.validationMessage).toBeNull();
});

test("O6: direct value conversion also refuses redundancy; cancelling the offer preserves every requirement", () => {
  let session = dimensioned();
  session = dimensionWith(
    session,
    "dimensionDistance",
    [entity(session, "Rectangle 1 top").target],
    [3, 5],
  );
  const editing = openEdit(session, session.definition.dimensions[2]!);
  const refused = patchSketchConstraintValue(editing, {
    intent: "commitAnnotationValue",
  });
  expect(refused.definition).toBe(session.definition);
  expect(refused.toolPresentation?.floatingInput?.secondaryAction?.label).toBe(
    "Make those references",
  );
  const cancelled = patchSketchConstraintValue(refused, {
    intent: "cancelAnnotationValue",
  });
  expect(cancelled.definition).toBe(session.definition);
  expect(cancelled.activeAnnotationEdit).toBeNull();
});

test("T13d: an arc endpoint binding opens no edit popup, so it can never be made a reference", () => {
  let session = draw(dimensioned(), "centerPointArc", [
    [20, 0],
    [22, 0],
    [20, 2],
  ]);
  const binding = session.definition.dimensions.find(
    (dimension) => dimension.kind === "arcStartPointCoincident",
  );
  expect(binding, "premise: the arc authors a binding").toBeTruthy();
  session = openEdit(session, binding!);
  expect(session.toolPresentation?.floatingInput).toBeUndefined();
});

// --- Finish → publish → reopen ---------------------------------------------

function createFakeOccWithoutKernel() {
  return {
    BRepBuilderAPI_MakeWire_1: function NoKernel() {
      throw Object.assign(new Error("fake OCC runtime: no kernel"), {
        code: "profile-face-invalid",
      });
    },
  } as unknown as OpenCascadeInstance;
}

const ADAPTERS: Array<[string, () => ModelingKernelAdapter]> = [
  ["mock", () => new MockKernelAdapter()],
  [
    "OCC",
    () =>
      new OpenCascadeKernelAdapter({
        createSolverAdapter: () =>
          new SketchConstraintSolverAdapter({
            neutralCurveQueries:
              createCertifiedNeutralCurveQueryCapabilityForTest(),
            revisionId: null,
          }),
        getOpenCascadeInstance: async () => createFakeOccWithoutKernel(),
      }),
  ],
];

test.each(ADAPTERS)(
  "T13d: Finish → publish → reopen keeps the reference dimension (%s kernel adapter); its profile is not blocked",
  async (_name, createAdapter) => {
    const adapter = createAdapter();
    const request = {
      contractVersion: "modeling-contract/v1alpha1" as const,
      documentId: "doc_workspace" as const,
    };
    const readSnapshot = async () =>
      (await adapter.getDocumentSnapshot(request)).snapshot;
    const opened = openSketchSessionFromSelection(
      [{ kind: "construction", constructionId: "construction_plane-xy" }],
      await readSnapshot(),
    );
    if (!opened) throw new Error("The XY plane opens a sketch session.");
    const session = makeReference(dimensioned_(opened), 0);
    const definition = session.definition;
    const result = await adapter.commitSketch({
      ...request,
      baseRevisionId: (await readSnapshot()).document.revisionId,
      solverCorrelation: {
        requestId: "request_t13d",
        projectionRequestId: "request_t13d:project",
        validationRequestId: "request_t13d:validate",
        solveRequestId: "request_t13d:solve",
        regionRequestId: "request_t13d:regions",
      },
      sketchId: null,
      sketchLabel: "Reference sketch",
      plane: opened.plane,
      definition,
    });
    expect(result.revisionState.kind).toBe("accepted");
    const published = (await readSnapshot()).document.sketches.find(
      (entry) => entry.sketchId === result.sketchId,
    )!;
    expect(published.sketch.definition.dimensions[0]).toEqual(
      definition.dimensions[0],
    );
    expect(published.sketch.solvedSnapshot.dimensionStatuses[0]).toMatchObject({
      status: "driven",
      solvedValue: expect.closeTo(5, 6),
    });
    expect(published.sketch.derivedValidity.state).toBe("current");
    expect(
      published.sketch.regions.length,
      "the reference never blocks profiles",
    ).toBeGreaterThan(0);

    // T17g3: reopened through the production entry (it has the live solve).
    const reopened = enterSketchSession(
      createSketchSessionFromSnapshot(published, OCC_KERNEL_SETTINGS),
    );
    expect(isReferenceDimension(reopened.definition.dimensions[0]!)).toBe(true);
    expect(descriptor(reopened, 0).visibleLabel).toBe("(5.00)");

    // Persistence: the authored document round-trips through the parser.
    const authored = parseAuthoredModelDocument(
      JSON.parse(
        JSON.stringify(
          createAuthoredModelDocumentFromSnapshot(await readSnapshot()),
        ),
      ),
    );
    expect(authored.ok).toBe(true);
    expect(
      authored.ok &&
        authored.document.sketches.find(
          (entry) => entry.sketchId === result.sketchId,
        )?.definition.dimensions[0],
    ).toEqual(definition.dimensions[0]);
  },
);

// T13d review A-4: a driving origin-datum distance survives Finish →
// publish → reopen through the modeling-service normalization (which had no
// pointDatumDistance branch before T13d).
test.each(ADAPTERS)(
  "T13d A-4: a driving pointDatumDistance commits, normalizes and reopens (%s kernel adapter)",
  async (_name, createAdapter) => {
    const adapter = createAdapter();
    const request = {
      contractVersion: "modeling-contract/v1alpha1" as const,
      documentId: "doc_workspace" as const,
    };
    const readSnapshot = async () =>
      (await adapter.getDocumentSnapshot(request)).snapshot;
    const opened = openSketchSessionFromSelection(
      [{ kind: "construction", constructionId: "construction_plane-xy" }],
      await readSnapshot(),
    );
    if (!opened) throw new Error("The XY plane opens a sketch session.");
    const session = rectangleAndCircle(enterSketchSession(opened));
    const corner = session.definition.points.find(
      (point) => point.position[0] === 5 && point.position[1] === 4,
    )!;
    const datumDistance: DimensionDefinition = {
      dimensionId:
        "dimension_origin_corner" as DimensionDefinition["dimensionId"],
      kind: "pointDatumDistance",
      label: "Origin to corner",
      axis: "aligned",
      point: { kind: "localPoint", pointId: corner.pointId },
      datum: { kind: "sketchDatum", datum: "origin" },
      value: createLiteralAuthoredValue(Math.hypot(5, 4)),
    };
    const definition = {
      ...session.definition,
      dimensionIds: [
        ...session.definition.dimensionIds,
        datumDistance.dimensionId,
      ],
      dimensions: [...session.definition.dimensions, datumDistance],
    };
    const result = await adapter.commitSketch({
      ...request,
      baseRevisionId: (await readSnapshot()).document.revisionId,
      solverCorrelation: {
        requestId: "request_t13d_pdd",
        projectionRequestId: "request_t13d_pdd:project",
        validationRequestId: "request_t13d_pdd:validate",
        solveRequestId: "request_t13d_pdd:solve",
        regionRequestId: "request_t13d_pdd:regions",
      },
      sketchId: null,
      sketchLabel: "Origin distance sketch",
      plane: opened.plane,
      definition,
    });
    expect(result.revisionState.kind).toBe("accepted");
    const published = (await readSnapshot()).document.sketches.find(
      (entry) => entry.sketchId === result.sketchId,
    )!;
    const normalized = requireSketchDefinition(
      JSON.parse(JSON.stringify(published.sketch.definition)),
    );
    expect(normalized.dimensions.at(-1)).toEqual(datumDistance);
    expect(validateSketchDefinition(normalized).success).toBe(true);
    const reopened = createSketchSessionFromSnapshot(
      { ...published, sketch: { ...published.sketch, definition: normalized } },
      OCC_KERNEL_SETTINGS,
    );
    expect(reopened.definition.dimensions.at(-1)).toEqual(datumDistance);
    // The reopened definition solves with the origin distance driving.
    const solved = solveSketchDefinitionCore({
      definition: resolveSketchDefinitionForSolve(normalized, []),
      tolerances: reopened.solverTolerances,
      ...getSketchSessionDerivationSettings(reopened),
      partialSolvePolicy: "bestEffort",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.dimensionStatuses.at(-1)).toMatchObject({
      status: "driving",
      solvedValue: expect.closeTo(Math.hypot(5, 4), 9),
    });
  },
);

function dimensioned_(opened: SketchSessionState) {
  let session = rectangleAndCircle(enterSketchSession(opened));
  session = dimensionWith(
    session,
    "dimensionDistance",
    [circle(session).target],
    [15, 3],
  );
  return session;
}

// T13d review R-1: a signed point-pair reference dragged across its points
// measures negative; it shows the magnitude and Make driving at the prefill
// stores the points in the measured direction, so nothing moves.
// cadara-bmy0: a label dragged along its line keeps its place through the
// swap (its stored position along the line is taken from the other end).
test("T13d R-1: a horizontal-distance reference dragged across shows its magnitude and Make driving keeps the geometry with a positive value", () => {
  let session = draw(rectangleAndCircle(), "line", [
    [25, 0],
    [21, 2],
  ]);
  const line = session.definition.entities.at(-1)!;
  if (line.kind !== "lineSegment") throw new Error("premise: a line");
  const pointTarget = (pointId: string) =>
    session.definition.points.find((point) => point.pointId === pointId)!
      .target;
  session = dimensionWith(
    session,
    "dimensionDistance",
    [pointTarget(line.startPointId), pointTarget(line.endPointId)],
    [23, -3],
  );
  const created = session.definition.dimensions.at(-1)!;
  expect(created).toMatchObject({ kind: "distance", axis: "horizontal" });
  const index = session.definition.dimensions.length - 1;
  session = makeReference(session, index);
  const moving =
    created.kind === "distance" ? created.pointIds[1] : line.endPointId;
  const from = session.definition.points.find(
    (point) => point.pointId === moving,
  )!;
  const fixedId =
    created.kind === "distance" ? created.pointIds[0] : line.startPointId;
  const fixedX = session.definition.points.find(
    (point) => point.pointId === fixedId,
  )!.position[0];
  const crossed = finishSketchGeometryDrag(
    beginSketchGeometryDrag(session, from.target, from.position),
    [fixedX - 3, from.position[1]],
  );
  expect(crossed.liveSolve?.accepted).toBe(true);
  const status = crossed.liveSolve!.solvedSnapshot.dimensionStatuses.at(-1)!;
  expect(status.status).toBe("driven");
  expect(status.solvedValue, "the status stays signed").toBeCloseTo(-3, 9);
  expect(descriptor(crossed, index).visibleLabel).toBe("(3.00)");

  // cadara-bmy0: the label dragged to a fifth of the way along its line.
  const placedLabel = patchSketchDimensionAnnotationPlacement(crossed, {
    intent: "setDimensionAnnotationPlacement",
    dimensionId: created.dimensionId,
    point: [fixedX - 0.6, from.position[1] - 2],
  });
  const placedDimension = placedLabel.definition.dimensions[index]!;
  const placedPosition =
    placedDimension.kind === "distance"
      ? placedDimension.annotationPlacement?.labelPosition
      : undefined;
  expect(placedPosition, "premise: off the midpoint").toBeCloseTo(0.2, 9);
  const labelPoint = descriptor(placedLabel, index).anchor;

  const editing = openEdit(
    placedLabel,
    placedLabel.definition.dimensions[index]!,
  );
  expect(editing.toolPresentation?.floatingInput).toMatchObject({
    value: "3",
    readout: "Measured 3.00 mm",
  });
  const driving = patchSketchConstraintValue(editing, {
    intent: "commitAnnotationValue",
  });
  const committed = driving.definition.dimensions[index]!;
  expect(isReferenceDimension(committed)).toBe(false);
  expect(committed.kind === "distance" && committed.pointIds).toEqual([
    moving,
    fixedId,
  ]);
  expect(committed.kind === "distance" && committed.value).toEqual({
    source: "literal",
    value: expect.closeTo(3, 9),
  });
  expect(driving.liveSolve?.accepted).toBe(true);
  expect(driving.validationMessage).toBeNull();
  for (const point of crossed.definition.points) {
    const after = driving.definition.points.find(
      (candidate) => candidate.pointId === point.pointId,
    )!.position;
    expect(after[0], "nothing moves").toBeCloseTo(point.position[0], 9);
    expect(after[1]).toBeCloseTo(point.position[1], 9);
  }
  expect(descriptor(driving, index).visibleLabel).toBe("3.00");
  expect(
    committed.kind === "distance" &&
      committed.annotationPlacement?.labelPosition,
    "cadara-bmy0: the swapped line keeps the label's place from its other end",
  ).toBeCloseTo(0.8, 9);
  expect(descriptor(driving, index).anchor, "the label does not move").toEqual(
    labelPoint,
  );
});

// T13d review A-5: a reference angle's accessible detail names its unit once.
test("T13d A-5: a reference angle's detail reads '(…°) reference angle'", () => {
  let session = draw(rectangleAndCircle(), "line", [
    [20, 0],
    [23, 3],
  ]);
  session = dimensionWith(
    session,
    "dimensionDistance",
    [
      entity(session, "Rectangle 1 bottom").target,
      session.definition.entities.at(-1)!.target,
    ],
    [10, 2],
  );
  const index = session.definition.dimensions.length - 1;
  expect(session.definition.dimensions[index]!.kind).toBe("lineAngle");
  const reference = makeReference(session, index);
  expect(descriptor(reference, index).detail).toMatch(
    /^\(\d+\.\d°\) reference angle$/,
  );
});

// T17o (T17g3 ADV-1, T14 T-16). Logic lane; seam: the sketch session's
// annotation descriptors. They read the session's live solve (the one the
// display draws), never a solve of their own. Red on base: the descriptors
// re-solved the definition, so a live solve that differs from that solve
// (here: a measured value only the live solve carries) was ignored, and a
// session without a live solve still showed solved values.
test("T17o ADV-1: annotation descriptors follow the live solve; without one nothing is measured", () => {
  const reference = makeReference(dimensioned(), 0);
  expect(descriptor(reference, 0).visibleLabel, "premise").toBe("(5.00)");
  const live = reference.liveSolve!;
  const forged: SketchSessionState = {
    ...reference,
    liveSolve: {
      ...live,
      solvedSnapshot: {
        ...live.solvedSnapshot,
        dimensionStatuses: live.solvedSnapshot.dimensionStatuses.map(
          (entry, index) =>
            index === 0 ? { ...entry, solvedValue: 7 } : entry,
        ),
      },
    },
  };
  expect(descriptor(forged, 0).visibleLabel).toBe("(7.00)");
  expect(descriptor(forged, 0).detail).toBe("(7.00) mm reference diameter");

  const unsolved = { ...reference, liveSolve: null };
  expect(descriptor(unsolved, 0).visibleLabel).not.toContain("5.00");
  expect(descriptor(unsolved, 0).detail).not.toContain("5.00");
});

// T17o (T17g3 ADV-2). The not-solved-yet sentinel is shared by every
// unsolved session, so it is frozen. Red on base: it was a plain object.
test("T17o ADV-2: SKETCH_NOT_SOLVED_YET is frozen, arrays included", () => {
  expect(Object.isFrozen(SKETCH_NOT_SOLVED_YET)).toBe(true);
  expect(Object.isFrozen(SKETCH_NOT_SOLVED_YET.status)).toBe(true);
  for (const list of [
    SKETCH_NOT_SOLVED_YET.solvedEntities,
    SKETCH_NOT_SOLVED_YET.solvedPoints,
    SKETCH_NOT_SOLVED_YET.constraintStatuses,
    SKETCH_NOT_SOLVED_YET.dimensionStatuses,
    SKETCH_NOT_SOLVED_YET.diagnostics,
  ]) {
    expect(Object.isFrozen(list)).toBe(true);
    expect(() => (list as unknown[]).push(1)).toThrow(TypeError);
  }
});
