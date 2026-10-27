// T13e (D11), logic lane, sketch-session constraint-authoring seam: when the
// Dimension tool's value input opens, the determined-quantity probe decides
// its mode. Determined → Reference mode (measured value read-only, the note,
// a visible "Make driving" switch; commit authors a reference dimension).
// Independent → driving mode as before. Unaccepted live solve → driving mode
// with a note. Every row runs in a multi-entity sketch and checks both
// directions, so a no-op probe fails.
import { expect, test } from "vitest";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import { probeSketchDimensionRedundancy } from "@/core/sketch-solver";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  getSketchAnnotationDescriptors,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  startSketchDraw,
  withLiveSolveBasis,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { createSessionCommitFactories } from "./tool-authoring";
import { createSketchFilletMutation } from "@/core/sketch-editing/operations";
import { createSketchSessionFromSnapshot } from "@/domain/editor/sketch-session";
import { updateSketchReferenceProjection } from "@/domain/editor/sketch-session/references";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import {
  CONSTRAINT_DETERMINED_NOTE,
  CONSTRAINT_REDUNDANCY_UNCHECKED_NOTE,
} from "@/domain/editor/sketch-session/constraints";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
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

function entity(session: SketchSessionState, label: string) {
  const found = session.definition.entities.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`No entity ${label}`);
  return found;
}

function circle(session: SketchSessionState) {
  return session.definition.entities.find(
    (candidate) => candidate.kind === "circle" && !candidate.isConstruction,
  )!;
}

/** Selects the targets and places the annotation: the value input opens. */
function openInput(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
  placement: SketchPoint,
  toolId: Parameters<typeof beginSketchTool>[1] = "dimensionDistance",
) {
  let next = beginSketchTool(session, toolId);
  for (const target of targets)
    next = selectSketchConstraintTarget(next, target);
  return pinSketchConstraintPreview(next, placement);
}

function input(session: SketchSessionState) {
  const found = session.toolPresentation?.floatingInput;
  expect(found, "the value input is open").toBeTruthy();
  return found!;
}

function commit(session: SketchSessionState) {
  return patchSketchConstraintValue(session, {
    intent: "commitConstraintValue",
  });
}

function toggleMode(session: SketchSessionState) {
  return patchSketchConstraintValue(
    session,
    input(session).modeSwitch!.action.patch,
  );
}

function positions(session: SketchSessionState) {
  return session.definition.points.map((point) => point.position);
}

function expectDrivingMode(session: SketchSessionState) {
  const opened = input(session);
  expect(opened.readOnly, "editable").toBeUndefined();
  expect(opened.modeSwitch, "no switch").toBeUndefined();
  expect(opened.readout, "no note").toBeUndefined();
  expect(opened.confirmLabel).toBe("Commit");
}

function expectReferenceMode(session: SketchSessionState, measured: string) {
  expect(input(session)).toMatchObject({
    value: measured,
    readOnly: true,
    readout: "Already determined by other requirements",
    confirmLabel: "Add reference",
    modeSwitch: {
      label: "Make driving",
      checked: false,
      action: {
        type: "patch",
        patch: { intent: "setConstraintValueMode", reference: false },
      },
    },
  });
}

/** Rectangle [1,1]–[5,4] (width 4 driving) and a free circle (centre [12,1], r 2.5). */
function rectangleWithWidth() {
  let session = draw(newSession(), "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  session = draw(session, "circle", [
    [12, 1],
    [14.5, 1],
  ]);
  session = commit(
    openInput(session, [entity(session, "Rectangle 1 bottom").target], [3, 0]),
  );
  expect(session.definition.dimensions, "premise: width").toHaveLength(1);
  expect(session.liveSolve?.accepted, "premise: solved").toBe(true);
  return session;
}

