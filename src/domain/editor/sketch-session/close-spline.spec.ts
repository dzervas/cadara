/**
 * T17c2 ([TECH] T17-16): Close spline. Logic lane; seams: the sketch
 * session's `computeSketchCloseSplineState` / `applySketchCloseSpline`
 * (the panel state and the action's write set), then the real owners
 * downstream: the live solve's wrapped reconstruction, the live region
 * derivation (certified neutral-curve query) and Finish through the mock
 * kernel → saved record → reopen. Splines are drawn with the real Spline
 * tool on entered sessions (T17-10′ builder); relationships are authored
 * by the production builders. The refusal set is T17b0 P-10's.
 */
import { describe, expect, test } from "vitest";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { createSketchDerivedTransformContribution } from "@/domain/sketch-editing/operations";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  entityRef,
  handleRef,
  pointRef,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  finalizeSketchDraw,
  publishSketchLiveRegions,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  appendDefinition,
  createSessionCommitFactories,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  applySketchCloseSpline,
  computeSketchCloseSplineState,
} from "./close-spline";

type P = readonly [number, number];
type Spline = Extract<SketchEntityDefinition, { kind: "spline" }>;

const entered = () =>
  enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
/** Draws a spline through `points` with the Spline tool, then disarms it. */
function drawSpline(session: SketchSessionState, points: readonly P[]) {
  let next = startSketchDraw(
    beginSketchTool(
      withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL),
      "spline",
    ),
    points[0]!,
  );
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return clearActiveSketchTool(finalizeSketchDraw(next));
}
function drawLine(session: SketchSessionState, a: P, b: P) {
  return clearActiveSketchTool(
    acceptSketchDraw(
      startSketchDraw(
        beginSketchTool(
          withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL),
          "line",
        ),
        a,
      ),
      b,
    ),
  );
}
const splines = (definition: SketchDefinition) =>
  definition.entities.filter(
    (entity): entity is Spline => entity.kind === "spline",
  );
const rebuild = (session: SketchSessionState, definition: SketchDefinition) =>
  rebuildSessionForDefinition(session, { definition });
const withSpline = (
  definition: SketchDefinition,
  entityId: string,
  patch: (spline: Spline) => Spline,
): SketchDefinition => ({
  ...definition,
  entities: definition.entities.map((entity) =>
    entity.kind === "spline" && entity.entityId === entityId
      ? patch(entity)
      : entity,
  ),
});
/** Every authored field of a spline but its identity and target, as bytes. */
const shape = ({ entityId: _id, target: _target, ...rest }: Spline) =>
  JSON.stringify(rest);
const solvedSpline = (session: SketchSessionState, entityId: string) => {
  const solved = session.liveSolve!.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === entityId,
  );
  if (solved?.kind !== "spline") throw new Error("solved spline");
  return solved.reconstruction;
};

const regionAdapter = new SketchConstraintSolverAdapter({
  revisionId: null,
  neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
});
/** The live region round (the editor's derive effect, real adapter), applied until settled. */
async function liveRegions(session: SketchSessionState) {
  let next = session;
  for (let round = 0; round < 3; round += 1) {
    const live = next.liveSolve!;
    const response = await regionAdapter.deriveSketchRegions({
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_close_spline" as never,
      documentId: "doc_workspace" as never,
      revisionId: "rev_0001" as never,
      sketchId: "sketch_close_spline" as never,
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: next.modelingTolerance,
    });
    next = publishSketchLiveRegions(
      next,
      response.regions,
      response.diagnostics,
      response.offsetPublications,
    );
    if (next.liveRegions.status !== "pending") return { next, response };
  }
  throw new Error("live regions never settled");
}

