// T17e (B2, F-2, O-1; specification "Minimum failure feedback": identify
// the affected geometry and a meaningful reason). Logic lane; seams: the
// session's edit-input gate, the feature-input and projection text
// helpers, the derivation evaluator, the solver's validation and the
// session's invalid feedback, and the offset chain connectivity owner.
// Every user text of these rows names geometry, requirements and
// relationships by label, never by an internal id (`expectNoInternalIds`);
// on the base each one contained an id.
import { describe, expect, test } from "vitest";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DerivableSketchDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { evaluateAuthoredSketchDerivations } from "@/domain/modeling/sketch-dimension-expressions";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import { DERIVED_SHELL_SEED_UNSUPPORTED } from "@/contracts/sketch/derived-geometry";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import { validateSketchDefinitionCore } from "@/core/sketch-solver";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import {
  nonAcceptedOffsetFeatureInputMessage,
  nonAcceptedOffsetFeaturePointMessage,
} from "@/domain/modeling/sketch-feature-input";
import { nonAcceptedOutputProjectionMessage } from "@/domain/modeling/sketch-reference-projection";
import { offsetEditInputGate } from "@/domain/editor/sketch-session/editing";
import {
  deleteSelectedSketchGeometry,
  updateSketchReferenceProjection,
} from "@/domain/editor/sketch-session";
import {
  getSketchSessionDerivationSettings,
  getSketchSessionInvalidFeedback,
  rebuildSessionForDefinition,
} from "@/domain/editor/sketch-session/internals";
import {
  eid,
  entityRef,
  mirroredSession,
  pid,
  seedDefinition,
  withDerived,
} from "@/domain/editor/sketch-mirror.fixtures";

const RECOVERY = "Fix it (Undo) or remove the offset from the Offset panel.";
const labelOf = (
  definition: DerivableSketchDefinition,
  entityId: SketchEntityId,
) => definition.entities.find((entity) => entity.entityId === entityId)!.label;

describe("T17e: an offset of a held mirror copy is named by label at every consumer", () => {
  // T16c review probe: an offset authored on a healthy copy whose mirror
  // breaks later is owned by the offset itself (never certified while the
  // mirror is held), so its consumers use the offset wording.
  function offsetOfHeldCopy() {
    const { session, outputOf } = mirroredSession("free");
    const copy = outputOf("ab").outputEntityId;
    const offset = withDerived(session, "offset", [copy], 92, 0.5);
    if (offset.relationship.kind !== "offset") throw new Error("offset");
    const output = offset.relationship.outputs[0]!;
    const broken = deleteSelectedSketchGeometry(offset.session, [
      entityRef(offset.session, eid("axis")),
    ]);
    const live = broken.liveSolve!;
    const owner = nonAcceptedDerivedOutputs(
      live.definition,
      live.solvedSnapshot,
    ).get(output.outputEntityId);
    expect(owner, "premise: the offset owns its held output").toMatchObject({
      derivationId: offset.relationship.derivationId,
      reason: "offsetNotCertified",
    });
    expect(broken.liveRegions.status, "premise: decided, not pending").not.toBe(
      "pending",
    );
    return {
      broken,
      live,
      owner: owner!,
      output,
      held: `‘${labelOf(live.definition, output.outputEntityId)}’ is a curve made by offset ‘${offset.relationship.label}’`,
    };
  }

  test("edit input, feature input (curve and driven point) and projection", () => {
    const { broken, live, owner, output, held } = offsetOfHeldCopy();
    const gate = offsetEditInputGate(
      broken,
      [output.outputEntityId],
      "a Sketch Fillet input",
    );
    expect(gate).toEqual({
      pending: false,
      message: `edit-input-offset-not-certified: ${held}, which is not certified, so it can't be used as a Sketch Fillet input. ${RECOVERY}`,
    });
    const sketch = {
      definition: live.definition,
      solvedSnapshot: live.solvedSnapshot,
    };
    const feature = nonAcceptedOffsetFeatureInputMessage(
      sketch,
      output.outputEntityId,
      "a sweep path",
    );
    expect(feature).toBe(
      `${held}, which is not certified, so it can't be used as a sweep path. ${RECOVERY}`,
    );
    const pointId = output.outputPointIds[0]! as SketchPointId;
    const point = nonAcceptedOffsetFeaturePointMessage(
      sketch,
      pointId,
      "a hole location",
    );
    const pointLabel = live.definition.points.find(
      (entry) => entry.pointId === pointId,
    )!.label;
    expect(point).toBe(
      `Point ‘${pointLabel}’ belongs to a curve made by offset ‘${owner.label}’, which is not certified, so it can't be used as a hole location. ${RECOVERY}`,
    );
    const projection = nonAcceptedOutputProjectionMessage(
      live.definition,
      output.outputEntityId,
      owner,
    );
    expect(projection).toBe(
      `${held}, which is not certified, so it is not projected. ${RECOVERY}`,
    );
    expectNoInternalIds([gate!.message, feature, point, projection]);
  });
});

