/**
 * T16a ([TECH] T16-1, T16-2, R-2, R-3, R-8): the Mirror panel state and the
 * Remove Mirror session action. Logic lane; seam: the sketch session's
 * `computeSketchMirrorActionState` and `applySketchMirrorRemoval`, on
 * mirrors authored by the Mirror tool (shared fixture).
 */
import { describe, expect, test } from "vitest";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import {
  deriveSketchValidity,
  sketchProfileGateFailures,
} from "@/contracts/sketch/derived-validity";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  acceptSketchDraw,
  beginSketchTool,
  completeSketchOffsetPreviewPublication,
  computeSketchTangentActionState,
  createNewSketchSession,
  finalizeSketchDraw,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  chainSession,
  eid,
  entityRef,
  handleRef,
  mirroredSession,
  pid,
  pointRef,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  applySketchMirrorRemoval,
  computeSketchMirrorActionState,
} from "./mirror-actions";

const rebuild = (session: SketchSessionState, definition: SketchDefinition) =>
  rebuildSessionForDefinition(session, { definition });
const without = (session: SketchSessionState, entityIds: readonly string[]) => {
  const entities = session.definition.entities.filter(
    (entity) => !entityIds.includes(entity.entityId),
  );
  return rebuild(session, {
    ...session.definition,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
  });
};
const listed = (
  session: SketchSessionState,
  selection: Parameters<typeof computeSketchMirrorActionState>[1],
) =>
  computeSketchMirrorActionState(session, selection)?.entries.map((entry) => [
    entry.label,
    entry.brokenReason,
  ]) ?? null;

describe("T16a: the Mirror panel lists the mirrors the selection takes part in", () => {
  test("a seed, a copy, their points, a copy's tangent handle and the axis line each show the healthy mirror", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copySpline = session.definition.entities.find(
      (entity) => entity.entityId === outputOf("s").outputEntityId,
    );
    if (copySpline?.kind !== "spline") throw new Error("spline");
    const occurrence = copySpline.pointOccurrences[1]!;
    const selections = {
      seed: entityRef(session, eid("ab")),
      copy: entityRef(session, outputOf("c").outputEntityId),
      "seed point": pointRef(session, pid("a")),
      "copy point": pointRef(session, outputOf("ab").outputPointIds[1]!),
      "copy tangent handle": handleRef(
        session,
        copySpline.entityId,
        occurrence.occurrenceId,
        occurrence.pointId,
      ),
      "axis line": entityRef(session, eid("axis")),
    };
    for (const [name, ref] of Object.entries(selections))
      expect(listed(session, [ref]), name).toEqual([
        [relationship.label, null],
      ]);
    expect(
      listed(session, [entityRef(session, eid("u"))]),
      "control: an unrelated selection with a healthy mirror shows nothing",
    ).toBeNull();
    expect(listed(session, []), "control: nothing selected").toBeNull();
  });

  test("a copy spline's fit point shows both the Mirror and the Tangent panel (they share the stacked container)", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const fitPoint = pointRef(session, outputOf("s").outputPointIds[1]!);
    expect(listed(session, [fitPoint])).toEqual([[relationship.label, null]]);
    expect(computeSketchTangentActionState(session, [fitPoint])?.visible).toBe(
      true,
    );
  });

  test("a held copy (its mirror broken) is a participant: its mirror is listed first", () => {
    const { session, setup, second, secondOutputOf } = chainSession();
    const broken = without(session, [eid("axis"), eid("axis2")]);
    expect(
      broken.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: both mirrors held",
    ).toEqual([setup.relationship.derivationId, second.derivationId]);
    const heldCopy = secondOutputOf(
      setup.outputOf("ab").outputEntityId,
    ).outputEntityId;
    expect(listed(broken, [entityRef(broken, heldCopy)])).toEqual([
      [second.label, "mirror line missing"],
      [setup.relationship.label, "mirror line missing"],
    ]);
    expect(listed(broken, []), "definition order otherwise").toEqual([
      [setup.relationship.label, "mirror line missing"],
      [second.label, "mirror line missing"],
    ]);
  });

  test("health names the reason of every broken state", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copyLine = outputOf("ab").outputEntityId;
    const states: [string, SketchSessionState][] = [
      ["mirror line missing", without(session, [eid("axis")])],
      [
        "mirror line too short",
        rebuild(session, {
          ...session.definition,
          points: session.definition.points.map((point) =>
            point.pointId === pid("x1")
              ? { ...point, position: [-2, 0] }
              : point,
          ),
        }),
      ],
      ["original deleted", without(session, [eid("c")])],
      ["copy deleted", without(session, [outputOf("c").outputEntityId])],
      [
        "geometry no longer matches",
        rebuild(session, {
          ...session.definition,
          entities: session.definition.entities.map((entity) =>
            entity.entityId === copyLine && entity.kind === "lineSegment"
              ? { ...entity, endPointId: pid("u") }
              : entity,
          ),
        }),
      ],
      [
        "dependency loop",
        rebuild(session, {
          ...session.definition,
          derivedRelationships: [
            {
              ...relationship,
              mirrorReference: { kind: "lineEntity", entityId: copyLine },
            },
          ],
        }),
      ],
    ];
    for (const [reason, broken] of states)
      expect(listed(broken, []), reason).toEqual([
        [relationship.label, reason],
      ]);
  });

  test("a broken mirror is listed whatever the selection: empty, or unrelated", () => {
    const { session, relationship } = mirroredSession("free");
    const broken = without(session, [eid("axis")]);
    expect(listed(broken, [])).toEqual([
      [relationship.label, "mirror line missing"],
    ]);
    expect(listed(broken, [entityRef(broken, eid("u"))])).toEqual([
      [relationship.label, "mirror line missing"],
    ]);
  });

  test("the panel slot belongs to an active tool: no Mirror panel while one is armed", () => {
    const { session } = mirroredSession("free");
    const broken = without(session, [eid("axis")]);
    expect(listed(broken, []), "control").not.toBeNull();
    expect(listed(beginSketchTool(broken, "trim"), [])).toBeNull();
  });
});