const KERNEL_REQUEST = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;
/** Finish through the mock kernel (real solver adapter), then read the saved sketch back. */
async function finish(definition: SketchDefinition) {
  const adapter = new MockKernelAdapter({ solverAdapter: regionAdapter });
  const before = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const response = await adapter.commitSketch({
    ...KERNEL_REQUEST,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_close_spline_finish",
      projectionRequestId: "request_close_spline_finish:project",
      validationRequestId: "request_close_spline_finish:validate",
      solveRequestId: "request_close_spline_finish:solve",
      regionRequestId: "request_close_spline_finish:regions",
    },
    sketchId: null,
    sketchLabel: "Close spline",
    plane: before.snapshot.document.sketches[0]!.plane,
    definition,
  });
  const after = await adapter.getDocumentSnapshot(KERNEL_REQUEST);
  const saved = after.snapshot.document.sketches.find(
    (entry) => entry.sketchId === response.sketchId,
  );
  if (!saved) throw new Error("no saved sketch");
  return { response, saved: saved as SketchSnapshotRecord };
}

const ref = (session: SketchSessionState, entityId: string) => [
  entityRef(session, entityId as SketchEntityId),
];
const refusal = (
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
) => computeSketchCloseSplineState(session, selection)?.refusal;
/** A refused Close writes nothing: the very same session comes back. */
function expectRefused(
  session: SketchSessionState,
  entityId: string,
  text: string,
) {
  const selection = ref(session, entityId);
  expect(computeSketchCloseSplineState(session, selection)).toEqual({
    entityId,
    label: splines(session.definition).find((s) => s.entityId === entityId)!
      .label,
    refusal: text,
  });
  expect(applySketchCloseSpline(session, selection)).toBe(session);
}

const NEEDS_SOLVE =
  "Close spline needs a solved sketch; fix the problem shown above first, or Undo.";

const THREE: readonly P[] = [
  [0, 0],
  [2, 1.2],
  [4, 0],
];
const FIVE: readonly P[] = [
  [0, 0],
  [1.5, 1.5],
  [3.5, 1.8],
  [5, 0.5],
  [3, -1],
];

