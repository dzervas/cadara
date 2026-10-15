/**
 * T16a ([TECH] T16-1): the mirror removal write set. Logic lane; seam: the
 * exported `removeMirrorRelationship` (definition in, definition out), on
 * mirrors authored by the production Mirror builder (shared fixture). The
 * downstream rows re-solve the result through the session's live solve to
 * show each downstream relationship is explicitly broken, not cascaded.
 */
import { describe, expect, test } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchEntityDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  evaluateMirrorRelationship,
  indexMirrorGeometry,
  MIRROR_DIAGNOSTIC_CODES,
} from "@/contracts/sketch/mirror-requirements";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  deleteSelectedSketchGeometry,
  offsetEditInputGate,
} from "@/domain/editor/sketch-session/editing";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import {
  chainSession,
  eid,
  entityRef,
  entityTarget,
  mirroredSession,
  pid,
  seedDefinition,
  withDerived,
  type P,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  MIRROR_CYCLE_MESSAGE,
  removeMirrorRelationship,
  replaceMirrorLine,
  replaceMirrorOriginal,
  type MirrorReplacement,
} from "./mirror-repair";

type Mirror = ReturnType<typeof mirroredSession>["relationship"];

const remove = (definition: SketchDefinition, derivationId: string) => {
  const removal = removeMirrorRelationship(definition, derivationId);
  if (!removal) throw new Error(`no mirror ${derivationId}`);
  return removal;
};
const pointIdsOf = (points: SketchDefinition["points"]) =>
  points.map((point) => point.pointId);
const entityIdsOf = (entities: SketchDefinition["entities"]) =>
  entities.map((entity) => entity.entityId);
const outputEntityIds = (relationship: Mirror) =>
  new Set<string>(relationship.outputs.map((output) => output.outputEntityId));
const outputPointIds = (relationship: Mirror) =>
  new Set<string>(
    relationship.outputs.flatMap((output) => output.outputPointIds),
  );
/** Drops entities (and nothing else), as a peer's Delete or a crafted document might. */
const withoutEntities = (
  definition: SketchDefinition,
  entityIds: readonly string[],
): SketchDefinition => {
  const entities = definition.entities.filter(
    (entity) => !entityIds.includes(entity.entityId),
  );
  return {
    ...definition,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
  };
};
const line = (id: string, a: SketchPointId, b: SketchPointId) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    startPointId: a,
    endPointId: b,
  }) as SketchEntityDefinition;
const withEntity = (
  definition: SketchDefinition,
  entity: SketchEntityDefinition,
): SketchDefinition => ({
  ...definition,
  entityIds: [...definition.entityIds, entity.entityId],
  entities: [...definition.entities, entity],
});
const failureCode = (definition: SketchDefinition, relationship: Mirror) => {
  const evaluation = evaluateMirrorRelationship({
    relationship,
    geometry: indexMirrorGeometry(definition),
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  });
  return evaluation.ok ? null : evaluation.failure.diagnostic.code;
};
const resolve = (session: SketchSessionState, definition: SketchDefinition) =>
  rebuildSessionForDefinition(session, { definition });

