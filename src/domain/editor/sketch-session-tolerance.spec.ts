import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { expect, test } from "vitest";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import { openSketchSessionFromSelection } from "@/domain/editor/sketch-session-controller";
import {
  createEmptyDefinition,
  createLineEntityDefinition,
  createPointDefinition,
  getSketchSessionDerivedValidity,
  getSketchSessionLiveRegionBasis,
  getSketchSessionSolvedSnapshot,
  publishSketchLiveRegions,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

// Non-default document policy: both values are far looser than the former
// hard-coded live constant (1e-6) and the default document policy (1e-3 / 1e-4).
const DOCUMENT_SETTINGS = {
  modelingTolerance: 0.01,
  angularToleranceRadians: 0.01,
} as const;
const SKETCH_ID = "sketch_draft" as SketchId;

function makeToleranceProbeDefinition(): SketchDefinition {
  const points: SketchPointDefinition[] = [];
  const entities: SketchEntityDefinition[] = [];
  const constraints: ConstraintDefinition[] = [];
  const dimensions: DimensionDefinition[] = [];
  const addPoint = (id: string, position: readonly [number, number]) => {
    const pointId = `sketch_point_${id}` as SketchPointId;
    points.push(createPointDefinition(SKETCH_ID, pointId, id, position));
    return pointId;
  };

  // Two fixed points joined by a coincident constraint the solver cannot
  // close. The least-squares solve splits the gap evenly across the three
  // requirements, leaving about a third of it on the coincidence, so only the
  // tolerance decides satisfaction.
  const addFixedGap = (id: string, gap: number, y: number) => {
    const first = addPoint(`${id}_a`, [0, y]);
    const second = addPoint(`${id}_b`, [gap, y]);
    constraints.push(
      {
        constraintId: `constraint_${id}_fix_a` as ConstraintId,
        kind: "fixPoint",
        label: `${id} fix a`,
        pointId: first,
        position: [0, y],
      },
      {
        constraintId: `constraint_${id}_fix_b` as ConstraintId,
        kind: "fixPoint",
        label: `${id} fix b`,
        pointId: second,
        position: [gap, y],
      },
      {
        constraintId: `constraint_${id}_gap` as ConstraintId,
        kind: "coincident",
        label: `${id} gap`,
        pointIds: [first, second],
      },
    );
  };
  addFixedGap("micro", 5e-4, 0); // ~1.7e-4 residual
  addFixedGap("within", 5e-3, 2); // ~1.7e-3 residual
  addFixedGap("beyond", 6e-2, 4); // ~2e-2 residual

  // Free line pairs whose initial angle straddles the document's angular
  // tolerance; the line-distance dimension is only enforceable when they
  // start parallel within it.
  const addLineDistance = (id: string, angle: number, y: number) => {
    const line = (
      suffix: string,
      start: readonly [number, number],
      end: readonly [number, number],
    ) => {
      const entityId = `sketch_entity_${id}_${suffix}` as SketchEntityId;
      entities.push(
        createLineEntityDefinition(
          SKETCH_ID,
          entityId,
          `${id} ${suffix}`,
          addPoint(`${id}_${suffix}_start`, start),
          addPoint(`${id}_${suffix}_end`, end),
        ),
      );
      return entityId;
    };
    const base = line("base", [0, y], [10, y]);
    const tilted = line(
      "tilted",
      [0, y + 2],
      [10 * Math.cos(angle), y + 2 + 10 * Math.sin(angle)],
    );
    dimensions.push({
      dimensionId: `dimension_${id}` as DimensionId,
      kind: "lineDistance",
      label: `${id} distance`,
      lines: [
        { kind: "localEntity", entityId: base },
        { kind: "localEntity", entityId: tilted },
      ],
      value: 3,
    });
  };
  addLineDistance("near_parallel", 0.005, 10);
  addLineDistance("skewed", 0.03, 20);

  return {
    ...createEmptyDefinition(),
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  };
}

/**
 * Opens an XY sketch session on a mock document whose commits are judged by
 * the production solver adapter, so each case compares the live session with
 * the real document-tolerance commit judgment. Without `settings` the
 * document keeps its default tolerances.
 */
async function openToleranceHarness(settings?: typeof DOCUMENT_SETTINGS) {
  const solverAdapter = new SketchConstraintSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    documentId: "doc_workspace",
    revisionId: null,
  });
  const adapter = new MockKernelAdapter({ solverAdapter });
  const readSnapshot = async () =>
    (
      await adapter.getDocumentSnapshot({
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
      })
    ).snapshot;
  if (settings) {
    const document = createAuthoredModelDocumentFromSnapshot(
      await readSnapshot(),
    );
    document.settings.modelingTolerance = settings.modelingTolerance;
    document.settings.angularToleranceRadians =
      settings.angularToleranceRadians;
    await adapter.restoreAuthoredModelDocument(document);
  }
  const snapshot = await readSnapshot();
  const opened = openSketchSessionFromSelection(
    [{ kind: "construction", constructionId: "construction_plane-xy" }],
    snapshot,
  );
  if (!opened) {
    throw new Error("The XY construction plane must open a sketch session.");
  }

  const liveAndCommit = async (definition: SketchDefinition, name: string) => {
    // Live regions arrive through the same async solver boundary the
    // editor's `sketch.deriveRegions` effect uses.
    const rebuilt = rebuildSessionForDefinition(opened, { definition });
    const basis = getSketchSessionLiveRegionBasis(rebuilt);
    const liveSession =
      rebuilt.liveRegions.status === "pending" && basis
        ? await solverAdapter
            .deriveSketchRegions({
              contractVersion: "modeling-contract/v1alpha1",
              solverSchemaVersion: SOLVER_SCHEMA_VERSION,
              requestId: `request_${name}:live-regions` as const,
              documentId: "doc_workspace",
              revisionId: (await readSnapshot()).document.revisionId,
              sketchId: basis.sketchId,
              definition: basis.definition,
              solvedSnapshot: basis.solvedSnapshot,
              projectedReferences: basis.projectedReferences,
              modelingTolerance: basis.modelingTolerance,
            })
            .then((derived) =>
              publishSketchLiveRegions(
                rebuilt,
                derived.regions,
                derived.diagnostics,
              ),
            )
        : rebuilt;
    const live = getSketchSessionSolvedSnapshot(liveSession);
    if (!live) {
      throw new Error("A live rebuild must publish its solved snapshot.");
    }
    const requestId = `request_${name}` as const;
    const result = await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: (await readSnapshot()).document.revisionId,
      solverCorrelation: {
        requestId,
        projectionRequestId: `${requestId}:project`,
        validationRequestId: `${requestId}:validate`,
        solveRequestId: `${requestId}:solve`,
        regionRequestId: `${requestId}:regions`,
      },
      sketchId: null,
      sketchLabel: name,
      plane: opened.plane,
      definition,
    });
    expect(result.revisionState.kind).toBe("accepted");
    const committed = (await readSnapshot()).document.sketches.find(
      (entry) => entry.sketchId === result.sketchId,
    )?.sketch;
    if (!committed) {
      throw new Error("The committed sketch must be in the document.");
    }
    return { liveSession, live, committed };
  };

  return { snapshot, opened, liveAndCommit };
}