/**
 * R-8: a copy carries the only driving radius of the circle pair and a
 * copy↔unrelated constraint (point u on the copy circle), plus a reference
 * radius on the copy.
 */
function copyRequirementsSession() {
  const { session, relationship, outputOf } = mirroredSession("free");
  const copyCircle = outputOf("c").outputEntityId;
  const constraints = [
    {
      constraintId: "constraint_u_on_copy",
      kind: "pointOnCurve",
      label: "u on copy",
      point: { kind: "localPoint", pointId: pid("u") },
      curve: { kind: "localEntity", entityId: copyCircle },
    },
  ] as unknown as ConstraintDefinition[];
  const dimensions = [
    {
      dimensionId: "dimension_copy_radius",
      kind: "circleRadius",
      label: "Copy radius",
      entityId: copyCircle,
      value: 1,
    },
    {
      dimensionId: "dimension_copy_reference",
      kind: "circleRadius",
      label: "Copy reference",
      entityId: copyCircle,
      reference: true,
    },
  ] as unknown as DimensionDefinition[];
  const definition: SketchDefinition = {
    ...session.definition,
    // u sits on the copy circle (centre (6, −3), r = 1).
    points: session.definition.points.map((point) =>
      point.pointId === pid("u") ? { ...point, position: [7, -3] } : point,
    ),
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
    dimensionIds: dimensions.map((entry) => entry.dimensionId),
    dimensions,
  };
  return { session: rebuild(session, definition), relationship, outputOf };
}