describe("T16a: removing a mirror deletes exactly its write set", () => {
  test("healthy line/circle/arc/spline mirror: the relationship, its 4 copies and their points go; seeds, axis and their points stay untouched", () => {
    const { session, relationship } = mirroredSession("free");
    const before = session.definition;
    const removal = remove(before, relationship.derivationId);
    const copies = outputEntityIds(relationship);
    const copyPoints = outputPointIds(relationship);
    expect(copies.size, "premise: four copies").toBe(4);
    expect([...removal.removedEntityIds].sort()).toEqual([...copies].sort());
    expect([...removal.removedPointIds].sort()).toEqual([...copyPoints].sort());
    const kept = before.entities.filter(
      (entity) => !copies.has(entity.entityId),
    );
    const keptPoints = before.points.filter(
      (point) => !copyPoints.has(point.pointId),
    );
    expect(removal.definition).toEqual({
      ...before,
      pointIds: pointIdsOf(keptPoints),
      points: keptPoints,
      entityIds: entityIdsOf(kept),
      entities: kept,
      derivedRelationships: [],
    });
    expect(
      removal.definition.entities.map((entity) => entity.entityId),
      "seeds and the axis, in order",
    ).toEqual(
      ["ab", "c", "s", "ar", "axis", "u"].map((id) => eid(id) as string),
    );
    expect(removal.brokenDownstream).toEqual([]);
    expect(
      before.derivedRelationships,
      "the input definition is not mutated",
    ).toHaveLength(1);
  });

  test("an output point shared by two outputs (two seeds sharing an end) is removed once", () => {
    // Line bu shares b with ab: the builder gives both copies one copy of b.
    const base = rebuildSessionForDefinition(mirroredSession("free").session, {
      definition: withEntity(seedDefinition(), line("bu", pid("b"), pid("u"))),
    });
    const { session, relationship } = withDerived(
      base,
      "mirror",
      [eid("ab"), eid("bu"), eid("axis")],
      80,
    );
    if (relationship.kind !== "mirror") throw new Error("mirror");
    const [abCopy, buCopy] = relationship.outputs;
    const shared = abCopy!.outputPointIds[1]!;
    expect(buCopy!.outputPointIds[0], "premise: one shared copy point").toBe(
      shared,
    );
    const removal = remove(session.definition, relationship.derivationId);
    expect([...removal.removedPointIds].sort()).toEqual(
      [...outputPointIds(relationship)].sort(),
    );
    expect(removal.removedPointIds.size, "three distinct copy points").toBe(3);
    expect(removal.definition.pointIds).toEqual(
      pointIdsOf(removal.definition.points),
    );
    expect(removal.definition.pointIds).toEqual(base.definition.pointIds);
    expect(removal.definition.entities).toEqual(base.definition.entities);
  });

  test("a copy point a user entity reuses stays, with that entity and its requirements; the copy's other points go", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const [ma, mb] = outputOf("ab").outputPointIds;
    const fix: ConstraintDefinition = {
      constraintId: "constraint_fix_ma" as never,
      kind: "fixPoint",
      label: "Fix ma",
      pointId: ma!,
      position: [1, -1],
    };
    const definition = {
      ...withEntity(session.definition, line("user", ma!, pid("u"))),
      constraintIds: [fix.constraintId],
      constraints: [fix],
    };
    const removal = remove(definition, relationship.derivationId);
    expect(
      removal.removedPointIds.has(ma!),
      "the reused copy point stays",
    ).toBe(false);
    expect(removal.removedPointIds.has(mb!), "the copy's other end goes").toBe(
      true,
    );
    expect(removal.definition.pointIds).toContain(ma);
    expect(removal.definition.entities.at(-1)!.entityId).toBe(eid("user"));
    expect(
      removal.definition.constraints,
      "a requirement on the kept point stays",
    ).toEqual([fix]);
    expect(removal.removedConstraints).toEqual([]);
  });

  test("requirements naming a copy go (ordinary Delete semantics); requirements on seeds and the axis stay, in order", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const copyLine = outputOf("ab").outputEntityId;
    const copyCircle = outputOf("c").outputEntityId;
    const [ma] = outputOf("ab").outputPointIds;
    const constraints = [
      {
        constraintId: "c_copy_h",
        kind: "horizontal",
        label: "H",
        entityId: copyLine,
      },
      {
        constraintId: "c_copy_u",
        kind: "coincident",
        label: "C",
        pointIds: [ma, pid("u")],
      },
      {
        constraintId: "c_axis_h",
        kind: "horizontal",
        label: "Axis",
        entityId: eid("axis"),
      },
      {
        constraintId: "c_pair",
        kind: "parallel",
        label: "P",
        entityIds: [eid("ab"), copyLine],
      },
      {
        constraintId: "c_seed_fix",
        kind: "fixPoint",
        label: "F",
        pointId: pid("a"),
        position: [1, 1],
      },
    ] as unknown as ConstraintDefinition[];
    const dimensions = [
      {
        dimensionId: "d_copy_r",
        kind: "circleRadius",
        label: "R",
        entityId: copyCircle,
        value: createLiteralAuthoredValue(1),
      },
      {
        dimensionId: "d_seed_len",
        kind: "lineLength",
        label: "L",
        entityId: eid("ab"),
        value: createLiteralAuthoredValue(2),
      },
      {
        dimensionId: "d_seed_ab",
        kind: "distance",
        label: "D",
        axis: "aligned",
        pointIds: [pid("a"), pid("b")],
        value: createLiteralAuthoredValue(2),
      },
      {
        dimensionId: "d_copy_ref",
        kind: "circleRadius",
        label: "Ref",
        entityId: copyCircle,
        reference: true,
      },
    ] as unknown as DimensionDefinition[];
    const definition: SketchDefinition = {
      ...session.definition,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      dimensionIds: dimensions.map((entry) => entry.dimensionId),
      dimensions,
    };
    const removal = remove(definition, relationship.derivationId);
    expect(
      removal.removedConstraints.map((entry) => entry.constraintId),
    ).toEqual(["c_copy_h", "c_copy_u", "c_pair"]);
    expect(removal.removedDimensions.map((entry) => entry.dimensionId)).toEqual(
      ["d_copy_r", "d_copy_ref"],
    );
    expect(removal.definition.constraintIds).toEqual([
      "c_axis_h",
      "c_seed_fix",
    ]);
    expect(removal.definition.constraints).toEqual([
      constraints[2],
      constraints[4],
    ]);
    expect(removal.definition.dimensionIds).toEqual([
      "d_seed_len",
      "d_seed_ab",
    ]);
    expect(removal.definition.dimensions).toEqual([
      dimensions[1],
      dimensions[2],
    ]);
  });

  test("a copy end rebound to a point outside the map (a stale map) is swept with the copy when nothing else uses it, as Delete would", () => {
    // Review A-8 (mutant X6): the candidates include the removed copies'
    // own points, not only the recorded `outputPointIds`.
    const { session, relationship, outputOf } = mirroredSession("free");
    const copy = outputOf("ab").outputEntityId;
    const fresh = {
      ...session.definition.points.find((point) => point.pointId === pid("u"))!,
      pointId: pid("fresh"),
      label: "fresh",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: pid("fresh"),
      },
    } as SketchDefinition["points"][number];
    const broken: SketchDefinition = {
      ...session.definition,
      pointIds: [...session.definition.pointIds, fresh.pointId],
      points: [...session.definition.points, fresh],
      entities: session.definition.entities.map((entity) =>
        entity.entityId === copy && entity.kind === "lineSegment"
          ? { ...entity, endPointId: fresh.pointId }
          : entity,
      ),
    };
    expect(failureCode(broken, relationship), "premise: stale map").toBe(
      MIRROR_DIAGNOSTIC_CODES.mapStale,
    );
    const removal = remove(broken, relationship.derivationId);
    expect(removal.removedPointIds.has(fresh.pointId)).toBe(true);
    expect(removal.definition.pointIds).not.toContain(fresh.pointId);
    expect(removal.definition.pointIds).toEqual(
      session.definition.pointIds.filter(
        (pointId) => !outputPointIds(relationship).has(pointId),
      ),
    );
  });

  describe("every broken state is removable: the relationship and its remaining copies go, nothing else", () => {
    const setup = () => mirroredSession("free");
    const variants: Record<
      string,
      (definition: SketchDefinition, relationship: Mirror) => SketchDefinition
    > = {
      [MIRROR_DIAGNOSTIC_CODES.axisMissing]: (definition) =>
        withoutEntities(definition, [eid("axis")]),
      "seed missing": (definition) => withoutEntities(definition, [eid("c")]),
      "copy missing": (definition, relationship) =>
        withoutEntities(definition, [relationship.outputs[1]!.outputEntityId]),
      [MIRROR_DIAGNOSTIC_CODES.axisDegenerate]: (definition) => ({
        ...definition,
        points: definition.points.map((point) =>
          point.pointId === pid("x1") ? { ...point, position: [-2, 0] } : point,
        ),
      }),
      "map stale (a copy's end rebound)": (definition, relationship) => ({
        ...definition,
        entities: definition.entities.map((entity) =>
          entity.entityId === relationship.outputs[0]!.outputEntityId &&
          entity.kind === "lineSegment"
            ? { ...entity, endPointId: pid("u") }
            : entity,
        ),
      }),
      "orphan (no seed, copy or axis left)": (definition, relationship) =>
        withoutEntities(definition, [
          ...relationship.seedEntityIds,
          ...relationship.outputs.map((output) => output.outputEntityId),
          eid("axis"),
        ]),
    };
    const expectedCode: Record<string, string> = {
      [MIRROR_DIAGNOSTIC_CODES.axisMissing]:
        MIRROR_DIAGNOSTIC_CODES.axisMissing,
      [MIRROR_DIAGNOSTIC_CODES.axisDegenerate]:
        MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
      "orphan (no seed, copy or axis left)":
        MIRROR_DIAGNOSTIC_CODES.axisMissing,
    };
    for (const [name, breakIt] of Object.entries(variants))
      test(name, () => {
        const { session, relationship } = setup();
        const broken = breakIt(session.definition, relationship);
        expect(failureCode(broken, relationship), "premise: broken").toBe(
          expectedCode[name] ?? MIRROR_DIAGNOSTIC_CODES.mapStale,
        );
        const removal = remove(broken, relationship.derivationId);
        const copies = outputEntityIds(relationship);
        const copyPoints = outputPointIds(relationship);
        expect(removal.definition.derivedRelationships).toEqual([]);
        expect(removal.definition.entities).toEqual(
          broken.entities.filter((entity) => !copies.has(entity.entityId)),
        );
        expect(removal.definition.points).toEqual(
          broken.points.filter((point) => !copyPoints.has(point.pointId)),
        );
        expect(removal.definition.pointIds).toEqual(
          pointIdsOf(removal.definition.points),
        );
      });
  });
});

