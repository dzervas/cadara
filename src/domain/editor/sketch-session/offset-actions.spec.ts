/**
 * T17c ([TECH] T17-5): the Offset panel state, the Remove Offset session
 * action, and Delete of offset outputs (the shell refusal text; the
 * deleted-output diagnostic of the offset owner, T16-20 route). Logic
 * lane; seam: the sketch session's `computeSketchOffsetActionState`,
 * `applySketchOffsetRemoval` and `deleteSelectedSketchGeometry`, then the
 * owner (evaluation and the live publication round), on offsets authored
 * by the production Offset builder in entered sessions (shared fixture).
 */
import { describe, expect, test } from "vitest";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  beginSketchTool,
  deleteSelectedSketchGeometry,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  getSketchSessionDerivedValidity,
  publishSketchLiveRegions,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  eid,
  entityRef,
  handleRef,
  pid,
  pointRef,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";
import {
  offsetSession,
  withOffset,
} from "@/domain/editor/sketch-offset.fixtures";
import {
  applySketchOffsetRemoval,
  computeSketchOffsetActionState,
} from "./offset-actions";

const rebuild = (session: SketchSessionState, definition: SketchDefinition) =>
  rebuildSessionForDefinition(session, { definition });
const listed = (
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
) =>
  computeSketchOffsetActionState(session, selection)?.entries.map(
    (entry) => entry.label,
  ) ?? null;
const offsetOf = (session: SketchSessionState) => {
  const relationship = session.definition.derivedRelationships!.at(-1)!;
  if (relationship.kind !== "offset") throw new Error("offset");
  return relationship;
};
/** The live publication round of the session (the derive effect), applied. */
const settled = (session: SketchSessionState) => {
  const live = session.liveSolve!;
  return publishSketchLiveRegions(
    session,
    [],
    [],
    publishSketchOffsets({
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
      modelingTolerance: session.modelingTolerance,
      capabilities: {
        query: createCertifiedNeutralCurveRequestQuery(),
        certifier: createCertifiedCubicTubeChain(),
      },
    }),
  );
};
const expectValid = (definition: SketchDefinition, message: string) => {
  const result = validateSketchDefinition(definition);
  expect(result.success ? [] : result.issues, message).toEqual([]);
};