describe("T16a: the consequence line counts what Remove deletes, before the click", () => {
  test("healthy: 4 copies, 3 requirements on them, 2 of which size the originals (the driving radius and the copy↔unrelated constraint)", () => {
    const { session, relationship } = copyRequirementsSession();
    const snapshot = session.liveSolve!.solvedSnapshot;
    expect(snapshot.failedDerivationIds ?? [], "premise: healthy").toEqual([]);
    expect(
      snapshot.dimensionStatuses.find(
        (entry) => entry.dimensionId === "dimension_copy_radius",
      )?.status,
      "premise: the copy radius drives",
    ).toBe("driving");
    expect(computeSketchMirrorActionState(session, [])).toBeNull();
    expect(
      computeSketchMirrorActionState(session, [entityRef(session, eid("c"))])!
        .entries,
    ).toEqual([
      {
        derivationId: relationship.derivationId,
        label: relationship.label,
        brokenReason: null,
        copyCount: 4,
        requirementCount: 3,
        sizingRequirementCount: 2,
        brokenDownstreamLabels: [],
      },
    ]);
  });

  test("equal length between a copy and its own seed is removed (K) but sizes nothing (not in M)", () => {
    const { session, relationship, outputOf } = copyRequirementsSession();
    const equal = {
      constraintId: "constraint_equal_own_seed",
      kind: "equalLength",
      label: "Equal ab",
      entityIds: [eid("ab"), outputOf("ab").outputEntityId],
    } as unknown as ConstraintDefinition;
    const withEqual = rebuild(session, {
      ...session.definition,
      constraintIds: [...session.definition.constraintIds, equal.constraintId],
      constraints: [...session.definition.constraints, equal],
    });
    expect(
      withEqual.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
      "premise: healthy",
    ).toEqual([]);
    const [entry] = computeSketchMirrorActionState(withEqual, [
      entityRef(withEqual, eid("ab")),
    ])!.entries;
    expect(entry).toMatchObject({
      derivationId: relationship.derivationId,
      requirementCount: 4,
      sizingRequirementCount: 2,
    });
  });

  test("broken: the held copies size nothing (M = 0); a deleted copy is not counted", () => {
    const { session, relationship, outputOf } = copyRequirementsSession();
    const broken = without(session, [
      eid("axis"),
      outputOf("ab").outputEntityId,
    ]);
    expect(computeSketchMirrorActionState(broken, [])!.entries).toEqual([
      {
        derivationId: relationship.derivationId,
        label: relationship.label,
        brokenReason: "mirror line missing",
        copyCount: 3,
        requirementCount: 3,
        sizingRequirementCount: 0,
        brokenDownstreamLabels: [],
      },
    ]);
  });

  test("names the downstream relationships Remove leaves broken", () => {
    const chain = chainSession();
    expect(
      computeSketchMirrorActionState(chain.session, [
        entityRef(chain.session, eid("ab")),
      ])!.entries.map((entry) => [entry.label, entry.brokenDownstreamLabels]),
    ).toEqual([[chain.setup.relationship.label, [chain.second.label]]]);

    const { session, outputOf } = mirroredSession("free");
    const offset = withDerived(
      session,
      "offset",
      [outputOf("ab").outputEntityId],
      90,
      0.5,
    );
    const pattern = withDerived(
      offset.session,
      "linearPattern",
      [outputOf("c").outputEntityId],
      91,
      3,
    );
    expect(
      computeSketchMirrorActionState(pattern.session, [
        entityRef(pattern.session, eid("axis")),
      ])!.entries[0]!.brokenDownstreamLabels,
    ).toEqual([offset.relationship.label, pattern.relationship.label]);
  });
});