describe("T16a: downstream relationships are never touched; they become explicitly broken", () => {
  test("chain: removing the upstream mirror leaves the downstream mirror retained, held, map-stale, and the sketch blocked with its own message", () => {
    const { session, setup, second } = chainSession();
    const removal = remove(session.definition, setup.relationship.derivationId);
    expect(removal.brokenDownstream).toEqual([second]);
    expect(removal.definition.derivedRelationships).toEqual([second]);
    const secondCopies = outputEntityIds(second as Mirror);
    expect(
      removal.definition.entities.filter((entity) =>
        secondCopies.has(entity.entityId),
      ),
      "the downstream copies stay",
    ).toHaveLength(secondCopies.size);
    const after = resolve(session, removal.definition);
    const snapshot = after.liveSolve!.solvedSnapshot;
    expect(snapshot.failedDerivationIds, "held").toEqual([second.derivationId]);
    const diagnostic = snapshot.diagnostics.find(
      (entry) => entry.code === MIRROR_DIAGNOSTIC_CODES.mapStale,
    );
    expect(diagnostic?.severity).toBe("error");
    // T16b: the message names the downstream mirror by label and its
    // surviving copy (the first output whose original was removed).
    const firstCopy = removal.definition.entities.find(
      (entity) => entity.entityId === second.outputs[0]!.outputEntityId,
    )!;
    expect(diagnostic?.message).toBe(
      `Mirror ‘${second.label}’ is broken: the original of ‘${firstCopy.label}’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the original, or remove the mirror from the Mirror panel.`,
    );
    expect(after.liveRegions.status, "the sketch stays blocked").toBe(
      "unavailable",
    );
    expect(after.validationMessage).toBe(diagnostic?.message);
  });

  test("a mirror whose axis is a removed copy line stays, axis-missing and held", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const downstream = withDerived(
      session,
      "mirror",
      [eid("u"), outputOf("ab").outputEntityId],
      81,
    );
    const removal = remove(
      downstream.session.definition,
      relationship.derivationId,
    );
    expect(removal.brokenDownstream).toEqual([downstream.relationship]);
    expect(removal.definition.derivedRelationships).toEqual([
      downstream.relationship,
    ]);
    const snapshot = resolve(downstream.session, removal.definition).liveSolve!
      .solvedSnapshot;
    expect(snapshot.failedDerivationIds).toEqual([
      downstream.relationship.derivationId,
    ]);
    expect(snapshot.diagnostics.map((entry) => entry.code)).toContain(
      MIRROR_DIAGNOSTIC_CODES.axisMissing,
    );
  });

  test("an offset and a linear pattern of copies stay; each fails explicitly (G18 missing seed, derived-transform-missing-seed)", () => {
    const { session, relationship, outputOf } = mirroredSession("free");
    const offset = withDerived(
      session,
      "offset",
      [outputOf("ab").outputEntityId],
      82,
      0.5,
    );
    const pattern = withDerived(
      offset.session,
      "linearPattern",
      [outputOf("c").outputEntityId],
      83,
      3,
    );
    const before = pattern.session.definition;
    expect(
      before.derivedRelationships!.slice(1).flatMap((entry) => entry.outputs)
        .length,
      "premise: both downstream relationships have outputs",
    ).toBeGreaterThan(1);
    const removal = remove(before, relationship.derivationId);
    expect(removal.brokenDownstream).toEqual([
      offset.relationship,
      pattern.relationship,
    ]);
    expect(removal.definition.derivedRelationships).toEqual(
      before.derivedRelationships!.slice(1),
    );
    const downstreamOutputs = new Set(
      [offset.relationship, pattern.relationship].flatMap((entry) =>
        entry.outputs.map((output) => output.outputEntityId as string),
      ),
    );
    expect(
      removal.definition.entities.filter((entity) =>
        downstreamOutputs.has(entity.entityId),
      ),
      "their outputs stay",
    ).toEqual(
      before.entities.filter((entity) =>
        downstreamOutputs.has(entity.entityId),
      ),
    );
    const after = resolve(pattern.session, removal.definition);
    const diagnostics = after.liveSolve!.solvedSnapshot.diagnostics;
    // T17e (B2): the offset by label, never by id.
    const named = (code: string, label: string) =>
      diagnostics.find(
        (entry) =>
          entry.code === code &&
          entry.severity === "error" &&
          entry.message.startsWith(`Offset ‘${label}’: `),
      );
    expect(
      named("derived-offset-unsupported-seed", offset.relationship.label),
      "the offset reports its missing seed",
    ).toBeDefined();
    // T16c (T16b review A-1): the pattern's text names it by label (never
    // its id) and the copy whose original was removed.
    expect(
      diagnostics
        .filter((entry) => entry.code === "derived-transform-missing-seed")
        .map((entry) => [entry.severity, entry.message]),
      "the pattern reports its missing seed",
    ).toEqual(
      pattern.relationship.outputs.map((output) => [
        "error",
        `Linear pattern ‘${pattern.relationship.label}’ is broken: the original of ‘${
          removal.definition.entities.find(
            (entity) => entity.entityId === output.outputEntityId,
          )!.label
        }’ was deleted. Profiles from this sketch are blocked. Undo to recover.`,
      ]),
    );
    expect(after.liveRegions.status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------- T16e
//
// T16e ([TECH] T16-9/T16-10, review A-7; logic lane, seam: the exported
// `replaceMirrorLine` / `replaceMirrorOriginal`). The mirrors are authored
// by the production Mirror tool (shared fixture); the context is the
// session's (its live solve and its edit-input gate). Rows that check the
// result re-solve it through the session's live solve.

const TAU = OCC_KERNEL_SETTINGS.modelingTolerance;
const point = (id: string, position: P, isConstruction = false) =>
  ({
    pointId: pid(id),
    label: id,
    target: { kind: "sketchPoint", sketchId: "sketch_draft", pointId: pid(id) },
    position: [position[0], position[1]],
    isConstruction,
  }) as SketchDefinition["points"][number];
const constructionLine = (id: string, a: SketchPointId, b: SketchPointId) =>
  ({ ...line(id, a, b), isConstruction: true }) as SketchEntityDefinition;
const circle = (id: string, centre: SketchPointId, radius: number) =>
  ({
    kind: "circle",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    centerPointId: centre,
    radius,
  }) as SketchEntityDefinition;
const arc = (
  id: string,
  [centre, start, end]: SketchPointId[],
  sweepDirection: "clockwise" | "counterClockwise",
) =>
  ({
    kind: "arc",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    centerPointId: centre,
    startPointId: start,
    endPointId: end,
    sweepDirection,
  }) as SketchEntityDefinition;
const spline = (
  id: string,
  pointIds: SketchPointId[],
  closure: "open" | "closed" = "open",
) =>
  ({
    kind: "spline",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    closure,
    interpolationPolicy: "centripetal-mean-arm-v1",
    pointOccurrenceIds: pointIds.map((_, index) => `${id}_occ${index}`),
    pointOccurrences: pointIds.map((pointId, index) => ({
      occurrenceId: `${id}_occ${index}`,
      pointId,
      tangent: { kind: "automatic" },
    })),
  }) as SketchEntityDefinition;
const withGeometry = (
  definition: SketchDefinition,
  points: readonly SketchDefinition["points"][number][],
  entities: readonly SketchEntityDefinition[],
): SketchDefinition => ({
  ...definition,
  pointIds: [...definition.pointIds, ...points.map((entry) => entry.pointId)],
  points: [...definition.points, ...points],
  entityIds: [
    ...definition.entityIds,
    ...entities.map((entry) => entry.entityId),
  ],
  entities: [...definition.entities, ...entities],
});
/** The session's own replacement context: its live solve and its edit-input gate. */
const contextOf = (session: SketchSessionState, use = "a mirror line") => ({
  modelingTolerance: TAU,
  solvedSnapshot: session.liveSolve!.solvedSnapshot,
  inputRefusal: (entityId: SketchEntityId) =>
    offsetEditInputGate(session, [entityId], use)?.message ?? null,
});
const solvedAt = (session: SketchSessionState, pointId: SketchPointId) =>
  session.liveSolve!.solvedSnapshot.solvedPoints.find(
    (entry) => entry.pointId === pointId,
  )!.solvedPosition;
const expectNear = (actual: P, expected: P, message: string) => {
  expect(actual[0], message).toBeCloseTo(expected[0], 9);
  expect(actual[1], message).toBeCloseTo(expected[1], 9);
};
const refused = (result: MirrorReplacement) =>
  result.ok ? "accepted" : result.message;
const accepted = (result: MirrorReplacement) => {
  if (!result.ok) throw new Error(result.message);
  return result.definition;
};
/** Every copy point of `relationship` at the reflection `reflect` of its seed point, re-solved, and the mirror healthy. */
const expectCopiesAt = (
  session: SketchSessionState,
  relationship: Mirror,
  reflect: (position: P) => P,
  message: string,
) => {
  expect(
    session.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
    `${message}: healthy`,
  ).toEqual([]);
  for (const output of relationship.outputs)
    output.seedPointIds.forEach((seedPointId, index) =>
      expectNear(
        solvedAt(session, output.outputPointIds[index]!),
        reflect(solvedAt(session, seedPointId)),
        `${message}: ${output.outputPointIds[index]}`,
      ),
    );
};

/** Lines to pick: l2 (x = −5), the construction line h (y = 10), a short line, a circle. */
function replacementSession() {
  const { session, relationship, outputOf } = mirroredSession("free");
  const definition = withGeometry(
    session.definition,
    [
      point("l2a", [-5, -10]),
      point("l2b", [-5, 10]),
      point("ha", [-5, 10], true),
      point("hb", [25, 10], true),
      point("ta", [30, 30]),
      point("tb", [30 + TAU / 2, 30]),
      point("kc", [30, -20]),
    ],
    [
      line("l2", pid("l2a"), pid("l2b")),
      constructionLine("h", pid("ha"), pid("hb")),
      line("short", pid("ta"), pid("tb")),
      circle("k", pid("kc"), 2),
    ],
  );
  return {
    session: resolve(session, definition),
    relationship,
    outputOf,
  };
}

describe("T16e: replacing the mirror line", () => {
  test("a line, a construction line and the X/Y sketch axes are accepted; only mirrorReference changes (derivationId, label, seeds, every output id kept); re-solved, the copies are the reflection about the new line", () => {
    const { session, relationship } = replacementSession();
    const cases: [string, Mirror["mirrorReference"], (p: P) => P][] = [
      [
        "line",
        { kind: "lineEntity", entityId: eid("l2") },
        ([x, y]) => [-10 - x, y],
      ],
      [
        "construction line",
        { kind: "lineEntity", entityId: eid("h") },
        ([x, y]) => [x, 20 - y],
      ],
      ["X axis", { kind: "sketchDatum", datum: "xAxis" }, ([x, y]) => [x, -y]],
      ["Y axis", { kind: "sketchDatum", datum: "yAxis" }, ([x, y]) => [-x, y]],
    ];
    for (const [name, candidate, reflect] of cases) {
      const definition = accepted(
        replaceMirrorLine(
          session.definition,
          relationship.derivationId,
          candidate,
          contextOf(session),
        ),
      );
      expect(definition, `${name}: only the reference is written`).toEqual({
        ...session.definition,
        derivedRelationships: [{ ...relationship, mirrorReference: candidate }],
      });
      expectCopiesAt(resolve(session, definition), relationship, reflect, name);
    }
  });

  test("refusals: a circle, an original of this mirror, the current line; nothing is chosen instead", () => {
    const { session, relationship } = replacementSession();
    const replace = (candidate: Mirror["mirrorReference"]) =>
      refused(
        replaceMirrorLine(
          session.definition,
          relationship.derivationId,
          candidate,
          contextOf(session),
        ),
      );
    expect(replace({ kind: "lineEntity", entityId: eid("k") })).toBe(
      "A circle can't be a mirror line. Pick a straight line or a sketch axis.",
    );
    expect(replace({ kind: "lineEntity", entityId: eid("ab") })).toBe(
      "‘ab’ is an original of mirror ‘mirror 1’, so it can't be its mirror line. Pick another line or a sketch axis.",
    );
    expect(replace({ kind: "lineEntity", entityId: eid("axis") })).toBe(
      "‘axis’ is already the mirror line of mirror ‘mirror 1’.",
    );
    const datum = mirroredSession("datumAxis");
    expect(
      refused(
        replaceMirrorLine(
          datum.session.definition,
          datum.relationship.derivationId,
          { kind: "sketchDatum", datum: "xAxis" },
          contextOf(datum.session),
        ),
      ),
    ).toBe(
      "The sketch X axis is already the mirror line of mirror ‘mirror 1’.",
    );
  });

  test("a line shorter than τ is refused, judged at the current solved positions (not the authored ones)", () => {
    const { session, relationship } = replacementSession();
    const SHORT =
      "‘short’ is shorter than the modeling tolerance, so it can't be a mirror line. Pick a longer line or a sketch axis.";
    const replaceWith = (
      entityId: SketchEntityId,
      solvedSnapshot: SolvedSketchSnapshot,
    ) =>
      refused(
        replaceMirrorLine(
          session.definition,
          relationship.derivationId,
          { kind: "lineEntity", entityId },
          { ...contextOf(session), solvedSnapshot },
        ),
      );
    const snapshot = session.liveSolve!.solvedSnapshot;
    const moved = (pointId: SketchPointId, position: P) => ({
      ...snapshot,
      solvedPoints: snapshot.solvedPoints.map((entry) =>
        entry.pointId === pointId
          ? { ...entry, solvedPosition: [position[0], position[1]] as P }
          : entry,
      ),
    });
    expect(
      session.liveSolve!.solvedSnapshot.diagnostics.map((entry) => entry.code),
      "premise: the authored short line is a degenerate line of the sketch",
    ).toContain("degenerate-line-segment");
    expect(replaceWith(eid("short"), snapshot)).toBe(SHORT);
    expect(
      replaceWith(eid("short"), moved(pid("tb"), [31, 30]) as never),
      "authored short, solved 1 long: accepted",
    ).toBe("accepted");
    expect(
      replaceWith(eid("l2"), moved(pid("l2b"), [-5, -10 + TAU / 2]) as never),
      "authored 20 long, solved shorter than τ: refused",
    ).toBe(SHORT.replace("short", "l2"));
  });

  test("geometry that is not accepted (a broken mirror's held copy) is refused with the edit-input text", () => {
    const { session, relationship } = replacementSession();
    // A second mirror of l2 about h, then h deleted: its copy is held.
    const second = withDerived(session, "mirror", [eid("l2"), eid("h")], 70);
    if (second.relationship.kind !== "mirror") throw new Error("mirror");
    const heldCopy = second.relationship.outputs[0]!.outputEntityId;
    const broken = resolve(
      second.session,
      withoutEntities(second.session.definition, [eid("h")]),
    );
    expect(
      broken.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: the second mirror is held",
    ).toEqual([second.relationship.derivationId]);
    expect(
      refused(
        replaceMirrorLine(
          broken.definition,
          relationship.derivationId,
          { kind: "lineEntity", entityId: heldCopy },
          contextOf(broken),
        ),
      ),
    ).toBe(
      "edit-input-derived-failed: ‘l2 mirror’ is a copy made by mirror ‘mirror 70’, which is broken, so it can't be used as a mirror line. Fix it (Undo or replace the mirror line) or remove the mirror from the Mirror panel.",
    );
  });

  test("broken mirrors are replaceable too: a deleted line is replaced and the mirror heals; with its original also deleted, the line is still replaced and the mirror stays broken for that reason only", () => {
    const { session, relationship, outputOf } = replacementSession();
    const lineless = resolve(
      session,
      withoutEntities(session.definition, [eid("axis")]),
    );
    expect(
      lineless.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: broken",
    ).toEqual([relationship.derivationId]);
    const healed = resolve(
      lineless,
      accepted(
        replaceMirrorLine(
          lineless.definition,
          relationship.derivationId,
          { kind: "lineEntity", entityId: eid("l2") },
          contextOf(lineless),
        ),
      ),
    );
    expectCopiesAt(healed, relationship, ([x, y]) => [-10 - x, y], "healed");
    expect(
      healed
        .liveSolve!.solvedSnapshot.diagnostics.filter(
          (entry) => entry.severity === "error",
        )
        .map((entry) => entry.code),
      "only the unrelated short line's own error is left",
    ).toEqual(["degenerate-line-segment"]);

    const both = resolve(
      session,
      withoutEntities(session.definition, [eid("axis"), eid("ab")]),
    );
    const rebound = resolve(
      both,
      accepted(
        replaceMirrorLine(
          both.definition,
          relationship.derivationId,
          { kind: "lineEntity", entityId: eid("l2") },
          contextOf(both),
        ),
      ),
    );
    expect(rebound.liveSolve!.solvedSnapshot.failedDerivationIds).toEqual([
      relationship.derivationId,
    ]);
    expect(rebound.validationMessage).toBe(
      `Mirror ‘mirror 1’ is broken: the original of ‘${
        both.definition.entities.find(
          (entity) => entity.entityId === outputOf("ab").outputEntityId,
        )!.label
      }’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the original, or remove the mirror from the Mirror panel.`,
    );
  });

  test("degenerate mirror line repaired: the mirror failure clears; the short line keeps its own degenerate-line-segment until it is fixed", () => {
    const { session, relationship } = replacementSession();
    const shortAxis = resolve(session, {
      ...session.definition,
      points: session.definition.points.map((entry) =>
        entry.pointId === pid("x1")
          ? { ...entry, position: [-2 + TAU / 2, 0] }
          : entry,
      ),
    });
    const codes = (state: SketchSessionState) =>
      state.liveSolve!.solvedSnapshot.diagnostics.map((entry) => entry.code);
    expect(codes(shortAxis), "premise").toEqual(
      expect.arrayContaining([
        MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
        "degenerate-line-segment",
      ]),
    );
    const repaired = resolve(
      shortAxis,
      accepted(
        replaceMirrorLine(
          shortAxis.definition,
          relationship.derivationId,
          { kind: "lineEntity", entityId: eid("l2") },
          contextOf(shortAxis),
        ),
      ),
    );
    expect(
      repaired.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
    ).toEqual([]);
    expect(codes(repaired)).not.toContain(
      MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
    );
    expect(
      codes(repaired).filter((code) => code === "degenerate-line-segment"),
      "the old short line and the other short line keep their own diagnostic",
    ).toHaveLength(2);
    expect(repaired.liveRegions.status).toBe("unavailable");
  });

  test("downstream offset, pattern and mirror of the copies stay healthy and untouched after the line is replaced (copy ids kept)", () => {
    const { session, setup, second } = chainSession();
    const withLine = resolve(
      session,
      withGeometry(
        session.definition,
        [point("l2a", [-5, -10]), point("l2b", [-5, 10])],
        [line("l2", pid("l2a"), pid("l2b"))],
      ),
    );
    const offset = withDerived(
      withLine,
      "offset",
      [setup.outputOf("ab").outputEntityId],
      84,
      0.5,
    );
    const pattern = withDerived(
      offset.session,
      "linearPattern",
      [setup.outputOf("c").outputEntityId],
      85,
      3,
    );
    const before = pattern.session;
    expect(
      before.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
      "premise: all healthy",
    ).toEqual([]);
    const definition = accepted(
      replaceMirrorLine(
        before.definition,
        setup.relationship.derivationId,
        { kind: "lineEntity", entityId: eid("l2") },
        contextOf(before),
      ),
    );
    expect(
      definition.derivedRelationships!.slice(1),
      "downstream records untouched",
    ).toEqual(before.definition.derivedRelationships!.slice(1));
    const after = resolve(before, definition);
    const snapshot = after.liveSolve!.solvedSnapshot;
    expect(snapshot.failedDerivationIds ?? []).toEqual([]);
    expect(
      snapshot.diagnostics.filter((entry) => entry.severity === "error"),
    ).toEqual([]);
    expect(
      [second, offset.relationship, pattern.relationship].every((entry) =>
        definition.derivedRelationships!.includes(entry),
      ),
    ).toBe(true);
    // The downstream mirror's copies follow the moved first copies.
    const reflectX30 = ([x, y]: P): P => [60 - x, y];
    for (const output of second.outputs)
      output.seedPointIds.forEach((seedPointId, index) =>
        expectNear(
          solvedAt(after, output.outputPointIds[index]!),
          reflectX30(solvedAt(after, seedPointId)),
          "second copy",
        ),
      );
  });
});

describe("T16e: the cycle check (bounded, through the relationship order)", () => {
  test("mirror line := its own copy, or := a downstream mirror's copy: refused, the definition untouched", () => {
    const { session, setup, secondOutputOf } = chainSession();
    const firstCopy = setup.outputOf("ab").outputEntityId;
    for (const entityId of [
      firstCopy,
      secondOutputOf(firstCopy).outputEntityId,
    ])
      expect(
        refused(
          replaceMirrorLine(
            session.definition,
            setup.relationship.derivationId,
            { kind: "lineEntity", entityId },
            contextOf(session),
          ),
        ),
        entityId,
      ).toBe(MIRROR_CYCLE_MESSAGE);
  });

  test("mirror line := an upstream mirror's copy: allowed, and the chain solves", () => {
    const { session, relationship, outputOf } = replacementSession();
    const downstream = withDerived(
      session,
      "mirror",
      [eid("u"), eid("l2")],
      72,
    );
    const definition = accepted(
      replaceMirrorLine(
        downstream.session.definition,
        downstream.relationship.derivationId,
        { kind: "lineEntity", entityId: outputOf("ab").outputEntityId },
        contextOf(downstream.session),
      ),
    );
    const after = resolve(downstream.session, definition);
    expect(after.liveSolve!.solvedSnapshot.failedDerivationIds ?? []).toEqual(
      [],
    );
    expect(definition.derivedRelationships![0]).toBe(relationship);
  });

  test("a persisted loop (line := own copy) is repaired by a valid line; a mirror still reading geometry made in a loop is refused even though nothing new becomes unresolved (review A-7)", () => {
    const { session, setup, second } = chainSession();
    const withLine = withGeometry(
      session.definition,
      [point("l2a", [-5, -10]), point("l2b", [-5, 10])],
      [line("l2", pid("l2a"), pid("l2b"))],
    );
    const looped = resolve(session, {
      ...withLine,
      derivedRelationships: withLine.derivedRelationships!.map((entry) =>
        entry.derivationId === setup.relationship.derivationId
          ? {
              ...entry,
              mirrorReference: {
                kind: "lineEntity" as const,
                entityId: setup.outputOf("ab").outputEntityId,
              },
            }
          : entry,
      ),
    });
    expect(
      looped.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: the loop and its dependent are unresolved",
    ).toEqual([setup.relationship.derivationId, second.derivationId]);
    expect(
      refused(
        replaceMirrorLine(
          looped.definition,
          second.derivationId,
          { kind: "lineEntity", entityId: eid("l2") },
          contextOf(looped),
        ),
      ),
      "the second mirror's originals are still made in the loop (review A-7: its own wording)",
    ).toBe(
      `Mirror ‘${second.label}’ depends on geometry made in a dependency loop. Repair that loop first, or remove the mirror.`,
    );
    const repaired = resolve(
      looped,
      accepted(
        replaceMirrorLine(
          looped.definition,
          setup.relationship.derivationId,
          { kind: "lineEntity", entityId: eid("l2") },
          contextOf(looped),
        ),
      ),
    );
    expect(
      repaired.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
      "both resolve again",
    ).toEqual([]);
  });

  test("creation needs no new check: fresh copies close no loop (a mirror of a copy about another copy solves); a seed made in a loop is refused by creation", () => {
    const { session, relationship, outputOf } = replacementSession();
    const chained = withDerived(
      session,
      "mirror",
      [outputOf("c").outputEntityId, outputOf("ab").outputEntityId],
      73,
    );
    expect(
      chained.session.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
    ).toEqual([]);
    const looped = resolve(session, {
      ...session.definition,
      derivedRelationships: [
        {
          ...relationship,
          mirrorReference: {
            kind: "lineEntity",
            entityId: outputOf("ab").outputEntityId,
          },
        },
      ],
    });
    expect(() =>
      withDerived(
        looped,
        "mirror",
        [outputOf("c").outputEntityId, eid("l2")],
        74,
      ),
    ).toThrow(
      "Sketch mirror could not mirror the selected geometry about this axis.",
    );
  });
});

/** The seeds' copies, with one original (`ab` unless told) deleted, and new geometry to pick. */
function originalSession(deleted: readonly string[] = ["ab"]) {
  const { session, relationship, outputOf } = mirroredSession("free");
  const definition = withGeometry(
    withoutEntities(session.definition, deleted.map(eid)),
    [
      point("n0", [2, 4]),
      point("n1", [5, 6]),
      point("nc", [8, 7]),
      point("ra", [20, 6]),
      point("rb", [21, 6]),
      point("rd", [20, 7]),
      point("p0", [9, 6]),
      point("p1", [10, 8]),
      point("p2", [12, 7]),
      point("p3", [13, 9]),
    ],
    [
      line("n", pid("n0"), pid("n1")),
      circle("nk", pid("nc"), 3),
      arc("na", [pid("ra"), pid("rb"), pid("rd")], "clockwise"),
      spline("ns", [pid("p0"), pid("p1"), pid("p2")]),
      spline("ns4", [pid("p0"), pid("p1"), pid("p2"), pid("p3")]),
      spline("nsc", [pid("p0"), pid("p1"), pid("p2")], "closed"),
      {
        kind: "point",
        entityId: eid("np"),
        label: "np",
        target: entityTarget("np"),
        isConstruction: false,
        pointId: pid("n1"),
      } as SketchEntityDefinition,
    ],
  );
  return { session: resolve(session, definition), relationship, outputOf };
}

describe("T16e: replacing the original of a copy", () => {
  const replace = (
    session: SketchSessionState,
    relationship: Mirror,
    outputEntityId: SketchEntityId,
    seedEntityId: SketchEntityId,
  ) =>
    replaceMirrorOriginal(
      session.definition,
      relationship.derivationId,
      outputEntityId,
      seedEntityId,
      contextOf(session, "a mirror original"),
    );

  test("a line for a deleted line original: that output's seed and seed points and the matching seedEntityIds entry are written, every id kept; re-solved, the copy reflects the new line", () => {
    const { session, relationship, outputOf } = originalSession();
    const copy = outputOf("ab");
    expect(
      session.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: broken",
    ).toEqual([relationship.derivationId]);
    const definition = accepted(
      replace(session, relationship, copy.outputEntityId, eid("n")),
    );
    expect(definition).toEqual({
      ...session.definition,
      derivedRelationships: [
        {
          ...relationship,
          seedEntityIds: [eid("n"), eid("c"), eid("s"), eid("ar")],
          outputs: relationship.outputs.map((output) =>
            output === copy
              ? {
                  ...output,
                  seedEntityId: eid("n"),
                  seedPointIds: [pid("n0"), pid("n1")],
                }
              : output,
          ),
        },
      ],
    });
    expectCopiesAt(
      resolve(session, definition),
      {
        ...relationship,
        outputs: definition.derivedRelationships![0]!.outputs,
      } as Mirror,
      ([x, y]) => [x, -y],
      "healed",
    );
  });

  test("circle, arc (centre/start/end; the copy's sweep follows) and spline (same fit-point count and closure; the copy's occurrence ids kept) originals", () => {
    const { session, relationship, outputOf } = originalSession([
      "c",
      "ar",
      "s",
    ]);
    let definition = session.definition;
    let state = session;
    for (const [seed, copyOf] of [
      ["nk", "c"],
      ["na", "ar"],
      ["ns", "s"],
    ] as const) {
      definition = accepted(
        replaceMirrorOriginal(
          definition,
          relationship.derivationId,
          outputOf(copyOf).outputEntityId,
          eid(seed),
          contextOf(state, "a mirror original"),
        ),
      );
      state = resolve(state, definition);
    }
    const copyOf = (seed: string) =>
      definition.entities.find(
        (entity) => entity.entityId === outputOf(seed).outputEntityId,
      )!;
    expect(
      copyOf("ar"),
      "the arc copy's sweep is the new original's, flipped",
    ).toMatchObject({
      sweepDirection: "counterClockwise",
    });
    const splineCopy = copyOf("s");
    const splineCopyBefore = session.definition.entities.find(
      (entity) => entity.entityId === outputOf("s").outputEntityId,
    );
    if (splineCopy.kind !== "spline" || splineCopyBefore?.kind !== "spline")
      throw new Error("spline");
    expect(splineCopy.pointOccurrenceIds).toEqual(
      splineCopyBefore.pointOccurrenceIds,
    );
    expect(
      splineCopyBefore.pointOccurrences[1]!.tangent.kind,
      "premise: the old original's middle tangent was authored",
    ).toBe("authored");
    expect(
      splineCopy.pointOccurrences.map((occurrence) => occurrence.tangent.kind),
      "tangent kinds follow the new original (all automatic)",
    ).toEqual(["automatic", "automatic", "automatic"]);
    expectCopiesAt(
      state,
      definition.derivedRelationships![0] as Mirror,
      ([x, y]) => [x, -y],
      "all three",
    );
    const radius = state.liveSolve!.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === outputOf("c").outputEntityId,
    );
    expect(radius).toMatchObject({ kind: "circle", solvedRadius: 3 });
  });

  test("incompatible geometry is refused with the recreate text: kind mismatch, spline fit-point count, spline closure", () => {
    const { session, relationship, outputOf } = originalSession([
      "ab",
      "s",
      "c",
    ]);
    const cases: [string, string, string][] = [
      [
        "nk",
        "ab",
        "A circle can't replace the original of this mirrored line.",
      ],
      ["n", "c", "A line can't replace the original of this mirrored circle."],
      ["na", "ab", "An arc can't replace the original of this mirrored line."],
      ["np", "ab", "A point can't replace the original of this mirrored line."],
      [
        "ns4",
        "s",
        "A spline with 4 fit points can't replace the original of this mirrored spline with 3.",
      ],
      [
        "nsc",
        "s",
        "A closed spline can't replace the original of this mirrored open spline.",
      ],
    ];
    for (const [seed, copyOf, text] of cases)
      expect(
        refused(
          replace(
            session,
            relationship,
            outputOf(copyOf).outputEntityId,
            eid(seed),
          ),
        ),
        `${seed} for the copy of ${copyOf}`,
      ).toBe(`${text} Remove the mirror and mirror the new geometry instead.`);
  });

  test("an original of this mirror, its mirror line, an offset spline curve, a deleted copy: refused", () => {
    const { session, relationship, outputOf } = originalSession();
    const copy = outputOf("ab").outputEntityId;
    expect(refused(replace(session, relationship, copy, eid("c")))).toBe(
      "‘c’ is already an original of mirror ‘mirror 1’.",
    );
    expect(refused(replace(session, relationship, copy, eid("axis")))).toBe(
      "‘axis’ is the mirror line of mirror ‘mirror 1’, so it can't be one of its originals.",
    );
    const offset = withDerived(session, "offset", [eid("ns")], 75, 0.5);
    if (offset.relationship.kind !== "offset") throw new Error("offset");
    const shell = offset.relationship.piecewiseCubicOutputs[0]!.outputEntityId;
    expect(refused(replace(offset.session, relationship, copy, shell))).toBe(
      "An offset spline curve cannot be mirrored, patterned or transformed yet.",
    );
    const copyless = resolve(
      session,
      withoutEntities(session.definition, [outputOf("c").outputEntityId]),
    );
    expect(
      refused(
        replace(
          copyless,
          relationship,
          outputOf("c").outputEntityId,
          eid("nk"),
        ),
      ),
    ).toBe(
      "This copy of mirror ‘mirror 1’ was deleted, so it has no original to replace. Remove the mirror from the Mirror panel instead.",
    );
  });

  test("geometry that is not accepted (a broken mirror's held copy) is refused with the edit-input text", () => {
    const { session, relationship, outputOf } = originalSession();
    const second = withDerived(session, "mirror", [eid("n"), eid("axis")], 76);
    if (second.relationship.kind !== "mirror") throw new Error("mirror");
    // The second mirror's line reference is gone: its copy stays, held.
    const lineless = resolve(second.session, {
      ...second.session.definition,
      derivedRelationships: second.session.definition.derivedRelationships!.map(
        (entry) =>
          entry.derivationId === second.relationship.derivationId
            ? {
                ...entry,
                mirrorReference: {
                  kind: "lineEntity" as const,
                  entityId: eid("gone"),
                },
              }
            : entry,
      ),
    });
    expect(
      lineless.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise",
    ).toEqual([relationship.derivationId, second.relationship.derivationId]);
    expect(
      refused(
        replace(
          lineless,
          relationship,
          outputOf("ab").outputEntityId,
          second.relationship.outputs[0]!.outputEntityId,
        ),
      ),
    ).toBe(
      "edit-input-derived-failed: ‘n mirror’ is a copy made by mirror ‘mirror 76’, which is broken, so it can't be used as a mirror original. Fix it (Undo or replace the mirror line) or remove the mirror from the Mirror panel.",
    );
  });

  test("original := its own copy, or := a downstream mirror's copy: refused by the cycle check", () => {
    const { session, setup, secondOutputOf } = chainSession();
    const firstCopy = setup.outputOf("ab").outputEntityId;
    for (const seed of [firstCopy, secondOutputOf(firstCopy).outputEntityId])
      expect(
        refused(
          replaceMirrorOriginal(
            session.definition,
            setup.relationship.derivationId,
            firstCopy,
            seed,
            contextOf(session, "a mirror original"),
          ),
        ),
        seed,
      ).toBe(MIRROR_CYCLE_MESSAGE);
  });

  test("a healthy mirror's original is replaceable: the old original is freed, the copy follows the new one", () => {
    const { session, relationship, outputOf } = originalSession([]);
    const definition = accepted(
      replace(session, relationship, outputOf("ab").outputEntityId, eid("n")),
    );
    const after = resolve(session, definition);
    expectCopiesAt(
      after,
      definition.derivedRelationships![0] as Mirror,
      ([x, y]) => [x, -y],
      "healthy",
    );
    expect(definition.derivedRelationships![0]!.seedEntityIds).not.toContain(
      eid("ab"),
    );
  });
});

describe("T16e: point correspondence stays unambiguous (shared copy points)", () => {
  /** ab and bu share b, so their copies share one copy point; bu is deleted. */
  function sharedSession() {
    const base = rebuildSessionForDefinition(mirroredSession("free").session, {
      definition: withEntity(seedDefinition(), line("bu", pid("b"), pid("u"))),
    });
    const { session, relationship } = withDerived(
      base,
      "mirror",
      [eid("ab"), eid("bu"), eid("axis")],
      80,
    );
    if (relationship.kind !== "mirror") throw new Error("mirror");
    const definition = withGeometry(
      withoutEntities(session.definition, [eid("bu")]),
      [point("w", [4, 6]), point("q", [3, 4])],
      [
        line("bw", pid("b"), pid("w")),
        line("qw", pid("q"), pid("w")),
        line("ba", pid("b"), pid("a")),
        line("wb", pid("w"), pid("b")),
      ],
    );
    return {
      session: resolve(session, definition),
      relationship,
      buCopy: relationship.outputs[1]!,
    };
  }
  const replace = (
    session: SketchSessionState,
    relationship: Mirror,
    outputEntityId: SketchEntityId,
    seed: string,
  ) =>
    replaceMirrorOriginal(
      session.definition,
      relationship.derivationId,
      outputEntityId,
      eid(seed),
      contextOf(session, "a mirror original"),
    );

  // Review A-1: the refusals say what does not line up, not "ambiguous".
  const SHARED = (seed: string) =>
    `‘${seed}’ can't replace the original of ‘bu mirror’: its points don't line up with the points this copy shares with the other copies. Draw it from the shared point, or remove the mirror and mirror the new geometry instead.`;

  test("a copy point shared with another copy must keep that copy's original point: b→w is accepted; q→w (q ≠ b at the shared point) and the reversed w→b are refused, saying what does not line up", () => {
    const { session, relationship, buCopy } = sharedSession();
    expect(buCopy.outputPointIds[0], "premise: the shared copy point").toBe(
      relationship.outputs[0]!.outputPointIds[1],
    );
    const after = resolve(
      session,
      accepted(replace(session, relationship, buCopy.outputEntityId, "bw")),
    );
    expect(after.liveSolve!.solvedSnapshot.failedDerivationIds ?? []).toEqual(
      [],
    );
    for (const seed of ["qw", "wb"])
      expect(
        refused(replace(session, relationship, buCopy.outputEntityId, seed)),
        seed,
      ).toBe(SHARED(seed));
  });

  test("one new original point mapped to two copy points is refused too (math review A-7), naming that point: the line b→a, and a circle centred on another original's end", () => {
    const { session, relationship, buCopy } = sharedSession();
    expect(
      refused(replace(session, relationship, buCopy.outputEntityId, "ba")),
    ).toBe(
      "‘ba’ can't replace the original of ‘bu mirror’: its point ‘a’ is already the original of another copy's point. Use geometry with its own points, or remove the mirror and mirror the new geometry instead.",
    );
    const circles = originalSession(["c"]);
    const withCircle = resolve(
      circles.session,
      withGeometry(circles.session.definition, [], [circle("ka", pid("a"), 1)]),
    );
    expect(
      refused(
        replaceMirrorOriginal(
          withCircle.definition,
          circles.relationship.derivationId,
          circles.outputOf("c").outputEntityId,
          eid("ka"),
          contextOf(withCircle, "a mirror original"),
        ),
      ),
    ).toBe(
      "‘ka’ can't replace the original of ‘c mirror’: its point ‘a’ is already the original of another copy's point. Use geometry with its own points, or remove the mirror and mirror the new geometry instead.",
    );
  });

  test("review R-1: a connected original polyline deleted with its shared point is re-originated copy by copy (either order) and heals; an inconsistent second pick is still refused", () => {
    const base = rebuildSessionForDefinition(mirroredSession("free").session, {
      definition: withEntity(seedDefinition(), line("bu", pid("b"), pid("u"))),
    });
    const { session, relationship } = withDerived(
      base,
      "mirror",
      [eid("ab"), eid("bu"), eid("axis")],
      90,
    );
    if (relationship.kind !== "mirror") throw new Error("mirror");
    const [abCopy, buCopy] = relationship.outputs;
    const deleted = deleteSelectedSketchGeometry(session, [
      entityRef(session, eid("ab")),
      entityRef(session, eid("bu")),
    ]);
    expect(
      deleted.definition.points.some((entry) => entry.pointId === pid("b")),
      "premise: the shared original point is gone",
    ).toBe(false);
    const drawn = resolve(
      deleted,
      withGeometry(
        deleted.definition,
        [
          point("x", [1, 2]),
          point("y", [3, 3]),
          point("z", [5, 5]),
          point("w", [6, 1]),
        ],
        [
          line("xy", pid("x"), pid("y")),
          line("yz", pid("y"), pid("z")),
          line("wz", pid("w"), pid("z")),
        ],
      ),
    );
    for (const order of [
      [
        [abCopy!, "xy"],
        [buCopy!, "yz"],
      ],
      [
        [buCopy!, "yz"],
        [abCopy!, "xy"],
      ],
    ] as const) {
      const [[firstCopy, firstSeed], [secondCopy, secondSeed]] = order;
      const after = resolve(
        drawn,
        accepted(
          replace(drawn, relationship, firstCopy.outputEntityId, firstSeed),
        ),
      );
      if (secondCopy === buCopy)
        expect(
          refused(replace(after, relationship, buCopy.outputEntityId, "wz")),
          "w ≠ y at the shared copy point",
        ).toBe(SHARED("wz"));
      const healed = resolve(
        after,
        accepted(
          replace(after, relationship, secondCopy.outputEntityId, secondSeed),
        ),
      );
      expect(
        healed.liveSolve!.solvedSnapshot.failedDerivationIds ?? [],
        `${firstSeed} then ${secondSeed}`,
      ).toEqual([]);
    }
  });
});