describe("T17e: derived-transform evaluation texts", () => {
  const { session } = mirroredSession("free");
  const settings = getSketchSessionDerivationSettings(session);

  test("derived-transform-unsupported-entity names the original and the pattern by label", () => {
    const pattern = withDerived(session, "linearPattern", [eid("ab")], 93, 2);
    const output = pattern.relationship.outputs[0]!;
    // A copy whose kind no longer matches its original (e.g. after a merge).
    const definition: SketchDefinition = {
      ...pattern.session.definition,
      entities: pattern.session.definition.entities.map((entity) =>
        entity.entityId === output.outputEntityId
          ? ({
              kind: "circle",
              entityId: entity.entityId,
              label: entity.label,
              target: entity.target,
              isConstruction: false,
              centerPointId: output.outputPointIds[0]!,
              radius: 1,
            } as SketchEntityDefinition)
          : entity,
      ),
    };
    const messages = evaluateAuthoredSketchDerivations({
      definition,
      ...settings,
    })
      .diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "derived-transform-unsupported-entity",
      )
      .map((diagnostic) => diagnostic.message);
    expect(messages).toEqual([
      `‘ab’ (lineSegment) can't be copied by linear pattern ‘${pattern.relationship.label}’ yet; its copy is not updated.`,
    ]);
    expectNoInternalIds(messages);
  });

  test("the shell-seed text names the relationship and the offset spline curve by label", () => {
    const offset = withDerived(session, "offset", [eid("s")], 94, 0.2);
    const shell = offset.session.definition.entities.find(
      (entity) => entity.kind === "derivedPiecewiseCubic",
    )!;
    // A pattern whose original is the shell (tools refuse it; a crafted
    // or imported document can still hold one).
    const copyId = eid("shell_copy");
    const definition: SketchDefinition = {
      ...offset.session.definition,
      entityIds: [...offset.session.definition.entityIds, copyId],
      entities: [
        ...offset.session.definition.entities,
        { ...shell, entityId: copyId, label: "shell copy" },
      ],
      derivedRelationships: [
        ...offset.session.definition.derivedRelationships!,
        {
          derivationId: "derivation_shell_pattern",
          kind: "linearPattern",
          label: "shell pattern",
          seedEntityIds: [shell.entityId],
          vector: [0, 5],
          instanceCount: 2,
          outputs: [
            {
              seedEntityId: shell.entityId,
              outputEntityId: copyId,
              instanceIndex: 1,
              seedPointIds: [],
              outputPointIds: [],
            },
          ],
        },
      ],
    };
    const messages = evaluateAuthoredSketchDerivations({
      definition,
      ...settings,
    })
      .diagnostics.filter(
        (diagnostic) => diagnostic.code === DERIVED_SHELL_SEED_UNSUPPORTED,
      )
      .map((diagnostic) => diagnostic.message);
    expect(messages).toEqual([
      `Linear pattern ‘shell pattern’ uses the offset spline curve ‘${shell.label}’ as an original; mirroring, patterning or transforming an offset spline curve is not supported yet.`,
    ]);
    expectNoInternalIds(messages);
  });
});

test("T17e: an offset whose output records no longer fit its frame fails by its label, never its id", () => {
  const { session } = mirroredSession("free");
  const offset = withDerived(session, "offset", [eid("ab")], 95, 0.5);
  if (offset.relationship.kind !== "offset") throw new Error("offset");
  const output = offset.relationship.outputs[0]!;
  // A stale point map on the output line (e.g. after a merge).
  const definition: SketchDefinition = {
    ...offset.session.definition,
    derivedRelationships: offset.session.definition.derivedRelationships!.map(
      (relationship) =>
        relationship.derivationId === offset.relationship.derivationId &&
        relationship.kind === "offset"
          ? {
              ...relationship,
              outputs: [
                {
                  ...output,
                  outputPointIds: output.outputPointIds.slice(0, 1),
                },
              ],
            }
          : relationship,
    ),
  };
  const failures = evaluateAuthoredSketchDerivations({
    definition,
    ...getSketchSessionDerivationSettings(offset.session),
  }).offsetFailures.map((failure) => failure.diagnostic.message);
  expect(failures).toEqual([
    `Offset ‘${offset.relationship.label}’: an offset curve's points no longer match it.`,
  ]);
  expectNoInternalIds(failures);
});