/**
 * Closed line profiles with fixed points, horizontal/vertical constraints and
 * line-length dimensions: the realistic shape of a dimensioned sketch.
 */
function makeDimensionedProfile(
  corners: readonly (readonly [number, number])[],
  options: {
    fixed: readonly number[];
    horizontal?: readonly number[];
    vertical?: readonly number[];
    lengths: readonly (readonly [edge: number, value: number])[];
  },
): SketchDefinition {
  const points = corners.map((position, index) =>
    createPointDefinition(
      SKETCH_ID,
      `sketch_point_corner_${index}` as SketchPointId,
      `corner ${index}`,
      position,
    ),
  );
  const entities = points.map((start, index) =>
    createLineEntityDefinition(
      SKETCH_ID,
      `sketch_entity_edge_${index}` as SketchEntityId,
      `edge ${index}`,
      start.pointId,
      points[(index + 1) % points.length]!.pointId,
    ),
  );
  const constraints: ConstraintDefinition[] = [
    ...options.fixed.map(
      (index): ConstraintDefinition => ({
        constraintId: `constraint_fix_${index}` as ConstraintId,
        kind: "fixPoint",
        label: `fix corner ${index}`,
        pointId: points[index]!.pointId,
        position: corners[index]!,
      }),
    ),
    ...(
      [
        ["horizontal", options.horizontal ?? []],
        ["vertical", options.vertical ?? []],
      ] as const
    ).flatMap(([kind, edges]) =>
      edges.map(
        (edge): ConstraintDefinition => ({
          constraintId: `constraint_${kind}_${edge}` as ConstraintId,
          kind,
          label: `${kind} edge ${edge}`,
          entityId: entities[edge]!.entityId,
        }),
      ),
    ),
  ];
  const dimensions = options.lengths.map(
    ([edge, value]): DimensionDefinition => ({
      dimensionId: `dimension_edge_${edge}` as DimensionId,
      kind: "lineLength",
      label: `edge ${edge} length`,
      entityId: entities[edge]!.entityId,
      value,
    }),
  );
  return {
    ...createEmptyDefinition(),
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
  };
}

