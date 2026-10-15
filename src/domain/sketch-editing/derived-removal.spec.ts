/**
 * T17c ([TECH] T17-5): the offset removal write set. Logic lane; seam: the
 * exported `removeDerivedRelationship` (definition in, definition out) on
 * offsets authored by the production Offset builder in entered sessions
 * (shared fixture). The mirror removal (the same write set) keeps its T16a
 * pins in `mirror-repair.spec.ts`, unchanged. Downstream rows re-solve the
 * result through the session's live solve to show each downstream
 * relationship is explicitly broken, not cascaded; every result passes the
 * persistence validation ([TECH] G18).
 */
import { describe, expect, test } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchPointId } from "@/contracts/shared/ids";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { MIRROR_DIAGNOSTIC_CODES } from "@/contracts/sketch/mirror-requirements";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  eid,
  entityTarget,
  pid,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  offsetSession,
  withOffset,
  type OffsetVariant,
} from "@/domain/editor/sketch-offset.fixtures";
import { getEntityPointIds } from "./definition-references";
import { removeDerivedRelationship } from "./derived-removal";

type Offset = Extract<SketchDerivationDefinition, { kind: "offset" }>;

const remove = (definition: SketchDefinition, derivationId: string) => {
  const removal = removeDerivedRelationship(definition, derivationId, "offset");
  if (!removal) throw new Error(`no offset ${derivationId}`);
  return removal;
};
/** Every output entity the offset records (lines, arcs, circles, joint arcs, shells). */
const recordedEntities = (relationship: Offset) =>
  new Set<string>([
    ...relationship.outputs.map((output) => output.outputEntityId),
    ...relationship.jointOutputs.map((joint) => joint.outputEntityId),
    ...relationship.piecewiseCubicOutputs.map((shell) => shell.outputEntityId),
  ]);
/** Every point the offset records (output ends and centres, joint points, shell terminals). */
const recordedPoints = (relationship: Offset) =>
  new Set<string>([
    ...relationship.outputs.flatMap((output) => output.outputPointIds),
    ...relationship.jointOutputs.flatMap((joint) => [
      joint.centerPointId,
      joint.startPointId,
      joint.endPointId,
    ]),
    ...relationship.piecewiseCubicOutputs.flatMap((shell) => [
      shell.startPointId,
      shell.endPointId,
    ]),
  ]);
const withEntity = (
  definition: SketchDefinition,
  entity: SketchEntityDefinition,
): SketchDefinition => ({
  ...definition,
  entityIds: [...definition.entityIds, entity.entityId],
  entities: [...definition.entities, entity],
});
const userLine = (id: string, a: SketchPointId, b: SketchPointId) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: entityTarget(id),
    isConstruction: false,
    startPointId: a,
    endPointId: b,
  }) as SketchEntityDefinition;
const expectValid = (definition: SketchDefinition, message: string) => {
  const result = validateSketchDefinition(definition);
  expect(result.success ? [] : result.issues, message).toEqual([]);
};

