// Lane: logic (docs/testing.md). Seam: `resolveSketchPickStack`, the
// sketch editor's one pick-stack owner (T11c, T11-D1, review R-3/R-4):
// mapped candidates in, the full ordered stack out.
import { expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { nonAcceptedOffsetOutputs } from "@/contracts/sketch/offset-publication";
import {
  createLineEntityDefinition,
  createPointDefinition,
  createPointEntityDefinition,
  getSketchSessionDisplayDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  createNewSketchSession,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { getSketchSessionDisplaySolvedSnapshot } from "@/domain/editor/sketch-session/display";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  getArmedSketchPickCycleIndex,
  getSketchPickPreviewIndex,
  reduceSketchPickCycle,
  resolveSketchPickStack,
  SKETCH_PICK_CLASSES,
  SKETCH_PICK_CYCLE_RADIUS_PX,
  type SketchPickCycle,
  type SketchPickCyclePointer,
  type SketchPickStackCandidate,
} from "@/domain/sketch-interaction/pick-stack";

const sketchId = "sketch_primary" as SketchId;

/**
 * A session with a line on the X axis, a coincident construction line, a
 * Point-tool point on the origin and the line's end points.
 */
function makeStackSession({
  lineIsConstruction = false,
}: { lineIsConstruction?: boolean } = {}): SketchSessionState {
  const point = (suffix: string, position: SketchPoint2D) =>
    createPointDefinition(
      sketchId,
      `sketch_point_${suffix}` as SketchPointId,
      suffix,
      position,
    );
  const points = [
    point("line_a", [-4, 0]),
    point("line_b", [4, 0]),
    point("construction_a", [-4, 0]),
    point("construction_b", [4, 0]),
    point("origin_point", [0, 0]),
  ];
  const entities = [
    createLineEntityDefinition(
      sketchId,
      "sketch_entity_line" as SketchEntityId,
      "Line",
      points[0]!.pointId,
      points[1]!.pointId,
      lineIsConstruction,
    ),
    createLineEntityDefinition(
      sketchId,
      "sketch_entity_construction" as SketchEntityId,
      "Construction",
      points[2]!.pointId,
      points[3]!.pointId,
      true,
    ),
    createPointEntityDefinition(
      sketchId,
      "sketch_entity_point" as SketchEntityId,
      "Point",
      points[4]!.pointId,
    ),
  ];
  const base = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  return {
    ...base,
    sketchId,
    definition: {
      ...base.definition,
      pointIds: points.map((entry) => entry.pointId),
      points,
      entityIds: entities.map((entry) => entry.entityId),
      entities,
    },
  };
}

const entity = (entityId: string, owner: SketchId = sketchId) =>
  ({
    kind: "sketchEntity",
    sketchId: owner,
    entityId: entityId as SketchEntityId,
  }) satisfies PrimitiveRef;
const point = (pointId: string, owner: SketchId = sketchId) =>
  ({
    kind: "sketchPoint",
    sketchId: owner,
    pointId: pointId as SketchPointId,
  }) satisfies PrimitiveRef;
const datum = (datumId: "origin" | "xAxis") =>
  ({
    kind: "sketchDatumReference",
    sketchId,
    datumId,
    geometryKind: datumId === "origin" ? "point" : "lineSegment",
  }) satisfies PrimitiveRef;
const projected = (geometryKind: "point" | "lineSegment") =>
  ({
    kind: "projectedReferenceGeometry",
    referenceId: "reference_edge" as ReferenceId,
    geometryId: `geometry_${geometryKind}` as ProjectedGeometryId,
    geometryKind,
  }) satisfies PrimitiveRef;
const lineTarget = entity("sketch_entity_line");
const constructionTarget = entity("sketch_entity_construction");
const originPointTarget = point("sketch_point_origin_point");
const bodyTarget = { kind: "body", bodyId: "body_a" } satisfies PrimitiveRef;
const faceTarget = (faceId: string) =>
  ({ kind: "face", bodyId: "body_a", faceId }) satisfies PrimitiveRef;

function screen(
  key: string,
  target: PrimitiveRef,
  distance: number,
  depth = 0,
): SketchPickStackCandidate {
  return {
    key,
    target,
    ownerBodyTarget: null,
    metric: "screen",
    distance,
    depth,
  };
}

function ray(
  key: string,
  target: PrimitiveRef,
  distance: number,
  ownerBodyTarget: PrimitiveRef | null = null,
): SketchPickStackCandidate {
  return { key, target, ownerBodyTarget, metric: "ray", distance, depth: 0 };
}

const acceptAll = () => true;

/** The stack over the session's display definition, as the viewport builds it. */
function stackOf(
  input: Omit<
    Parameters<typeof resolveSketchPickStack<SketchPickStackCandidate>>[0],
    "displayDefinition"
  >,
) {
  return resolveSketchPickStack({
    ...input,
    displayDefinition: getSketchSessionDisplayDefinition(input.session),
  });
}

test("the stack orders the class table point → ordinary curve → construction curve → reference point → reference curve → region → reference image → face → construction plane, whatever the distances", () => {
  const session = makeStackSession();
  // Higher-priority classes get larger distances: the class wins first.
  const candidates = [
    ray(
      "plane",
      { kind: "construction", constructionId: "construction_plane-xy" },
      0.1,
    ),
    ray("face", faceTarget("face_top"), 0.2),
    ray(
      "image",
      {
        kind: "sketchOperation",
        sketchId,
        operationId: "operation_image" as never,
      },
      0.3,
    ),
    ray(
      "region",
      { kind: "region", sketchId, regionId: "region_a" as never },
      0.4,
    ),
    screen("axis", datum("xAxis"), 0),
    screen("origin", datum("origin"), 1),
    screen("construction", constructionTarget, 2),
    screen("line", lineTarget, 3),
    screen("point", originPointTarget, 11),
  ];
  const stack = stackOf({
    session,
    candidates,
    acceptsTarget: acceptAll,
  });

  expect(
    stack.map((entry) => entry.pickClass),
    "Every class precedes the next regardless of distance (issue 04 picking priority).",
  ).toEqual([
    "authoredPoint",
    "authoredCurve",
    "constructionCurve",
    "referencePoint",
    "referenceCurve",
    "region",
    "referenceImage",
    "face",
    "constructionPlane",
  ]);
  expect(
    SKETCH_PICK_CLASSES,
    "The exported class table is exactly the stack order.",
  ).toEqual(stack.map((entry) => entry.pickClass));
  expect(
    stack.map((entry) => entry.candidate.key),
    "The full ordered stack is returned, not only its top.",
  ).toEqual([
    "point",
    "line",
    "construction",
    "origin",
    "axis",
    "region",
    "image",
    "face",
    "plane",
  ]);

  // R-4: references never outrank authored curves, at any distance.
  const onOrigin = stackOf({
    session,
    candidates: [
      screen("origin", datum("origin"), 0),
      screen("axis", datum("xAxis"), 0),
      screen("line", lineTarget, 12),
    ],
    acceptsTarget: acceptAll,
  });
  expect(
    onOrigin.map((entry) => entry.target),
    "An authored curve within reach of the origin wins; the origin is the second entry, then the axis.",
  ).toEqual([lineTarget, datum("origin"), datum("xAxis")]);
});

test("references: datum, projected and model points precede reference curves; other sketches' geometry is reference geometry", () => {
  const session = makeStackSession();
  const vertex = {
    kind: "vertex",
    bodyId: "body_a",
    vertexId: "vertex_a",
  } satisfies PrimitiveRef;
  const edge = {
    kind: "edge",
    bodyId: "body_a",
    edgeId: "edge_a",
  } satisfies PrimitiveRef;
  const otherSketchEntity = entity(
    "sketch_entity_other",
    "sketch_other" as SketchId,
  );
  const otherSketchPoint = point(
    "sketch_point_other",
    "sketch_other" as SketchId,
  );
  const stack = stackOf({
    session,
    candidates: [
      ray("edge", edge, 0.01),
      screen("projected-curve", projected("lineSegment"), 0),
      screen("axis", datum("xAxis"), 1),
      ray("other-entity", otherSketchEntity, 0.02),
      screen("vertex", vertex, 40),
      screen("projected-point", projected("point"), 9),
      screen("origin", datum("origin"), 5),
      ray("other-point", otherSketchPoint, 0.03),
      ray(
        "unresolved",
        {
          kind: "sketchExternalReference",
          referenceId: "reference_x" as ReferenceId,
        },
        0.04,
      ),
    ],
    acceptsTarget: acceptAll,
  });

  expect(
    stack.map((entry) => [entry.candidate.key, entry.pickClass]),
    "Reference points (screen space by px, then raycast-only by ray distance) precede reference curves; raycast-only feature edges come after the screen-space reference curves.",
  ).toEqual([
    ["origin", "referencePoint"],
    ["projected-point", "referencePoint"],
    ["vertex", "referencePoint"],
    ["other-point", "referencePoint"],
    ["unresolved", "referencePoint"],
    ["projected-curve", "referenceCurve"],
    ["axis", "referenceCurve"],
    ["edge", "referenceCurve"],
    ["other-entity", "referenceCurve"],
  ]);
});

test("within a class: screen distance, then depth, then stable key; raycast-only classes order by ray distance", () => {
  const session = makeStackSession();
  const keys = (candidates: SketchPickStackCandidate[]) =>
    stackOf({
      session,
      candidates,
      acceptsTarget: acceptAll,
    }).map((entry) => entry.candidate.key);
  const otherLine = entity("sketch_entity_line_b");
  const sessionWithTwoLines: SketchSessionState = {
    ...session,
    definition: {
      ...session.definition,
      entityIds: [...session.definition.entityIds, otherLine.entityId],
      entities: [
        ...session.definition.entities,
        createLineEntityDefinition(
          sketchId,
          otherLine.entityId,
          "Line B",
          "sketch_point_line_a" as SketchPointId,
          "sketch_point_origin_point" as SketchPointId,
        ),
      ],
    },
  };
  const twoLineKeys = (candidates: SketchPickStackCandidate[]) =>
    stackOf({
      session: sessionWithTwoLines,
      candidates,
      acceptsTarget: acceptAll,
    }).map((entry) => entry.candidate.key);

  expect(
    twoLineKeys([screen("far", lineTarget, 3), screen("near", otherLine, 1)]),
    "The nearer curve in screen px comes first.",
  ).toEqual(["near", "far"]);
  expect(
    twoLineKeys([
      screen("deep", lineTarget, 2, 0.5),
      screen("shallow", otherLine, 2, 0.1),
    ]),
    "At equal screen distance the smaller depth comes first.",
  ).toEqual(["shallow", "deep"]);
  expect(
    twoLineKeys([screen("b", lineTarget, 2), screen("a", otherLine, 2)]),
    "At equal distance and depth the stable key decides.",
  ).toEqual(["a", "b"]);
  expect(
    keys([
      ray(
        "far-region",
        { kind: "region", sketchId, regionId: "region_far" as never },
        5,
      ),
      ray(
        "near-region",
        { kind: "region", sketchId, regionId: "region_near" as never },
        2,
      ),
      ray("far-face", faceTarget("face_far"), 9),
      ray("near-face", faceTarget("face_near"), 1),
    ]),
    "Raycast-only regions and faces order by ray distance within their class.",
  ).toEqual(["near-region", "far-region", "near-face", "far-face"]);
});

test("construction comes from the session's definition, not from the candidate", () => {
  const ordinary = stackOf({
    session: makeStackSession(),
    candidates: [
      screen("construction", constructionTarget, 0),
      screen("line", lineTarget, 0),
    ],
    acceptsTarget: acceptAll,
  });
  expect(
    ordinary.map((entry) => [entry.candidate.key, entry.pickClass]),
    "An ordinary line beats a coincident construction line (audit F4 overlap).",
  ).toEqual([
    ["line", "authoredCurve"],
    ["construction", "constructionCurve"],
  ]);

  const flipped = stackOf({
    session: makeStackSession({ lineIsConstruction: true }),
    candidates: [
      screen("construction", constructionTarget, 0),
      screen("line", lineTarget, 0),
    ],
    acceptsTarget: acceptAll,
  });
  expect(
    flipped.map((entry) => [entry.candidate.key, entry.pickClass]),
    "The same line target is a construction curve once the definition says so; the stable key then decides.",
  ).toEqual([
    ["construction", "constructionCurve"],
    ["line", "constructionCurve"],
  ]);

  const passed = resolveSketchPickStack({
    session: makeStackSession(),
    displayDefinition: getSketchSessionDisplayDefinition(
      makeStackSession({ lineIsConstruction: true }),
    ),
    candidates: [screen("line", lineTarget, 0)],
    acceptsTarget: acceptAll,
  });
  expect(
    passed.map((entry) => entry.pickClass),
    "The stack reads the display definition the caller built for this pick (review ADV-6), not a second derivation.",
  ).toEqual(["constructionCurve"]);
});

test("eligibility filters before ordering, with owner-body mapping", () => {
  const session = makeStackSession();
  const stack = stackOf({
    session,
    candidates: [
      screen("point", originPointTarget, 0),
      screen("line", lineTarget, 4),
      screen("origin", datum("origin"), 0),
    ],
    acceptsTarget: (target) => target.kind !== "sketchPoint",
  });
  expect(
    stack.map((entry) => entry.candidate.key),
    "A rejected authored point does not hide the next eligible candidates.",
  ).toEqual(["line", "origin"]);

  const edge = {
    kind: "edge",
    bodyId: "body_a",
    edgeId: "edge_a",
  } satisfies PrimitiveRef;
  const bodyOnly = stackOf({
    session,
    candidates: [
      ray("edge", edge, 1, bodyTarget),
      ray(
        "region",
        { kind: "region", sketchId, regionId: "region_a" as never },
        3,
      ),
    ],
    acceptsTarget: (target) => target.kind === "body",
  });
  expect(
    bodyOnly.map((entry) => [entry.target, entry.pickClass]),
    "A topology hit whose own target is ineligible stands for its owner body (classed as a face/body surface); an ineligible region is dropped.",
  ).toEqual([[bodyTarget, "face"]]);
});

test("candidates mapped to one target are de-duplicated, keeping the best metric", () => {
  const session = makeStackSession();
  const stack = stackOf({
    session,
    candidates: [
      ray("proxy", originPointTarget, 0.001),
      screen("marker-far", originPointTarget, 9),
      screen("marker-near", originPointTarget, 3),
      ray("face-far", faceTarget("face_b"), 4, bodyTarget),
      ray("face-near", faceTarget("face_a"), 2, bodyTarget),
    ],
    acceptsTarget: (target) => target.kind !== "face",
  });
  expect(
    stack.map((entry) => entry.candidate.key),
    "One entry per mapped target: the screen-space candidate over a raycast proxy of the same point, the nearer of two, and the nearer face hit standing for one body.",
  ).toEqual(["marker-near", "face-near"]);
});

test("staged previews and annotations are never candidates", () => {
  const session = makeStackSession();
  const stack = stackOf({
    session,
    candidates: [
      screen("staged-entity", entity("sketch_entity_staged"), 0),
      screen("staged-point", point("sketch_point_staged"), 0),
      screen(
        "constraint",
        { kind: "constraint", sketchId, constraintId: "constraint_a" as never },
        0,
      ),
      screen("line", lineTarget, 5),
    ],
    acceptsTarget: acceptAll,
  });
  expect(
    stack.map((entry) => entry.candidate.key),
    "Edited-sketch targets missing from the display definition (staged previews) and annotation targets are dropped.",
  ).toEqual(["line"]);
});

test("[TECH] G19: a non-accepted derived output stays pickable in its own class", () => {
  const base = makeStackSession();
  const shell = (entityId: string, isConstruction: boolean) =>
    ({
      kind: "derivedPiecewiseCubic",
      entityId: entityId as SketchEntityId,
      label: entityId,
      target: entity(entityId),
      isConstruction,
      derivationId: "derivation_shell",
    }) as const;
  const record = (entityId: string) =>
    ({
      entityId,
      kind: "derivedPiecewiseCubic",
      publication: "provisional",
      spans: [],
    }) as const;
  const shells = [
    shell("sketch_entity_shell", false),
    shell("sketch_entity_shell_c", true),
  ];
  const definition = {
    ...base.definition,
    entityIds: [
      ...base.definition.entityIds,
      ...shells.map((entry) => entry.entityId),
    ],
    entities: [...base.definition.entities, ...shells],
  } as unknown as SketchDefinition;
  const session = {
    ...base,
    definition,
    liveSolve: {
      definition,
      projectedReferences: [],
      solvedSnapshot: {
        solvedEntities: shells.map((entry) => record(entry.entityId)),
        solvedPoints: [],
      },
      accepted: false,
    },
  } as unknown as SketchSessionState;
  const nonAccepted = nonAcceptedOffsetOutputs(
    definition,
    getSketchSessionDisplaySolvedSnapshot(session),
  );
  expect(
    [...nonAccepted.keys()],
    "Precondition: both outputs are non-accepted under the shared G19 predicate.",
  ).toEqual(["sketch_entity_shell", "sketch_entity_shell_c"]);

  const stack = stackOf({
    session,
    candidates: [
      screen("origin", datum("origin"), 0),
      screen("shell-construction", entity("sketch_entity_shell_c"), 0),
      screen("shell", entity("sketch_entity_shell"), 6),
    ],
    acceptsTarget: acceptAll,
  });
  expect(
    stack.map((entry) => [entry.candidate.key, entry.pickClass]),
    "Non-accepted outputs keep their class by their own construction flag and still beat references.",
  ).toEqual([
    ["shell", "authoredCurve"],
    ["shell-construction", "constructionCurve"],
    ["origin", "referencePoint"],
  ]);
});

// T11d: the repeated-click cycle reducer (T11-D4/D5, review R-1).
const cycleStack = ["line", "construction", "xAxis"] as const;

function cyclePointer(
  overrides: Partial<SketchPickCyclePointer> = {},
): SketchPickCyclePointer {
  return {
    x: 100,
    y: 200,
    stackKeys: cycleStack,
    contextKey: "select:none",
    retainsPick: () => true,
    ...overrides,
  };
}

function clickCycle(
  cycle: SketchPickCycle | null,
  overrides: Partial<SketchPickCyclePointer> & {
    detail?: number;
    cycles?: boolean;
  } = {},
) {
  const { detail = 1, cycles = true, ...pointer } = overrides;
  return reduceSketchPickCycle(cycle, {
    type: "clicked",
    detail,
    cycles,
    ...cyclePointer(pointer),
  });
}

test("T11d cycle: repeated single clicks advance through the stack and wrap", () => {
  const picks: number[] = [];
  let cycle: SketchPickCycle | null = null;
  for (let click = 0; click < 5; click += 1) {
    const preview = getSketchPickPreviewIndex(cycle, cyclePointer());
    cycle = clickCycle(cycle);
    expect(cycle?.index, "The click picks what the preview showed.").toBe(
      preview,
    );
    picks.push(cycle!.index);
  }
  expect(picks, "stack[(i + 1) mod n], wrapping.").toEqual([0, 1, 2, 0, 1]);
  expect(cycle).toEqual({
    x: 100,
    y: 200,
    stackKeys: cycleStack,
    index: 1,
    contextKey: "select:none",
  });
  expect(
    getArmedSketchPickCycleIndex(null, cyclePointer()),
    "Nothing anchored: not armed.",
  ).toBeNull();
});

test("T11d cycle: within the 6 px click radius it advances; each reset rule restarts at stack[0]", () => {
  const anchored = clickCycle(clickCycle(null));
  expect(anchored?.index).toBe(1);
  expect(SKETCH_PICK_CYCLE_RADIUS_PX).toBe(6);
  expect(
    clickCycle(anchored, { x: 106, y: 200 })?.index,
    "6 px away still cycles.",
  ).toBe(2);
  const resets: [string, SketchPickCycle | null][] = [
    ["moved more than 6 px", clickCycle(anchored, { x: 106.01, y: 200 })],
    [
      "moved diagonally more than 6 px",
      clickCycle(anchored, { x: 105, y: 204 }),
    ],
    [
      "a stack change (reordered keys)",
      clickCycle(anchored, { stackKeys: ["construction", "line", "xAxis"] }),
    ],
    [
      "a stack change (one more candidate)",
      clickCycle(anchored, { stackKeys: [...cycleStack, "origin"] }),
    ],
    [
      "another selection context",
      clickCycle(anchored, { contextKey: "edit:offset:offset" }),
    ],
    [
      "the selection no longer holds the previous pick (Escape, Undo, a selection from elsewhere)",
      clickCycle(anchored, { retainsPick: () => false }),
    ],
  ];
  for (const [rule, cycle] of resets) {
    expect(cycle?.index, `Reset: ${rule}.`).toBe(0);
  }
  expect(
    reduceSketchPickCycle(anchored, { type: "reset" }),
    "An explicit reset clears the cycle.",
  ).toBeNull();
});

test("T11d cycle: retention is asked about the previous pick's index", () => {
  const anchored = clickCycle(clickCycle(null));
  const asked: number[] = [];
  clickCycle(anchored, {
    retainsPick: (index) => {
      asked.push(index);
      return true;
    },
  });
  expect(asked).toEqual([1]);
});

test("T11d cycle: connected selection (detail >= 2), a non-cycling context and an empty stack clear it", () => {
  const anchored = clickCycle(clickCycle(null));
  expect(
    clickCycle(anchored, { detail: 2 }),
    "A double click's second click never advances; it resets.",
  ).toBeNull();
  expect(clickCycle(anchored, { detail: 3 })).toBeNull();
  expect(
    clickCycle(anchored, { detail: 0 }),
    "Pointer events report detail 0: never a cycle click.",
  ).toBeNull();
  expect(
    clickCycle(anchored, { cycles: false }),
    "Immediate-action contexts do not cycle.",
  ).toBeNull();
  expect(clickCycle(anchored, { stackKeys: [] })).toBeNull();
  expect(
    clickCycle(clickCycle(anchored, { detail: 2 }))?.index,
    "After a connected selection the next single click starts at stack[0].",
  ).toBe(0);
});

test("T11d review R-1: a 1-entry stack never arms a cycle", () => {
  const single = ["line"];
  const anchored = clickCycle(null, { stackKeys: single });
  expect(anchored?.index).toBe(0);
  expect(
    getArmedSketchPickCycleIndex(anchored, cyclePointer({ stackKeys: single })),
    "Nothing to cycle: a repeated click keeps its ordinary meaning.",
  ).toBeNull();
  expect(
    clickCycle(anchored, { stackKeys: single })?.index,
    "The repeated click picks stack[0] again, as an ordinary click.",
  ).toBe(0);
});