describe("T17e: solver validation texts (F-2, O-1 and the missing-reference family)", () => {
  const validate = (definition: SketchDefinition) =>
    validateSketchDefinitionCore({
      // T17p2 (F-2): the solver validates the resolved definition.
      definition: literalResolvedDefinition(definition),
      tolerances: createDocumentSolverTolerances(OCC_KERNEL_SETTINGS),
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    }).diagnostics;

  test("F-2: a degenerate line is named by label in the solver text and in the session's invalid feedback", () => {
    const base = seedDefinition();
    const definition: SketchDefinition = {
      ...base,
      points: base.points.map((point) =>
        point.pointId === pid("b") ? { ...point, position: [1, 1] } : point,
      ),
    };
    const degenerate = validate(definition).filter(
      (diagnostic) => diagnostic.code === "degenerate-line-segment",
    );
    expect(degenerate.map((diagnostic) => diagnostic.message)).toEqual([
      "‘ab’ is shorter than the minimum segment length tolerance.",
    ]);
    const reopened = rebuildSessionForDefinition(mirroredSession().session, {
      definition,
    });
    expect(reopened.validationMessage).toBe(
      "‘ab’ is shorter than the minimum segment length tolerance.",
    );
    expectNoInternalIds([
      ...degenerate.map((diagnostic) => diagnostic.message),
      reopened.validationMessage,
    ]);
  });

  test("O-1 family: a constraint, dimension or curve naming a removed record says what no longer exists, by label", () => {
    const base = seedDefinition();
    const constraints = [
      {
        constraintId: "constraint_t17e_coincident",
        kind: "coincident",
        label: "Coincident 1",
        pointIds: [pid("a"), pid("gone")],
      },
      {
        constraintId: "constraint_t17e_horizontal",
        kind: "horizontal",
        label: "Horizontal 1",
        entityId: eid("gone"),
      },
    ] as unknown as ConstraintDefinition[];
    const dimensions = [
      {
        dimensionId: "dimension_t17e_length",
        kind: "lineLength",
        label: "Length 1",
        entityId: eid("gone"),
        value: createLiteralAuthoredValue(3),
      },
      {
        dimensionId: "dimension_t17e_distance",
        kind: "distance",
        label: "Distance 1",
        pointIds: [pid("a"), pid("gone")],
        axis: "aligned",
        value: createLiteralAuthoredValue(3),
      },
    ] as unknown as DimensionDefinition[];
    const definition: SketchDefinition = {
      ...base,
      // A line whose end point was removed by a peer.
      entities: base.entities.map((entity) =>
        entity.entityId === eid("ab") && entity.kind === "lineSegment"
          ? { ...entity, endPointId: pid("gone") }
          : entity,
      ),
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
    };
    const errors = validate(definition)
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message);
    expect(errors).toEqual(
      expect.arrayContaining([
        "‘ab’ references an endpoint that no longer exists.",
        "‘Coincident 1’ references a point that no longer exists.",
        "‘Horizontal 1’ references geometry that no longer exists.",
        "‘Length 1’ references a line that no longer exists.",
        "‘Distance 1’ references a point that no longer exists.",
      ]),
    );
    expectNoInternalIds(errors);
  });
});