describe("T16a R-8: Remove Mirror deletes the copies' requirements and the originals do not move", () => {
  const bitwise = (first: unknown, second: unknown) =>
    JSON.stringify(first, (_key, value) =>
      Object.is(value, -0) ? "-0" : value,
    ) ===
    JSON.stringify(second, (_key, value) =>
      Object.is(value, -0) ? "-0" : value,
    );

  test("seeds, the axis and u keep their authored and solved positions bitwise; the seed circle keeps r = 1", () => {
    const { session, relationship } = copyRequirementsSession();
    const after = applySketchMirrorRemoval(session, relationship.derivationId);
    expect(after.definition.derivedRelationships).toEqual([]);
    expect(after.definition.constraints).toEqual([]);
    expect(after.definition.dimensions).toEqual([]);
    const solved = (state: SketchSessionState) =>
      new Map(
        state.liveSolve!.solvedSnapshot.solvedPoints.map((entry) => [
          entry.pointId,
          entry.solvedPosition,
        ]),
      );
    const before = solved(session);
    const remaining = solved(after);
    expect(remaining.size, "every remaining point is solved").toBe(
      after.definition.points.length,
    );
    for (const [pointId, position] of remaining)
      expect(
        bitwise(position, before.get(pointId)),
        `${pointId}: [${position}] vs [${before.get(pointId)}]`,
      ).toBe(true);
    for (const point of after.definition.points)
      expect(
        bitwise(
          point.position,
          session.definition.points.find(
            (entry) => entry.pointId === point.pointId,
          )!.position,
        ),
        `${point.pointId} authored position`,
      ).toBe(true);
    const circle = after.definition.entities.find(
      (entity) => entity.entityId === eid("c"),
    );
    expect(circle?.kind === "circle" && circle.radius).toBe(1);
    expect(after.liveSolve!.solvedSnapshot.failedDerivationIds ?? []).toEqual(
      [],
    );
    expect(after.liveRegions.status).not.toBe("unavailable");
  });

  test("removing a mirror that is already gone changes nothing (the same session: no action)", () => {
    const { session, relationship } = mirroredSession("free");
    const after = applySketchMirrorRemoval(session, relationship.derivationId);
    expect(applySketchMirrorRemoval(after, relationship.derivationId)).toBe(
      after,
    );
  });
});

/**
 * T16b (T16a review A-1): the panel's broken set is the live solve's
 * sketch-wide profile gate (`sketchProfileGateFailures`); the owner's
 * evaluation gives the reason, and the broken set only before the first
 * live solve.
 */
