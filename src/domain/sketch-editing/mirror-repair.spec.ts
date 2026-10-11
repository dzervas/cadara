/**
 * T16a ([TECH] T16-1): the mirror removal write set. Logic lane; seam: the
 * exported `removeMirrorRelationship` (definition in, definition out), on
 * mirrors authored by the production Mirror builder (shared fixture). The
 * downstream rows re-solve the result through the session's live solve to
 * show each downstream relationship is explicitly broken, not cascaded.
 */
import { describe, expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import {
  evaluateMirrorRelationship,
  indexMirrorGeometry,
  MIRROR_DIAGNOSTIC_CODES,
} from "@/contracts/sketch/mirror-requirements";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import {
  chainSession,
  eid,
  entityTarget,
  mirroredSession,
  pid,
  seedDefinition,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";
import { removeMirrorRelationship } from "./mirror-repair";

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
        value: 1,
      },
      {
        dimensionId: "d_seed_len",
        kind: "lineLength",
        label: "L",
        entityId: eid("ab"),
        value: 2,
      },
      {
        dimensionId: "d_seed_ab",
        kind: "distance",
        label: "D",
        axis: "aligned",
        pointIds: [pid("a"), pid("b")],
        value: 2,
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
      `Mirror ‘${second.label}’ is broken: the original of ‘${firstCopy.label}’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, or remove the mirror from the Mirror panel.`,
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
    const named = (code: string, derivationId: string) =>
      diagnostics.find(
        (entry) =>
          entry.code === code &&
          entry.severity === "error" &&
          entry.message.includes(derivationId),
      );
    expect(
      named(
        "derived-offset-unsupported-seed",
        offset.relationship.derivationId,
      ),
      "the offset reports its missing seed",
    ).toBeDefined();
    expect(
      named(
        "derived-transform-missing-seed",
        pattern.relationship.derivationId,
      ),
      "the pattern reports its missing seed",
    ).toBeDefined();
    expect(after.liveRegions.status).toBe("unavailable");
  });
});