describe("T17c: removing an offset deletes exactly its write set", () => {
  const cases: Record<
    OffsetVariant,
    { outputs: number; points: number; premise: (relationship: Offset) => void }
  > = {
    lineTrim: {
      outputs: 2,
      points: 3,
      premise: (relationship) => {
        const [first, second] = relationship.outputs;
        expect(
          first!.outputPointIds[1],
          "premise: the two output lines share their trimmed corner point",
        ).toBe(second!.outputPointIds[0]);
      },
    },
    lineArcJoint: {
      outputs: 3,
      points: 5,
      premise: (relationship) => {
        const [joint] = relationship.jointOutputs;
        expect(
          [joint!.startPointId, joint!.endPointId],
          "premise: the joint arc reuses the adjacent outputs' ends",
        ).toEqual([
          relationship.outputs[0]!.outputPointIds[1],
          relationship.outputs[1]!.outputPointIds[0],
        ]);
      },
    },
    spline: {
      outputs: 1,
      points: 2,
      premise: (relationship) =>
        expect(
          relationship.piecewiseCubicOutputs,
          "premise: one shell, two terminal driven points",
        ).toHaveLength(1),
    },
    lineSpline: {
      outputs: 2,
      points: 3,
      premise: (relationship) =>
        expect(
          relationship.piecewiseCubicOutputs[0]!.startPointId,
          "premise: the line output and the shell share their trimmed joint point",
        ).toBe(relationship.outputs[0]!.outputPointIds[1]),
    },
    lineSplineArcJoint: {
      outputs: 3,
      points: 5,
      premise: (relationship) =>
        expect(
          relationship.jointOutputs[0]!.endPointId,
          "premise: the joint arc ends on the shell's terminal point",
        ).toBe(relationship.piecewiseCubicOutputs[0]!.startPointId),
    },
    singleLine: {
      outputs: 1,
      points: 2,
      premise: () => {},
    },
    circle: {
      outputs: 1,
      points: 1,
      premise: () => {},
    },
  };
  for (const [variant, expected] of Object.entries(cases))
    test(`${variant}: the relationship, its ${expected.outputs} output curves and their ${expected.points} points go; seeds and every other record stay byte-equal; the result is valid (G18)`, () => {
      const { session, relationship } = offsetSession(variant as OffsetVariant);
      if (relationship.kind !== "offset") throw new Error("offset");
      expected.premise(relationship);
      const before = session.definition;
      const removal = remove(before, relationship.derivationId);
      const outputs = recordedEntities(relationship);
      const points = recordedPoints(relationship);
      expect(outputs.size).toBe(expected.outputs);
      expect(points.size).toBe(expected.points);
      expect([...removal.removedEntityIds].sort()).toEqual([...outputs].sort());
      expect([...removal.removedPointIds].sort()).toEqual([...points].sort());
      const keptEntities = before.entities.filter(
        (entity) => !outputs.has(entity.entityId),
      );
      const keptPoints = before.points.filter(
        (point) => !points.has(point.pointId),
      );
      expect(removal.definition).toStrictEqual({
        ...before,
        pointIds: keptPoints.map((point) => point.pointId),
        points: keptPoints,
        entityIds: keptEntities.map((entity) => entity.entityId),
        entities: keptEntities,
        derivedRelationships: [],
      });
      // Seeds untouched: the very records (and their points) of the input.
      for (const seedId of relationship.seedEntityIds) {
        const seed = before.entities.find(
          (entity) => entity.entityId === seedId,
        )!;
        expect(
          removal.definition.entities.find(
            (entity) => entity.entityId === seedId,
          ),
          "the seed record is the input's",
        ).toBe(seed);
        for (const pointId of getEntityPointIds(seed))
          expect(
            removal.definition.points.find(
              (point) => point.pointId === pointId,
            ),
            "a seed point record is the input's",
          ).toBe(before.points.find((point) => point.pointId === pointId));
      }
      // Swept exactly: no removed point is still referenced, and every
      // point left is one the input had.
      const referenced = new Set(
        removal.definition.entities.flatMap(getEntityPointIds),
      );
      expect(
        [...removal.removedPointIds].filter((pointId) =>
          referenced.has(pointId),
        ),
      ).toEqual([]);
      expect(removal.brokenDownstream).toEqual([]);
      expect(
        before.derivedRelationships,
        "the input definition is not mutated",
      ).toHaveLength(1);
      expectValid(before, "premise: the input is valid");
      expectValid(removal.definition, "the removal is valid (G18)");
    });

  test("a user line reusing a shell terminal and an output end keeps both (with its requirements); the shared joint point still goes", () => {
    const { session, relationship } = offsetSession("lineSpline");
    if (relationship.kind !== "offset") throw new Error("offset");
    const terminal = relationship.piecewiseCubicOutputs[0]!.endPointId;
    const outputStart = relationship.outputs[0]!.outputPointIds[0]!;
    const fix: ConstraintDefinition = {
      constraintId: "constraint_fix_terminal" as never,
      kind: "fixPoint",
      label: "Fix terminal",
      pointId: terminal,
      position: [0, 0],
    };
    const definition = {
      ...withEntity(
        session.definition,
        userLine("user", terminal, outputStart),
      ),
      constraintIds: [fix.constraintId],
      constraints: [fix],
    };
    expectValid(definition, "premise: a user line may reuse them");
    const removal = remove(definition, relationship.derivationId);
    expect(removal.removedPointIds.has(terminal)).toBe(false);
    expect(removal.removedPointIds.has(outputStart)).toBe(false);
    expect(
      [...removal.removedPointIds].sort(),
      "the shared joint point goes",
    ).toEqual(
      [...recordedPoints(relationship)]
        .filter((pointId) => pointId !== terminal && pointId !== outputStart)
        .sort(),
    );
    expect(removal.definition.entities.at(-1)!.entityId).toBe(eid("user"));
    expect(removal.definition.constraints).toEqual([fix]);
    expectValid(removal.definition, "valid (G18)");
  });

  test("requirements naming an output curve or an output point go (ordinary Delete semantics); requirements on seeds and unrelated geometry stay, in order", () => {
    const { session, relationship } = offsetSession("lineArcJoint");
    if (relationship.kind !== "offset") throw new Error("offset");
    const [first, second] = relationship.outputs;
    const joint = relationship.jointOutputs[0]!;
    const constraints = [
      {
        constraintId: "c_out_h",
        kind: "horizontal",
        label: "H",
        entityId: first!.outputEntityId,
      },
      {
        constraintId: "c_seed_h",
        kind: "horizontal",
        label: "Seed H",
        entityId: eid("l1"),
      },
      {
        constraintId: "c_pair",
        kind: "parallel",
        label: "P",
        entityIds: [eid("l1"), first!.outputEntityId],
      },
      {
        constraintId: "c_joint_fix",
        kind: "fixPoint",
        label: "F",
        pointId: joint.centerPointId,
        position: [4, 0],
      },
      {
        constraintId: "c_out_free",
        kind: "coincident",
        label: "C",
        pointIds: [second!.outputPointIds[1], pid("f0")],
      },
      {
        constraintId: "c_free_v",
        kind: "horizontal",
        label: "Free H",
        entityId: eid("free"),
      },
    ] as unknown as ConstraintDefinition[];
    const dimensions = [
      {
        dimensionId: "d_out_len",
        kind: "lineLength",
        label: "L",
        entityId: second!.outputEntityId,
        value: createLiteralAuthoredValue(3),
      },
      {
        dimensionId: "d_seed_len",
        kind: "lineLength",
        label: "Seed L",
        entityId: eid("l2"),
        value: createLiteralAuthoredValue(3),
      },
      {
        dimensionId: "d_joint_r",
        kind: "circleRadius",
        label: "R",
        entityId: joint.outputEntityId,
        value: createLiteralAuthoredValue(0.5),
      },
      {
        dimensionId: "d_out_ref",
        kind: "lineLength",
        label: "Ref",
        entityId: first!.outputEntityId,
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
    ).toEqual(["c_out_h", "c_pair", "c_joint_fix", "c_out_free"]);
    expect(removal.removedDimensions.map((entry) => entry.dimensionId)).toEqual(
      ["d_out_len", "d_joint_r", "d_out_ref"],
    );
    expect(removal.definition.constraints).toEqual([
      constraints[1],
      constraints[5],
    ]);
    expect(removal.definition.constraintIds).toEqual(["c_seed_h", "c_free_v"]);
    expect(removal.definition.dimensions).toEqual([dimensions[1]]);
    expect(removal.definition.dimensionIds).toEqual(["d_seed_len"]);
  });

  test("a broken offset (its seed deleted, an output deleted) is removable: the relationship and its remaining outputs go, nothing else", () => {
    const { session, relationship } = offsetSession("lineTrim");
    if (relationship.kind !== "offset") throw new Error("offset");
    const drop = [
      eid("l2"),
      relationship.outputs[0]!.outputEntityId,
    ] as string[];
    const entities = session.definition.entities.filter(
      (entity) => !drop.includes(entity.entityId),
    );
    const broken: SketchDefinition = {
      ...session.definition,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
    };
    expect(
      evaluateSketchDerivations({
        definition: broken,
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      }).offsetFailures.map((failure) => failure.derivationId),
      "premise: broken",
    ).toEqual([relationship.derivationId]);
    const removal = remove(broken, relationship.derivationId);
    expect([...removal.removedEntityIds]).toEqual([
      relationship.outputs[1]!.outputEntityId,
    ]);
    expect(removal.definition.entities).toEqual(
      entities.filter(
        (entity) => entity.entityId !== relationship.outputs[1]!.outputEntityId,
      ),
    );
    expect(removal.definition.derivedRelationships).toEqual([]);
  });
});

describe("T17c: downstream relationships are never touched; they become explicitly broken", () => {
  test("an offset of an output and a mirror of an output stay with their outputs; each fails explicitly; the sketch is blocked by the mirror", () => {
    const setup = offsetSession("lineTrim");
    if (setup.relationship.kind !== "offset") throw new Error("offset");
    const [first, second] = setup.relationship.outputs;
    const offsetOfOffset = withOffset(
      setup.session,
      [first!.outputEntityId],
      91,
    );
    const mirror = withDerived(
      offsetOfOffset.session,
      "mirror",
      [second!.outputEntityId, eid("axis")],
      92,
    );
    const before = mirror.session.definition;
    expectValid(before, "premise: valid");
    expect(
      mirror.session.liveSolve!.solvedSnapshot.failedDerivationIds,
      "premise: nothing failed before",
    ).toBeUndefined();
    const removal = remove(before, setup.relationship.derivationId);
    expect(removal.brokenDownstream).toEqual([
      offsetOfOffset.relationship,
      mirror.relationship,
    ]);
    expect(
      removal.definition.derivedRelationships![0],
      "the downstream offset is the input's record",
    ).toBe(before.derivedRelationships![1]);
    expect(removal.definition.derivedRelationships![1]).toBe(
      before.derivedRelationships![2],
    );
    const downstreamOutputs = new Set<string>([
      ...recordedEntities(offsetOfOffset.relationship as Offset),
      ...mirror.relationship.outputs.map((output) => output.outputEntityId),
    ]);
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
    expectValid(removal.definition, "valid (G18)");
    const after = rebuildSessionForDefinition(mirror.session, {
      definition: removal.definition,
    });
    const snapshot = after.liveSolve!.solvedSnapshot;
    expect(snapshot.failedDerivationIds).toEqual([
      mirror.relationship.derivationId,
    ]);
    const errors = snapshot.diagnostics.filter(
      (entry) => entry.severity === "error",
    );
    expect(
      errors.some((entry) => entry.code === MIRROR_DIAGNOSTIC_CODES.mapStale),
      "the mirror reports its deleted original",
    ).toBe(true);
    expect(
      errors.some(
        (entry) =>
          entry.code === OFFSET_DIAGNOSTIC_CODES.unsupportedSeed &&
          // T17e (B2): the offset by label, never by id.
          entry.message.startsWith(
            `Offset ‘${offsetOfOffset.relationship.label}’: `,
          ),
      ),
      "the offset of the output reports its missing seed",
    ).toBe(true);
    expect(after.liveRegions.status).toBe("unavailable");
  });
});