test("T13e D11: the opposite width opens in Reference mode; the free height, the free circle and an unsized rectangle's width open driving", () => {
  const session = rectangleWithWidth();
  const top = openInput(
    session,
    [entity(session, "Rectangle 1 top").target],
    [3, 6],
  );
  expectReferenceMode(top, "4");
  expect(top.constraintAuthoring?.redundancy).toBe("determined");

  expectDrivingMode(
    openInput(session, [entity(session, "Rectangle 1 right").target], [6, 2]),
  );
  expectDrivingMode(openInput(session, [circle(session).target], [15, 3]));
  let unsized = draw(newSession(), "rectangle", [
    [1, 1],
    [5, 4],
  ]);
  unsized = draw(unsized, "circle", [
    [12, 1],
    [14.5, 1],
  ]);
  expectDrivingMode(
    openInput(unsized, [entity(unsized, "Rectangle 1 top").target], [3, 6]),
  );
});

test("T13e D11: committing in Reference mode authors a reference dimension; nothing moves and the label reads (4.00)", () => {
  const session = rectangleWithWidth();
  const opened = openInput(
    session,
    [entity(session, "Rectangle 1 top").target],
    [3, 6],
  );
  // The measured value is read-only: a typed value is ignored.
  const typed = patchSketchConstraintValue(opened, { value: "9" });
  expect(typed).toBe(opened);
  const committed = commit(typed);
  const added = committed.definition.dimensions.at(-1)!;
  expect(committed.definition.dimensions).toHaveLength(2);
  expect(isReferenceDimension(added)).toBe(true);
  expect(added).toMatchObject({ kind: "lineLength", reference: true });
  expect("value" in added, "a new reference carries no value").toBe(false);
  expect(committed.liveSolve?.accepted).toBe(true);
  expect(committed.validationMessage).toBeNull();
  expect(positions(committed), "nothing moves").toEqual(positions(session));
  const descriptor = getSketchAnnotationDescriptors(committed).find(
    (entry) => entry.id === added.dimensionId,
  );
  expect(descriptor).toMatchObject({ visibleLabel: "(4.00)", reference: true });
});

test("T13e D11: Make driving with another value is a retained conflict; the typed value is kept exactly", () => {
  const session = rectangleWithWidth();
  const driving = toggleMode(
    openInput(session, [entity(session, "Rectangle 1 top").target], [3, 6]),
  );
  expect(input(driving)).toMatchObject({
    value: "4",
    readout: "Already determined by other requirements",
    confirmLabel: "Commit",
    modeSwitch: { label: "Make driving", checked: true },
  });
  expect(input(driving).readOnly).toBeUndefined();
  const committed = commit(patchSketchConstraintValue(driving, { value: "6" }));
  const added = committed.definition.dimensions.at(-1)!;
  expect(isReferenceDimension(added)).toBe(false);
  expect(added.kind === "lineLength" && added.value).toEqual({
    source: "literal",
    value: 6,
  });
  expect(committed.liveSolve?.accepted, "retained, invalid").toBe(false);
  expect(committed.validationMessage).toMatch(
    new RegExp(`^${added.label} \\(6 mm\\) conflicts with `),
  );
});

test("T13e D11: Make driving at the measured value is a consistent driving dimension; switching back restores the read-only measured value", () => {
  const session = rectangleWithWidth();
  const opened = openInput(
    session,
    [entity(session, "Rectangle 1 top").target],
    [3, 6],
  );
  const driving = toggleMode(opened);
  const edited = patchSketchConstraintValue(driving, { value: "7" });
  expect(input(edited).value).toBe("7");
  const back = toggleMode(edited);
  expectReferenceMode(back, "4");

  const committed = commit(toggleMode(back));
  const added = committed.definition.dimensions.at(-1)!;
  expect(isReferenceDimension(added)).toBe(false);
  expect(added.kind === "lineLength" && added.value).toEqual({
    source: "literal",
    value: 4,
  });
  expect(committed.liveSolve?.accepted).toBe(true);
  expect(positions(committed), "nothing moves").toEqual(positions(session));
});

