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
  restageSketchMirrorTool,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchEditToolHover,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  getEnterEvent,
  getEscapeEvent,
} from "@/domain/editor/workbench-interactions";
import type { PrimitiveRef } from "@/core/editor/schema";
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
  applySketchMirrorRepair,
  beginSketchMirrorRepair,
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
    const { session, relationship, outputOf } = copyRequirementsSession();
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
        // T16e: the selected original's copy is what Replace original… targets.
        replaceOriginalOutputId: outputOf("c").outputEntityId,
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
        // T16e: nothing selected and no original deleted: no Replace original….
        replaceOriginalOutputId: null,
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

// T16e ([TECH] T16-9, review A-8; logic lane, seam: the sketch session's
// Mirror tool repair sub-state (`beginSketchMirrorRepair`,
// `updateSketchEditToolHover`, `selectSketchEditToolTarget`,
// `applySketchMirrorRepair`) and the workbench Enter/Escape routes).

type Point = SketchDefinition["points"][number];
type Entity = SketchDefinition["entities"][number];
const repairPoint = (id: string, position: [number, number]) =>
  ({
    pointId: pid(id),
    label: id,
    target: { kind: "sketchPoint", sketchId: "sketch_draft", pointId: pid(id) },
    position,
    isConstruction: false,
  }) as Point;
const repairLine = (id: string, a: string, b: string) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: eid(id),
    },
    isConstruction: false,
    startPointId: pid(a),
    endPointId: pid(b),
  }) as Entity;
const withRepairGeometry = (
  definition: SketchDefinition,
  points: Point[],
  entities: Entity[],
  constraints: ConstraintDefinition[] = [],
): SketchDefinition => ({
  ...definition,
  pointIds: [...definition.pointIds, ...points.map((entry) => entry.pointId)],
  points: [...definition.points, ...points],
  entityIds: [
    ...definition.entityIds,
    ...entities.map((entry) => entry.entityId),
  ],
  entities: [...definition.entities, ...entities],
  constraintIds: [
    ...definition.constraintIds,
    ...constraints.map((entry) => entry.constraintId),
  ],
  constraints: [...definition.constraints, ...constraints],
});
/** The mirrored seeds plus l2 (x = −5) and the line n (2, 4)–(5, 6). */
function repairSession() {
  const { session, relationship, outputOf } = mirroredSession("free");
  return {
    session: rebuild(
      session,
      withRepairGeometry(
        session.definition,
        [
          repairPoint("l2a", [-5, -10]),
          repairPoint("l2b", [-5, 10]),
          repairPoint("n0", [2, 4]),
          repairPoint("n1", [5, 6]),
        ],
        [repairLine("l2", "l2a", "l2b"), repairLine("n", "n0", "n1")],
      ),
    ),
    relationship,
    outputOf,
  };
}
const escapeOf = (session: SketchSessionState) =>
  getEscapeEvent({
    activeCommand: null,
    activeReferencePickerFieldId: null,
    selection: [],
    sketchSession: session,
  });
const previewById = (session: SketchSessionState) =>
  new Map(session.toolStagedEntities.map((entry) => [entry.id, entry]));
const solvedAt = (session: SketchSessionState, pointId: string) =>
  session.liveSolve!.solvedSnapshot.solvedPoints.find(
    (entry) => entry.pointId === pointId,
  )!.solvedPosition;

describe("T16e: Replace original… targets one copy", () => {
  test("a selected copy, else the first copy whose original was deleted (review A-3), else a selected original's copy; none for an axis-only or unrelated selection with every original present", () => {
    const { session, outputOf } = repairSession();
    const target = (state: SketchSessionState, selection: PrimitiveRef[]) => {
      const panel = computeSketchMirrorActionState(state, selection);
      return panel ? panel.entries[0]!.replaceOriginalOutputId : "no panel";
    };
    expect(
      target(session, [entityRef(session, outputOf("c").outputEntityId)]),
    ).toBe(outputOf("c").outputEntityId);
    expect(target(session, [entityRef(session, eid("s"))])).toBe(
      outputOf("s").outputEntityId,
    );
    expect(target(session, [entityRef(session, eid("axis"))])).toBeNull();
    expect(target(session, []), "healthy, nothing selected: no panel").toBe(
      "no panel",
    );
    const seedless = without(session, [eid("c")]);
    expect(target(seedless, [])).toBe(outputOf("c").outputEntityId);
    expect(
      target(seedless, [entityRef(seedless, outputOf("ab").outputEntityId)]),
      "the selected copy wins",
    ).toBe(outputOf("ab").outputEntityId);
    // Review A-3: after one original is replaced the new original stays
    // selected; the next copy whose original is missing is the target.
    expect(
      target(seedless, [entityRef(seedless, eid("s"))]),
      "a copy whose original is missing before a selected original's copy",
    ).toBe(outputOf("c").outputEntityId);
  });
});