// A pinned 10x10 square whose bottom edge is dimensioned `10 + gap`: the gap
// is the only irreducible residual.
const makePinnedSquare = (gap: number) =>
  makeDimensionedProfile(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    { fixed: [0, 1, 2, 3], lengths: [[0, 10 + gap]] },
  );

// A right isosceles triangle whose hypotenuse dimension is typed to three
// decimals, as a user would enter it.
const makeRoundedTriangle = (side: number) =>
  makeDimensionedProfile(
    [
      [0, 0],
      [side, 0],
      [side, side],
    ],
    {
      fixed: [0],
      horizontal: [0],
      vertical: [1],
      lengths: [
        [0, side],
        [1, side],
        [2, Number((side * Math.SQRT2).toFixed(3))],
      ],
    },
  );

test("live sketch session and commit judge requirements against the same non-default document tolerance", async () => {
  const { opened, liveAndCommit } =
    await openToleranceHarness(DOCUMENT_SETTINGS);
  expect(
    opened.solverTolerances,
    "Opening a sketch must carry the document policy onto the live session.",
  ).toEqual({
    coincidence: DOCUMENT_SETTINGS.modelingTolerance,
    angleRadians: DOCUMENT_SETTINGS.angularToleranceRadians,
    minimumSegmentLength: DOCUMENT_SETTINGS.modelingTolerance,
  });

  const { live, committed } = await liveAndCommit(
    makeToleranceProbeDefinition(),
    "live_tolerance",
  );
  const commit = committed.solvedSnapshot;

  expect(
    live.constraintStatuses,
    "Every live constraint status must match the committed judgment.",
  ).toEqual(commit.constraintStatuses);
  expect(
    live.dimensionStatuses.map((status) => status.status),
    "Every live dimension status must match the committed judgment.",
  ).toEqual(commit.dimensionStatuses.map((status) => status.status));

  const gapStatuses = (statuses: typeof live.constraintStatuses) =>
    Object.fromEntries(
      statuses
        .filter((status) => status.constraintId.endsWith("_gap"))
        .map((status) => [status.constraintId, status.status]),
    );
  const expectedGaps = {
    constraint_micro_gap: "satisfied",
    constraint_within_gap: "satisfied",
    constraint_beyond_gap: "unsatisfied",
  };
  expect(
    gapStatuses(live.constraintStatuses),
    "Live coincidence must be judged by the document linear tolerance.",
  ).toEqual(expectedGaps);
  expect(
    gapStatuses(commit.constraintStatuses),
    "Commit coincidence must be judged by the same document linear tolerance.",
  ).toEqual(expectedGaps);

  const dimensionStatuses = (statuses: typeof live.dimensionStatuses) =>
    Object.fromEntries(
      statuses.map((status) => [status.dimensionId, status.status]),
    );
  const expectedDimensions = {
    dimension_near_parallel: "driving",
    dimension_skewed: "unsatisfied",
  };
  expect(
    dimensionStatuses(live.dimensionStatuses),
    "Live line-distance admission and status must follow the document angular tolerance.",
  ).toEqual(expectedDimensions);
  expect(
    dimensionStatuses(commit.dimensionStatuses),
    "Commit line-distance admission and status must follow the same angular tolerance.",
  ).toEqual(expectedDimensions);
  expect(
    live.dimensionStatuses.find(
      (status) => status.dimensionId === "dimension_near_parallel",
    )?.solvedValue,
  ).toBeCloseTo(3, 6);
});