describe("T16b: the Mirror panel's health agrees with the profile gate", () => {
  const brokenIds = (session: SketchSessionState) =>
    (computeSketchMirrorActionState(session, [])?.entries ?? [])
      .filter((entry) => entry.brokenReason !== null)
      .map((entry) => entry.derivationId);
  const gate = (session: SketchSessionState) => [
    ...sketchProfileGateFailures(session.liveSolve!.solvedSnapshot),
  ];

  test("on every broken fixture the panel's broken mirrors are exactly the gate's", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copyLine = outputOf("ab").outputEntityId;
    const chain = chainSession();
    const states: [string, SketchSessionState][] = [
      ["healthy", session],
      ["axis missing", without(session, [eid("axis")])],
      ["original deleted", without(session, [eid("c")])],
      ["copy deleted", without(session, [outputOf("c").outputEntityId])],
      [
        "mirror line too short",
        rebuild(session, {
          ...session.definition,
          points: session.definition.points.map((point) =>
            point.pointId === pid("x1")
              ? { ...point, position: [-2, 0] }
              : point,
          ),
        }),
      ],
      [
        "geometry no longer matches",
        rebuild(session, {
          ...session.definition,
          entities: session.definition.entities.map((entity) =>
            entity.entityId === copyLine && entity.kind === "lineSegment"
              ? { ...entity, endPointId: pid("u") }
              : entity,
          ),
        }),
      ],
      [
        "dependency loop",
        rebuild(session, {
          ...session.definition,
          derivedRelationships: [
            {
              ...relationship,
              mirrorReference: { kind: "lineEntity", entityId: copyLine },
            },
          ],
        }),
      ],
      [
        "chain, both axes missing",
        without(chain.session, [eid("axis"), eid("axis2")]),
      ],
      ["chain, first axis missing", without(chain.session, [eid("axis")])],
    ];
    for (const [name, state] of states)
      expect(brokenIds(state), name).toEqual(gate(state));
  });

  test("a mirror the solve fails although its authored positions evaluate (a driving axis length below τ) is broken, with the solve's reason (red on base: listed nowhere)", () => {
    const { session, relationship } = mirroredSession("free");
    const shrunk = rebuild(session, {
      ...session.definition,
      dimensionIds: ["dimension_axis"],
      dimensions: [
        {
          dimensionId: "dimension_axis",
          kind: "lineLength",
          label: "Axis",
          entityId: eid("axis"),
          value: 0.0005,
        } as unknown as DimensionDefinition,
      ],
    });
    expect(gate(shrunk), "premise: the solve holds the mirror").toEqual([
      relationship.derivationId,
    ]);
    expect(
      evaluateSketchDerivations({
        definition: shrunk.definition,
        modelingTolerance: shrunk.modelingTolerance,
      }).derivedFailures,
      "premise: the authored positions evaluate",
    ).toEqual([]);
    expect(listed(shrunk, [])).toEqual([
      [relationship.label, "mirror line too short"],
    ]);
  });

  test("before the first live solve (re-entry) the owner's evaluation gives the broken set", () => {
    const { session, relationship } = mirroredSession("free");
    const reentered = { ...without(session, [eid("axis")]), liveSolve: null };
    expect(listed(reentered, [])).toEqual([
      [relationship.label, "mirror line missing"],
    ]);
    expect(listed({ ...session, liveSolve: null }, []), "control").toBeNull();
  });

  test("a mirror seeded on an offset spline curve (U-G2, malformed only, gated by severity) is listed as broken with its reason", () => {
    let session = beginSketchTool(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      "spline",
    );
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 0.6]);
    session = finalizeSketchDraw(acceptSketchDraw(session, [2, -0.4]));
    const seed = session.definition.entities[0]!;
    session = patchSketchEditToolValue(
      selectSketchEditToolTarget(
        beginSketchTool(session, "offset"),
        seed.target,
      ),
      { value: 0.2 },
    );
    session = patchSketchEditToolValue(session, { intent: "commitOffset" });
    for (let round = 0; round < 2; round += 1) {
      const publication = session.activeEditTool?.offsetPublication;
      if (publication?.status !== "pending") break;
      const basis = publication.basis!;
      session = completeSketchOffsetPreviewPublication(
        session,
        publication.derivationId,
        publishSketchOffsets({
          definition: basis.definition,
          solvedSnapshot: basis.solvedSnapshot,
          modelingTolerance: basis.modelingTolerance,
          capabilities: {
            query: createCertifiedNeutralCurveRequestQuery(),
            certifier: createCertifiedCubicTubeChain(),
          },
        }),
      );
    }
    const shell = session.definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    );
    if (!shell) throw new Error("premise: the offset committed a shell");
    const shellMirror = {
      derivationId: "derivation_shell_mirror",
      kind: "mirror",
      label: "shell mirror",
      seedEntityIds: [shell.entityId],
      mirrorReference: { kind: "sketchDatum", datum: "xAxis" },
      outputs: [
        {
          seedEntityId: shell.entityId,
          outputEntityId: eid("shell_copy"),
          instanceIndex: 1,
          seedPointIds: [],
          outputPointIds: [],
        },
      ],
    } as SketchDefinition["derivedRelationships"] extends
      | readonly (infer R)[]
      | undefined
      ? R
      : never;
    const malformed = rebuild(
      { ...session, activeTool: null, activeEditTool: null },
      {
        ...session.definition,
        derivedRelationships: [
          ...session.definition.derivedRelationships!,
          shellMirror,
        ],
      },
    );
    expect(
      gate(malformed),
      "premise: not a failed id (severity-gated)",
    ).toEqual([]);
    expect(
      deriveSketchValidity({
        solvedSnapshot: malformed.liveSolve!.solvedSnapshot,
      }).state,
      "premise: its error gates the sketch by severity",
    ).toBe("invalid");
    expect(listed(malformed, [])).toEqual([
      ["shell mirror", "original is an offset spline curve"],
    ]);
  });
});