describe("T17c2: Close spline closes an open spline smoothly", () => {
  for (const fit of [THREE, FIVE])
    test(`${fit.length} fit points: closure "open" → "smooth" is the whole write set; the wrapped reconstruction has ${fit.length} spans; one region forms`, async () => {
      const session = drawSpline(entered(), fit);
      const [spline] = splines(session.definition);
      expect(spline!.closure, "premise: drawn open").toBe("open");
      expect(spline!.pointOccurrences).toHaveLength(fit.length);
      const open = await liveRegions(session);
      expect(open.response.regions, "premise: no region while open").toEqual(
        [],
      );

      const state = computeSketchCloseSplineState(
        session,
        ref(session, spline!.entityId),
      );
      expect(state).toEqual({
        entityId: spline!.entityId,
        label: spline!.label,
        refusal: null,
      });
      const closed = applySketchCloseSpline(
        session,
        ref(session, spline!.entityId),
      );
      expect(
        closed.definition,
        "only `closure` changes: no fit point added or removed, tangents and every other record untouched",
      ).toEqual(
        withSpline(session.definition, spline!.entityId, (entity) => ({
          ...entity,
          closure: "smooth",
        })),
      );
      expect(closed.definition.points).toEqual(session.definition.points);
      expect(validateSketchDefinition(closed.definition).success).toBe(true);
      expect(closed.liveSolve?.accepted).toBe(true);
      expect(closed.validationMessage).toBeNull();
      const wrapped = solvedSpline(closed, spline!.entityId);
      expect(wrapped.validity).toBe("valid");
      expect(
        wrapped.spans,
        "smooth closure wraps: n spans for n fit points, no duplicate fit point",
      ).toHaveLength(fit.length);
      const last = wrapped.spans.at(-1)!;
      const first = wrapped.spans[0]!;
      expect(
        [last.source.endOccurrenceId, last.poles.at(-1)],
        "the closing span ends on the first fit point's occurrence",
      ).toEqual([first.source.startOccurrenceId, first.poles[0]]);
      const { next, response } = await liveRegions(closed);
      expect(response.diagnostics).toEqual([]);
      expect(response.regions, "one region").toHaveLength(1);
      expect(next.liveRegions.status).toBe("current");
      expect(
        computeSketchCloseSplineState(closed, ref(closed, spline!.entityId)),
        "a closed spline offers no Close spline",
      ).toBeNull();
    });

  test("authored end tangents survive the close, Finish → saved record → reopen byte-equal; the reopened spline is still wrapped", async () => {
    const drawn = drawSpline(entered(), FIVE);
    const [spline] = splines(drawn.definition);
    const authored = withSpline(drawn.definition, spline!.entityId, (s) => ({
      ...s,
      pointOccurrences: s.pointOccurrences.map((occurrence, index) =>
        index === 0 || index === s.pointOccurrences.length - 1
          ? {
              ...occurrence,
              tangent: {
                kind: "authored",
                vector: index === 0 ? [-0.75, 1.25] : [-2, -0.5],
              },
            }
          : occurrence,
      ),
    }));
    const session = rebuild(drawn, authored);
    const closed = applySketchCloseSpline(
      session,
      ref(session, spline!.entityId),
    );
    const closedSpline = splines(closed.definition)[0]!;
    expect(closedSpline.closure).toBe("smooth");
    expect(closedSpline.pointOccurrences).toEqual(
      splines(authored)[0]!.pointOccurrences,
    );

    const { response, saved } = await finish(closed.commitRequest!.definition);
    expect(response.revisionState.kind, "Finish is accepted").toBe("accepted");
    expect(
      saved.sketch.regions,
      "the saved sketch has its region",
    ).toHaveLength(1);
    const savedSpline = splines(saved.sketch.definition).find(
      (entity) => entity.entityId === spline!.entityId,
    )!;
    expect(
      shape(savedSpline),
      "the saved spline is byte-equal (closure, occurrences, tangents; Finish only re-targets the published sketch id)",
    ).toBe(shape(closedSpline));
    expect(savedSpline.target.sketchId).toBe(saved.sketchId);
    const file = JSON.parse(JSON.stringify(saved)) as SketchSnapshotRecord;
    // The persistence boundary's runtime validation ([TECH] G18, Typia).
    const restored = file.sketch.definition;
    expect(validateSketchDefinition(restored).success).toBe(true);
    expect(JSON.stringify(splines(restored)[0])).toBe(
      JSON.stringify(savedSpline),
    );
    const reopened = enterSketchSession(
      createSketchSessionFromSnapshot(file, OCC_KERNEL_SETTINGS),
    );
    const reopenedSpline = splines(reopened.definition)[0]!;
    expect(JSON.stringify(reopenedSpline)).toBe(JSON.stringify(savedSpline));
    const wrapped = solvedSpline(reopened, spline!.entityId);
    expect(wrapped.validity).toBe("valid");
    expect(wrapped.spans).toEqual(solvedSpline(closed, spline!.entityId).spans);
    expect(
      computeSketchCloseSplineState(reopened, ref(reopened, spline!.entityId)),
      "reopened closed: still no Close spline",
    ).toBeNull();
  });
});