test("T13e D11: with an unaccepted live solve the input opens driving with the unchecked note and no switch", () => {
  const session = rectangleWithWidth();
  const conflicting = commit(
    patchSketchConstraintValue(
      toggleMode(
        openInput(session, [entity(session, "Rectangle 1 top").target], [3, 6]),
      ),
      { value: "6" },
    ),
  );
  expect(conflicting.liveSolve?.accepted, "premise: invalid").toBe(false);
  const opened = openInput(
    conflicting,
    [entity(conflicting, "Rectangle 1 right").target],
    [6, 2],
  );
  expect(opened.constraintAuthoring?.redundancy).toBe("invalidSketch");
  expect(input(opened).readout).toBe(
    "Can't check redundancy while the sketch is invalid",
  );
  expect(input(opened).modeSwitch).toBeUndefined();
  expect(input(opened).readOnly).toBeUndefined();
  expect(input(opened).confirmLabel).toBe("Commit");
  expect(CONSTRAINT_REDUNDANCY_UNCHECKED_NOTE).toBe(input(opened).readout);
  expect(CONSTRAINT_DETERMINED_NOTE).toBe(
    "Already determined by other requirements",
  );
});

/**
 * Rectangle [0,0]–[6,4] with a circle tangent to its bottom, top and left
 * sides (the third tangency keeps the contacts on the segments), and a free
 * line elsewhere.
 */
function slotCircle() {
  let session = draw(newSession(), "rectangle", [
    [0, 0],
    [6, 4],
  ]);
  session = draw(session, "circle", [
    [2, 2],
    [3.8, 2],
  ]);
  session = draw(session, "line", [
    [10, 0],
    [13, 3],
  ]);
  for (const side of [
    "Rectangle 1 bottom",
    "Rectangle 1 top",
    "Rectangle 1 left",
  ]) {
    let next = beginSketchTool(session, "constraintTangent");
    next = selectSketchConstraintTarget(next, entity(session, side).target);
    next = selectSketchConstraintTarget(next, circle(session).target);
    session = beginSketchTool(next, "line");
  }
  expect(
    session.definition.constraints.filter((entry) => entry.kind === "tangent"),
    "premise: three tangencies",
  ).toHaveLength(3);
  expect(session.liveSolve?.accepted, "premise: solved").toBe(true);
  return session;
}

test("T13e D11: a circle tangent to two parallel lines a sized distance apart has a determined diameter and radius; with the distance free both are independent", () => {
  const free = slotCircle();
  expectDrivingMode(openInput(free, [circle(free).target], [5, 5]));
  expectDrivingMode(
    openInput(free, [circle(free).target], [5, 5], "dimensionRadius"),
  );

  const sized = commit(
    openInput(free, [entity(free, "Rectangle 1 right").target], [7, 2]),
  );
  expect(sized.liveSolve?.accepted, "premise: height sized").toBe(true);
  const sizedCircle = circle(sized);
  const diameter =
    2 * (sizedCircle.kind === "circle" ? sizedCircle.radius : NaN);
  expectReferenceMode(
    openInput(sized, [circle(sized).target], [5, 5]),
    String(Number(diameter.toFixed(6))),
  );
  expect(
    openInput(sized, [circle(sized).target], [5, 5], "dimensionRadius")
      .constraintAuthoring?.redundancy,
  ).toBe("determined");
  expectDrivingMode(
    openInput(sized, [entity(sized, "Rectangle 1 bottom").target], [3, -1]),
  );
});

test("T13e D11: a polygon with equal sides and one side sized offers another side as a reference; unsized, it opens driving", () => {
  let session = draw(newSession(), "inscribedPolygon", [
    [0, 0],
    [3, 0],
  ]);
  session = draw(session, "circle", [
    [8, 0],
    [9, 0],
  ]);
  const sides = () =>
    session.definition.entities.filter(
      (candidate) => candidate.kind === "lineSegment",
    );
  expectDrivingMode(openInput(session, [sides()[3]!.target], [-3, -1]));
  session = commit(openInput(session, [sides()[0]!.target], [3, 2]));
  expect(session.liveSolve?.accepted, "premise: one side sized").toBe(true);
  expect(
    openInput(session, [sides()[3]!.target], [-3, -1]).constraintAuthoring
      ?.redundancy,
  ).toBe("determined");
});