test("at the default document tolerance, sketches whose requirements all hold are solved with regions both live and at commit", async () => {
  const { snapshot, opened, liveAndCommit } = await openToleranceHarness();
  expect(
    opened.solverTolerances,
    "The session must judge against the default document tolerance.",
  ).toEqual({
    coincidence: 0.001,
    angleRadians: 1e-4,
    minimumSegmentLength: 0.001,
  });
  expect(snapshot.document.settings).toMatchObject({
    modelingTolerance: 0.001,
    angularToleranceRadians: 1e-4,
  });

  const cases = {
    square_gap_5e4: makePinnedSquare(5e-4),
    triangle_side_20: makeRoundedTriangle(20),
    triangle_side_50: makeRoundedTriangle(50),
  };
  const summaries: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(cases)) {
    const { liveSession, live, committed } = await liveAndCommit(
      definition,
      name,
    );
    summaries[name] = {
      live: {
        solveState: live.status.solveState,
        constraints: [...new Set(live.constraintStatuses.map((s) => s.status))],
        dimensions: [...new Set(live.dimensionStatuses.map((s) => s.status))],
        validity: getSketchSessionDerivedValidity(liveSession).state,
        regions: liveSession.liveRegions.regions.length,
      },
      commit: {
        solveState: committed.solvedSnapshot.status.solveState,
        validity: committed.derivedValidity.state,
        regions: committed.regions.length,
      },
    };
  }
  const solvedWithRegion = {
    live: {
      solveState: "solved",
      constraints: ["satisfied"],
      dimensions: ["driving"],
      validity: "current",
      regions: 1,
    },
    commit: { solveState: "solved", validity: "current", regions: 1 },
  };
  expect(
    summaries,
    "Every requirement within the document tolerance must yield a solved, current sketch with its region, live and at commit.",
  ).toEqual({
    square_gap_5e4: solvedWithRegion,
    triangle_side_20: solvedWithRegion,
    triangle_side_50: solvedWithRegion,
  });

  // A gap the document tolerance cannot absorb still leaves the sketch
  // partially solved and withholds its region at commit.
  const { liveSession, live, committed } = await liveAndCommit(
    makePinnedSquare(1e-2),
    "square_gap_1e2",
  );
  expect(
    {
      live: live.status.solveState,
      liveValidity: getSketchSessionDerivedValidity(liveSession).state,
      commit: committed.solvedSnapshot.status.solveState,
      commitValidity: committed.derivedValidity.state,
      commitRegions: committed.regions.length,
    },
    "A requirement outside the document tolerance must keep the sketch partially solved.",
  ).toEqual({
    live: "partiallySolved",
    liveValidity: "invalid",
    commit: "partiallySolved",
    commitValidity: "invalid",
    commitRegions: 0,
  });
});