describe("T17c2: the selection Close spline answers", () => {
  test("the spline, any of its fit points or tangent handles (one spline); hidden for anything else or with a tool armed", () => {
    let session = drawSpline(entered(), FIVE);
    session = drawLine(session, [10, 0], [12, 0]);
    session = drawSpline(session, [
      [20, 0],
      [22, 2],
      [24, 0],
    ]);
    const [a, b] = splines(session.definition);
    const line = session.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    )!;
    const occurrence = a!.pointOccurrences[2]!;
    const shown = (selection: PrimitiveRef[]) =>
      computeSketchCloseSplineState(session, selection)?.entityId ?? null;
    expect(shown([entityRef(session, a!.entityId)])).toBe(a!.entityId);
    expect(shown([pointRef(session, occurrence.pointId)])).toBe(a!.entityId);
    expect(
      shown([
        handleRef(
          session,
          a!.entityId,
          occurrence.occurrenceId,
          occurrence.pointId,
        ),
      ]),
    ).toBe(a!.entityId);
    expect(
      shown([
        entityRef(session, a!.entityId),
        pointRef(session, a!.pointOccurrences[0]!.pointId),
      ]),
      "the spline and its own fit point: one spline",
    ).toBe(a!.entityId);
    expect(shown([]), "nothing selected").toBeNull();
    expect(
      shown([entityRef(session, a!.entityId), entityRef(session, b!.entityId)]),
      "two splines",
    ).toBeNull();
    expect(
      shown([
        entityRef(session, a!.entityId),
        entityRef(session, line.entityId),
      ]),
      "a spline and a line",
    ).toBeNull();
    expect(shown([entityRef(session, line.entityId)]), "a line").toBeNull();
    expect(
      computeSketchCloseSplineState(beginSketchTool(session, "line"), [
        entityRef(session, a!.entityId),
      ]),
      "a tool armed",
    ).toBeNull();
    // Review A-5: a drag, a special mode or an annotation edit owns the slot.
    for (const owner of [
      "activeDrag",
      "activeSpecialMode",
      "activeAnnotationEdit",
    ] as const)
      expect(
        computeSketchCloseSplineState(
          { ...session, [owner]: {} } as SketchSessionState,
          [entityRef(session, a!.entityId)],
        ),
        owner,
      ).toBeNull();
  });

  // Review A-5: a fit point two splines share selects neither.
  test("a fit point shared by two splines hides it; each spline alone is offered", () => {
    const first = drawSpline(entered(), FIVE);
    const [a] = splines(first.definition);
    const shared = a!.pointOccurrences.at(-1)!.pointId;
    const drawn = drawSpline(first, [
      [3, -1],
      [5, -3],
      [7, -1],
    ]);
    const b = splines(drawn.definition).find(
      (spline) => spline.entityId !== a!.entityId,
    )!;
    const session = rebuild(
      drawn,
      withSpline(drawn.definition, b.entityId, (spline) => ({
        ...spline,
        pointOccurrences: spline.pointOccurrences.map((occurrence, index) =>
          index === 0 ? { ...occurrence, pointId: shared } : occurrence,
        ),
      })),
    );
    expect(
      computeSketchCloseSplineState(session, [pointRef(session, shared)]),
    ).toBeNull();
    for (const spline of [a!, b])
      expect(
        computeSketchCloseSplineState(session, ref(session, spline.entityId))
          ?.entityId,
      ).toBe(spline.entityId);
  });
});