describe("T16e: the Mirror tool's repair sub-state", () => {
  test("Replace mirror line… arms the Mirror tool's repair (no new tool id): a prompt, nothing staged, no popup, the panel hidden, Enter not consumed, Escape cancels; a gone mirror does not arm it", () => {
    const { session, relationship } = repairSession();
    const broken = without(session, [eid("axis")]);
    const armed = beginSketchMirrorRepair(
      broken,
      relationship.derivationId,
      "axis",
      [entityRef(broken, eid("u"))],
    );
    expect(armed.activeTool).toBe("sketchMirror");
    expect(armed.activeEditTool?.repair).toEqual({
      derivationId: relationship.derivationId,
      target: "axis",
      returnSelection: [entityRef(broken, eid("u"))],
    });
    expect(armed.definition).toBe(broken.definition);
    expect(armed.toolStagedEntities).toEqual([]);
    expect(armed.toolPresentation?.prompts?.[0]?.text).toBe(
      "Pick the new mirror line of mirror ‘mirror 1’: a straight line or a sketch axis.",
    );
    expect(
      armed.toolPresentation?.completionHints?.[0]?.text,
      "review A-5: a short hint, not the prompt again",
    ).toBe("Pick one line or sketch axis");
    expect(armed.toolPresentation?.floatingInput ?? null).toBeNull();
    expect(computeSketchMirrorActionState(armed, [])).toBeNull();
    expect(getEnterEvent({ sketchSession: armed })).toBeNull();
    expect(escapeOf(armed)).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "cancelMirrorRepair" },
    });
    expect(
      beginSketchMirrorRepair(broken, "derivation_missing", "axis", []),
    ).toBe(broken);
  });

  test("hover: a refused candidate shows its text and stages nothing; a valid one stages the copies reflected about it (no popup, nothing authored)", () => {
    const { session, relationship, outputOf } = repairSession();
    const armed = beginSketchMirrorRepair(
      session,
      relationship.derivationId,
      "axis",
      [],
    );
    const refused = updateSketchEditToolHover(
      armed,
      entityRef(armed, eid("ab")),
    );
    expect(refused.toolStagedEntities).toEqual([]);
    expect(refused.toolPresentation?.validation).toEqual([
      expect.objectContaining({
        message:
          "‘ab’ is an original of mirror ‘mirror 1’, so it can't be its mirror line. Pick another line or a sketch axis.",
      }),
    ]);
    expect(refused.toolPresentation?.floatingInput ?? null).toBeNull();
    const hovered = updateSketchEditToolHover(
      armed,
      entityRef(armed, eid("l2")),
    );
    expect(hovered.definition).toBe(session.definition);
    expect(hovered.toolPresentation?.floatingInput ?? null).toBeNull();
    const previews = previewById(hovered);
    expect([...previews.keys()].sort()).toEqual(
      relationship.outputs
        .map((output) => `preview-${output.outputEntityId}`)
        .sort(),
    );
    const copyLine = previews.get(`preview-${outputOf("ab").outputEntityId}`);
    expect(copyLine).toMatchObject({ kind: "line" });
    if (copyLine?.kind !== "line") throw new Error("line");
    // a (1, 1), b (3, 2) about x = −5.
    expect(copyLine.start[0]).toBeCloseTo(-11, 12);
    expect(copyLine.start[1]).toBeCloseTo(1, 12);
    expect(copyLine.end[0]).toBeCloseTo(-13, 12);
    expect(copyLine.end[1]).toBeCloseTo(2, 12);
    const left = updateSketchEditToolHover(hovered, null);
    expect(left.toolStagedEntities, "leaving the candidate clears it").toEqual(
      [],
    );
  });

  test("a refused pick is not kept (its text shows, Enter not consumed); a valid pick stages its solved candidate with the Replace/Cancel popup, Enter confirms; a sketch axis is a valid pick", () => {
    const { session, relationship } = repairSession();
    const armed = beginSketchMirrorRepair(
      session,
      relationship.derivationId,
      "axis",
      [],
    );
    const refused = selectSketchEditToolTarget(
      armed,
      entityRef(armed, eid("c")),
    );
    expect(refused.activeEditTool?.selectedTargets).toEqual([]);
    expect(refused.validationMessage).toBe(
      "A circle can't be a mirror line. Pick a straight line or a sketch axis.",
    );
    expect(getEnterEvent({ sketchSession: refused })).toBeNull();

    const picked = selectSketchEditToolTarget(
      refused,
      entityRef(refused, eid("l2")),
    );
    expect(picked.definition).toBe(session.definition);
    expect(picked.validationMessage).toBeNull();
    expect(picked.toolPresentation?.floatingInput).toMatchObject({
      label: "Replace mirror line",
      readout: "Use ‘l2’ as the mirror line",
      confirmOnly: true,
      confirmLabel: "Replace",
      cancelLabel: "Cancel",
      submitAction: { type: "patch", patch: { intent: "replaceMirrorLine" } },
      cancelAction: { type: "patch", patch: { intent: "cancelMirrorRepair" } },
    });
    expect(getEnterEvent({ sketchSession: picked })).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "replaceMirrorLine" },
    });
    expect(escapeOf(picked)).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "cancelMirrorRepair" },
    });

    const datum = selectSketchEditToolTarget(armed, {
      kind: "sketchDatumReference",
      sketchId: "sketch_draft",
      datumId: "yAxis",
      geometryKind: "lineSegment",
    } as PrimitiveRef);
    expect(datum.toolPresentation?.floatingInput?.readout).toBe(
      "Use the sketch Y axis as the mirror line",
    );
  });

  test("review A-8: the pick shows the solved candidate (a fixed copy centre moves the original), and Confirm commits exactly what was staged", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copyCentre = outputOf("c").outputPointIds[0]!;
    const fix = (id: string, pointId: string, position: [number, number]) =>
      ({
        constraintId: `constraint_fix_${id}`,
        kind: "fixPoint",
        label: `Fix ${id}`,
        pointId,
        position,
      }) as unknown as ConstraintDefinition;
    const fixed = rebuild(
      session,
      withRepairGeometry(
        session.definition,
        [repairPoint("h0", [-5, 1]), repairPoint("h1", [25, 1])],
        [repairLine("h", "h0", "h1")],
        [
          fix("copy_centre", copyCentre, [6, -3]),
          fix("h0", pid("h0"), [-5, 1]),
          fix("h1", pid("h1"), [25, 1]),
        ],
      ),
    );
    expect(
      fixed.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
      "premise: healthy",
    ).toEqual([]);
    const armed = beginSketchMirrorRepair(
      fixed,
      relationship.derivationId,
      "axis",
      [],
    );
    const hovered = updateSketchEditToolHover(
      armed,
      entityRef(armed, eid("h")),
    );
    const hoverCopy = previewById(hovered).get(
      `preview-${outputOf("c").outputEntityId}`,
    );
    expect(
      hoverCopy?.kind === "circle" && hoverCopy.center,
      "hover: the pure reflection about y = 1 (the copy would jump to y = −1)",
    ).toEqual([6, -1]);
    const picked = selectSketchEditToolTarget(
      armed,
      entityRef(armed, eid("h")),
    );
    const staged = previewById(picked);
    const stagedCopy = staged.get(`preview-${outputOf("c").outputEntityId}`);
    const stagedSeed = staged.get(`preview-${eid("c")}`);
    if (stagedCopy?.kind !== "circle" || stagedSeed?.kind !== "circle")
      throw new Error("the staged copy and the moved original are circles");
    expect(stagedCopy.center[0]).toBeCloseTo(6, 6);
    expect(stagedCopy.center[1], "the copy stays fixed").toBeCloseTo(-3, 6);
    expect(stagedSeed.center[1], "the original moves to y = 5").toBeCloseTo(
      5,
      6,
    );
    expect(
      staged.has(`preview-${eid("ab")}`),
      "an original the solve leaves in place is not staged",
    ).toBe(false);
    const committed = applySketchMirrorRepair(picked);
    expect(committed.activeEditTool).toBeNull();
    expect(committed.activeTool).toBeNull();
    expect(solvedAt(committed, copyCentre)).toEqual(stagedCopy.center);
    expect(solvedAt(committed, pid("c"))).toEqual(stagedSeed.center);
    for (const preview of picked.toolStagedEntities)
      if (preview.kind === "line") {
        const entity = committed.definition.entities.find(
          (entry) => `preview-${entry.entityId}` === preview.id,
        );
        if (entity?.kind !== "lineSegment") throw new Error("line");
        expect([
          solvedAt(committed, entity.startPointId),
          solvedAt(committed, entity.endPointId),
        ]).toEqual([preview.start, preview.end]);
      }
    expect(committed.definition.derivedRelationships![0]!).toEqual({
      ...relationship,
      mirrorReference: { kind: "lineEntity", entityId: eid("h") },
    });
  });

  test("Replace original…: hover refuses an incompatible candidate; the pick of a compatible one reads 'Use ‘n’ as the original of ‘ab mirror’', Enter sends replaceMirrorOriginal, Confirm heals the mirror", () => {
    const { session, relationship, outputOf } = repairSession();
    const seedless = without(session, [eid("ab")]);
    const copy = outputOf("ab").outputEntityId;
    const armed = beginSketchMirrorRepair(
      seedless,
      relationship.derivationId,
      { outputEntityId: copy },
      [],
    );
    expect(armed.toolPresentation?.prompts?.[0]?.text).toBe(
      "Pick the new original of ‘ab mirror’ (mirror ‘mirror 1’).",
    );
    expect(
      updateSketchEditToolHover(armed, entityRef(armed, eid("c")))
        .toolPresentation?.validation?.[0]?.message,
    ).toBe("‘c’ is already an original of mirror ‘mirror 1’.");
    const picked = selectSketchEditToolTarget(
      armed,
      entityRef(armed, eid("n")),
    );
    expect(picked.toolPresentation?.floatingInput).toMatchObject({
      label: "Replace original",
      readout: "Use ‘n’ as the original of ‘ab mirror’",
      submitAction: {
        type: "patch",
        patch: { intent: "replaceMirrorOriginal" },
      },
    });
    expect(getEnterEvent({ sketchSession: picked })).toEqual({
      type: "sketch.toolPatched",
      patch: { intent: "replaceMirrorOriginal" },
    });
    const healed = applySketchMirrorRepair(picked);
    expect(healed.liveSolve!.solvedSnapshot.failedDerivationIds ?? []).toEqual(
      [],
    );
    expect(
      healed.definition.derivedRelationships![0]!.outputs[0],
    ).toMatchObject({
      seedEntityId: eid("n"),
      outputEntityId: copy,
      outputPointIds: outputOf("ab").outputPointIds,
    });
    expect(
      beginSketchMirrorRepair(
        seedless,
        relationship.derivationId,
        { outputEntityId: eid("missing") },
        [],
      ),
      "a copy that is not there does not arm the repair",
    ).toBe(seedless);
  });

  test("review A-4: when the definition loses the mirror (Undo of its creation) the repair ends, as Cancel does: no tool, no 'mirror ‘’' prompt, the sketch's own message", () => {
    const { session, relationship } = repairSession();
    const broken = without(session, [eid("axis")]);
    const armed = beginSketchMirrorRepair(
      broken,
      relationship.derivationId,
      "axis",
      [],
    );
    const mirrorless = restageSketchMirrorTool(
      rebuild(armed, { ...armed.definition, derivedRelationships: [] }),
    );
    expect(mirrorless.activeEditTool).toBeNull();
    expect(mirrorless.activeTool).toBeNull();
    expect(mirrorless.toolPresentation).toBeNull();
    expect(mirrorless.validationMessage).toBeNull();
    const original = beginSketchMirrorRepair(
      broken,
      relationship.derivationId,
      { outputEntityId: relationship.outputs[0]!.outputEntityId },
      [],
    );
    const copyless = restageSketchMirrorTool(
      without(original, [relationship.outputs[0]!.outputEntityId]),
    );
    expect(copyless.activeEditTool, "the target copy gone").toBeNull();
    expect(
      copyless.validationMessage,
      "the broken mirror is explained again",
    ).toMatch(/^Mirror ‘mirror 1’ is broken: /);
  });

  test("Confirm without a valid pick changes nothing; Undo of the definition while picked re-judges the candidate", () => {
    const { session, relationship } = repairSession();
    const armed = beginSketchMirrorRepair(
      session,
      relationship.derivationId,
      "axis",
      [],
    );
    expect(applySketchMirrorRepair(armed)).toBe(armed);
    const picked = selectSketchEditToolTarget(
      armed,
      entityRef(armed, eid("l2")),
    );
    const withoutLine = restageSketchMirrorTool({
      ...picked,
      definition: {
        ...picked.definition,
        entityIds: picked.definition.entityIds.filter((id) => id !== eid("l2")),
        entities: picked.definition.entities.filter(
          (entity) => entity.entityId !== eid("l2"),
        ),
      },
    });
    expect(withoutLine.activeEditTool?.selectedTargets).toEqual([]);
    expect(withoutLine.toolStagedEntities).toEqual([]);
    expect(withoutLine.toolPresentation?.floatingInput ?? null).toBeNull();
    expect(getEnterEvent({ sketchSession: withoutLine })).toBeNull();
  });
});