describe("T17c: the Offset panel lists the offsets the selection takes part in", () => {
  test("a seed, a seed point, a seed's tangent handle, an output line, an output point, a joint arc, its centre, a shell and a shell terminal each show the offset; unrelated geometry and an empty selection show nothing", () => {
    const arcs = offsetSession("lineArcJoint");
    const shells = offsetSession("lineSplineArcJoint");
    const arcOffset = offsetOf(arcs.session);
    const shellOffset = offsetOf(shells.session);
    const joint = arcOffset.jointOutputs[0]!;
    const shell = shellOffset.piecewiseCubicOutputs[0]!;
    const on = (session: SketchSessionState, ref: PrimitiveRef) =>
      listed(session, [ref]);
    for (const [name, session, ref] of [
      ["seed", arcs.session, entityRef(arcs.session, eid("l1"))],
      ["seed point", arcs.session, pointRef(arcs.session, pid("p0"))],
      [
        "seed tangent handle",
        shells.session,
        handleRef(shells.session, eid("s"), "o1", pid("q1")),
      ],
      [
        "output line",
        arcs.session,
        entityRef(arcs.session, arcOffset.outputs[1]!.outputEntityId),
      ],
      [
        "output point",
        arcs.session,
        pointRef(arcs.session, arcOffset.outputs[0]!.outputPointIds[0]!),
      ],
      [
        "joint arc",
        arcs.session,
        entityRef(arcs.session, joint.outputEntityId),
      ],
      [
        "joint centre",
        arcs.session,
        pointRef(arcs.session, joint.centerPointId),
      ],
      [
        "shell",
        shells.session,
        entityRef(shells.session, shell.outputEntityId),
      ],
      [
        "shell terminal",
        shells.session,
        pointRef(shells.session, shell.endPointId),
      ],
    ] as const)
      expect(on(session, ref), name).toEqual([
        session === arcs.session ? arcOffset.label : shellOffset.label,
      ]);
    expect(
      listed(arcs.session, [entityRef(arcs.session, eid("free"))]),
      "unrelated",
    ).toBeNull();
    expect(listed(arcs.session, []), "empty").toBeNull();
  });

  test("a seed with several offsets lists each, in definition order; an output selects only its own", () => {
    const first = offsetSession("lineArcJoint");
    const second = withOffset(first.session, [eid("l2")], 95, "left", 1);
    const firstOffset = offsetOf(first.session);
    expect(
      listed(second.session, [entityRef(second.session, eid("l2"))]),
    ).toEqual([firstOffset.label, second.relationship.label]);
    expect(
      listed(second.session, [
        entityRef(
          second.session,
          second.relationship.outputs[0]!.outputEntityId,
        ),
      ]),
    ).toEqual([second.relationship.label]);
  });

  test("hidden while a tool is armed, during a drag and in a special mode", () => {
    const { session } = offsetSession("lineTrim");
    const seed = [entityRef(session, eid("l1"))];
    expect(listed(session, seed), "premise").not.toBeNull();
    expect(listed(beginSketchTool(session, "trim"), seed)).toBeNull();
    // Review A-3: a drag or a special mode owns the slot too (as Mirror).
    expect(
      listed({ ...session, activeDrag: {} as never }, seed),
      "dragging",
    ).toBeNull();
    expect(
      listed({ ...session, activeSpecialMode: {} as never }, seed),
      "special mode",
    ).toBeNull();
  });

  test("the consequence numbers: output curves, requirements on them, how many currently size the originals (not parallel/concentric to their own seed, not reference), downstream labels", () => {
    const setup = offsetSession("lineArcJoint");
    const offset = offsetOf(setup.session);
    const [first, second] = offset.outputs;
    const constraints = [
      {
        constraintId: "c_out_h",
        kind: "horizontal",
        label: "H",
        entityId: first!.outputEntityId,
      },
      {
        constraintId: "c_pair",
        kind: "parallel",
        label: "P",
        entityIds: [eid("l1"), first!.outputEntityId],
      },
      {
        constraintId: "c_seed_h",
        kind: "horizontal",
        label: "Seed H",
        entityId: eid("l1"),
      },
    ] as unknown as ConstraintDefinition[];
    const dimensions = [
      {
        dimensionId: "d_out_len",
        kind: "lineLength",
        label: "L",
        entityId: second!.outputEntityId,
        value: 3,
      },
      {
        dimensionId: "d_out_ref",
        kind: "lineLength",
        label: "Ref",
        entityId: first!.outputEntityId,
        reference: true,
      },
    ] as unknown as DimensionDefinition[];
    const constrained = rebuild(setup.session, {
      ...setup.session.definition,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      dimensionIds: dimensions.map((entry) => entry.dimensionId),
      dimensions,
    });
    const mirror = withDerived(
      constrained,
      "mirror",
      [second!.outputEntityId, eid("axis")],
      96,
    );
    expect(
      computeSketchOffsetActionState(mirror.session, [
        entityRef(mirror.session, eid("l1")),
      ])?.entries,
    ).toEqual([
      {
        derivationId: offset.derivationId,
        label: offset.label,
        health: { kind: "checking" },
        outputCount: 3,
        requirementCount: 4,
        sizingRequirementCount: 2,
        brokenDownstreamLabels: [mirror.relationship.label],
      },
    ]);
  });

  test("a failed offset's requirements (a constraint and a driving dimension) are blocked, so they size nothing (M = 0); its health names the reason", () => {
    const setup = offsetSession("lineTrim");
    const offset = offsetOf(setup.session);
    const horizontal = {
      constraintId: "c_out_h",
      kind: "horizontal",
      label: "H",
      entityId: offset.outputs[0]!.outputEntityId,
    } as unknown as ConstraintDefinition;
    const length = {
      dimensionId: "d_out_len",
      kind: "lineLength",
      label: "L",
      entityId: offset.outputs[1]!.outputEntityId,
      value: 3,
    } as unknown as DimensionDefinition;
    const entities = setup.session.definition.entities.filter(
      (entity) => entity.entityId !== eid("l2"),
    );
    const failed = rebuild(setup.session, {
      ...setup.session.definition,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [horizontal.constraintId],
      constraints: [horizontal],
      dimensionIds: [length.dimensionId],
      dimensions: [length],
    });
    expect(
      failed.liveSolve!.solvedSnapshot.constraintStatuses,
      "premise: blocked by the failed offset",
    ).toEqual([{ constraintId: "c_out_h", status: "blocked" }]);
    expect(
      failed.liveSolve!.solvedSnapshot.dimensionStatuses.map(
        (status) => status.status,
      ),
      "premise: the driving dimension is blocked too",
    ).toEqual(["blocked"]);
    expect(
      computeSketchOffsetActionState(failed, [entityRef(failed, eid("l1"))])
        ?.entries[0],
    ).toMatchObject({
      health: {
        kind: "broken",
        reason: "an original was deleted or can't be offset",
      },
      outputCount: 2,
      requirementCount: 2,
      sizingRequirementCount: 0,
    });
  });
});