describe("T17c2: P-10 refusals (label-based; nothing written)", () => {
  test("fewer than 3 fit points", () => {
    const session = drawSpline(entered(), [
      [0, 0],
      [3, 1],
    ]);
    const [spline] = splines(session.definition);
    expectRefused(
      session,
      spline!.entityId,
      `${spline!.label} has 2 fit points; closing a spline needs at least 3.`,
    );
  });

  test("already closed: hidden, positional (Merge) or smooth", () => {
    const session = drawSpline(entered(), FIVE);
    const [spline] = splines(session.definition);
    for (const closure of ["positional", "smooth"] as const) {
      const closed = rebuild(
        session,
        withSpline(session.definition, spline!.entityId, (s) => ({
          ...s,
          closure,
        })),
      );
      const selection = ref(closed, spline!.entityId);
      expect(computeSketchCloseSplineState(closed, selection)).toBeNull();
      expect(applySketchCloseSpline(closed, selection)).toBe(closed);
    }
  });

  // T17c2 review R-2: both coordinates must be equal.
  test("ends sharing exactly one coordinate are not together: offered", () => {
    for (const last of [
      [0, -2],
      [3, 0],
    ] as const) {
      const session = drawSpline(entered(), [[0, 0], [2, 2], [4, 0.5], last]);
      const [spline] = splines(session.definition);
      const ends = [
        spline!.pointOccurrences[0]!.pointId,
        spline!.pointOccurrences.at(-1)!.pointId,
      ].map(
        (pointId) =>
          session.liveSolve!.solvedSnapshot.solvedPoints.find(
            (point) => point.pointId === pointId,
          )!.solvedPosition,
      );
      expect(
        ends[0]!.filter((value, axis) => value === ends[1]![axis]),
        "premise: exactly one shared coordinate",
      ).toHaveLength(1);
      expect(refusal(session, ref(session, spline!.entityId)), `${last}`).toBe(
        null,
      );
    }
  });

  test("ends together: one point, a satisfied Coincident, or the same solved position — closed by position", () => {
    const fit: readonly P[] = [
      [0, 0],
      [2, 2],
      [4, 0.5],
      [0.3, -0.2],
    ];
    const session = drawSpline(entered(), fit);
    const [spline] = splines(session.definition);
    const first = spline!.pointOccurrences[0]!.pointId;
    const last = spline!.pointOccurrences.at(-1)!.pointId;
    const text = `${spline!.label}'s first and last fit points are already joined; it is closed by position.`;
    expect(refusal(session, ref(session, spline!.entityId))).toBeNull();

    const coincident = rebuild(session, {
      ...session.definition,
      constraintIds: [...session.definition.constraintIds, "constraint_ends"],
      constraints: [
        ...session.definition.constraints,
        {
          constraintId: "constraint_ends",
          kind: "coincident",
          label: "Ends",
          pointIds: [first, last],
        } as SketchDefinition["constraints"][number],
      ],
    });
    expect(
      coincident.liveSolve!.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_ends",
      )?.status,
      "premise: the Coincident is satisfied",
    ).toBe("satisfied");
    expectRefused(coincident, spline!.entityId, text);

    const samePosition = rebuild(session, {
      ...session.definition,
      points: session.definition.points.map((point) =>
        point.pointId === last
          ? {
              ...point,
              position: session.definition.points.find(
                (p) => p.pointId === first,
              )!.position,
            }
          : point,
      ),
    });
    expect(samePosition.liveSolve?.accepted, "premise: solved").toBe(true);
    expectRefused(samePosition, spline!.entityId, text);

    const sharedPoint = rebuild(
      session,
      withSpline(session.definition, spline!.entityId, (s) => ({
        ...s,
        pointOccurrences: s.pointOccurrences.map((occurrence, index) =>
          index === s.pointOccurrences.length - 1
            ? { ...occurrence, pointId: first as SketchPointId }
            : occurrence,
        ),
      })),
    );
    expectRefused(sharedPoint, spline!.entityId, text);
  });

  test("the source of an offset", () => {
    const drawn = drawSpline(entered(), [
      [0, 0],
      [1, 0.6],
      [2, -0.4],
    ]);
    const [spline] = splines(drawn.definition);
    const { session, relationship } = withDerived(
      drawn,
      "offset",
      [spline!.entityId],
      50,
      0.2,
    );
    expectRefused(
      session,
      spline!.entityId,
      `${spline!.label} is the source of offset ‘${relationship.label}’; closing it would change the offset. Remove the offset first (select it, then Offset → Remove offset).`,
    );
  });

  test("a mirror seed or copy", () => {
    let drawn = drawSpline(entered(), [
      [0, 1],
      [2, 2.2],
      [4, 1],
      [2, 0.4],
    ]);
    drawn = drawLine(drawn, [-1, 0], [6, 0]);
    const [seed] = splines(drawn.definition);
    const axis = drawn.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    )!;
    const { session, relationship } = withDerived(
      drawn,
      "mirror",
      [seed!.entityId, axis.entityId],
      60,
    );
    const copy = splines(session.definition).find(
      (s) => s.entityId !== seed!.entityId,
    )!;
    for (const target of [seed!, copy])
      expectRefused(
        session,
        target.entityId,
        `${target.label} is part of mirror ‘${relationship.label}’. To close it, select it, then Mirror → Remove mirror.`,
      );
  });

  test("a pattern or transform seed or copy", () => {
    for (const [operatorKind, noun] of [
      ["linearPattern", "linear pattern"],
      ["transform", "transform"],
    ] as const) {
      const drawn = drawSpline(entered(), [
        [0, 0],
        [2, 1.2],
        [4, 0],
        [2, -1],
      ]);
      const [seed] = splines(drawn.definition);
      const result = createSketchDerivedTransformContribution({
        definition: drawn.definition,
        operatorKind,
        entityIds: [seed!.entityId],
        value: operatorKind === "linearPattern" ? 10 : null,
        sequence: 70,
        factories: createSessionCommitFactories(70, "sketch_draft" as never),
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
        documentVariables: [],
      });
      if (!result.valid || !result.contribution)
        throw new Error(result.message ?? operatorKind);
      const session = rebuild(
        drawn,
        appendDefinition(drawn.definition, result.contribution),
      );
      const relationship = session.definition.derivedRelationships!.at(-1)!;
      expect(relationship.kind).toBe(operatorKind);
      const copy = splines(session.definition).find(
        (s) => s.entityId !== seed!.entityId,
      )!;
      for (const target of [seed!, copy])
        expectRefused(
          session,
          target.entityId,
          `${target.label} is part of ${noun} ‘${relationship.label}’; a spline in a pattern or transform can't be closed.`,
        );
    }
  });

  test("without a solve of the current sketch", () => {
    let drawn = drawSpline(entered(), FIVE);
    drawn = drawLine(drawn, [10, 0], [12, 0]);
    const line = drawn.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    )!;
    const conflict = rebuild(drawn, {
      ...drawn.definition,
      dimensionIds: ["dimension_a", "dimension_b"],
      dimensions: [2, 5].map((value, index) => ({
        dimensionId: index ? "dimension_b" : "dimension_a",
        kind: "lineLength",
        label: `L${index}`,
        entityId: line.entityId,
        value: createLiteralAuthoredValue(value),
      })) as SketchDefinition["dimensions"],
    });
    expect(conflict.liveSolve?.accepted, "premise: not solved").toBe(false);
    expectRefused(
      conflict,
      splines(drawn.definition)[0]!.entityId,
      NEEDS_SOLVE,
    );
  });

  // T17c2 review R-1: a broken mirror elsewhere (its line deleted by the
  // real Delete) leaves the solve accepted (the mirror is reported, its
  // copies held), so Close is offered and closes. When the solve is not
  // accepted for a reason that is no conflict, Close's text is
  // cause-neutral and points at the message the column shows above it.
  test("a broken mirror elsewhere: offered after a real Delete of its line; without an accepted solve (no conflict) the cause-neutral text, the mirror's message shown above", () => {
    let drawn = drawSpline(entered(), FIVE);
    drawn = drawLine(drawn, [10, 0], [12, 1]);
    drawn = drawLine(drawn, [9, -3], [13, -3]);
    const [seed, axis] = drawn.definition.entities.filter(
      (entity) => entity.kind === "lineSegment",
    );
    const { session } = withDerived(
      drawn,
      "mirror",
      [seed!.entityId, axis!.entityId],
      60,
    );
    const spline = splines(drawn.definition)[0]!.entityId;
    const mirrorMessage =
      /^Mirror ‘.+’ is broken: its mirror line was deleted\./;

    const deleted = deleteSelectedSketchGeometry(session, [
      entityRef(session, axis!.entityId),
    ]);
    expect(deleted.validationMessage).toMatch(mirrorMessage);
    expect(deleted.liveSolve?.accepted, "premise: still solved").toBe(true);
    expect(refusal(deleted, ref(deleted, spline))).toBeNull();
    const closed = applySketchCloseSpline(deleted, ref(deleted, spline));
    expect(
      splines(closed.definition).find((s) => s.entityId === spline)!.closure,
    ).toBe("smooth");
    expect(closed.validationMessage, "the mirror is still reported").toMatch(
      mirrorMessage,
    );

    // No accepted solve, and no conflict: a second spline with two
    // consecutive fit points at one place (T17b0 P-9, the drag path's
    // definition).
    const other = drawSpline(deleted, [
      [20, 0],
      [21, 1],
      [22, 1],
      [23, 0],
    ]);
    const degenerate = splines(other.definition).at(-1)!;
    const [b, c] = [1, 2].map(
      (index) => degenerate.pointOccurrences[index]!.pointId,
    );
    const moved = rebuild(other, {
      ...other.definition,
      points: other.definition.points.map((point) =>
        point.pointId === c
          ? {
              ...point,
              position: other.definition.points.find((p) => p.pointId === b)!
                .position,
            }
          : point,
      ),
    });
    expect(moved.liveSolve?.accepted, "premise: not solved").toBe(false);
    expect(
      moved.liveSolve!.solvedSnapshot.constraintStatuses.filter(
        (status) => status.status !== "satisfied",
      ),
      "premise: no constraint conflicts",
    ).toEqual([]);
    expect(
      moved.validationMessage,
      "the column's first message is the mirror's",
    ).toMatch(mirrorMessage);
    expectRefused(moved, spline, NEEDS_SOLVE);
  });
});