/** A closed n-gon of circumradius 5 drawn as one Line chain. */
function drawnPolygon(n: number) {
  const corners: SketchPoint[] = Array.from({ length: n + 1 }, (_, k) => {
    const angle = (2 * Math.PI * (k % n)) / n + 0.1;
    return [5 * Math.cos(angle), 5 * Math.sin(angle)];
  });
  const session = draw(newSession(), "line", corners);
  expect(
    session.definition.entities.filter((e) => e.kind === "lineSegment"),
    "premise: n sides",
  ).toHaveLength(n);
  return session;
}

test("T13e review R-1: a free 0.1 mm line hanging off the rounded 32-gon has an independent angle to a side (a solved trial, never a vacuous verdict)", () => {
  // The rounded 32-gon (side 1, every corner filleted r 0.15).
  let definition = drawnPolygon(32).definition;
  const sides = definition.entities
    .filter((e) => e.kind === "lineSegment")
    .map((e) => e.entityId);
  for (let k = 0; k < 32; k += 1) {
    const sequence = 500 + k;
    const filleted = createSketchFilletMutation({
      definition,
      entityIds: [sides[k]!, sides[(k + 1) % 32]!],
      radius: 0.15,
      sequence,
      factories: createSessionCommitFactories(
        sequence,
        "sketch_draft" as never,
      ),
    });
    expect(filleted.valid, "premise: fillet").toBe(true);
    definition = filleted.definition!;
  }
  const side = definition.entities.find((e) => e.entityId === sides[4]);
  if (side?.kind !== "lineSegment") throw new Error("side 5");
  const anchor = definition.points.find(
    (p) => p.pointId === side.startPointId,
  )!;
  const tip = {
    ...anchor,
    pointId: "sketch_point_t13e_tip" as typeof anchor.pointId,
    label: "tip",
    position: [
      anchor.position[0] + 0.1 * Math.cos(2),
      anchor.position[1] + 0.1 * Math.sin(2),
    ] as typeof anchor.position,
  };
  const shortLine = {
    ...side,
    entityId: "sketch_entity_t13e_short" as typeof side.entityId,
    label: "short",
    startPointId: anchor.pointId,
    endPointId: tip.pointId,
  };
  const withShort = {
    ...definition,
    pointIds: [...definition.pointIds, tip.pointId],
    points: [...definition.points, tip],
    entityIds: [...definition.entityIds, shortLine.entityId],
    entities: [...definition.entities, shortLine],
  };
  const verdict = probeSketchDimensionRedundancy({
    definition: withShort as never,
    candidate: {
      dimensionId: "dimension_t13e_angle",
      kind: "lineAngle",
      label: "angle",
      lines: [
        { kind: "localEntity", entityId: side.entityId },
        { kind: "localEntity", entityId: shortLine.entityId },
      ],
      valueRadians: 1,
    } as never,
    tolerances: newSession().solverTolerances,
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  });
  expect(verdict.kind).toBe("independent");
  const trials = "trialValues" in verdict ? verdict.trialValues : [];
  expect(trials.length, "at least one solved trial").toBeGreaterThan(0);
  for (const value of trials) {
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(Math.PI);
  }
}, 60_000);

test("T13e review A-1: the verdict cache does not outlive a tolerance change on the same definition", () => {
  // A 12-gon with chained equal sides, side 1 sized: side 12 is determined
  // at τ = 1e-3. At τ = 0.03 the capped δ (0.1·m ≈ 0.26) is below the
  // 12-row chain's spread (≈ 13τ = 0.39), so the probe reads independent.
  let session = drawnPolygon(12);
  const sides = () =>
    session.definition.entities.filter((e) => e.kind === "lineSegment");
  for (let k = 0; k + 1 < 12; k += 1) {
    let next = beginSketchTool(session, "constraintEqual");
    next = selectSketchConstraintTarget(next, sides()[k]!.target);
    next = selectSketchConstraintTarget(next, sides()[k + 1]!.target);
    session = beginSketchTool(next, "line");
  }
  session = commit(openInput(session, [sides()[0]!.target], [6, 2]));
  expect(session.liveSolve?.accepted, "premise: sized chain").toBe(true);
  const side12 = sides()[11]!.target;
  expect(
    openInput(session, [side12], [6, -2]).constraintAuthoring?.redundancy,
  ).toBe("determined");

  const coarse = withLiveSolveBasis(
    {
      ...session,
      solverTolerances: {
        ...session.solverTolerances,
        coincidence: 0.03,
        minimumSegmentLength: 0.03,
      },
      modelingTolerance: 0.03,
    },
    session.definition,
  );
  expect(coarse.definition, "premise: same definition").toBe(
    session.definition,
  );
  expect(coarse.liveSolve?.accepted, "premise: still solved").toBe(true);
  expect(
    openInput(coarse, [side12], [6, -2]).constraintAuthoring?.redundancy,
  ).toBe("independent");
});