describe("T17c review: the Offset panel's health and the rest of the sizing rule", () => {
  test("concentric between an output circle and its own seed is removed (K) but sizes nothing; a radius on the output sizes the seed (R-3)", () => {
    const setup = offsetSession("circle");
    const offset = offsetOf(setup.session);
    const output = offset.outputs[0]!.outputEntityId;
    const constrained = rebuild(setup.session, {
      ...setup.session.definition,
      constraintIds: ["c_concentric" as never],
      constraints: [
        {
          constraintId: "c_concentric",
          kind: "concentric",
          label: "C",
          entityIds: [eid("c"), output],
        } as unknown as ConstraintDefinition,
      ],
      dimensionIds: ["d_out_r" as never],
      dimensions: [
        {
          dimensionId: "d_out_r",
          kind: "circleRadius",
          label: "R",
          entityId: output,
          value: 1.5,
        } as unknown as DimensionDefinition,
      ],
    });
    expect(
      computeSketchOffsetActionState(constrained, [
        entityRef(constrained, eid("c")),
      ])?.entries[0],
    ).toMatchObject({
      outputCount: 1,
      requirementCount: 2,
      sizingRequirementCount: 1,
    });
  });

  test("healthy once the live round certified it; checking while the round runs", () => {
    const { session } = offsetSession("lineTrim");
    const seed = [entityRef(session, eid("l1"))];
    expect(session.liveRegions.status, "premise: pending").toBe("pending");
    expect(
      computeSketchOffsetActionState(session, seed)?.entries[0]?.health,
    ).toEqual({ kind: "checking" });
    expect(
      computeSketchOffsetActionState(settled(session), seed)?.entries[0]
        ?.health,
    ).toEqual({ kind: "healthy" });
  });

  test("a round that fails it without an evaluation failure (e.g. the certifier) reads broken, by that failure's code", () => {
    const { session } = offsetSession("lineTrim");
    const offset = offsetOf(session);
    const failed = publishSketchLiveRegions(
      session,
      [],
      [],
      [
        {
          derivationId: offset.derivationId,
          status: "failed",
          diagnostic: {
            code: OFFSET_DIAGNOSTIC_CODES.topologyClearanceUnproven,
            severity: "error",
            message: "not proved",
            target: { kind: "entity", entityId: eid("l1") },
          },
        },
      ],
    );
    expect(
      computeSketchOffsetActionState(failed, [entityRef(failed, eid("l2"))])
        ?.entries[0]?.health,
    ).toEqual({ kind: "broken", reason: "its curves could not be checked" });
  });

  test("a deleted joint arc: broken, named by label (before and after the round)", () => {
    const { session } = offsetSession("lineArcJoint");
    const offset = offsetOf(session);
    const deleted = deleteSelectedSketchGeometry(session, [
      entityRef(session, offset.jointOutputs[0]!.outputEntityId),
    ]);
    const broken = {
      kind: "broken",
      reason:
        "the joint arc between the offset curves of ‘l1’ and ‘l2’ was deleted",
    };
    for (const state of [deleted, settled(deleted)])
      expect(
        computeSketchOffsetActionState(state, [entityRef(state, eid("l2"))])
          ?.entries[0]?.health,
      ).toEqual(broken);
  });
});