// T17e (B2; T17c2 review R-1/A-1). Logic lane; seams: the Trim tool's
// edit-query basis refusal and the live region derivation (real adapter).
describe("T17e: cause-neutral and label-based texts around Close spline", () => {
  test("Trim without an accepted solve and without a conflict: the cause-neutral text (the column shows the cause above)", () => {
    let drawn = drawSpline(entered(), [
      [20, 0],
      [21, 1],
      [22, 1],
      [23, 0],
    ]);
    drawn = drawLine(drawn, [0, 0], [4, 0]);
    const degenerate = splines(drawn.definition)[0]!;
    const [b, c] = [1, 2].map(
      (index) => degenerate.pointOccurrences[index]!.pointId,
    );
    const moved = rebuild(drawn, {
      ...drawn.definition,
      points: drawn.definition.points.map((point) =>
        point.pointId === c
          ? {
              ...point,
              position: drawn.definition.points.find((p) => p.pointId === b)!
                .position,
            }
          : point,
      ),
    });
    expect(moved.liveSolve?.accepted, "premise: not solved").toBe(false);
    expect(
      moved.liveSolve!.solvedSnapshot.constraintStatuses.filter(
        (status) => status.status !== "satisfied",
      ),
      "premise: no constraint conflicts",
    ).toEqual([]);
    const line = moved.definition.entities.find(
      (entity) => entity.kind === "lineSegment",
    )!;
    const trimmed = selectSketchEditToolTarget(
      beginSketchTool(moved, "trim"),
      entityRef(moved, line.entityId),
    );
    expect(trimmed.toolPresentation?.validation?.[0]?.message).toBe(
      "Trim needs a solved sketch; fix the problem shown above first, or Undo.",
    );
    expect(trimmed.definition).toBe(moved.definition);
  });

  test("end tangents against the closing direction: no region, and the join warnings name the spline's spans by label (T17c2 review A-1)", async () => {
    const drawn = drawSpline(entered(), FIVE);
    const [spline] = splines(drawn.definition);
    const authored = withSpline(drawn.definition, spline!.entityId, (s) => ({
      ...s,
      pointOccurrences: s.pointOccurrences.map((occurrence, index) =>
        index === 0 || index === s.pointOccurrences.length - 1
          ? {
              ...occurrence,
              tangent: {
                kind: "authored",
                vector: index === 0 ? [0.75, -1.25] : [-0.5, -1],
              },
            }
          : occurrence,
      ),
    }));
    const session = rebuild(drawn, authored);
    const closed = applySketchCloseSpline(
      session,
      ref(session, spline!.entityId),
    );
    expect(closed.liveSolve?.accepted, "premise: solved").toBe(true);
    const { response } = await liveRegions(closed);
    expect(response.regions, "premise: no region").toEqual([]);
    const joins = response.diagnostics.filter(
      (diagnostic) => diagnostic.code === "region-join-uncertain",
    );
    expect(joins.length, "premise: the join warnings").toBeGreaterThan(0);
    for (const diagnostic of joins)
      expect(diagnostic.message).toMatch(
        new RegExp(`‘${spline!.label}’ span [1-5]`),
      );
    expectNoInternalIds(
      response.diagnostics.map((diagnostic) => diagnostic.message),
      spline!.pointOccurrenceIds,
    );
  });
});