// T17e review R-1/R-2. Logic lane; seam: the session's invalid feedback
// (`getSketchSessionInvalidFeedback`). A peer-orphaned requirement is
// explained as missing geometry, naming it in the recovery; a value
// conflict the user's own change caused is still explained first, without
// the orphan.
describe("T17e: missing references and the user's own conflict", () => {
  const length = (id: string, label: string, entity: string, value: number) =>
    ({
      dimensionId: `dimension_t17e_${id}`,
      kind: "lineLength",
      label,
      entityId: eid(entity),
      value,
    }) as unknown as DimensionDefinition;
  const sessionWith = (dimensions: DimensionDefinition[]) =>
    rebuildSessionForDefinition(mirroredSession().session, {
      definition: {
        ...seedDefinition(),
        dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
        dimensions,
      },
    });
  const orphan = length("peer", "Peer length", "gone", 3);

  test("no subject: the missing reference, its recovery naming it; two orphans name both", () => {
    const one = sessionWith([orphan]);
    expect(getSketchSessionInvalidFeedback(one)).toBe(
      "‘Peer length’ references a line that no longer exists. The sketch is invalid; profiles from it are blocked. Delete ‘Peer length’, or Undo.",
    );
    const two = sessionWith([
      orphan,
      length("peer2", "Peer width", "gone2", 2),
    ]);
    expect(getSketchSessionInvalidFeedback(two)).toBe(
      "‘Peer length’ references a line that no longer exists. The sketch is invalid; profiles from it are blocked. Delete ‘Peer length’ and ‘Peer width’, or Undo.",
    );
    expectNoInternalIds([
      getSketchSessionInvalidFeedback(one),
      getSketchSessionInvalidFeedback(two),
    ]);
  });

  test("a conflict the user just authored is explained first, without the orphan (P3)", () => {
    const authored = length("b", "Length B", "ab", 5);
    const session = sessionWith([
      orphan,
      length("a", "Length A", "ab", 3),
      authored,
    ]);
    const withoutOrphan = sessionWith([
      length("a", "Length A", "ab", 3),
      authored,
    ]);
    const expected = getSketchSessionInvalidFeedback(withoutOrphan, [
      authored.dimensionId,
    ]);
    expect(expected, "premise: a value conflict").toMatch(
      /^Length B \(5 mm\) conflicts with Length A \(3 mm\)\./,
    );
    expect(
      getSketchSessionInvalidFeedback(session, [authored.dimensionId]),
    ).toBe(expected);
    expect(
      getSketchSessionInvalidFeedback(session),
      "no subject: the missing reference",
    ).toMatch(/^‘Peer length’ references a line that no longer exists\./);
  });
});

// T17e (review A-7). Logic lane; seam: the session's projection update. A
// reference that is not projected is named by its label, its status in
// words.
test("T17e: a reference that is not projected is named by label", () => {
  const base = seedDefinition();
  const reference = {
    referenceId: "ref_t17e_copy",
    kind: "sketchReference",
    label: "Copy edge",
    source: {
      kind: "sketchEntity",
      sketchId: "sketch_other",
      entityId: "sketch_entity_other",
    },
  } as unknown as SketchDefinition["references"][number];
  const session = rebuildSessionForDefinition(mirroredSession().session, {
    definition: {
      ...base,
      referenceIds: [reference.referenceId],
      references: [reference],
    },
  });
  const updated = updateSketchReferenceProjection(
    session,
    [
      {
        referenceId: reference.referenceId,
        status: "missingSource",
        geometry: [],
        diagnostics: [],
      },
    ],
    [],
  );
  expect(updated.validationMessage).toBe(
    "Reference ‘Copy edge’ is not projected: its source no longer exists.",
  );
  expectNoInternalIds([updated.validationMessage], ["ref_t17e_copy"]);
});

test("T17e: an offset chain that branches names the shared point by label", () => {
  const base = seedDefinition();
  // Three lines from point a: an offset chain can't branch.
  const line = (id: string, end: string) =>
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
      startPointId: pid("a"),
      endPointId: pid(end),
    }) as SketchEntityDefinition;
  const branches = [line("ac", "c"), line("au", "u")];
  const definition = {
    ...base,
    entities: [...base.entities, ...branches],
  };
  const result = extractDeclaredOffsetChainConnectivity({
    definition,
    seedIds: [eid("ab"), eid("ac"), eid("au")],
  });
  expect(result).toMatchObject({
    ok: false,
    message:
      "Point ‘a’ is shared by 3 ends of the originals; an offset chain can't branch.",
  });
  expectNoInternalIds([(result as { message: string }).message]);
});

test("T17e: a Coincident that joins a point to itself on an original is named by label", () => {
  const base = seedDefinition();
  const self = {
    constraintId: "constraint_t17e_self",
    kind: "coincident",
    label: "Coincident 7",
    pointIds: [pid("a"), pid("a")],
  } as unknown as ConstraintDefinition;
  const result = extractDeclaredOffsetChainConnectivity({
    definition: { ...base, constraints: [self] },
    seedIds: [eid("ab")],
  });
  expect(result).toMatchObject({
    ok: false,
    message: "‘Coincident 7’ makes a point coincident with itself.",
  });
  expectNoInternalIds([(result as { message: string }).message]);
});