describe("T17c: Remove Offset in the session", () => {
  test("removes the write set and re-solves from the current positions: every remaining point keeps its authored and solved position bitwise; removing again is the same session", () => {
    const { session } = offsetSession("lineSplineArcJoint");
    const offset = offsetOf(session);
    const removed = applySketchOffsetRemoval(session, offset.derivationId);
    expect(removed.definition.derivedRelationships).toEqual([]);
    const solved = (state: SketchSessionState) =>
      new Map(
        state.liveSolve!.solvedSnapshot.solvedPoints.map((point) => [
          point.pointId,
          point.solvedPosition,
        ]),
      );
    const before = solved(session);
    const after = solved(removed);
    for (const point of removed.definition.points) {
      const original = session.definition.points.find(
        (entry) => entry.pointId === point.pointId,
      )!;
      expect(point.position, point.label).toStrictEqual(original.position);
      expect(after.get(point.pointId), point.label).toStrictEqual(
        before.get(point.pointId),
      );
    }
    expect(removed.liveRegions.status).not.toBe("unavailable");
    expectValid(removed.definition, "valid (G18)");
    expect(applySketchOffsetRemoval(removed, offset.derivationId)).toBe(
      removed,
    );
  });
});

describe("T17c: Delete of offset outputs", () => {
  test("a shell (or its terminal) is not deleted on its own; the refusal names Offset → Remove offset, which the selection already shows", () => {
    const { session } = offsetSession("spline");
    const shell = offsetOf(session).piecewiseCubicOutputs[0]!;
    for (const [ref, text] of [
      [
        entityRef(session, shell.outputEntityId),
        "An offset spline curve is part of its offset and can't be deleted on its own. To remove the whole offset, select it, then Offset → Remove offset.",
      ],
      [
        pointRef(session, shell.endPointId),
        "An offset spline curve's end point is part of its offset and can't be deleted on its own. To remove the whole offset, select it, then Offset → Remove offset.",
      ],
    ] as const) {
      const refused = deleteSelectedSketchGeometry(session, [ref]);
      expect(refused.validationMessage).toBe(text);
      expect(refused.definition).toBe(session.definition);
      expect(listed(session, [ref])).toEqual([offsetOf(session).label]);
    }
  });

  test("deleting a line offset's only output keeps the offset (G18) and the owner reports it by label, in the solve frame and in the live publication round; the seed's Offset panel removes it", () => {
    const { session } = offsetSession("singleLine");
    const offset = offsetOf(session);
    const output = offset.outputs[0]!.outputEntityId;
    const deleted = deleteSelectedSketchGeometry(session, [
      entityRef(session, output),
    ]);
    expect(deleted.definition.derivedRelationships).toEqual([offset]);
    expect(deleted.definition.entityIds).not.toContain(output);
    expectValid(deleted.definition, "a deleted output is a valid state (G18)");
    const message = `Offset ‘${offset.label}’ is broken: the offset curve of ‘free’ was deleted. Undo, or select ‘free’, then Offset → Remove offset.`;
    const expected = {
      code: OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      severity: "error",
      message,
      target: { kind: "entity", entityId: eid("free") },
    };
    expect(
      evaluateSketchDerivations({
        definition: deleted.definition,
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      }).offsetFailures,
      "the owner's evaluation",
    ).toEqual([{ derivationId: offset.derivationId, diagnostic: expected }]);
    const published = settled(deleted);
    expect(
      published.offsetPublicationDiagnostics,
      "the live publication round",
    ).toEqual([expected]);
    expect(
      getSketchSessionDerivedValidity(published).diagnostics,
    ).toContainEqual(expected);
    expect(
      computeSketchOffsetActionState(published, [
        entityRef(published, eid("free")),
      ])?.entries,
    ).toEqual([
      {
        derivationId: offset.derivationId,
        label: offset.label,
        health: {
          kind: "broken",
          reason: "the offset curve of ‘free’ was deleted",
        },
        outputCount: 0,
        requirementCount: 0,
        sizingRequirementCount: 0,
        brokenDownstreamLabels: [],
      },
    ]);
    const removed = settled(
      applySketchOffsetRemoval(published, offset.derivationId),
    );
    expect(removed.definition.derivedRelationships).toEqual([]);
    expect(removed.offsetPublicationDiagnostics).toEqual([]);
  });

  test("a deleted joint arc is reported by label too", () => {
    const { session } = offsetSession("lineArcJoint");
    const offset = offsetOf(session);
    const deleted = deleteSelectedSketchGeometry(session, [
      entityRef(session, offset.jointOutputs[0]!.outputEntityId),
    ]);
    expect(
      settled(deleted).offsetPublicationDiagnostics?.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual([
      `Offset ‘${offset.label}’ is broken: the joint arc between the offset curves of ‘l1’ and ‘l2’ was deleted. Undo, or select ‘l1’, then Offset → Remove offset.`,
    ]);
  });
});