test("T13e re-review A-1′: the verdict is recomputed when a projection result lands on the same definition", () => {
  // A hexagon (side 2) with chained equal sides whose side 1 ends are
  // coincident to two projected points. Side 6 is determined while the
  // projected points are 2 apart (δ = 2·(1+7)·τ exceeds the 7-row spread);
  // when a new projection puts them 0.04 apart, the capped δ
  // (max(0.1·m, 4τ) = 4τ) no longer does, so side 6 reads independent.
  const sketch = makeSketchFixture();
  const corner = (k: number): [number, number] => [
    2 * Math.cos((Math.PI * k) / 3),
    2 * Math.sin((Math.PI * k) / 3),
  ];
  for (let k = 0; k < 6; k += 1) sketch.point(`v${k}`, ...corner(k));
  for (let k = 0; k < 6; k += 1)
    sketch.line(`s${k + 1}`, `v${k}`, `v${(k + 1) % 6}`);
  const referenceId = sketch.project("pins", [
    { geometryId: "pin0", kind: "point", position: corner(0) },
    { geometryId: "pin1", kind: "point", position: corner(1) },
  ] as never);
  const built = sketch.build();
  const pin = (k: 0 | 1) => ({
    constraintId: `constraint_t13e_pin${k}`,
    kind: "coincidentProjectedPoint",
    label: `pin ${k}`,
    point: { kind: "localPoint", pointId: `sketch_point_v${k}` },
    projectedPoint: {
      kind: "projectedGeometry",
      reference: { kind: "projectedPoint", referenceId, geometryId: `pin${k}` },
    },
  });
  const equalities = Array.from({ length: 5 }, (_, k) => ({
    constraintId: `constraint_t13e_equal${k + 1}`,
    kind: "equalLength",
    label: `equal ${k + 1}`,
    entityIds: [`sketch_entity_s${k + 1}`, `sketch_entity_s${k + 2}`],
  }));
  const constraints = [...equalities, pin(0), pin(1)];
  const definition = {
    ...built.definition,
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
  } as never as typeof built.definition;
  const projection = (second: [number, number]) =>
    [
      {
        referenceId,
        status: "projected",
        diagnostics: [],
        geometry: [
          { geometryId: "pin0", kind: "point", position: corner(0) },
          { geometryId: "pin1", kind: "point", position: second },
        ],
      },
    ] as never as ProjectedSketchReferenceRecord[];
  const opened = withSketchSnapScale(
    createSketchSessionFromSnapshot(
      sketchSnapshotRecordForTest(
        { ...built, definition },
        [],
        createStandardPlaneDefinition("xy"),
      ),
      OCC_KERNEL_SETTINGS,
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  const wide = updateSketchReferenceProjection(
    opened,
    projection(corner(1)),
    [],
  );
  expect(wide.liveSolve?.accepted, "premise: solved").toBe(true);
  const side6 = entity(wide, "s6").target;
  expect(
    openInput(wide, [side6], [3, -3]).constraintAuthoring?.redundancy,
  ).toBe("determined");

  const near: [number, number] = [corner(0)[0] - 0.02, corner(0)[1] + 0.0346];
  const narrow = updateSketchReferenceProjection(wide, projection(near), []);
  expect(narrow.definition, "premise: same definition").toBe(wide.definition);
  expect(narrow.liveSolve?.accepted, "premise: still solved").toBe(true);
  expect(
    openInput(narrow, [side6], [3, -3]).constraintAuthoring?.redundancy,
  ).toBe("independent");
});
