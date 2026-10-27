import { expect, test } from "vitest";
import type {
  DocumentId,
  RequestId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import {
  createDocumentSolverTolerances,
  SOLVER_SCHEMA_VERSION,
} from "@/contracts/solver/schema";
import { solveDragEdit } from "@/domain/editor/sketch-session/drag-solve";
import { appendDefinition } from "@/domain/editor/sketch-session/definition-authoring";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/tool-authoring";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createSketchDerivedTransformContribution } from "@/domain/sketch-editing/operations";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/domain/solver/mock-sketch-solver-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

// Logic lane: the exported drag write must update copies before any later
// live solve; the mock adapter must evaluate the same mirror-free relationships.
const kinds = ["linearPattern", "circularPattern", "transform"] as const;
const settings = {
  modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  documentVariables: [],
};
const tolerances = createDocumentSolverTolerances(OCC_KERNEL_SETTINGS);

function derivedSketch(kind: (typeof kinds)[number]) {
  const f = makeSketchFixture();
  f.point("center", 4, 3);
  const circleId = f.circle("circle", "center", 2);
  f.point("a", 0, 0);
  f.point("b", 4, 3);
  f.point("c", 8, 0);
  const splineId = f.spline("spline", ["a", "b", "c"], "open", [
    null,
    [1, 0],
    null,
  ]);
  const created = createSketchDerivedTransformContribution({
    definition: f.definition(),
    operatorKind: kind,
    entityIds: [circleId, splineId],
    value: kind === "circularPattern" ? Math.PI / 2 : 10,
    sequence: 1,
    factories: createSessionCommitFactories(1, "sketch_arrangement" as SketchId),
    ...settings,
  });
  if (!created.valid || !created.contribution)
    throw new Error(created.message ?? "Derivation failed");
  const definition = appendDefinition(f.definition(), created.contribution);
  const relationship = definition.derivedRelationships![0]!;
  const outputOf = (id: string) =>
    relationship.outputs.find((output) => output.seedEntityId === id)!;
  return { definition, circleId, splineId, outputOf };
}

function circleRadius(definition: SketchDefinition, entityId: string) {
  const entity = definition.entities.find(
    (entity) => entity.entityId === entityId,
  );
  if (entity?.kind !== "circle") throw new Error("No circle");
  return entity.radius;
}

function splineOccurrence(entity: SketchEntityDefinition | undefined) {
  if (entity?.kind !== "spline") throw new Error("No spline");
  return entity.pointOccurrences[1]!;
}

for (const kind of kinds) {
  test(`${kind} copies follow fast radius writes without a mirror or subsequent solve`, () => {
    const { definition, circleId, outputOf } = derivedSketch(kind);
    expect(definition.constraints).toEqual([]);
    expect(definition.dimensions).toEqual([]);
    expect(definition.derivedRelationships!.map((r) => r.kind)).toEqual([kind]);
    const radius = solveDragEdit(
      definition,
      [],
      tolerances,
      settings,
      [],
      { kind: "radius", entityId: circleId },
      { kind: "sketchRadius", entityId: circleId, targetRadius: 3 },
    );
    expect(radius.kind).toBe("accepted");
    if (radius.kind !== "accepted") throw new Error(radius.message);
    expect(radius.interactiveSolveSession).toBeNull();
    expect(circleRadius(radius.definition, circleId)).toBe(3);
    expect(
      circleRadius(radius.definition, outputOf(circleId).outputEntityId),
    ).toBe(3);
    expect(circleRadius(definition, outputOf(circleId).outputEntityId)).toBe(2);
  });

  test(`${kind} copies follow fast tangent writes without a mirror or subsequent solve`, () => {
    const { definition, splineId, outputOf } = derivedSketch(kind);
    const occurrence = splineOccurrence(
      definition.entities.find((e) => e.entityId === splineId),
    );
    const tangent = solveDragEdit(
      definition,
      [],
      tolerances,
      settings,
      [],
      {
        kind: "tangentVector",
        entityId: splineId,
        occurrenceId: occurrence.occurrenceId,
        pointId: occurrence.pointId,
      },
      {
        kind: "sketchTangentVector",
        entityId: splineId,
        occurrenceId: occurrence.occurrenceId,
        targetVector: [2, 1],
      },
    );
    expect(tangent.kind).toBe("accepted");
    if (tangent.kind !== "accepted") throw new Error(tangent.message);
    expect(tangent.interactiveSolveSession).toBeNull();
    const output = splineOccurrence(
      tangent.definition.entities.find(
        (e) => e.entityId === outputOf(splineId).outputEntityId,
      ),
    );
    expect(output.tangent.kind).toBe("authored");
    if (output.tangent.kind !== "authored")
      throw new Error("No authored tangent");
    const expected = kind === "circularPattern" ? [-1, 2] : [2, 1];
    expect(output.tangent.vector[0]).toBeCloseTo(expected[0]!, 9);
    expect(output.tangent.vector[1]).toBeCloseTo(expected[1]!, 9);
    expect(tangent.definition.derivedRelationships).toEqual(
      definition.derivedRelationships,
    );
  });

  test(`${kind}-only mock solves refresh outputs and validity like the production adapter`, async () => {
    const { definition, circleId, splineId, outputOf } = derivedSketch(kind);
    const changed = {
      ...definition,
      entities: definition.entities.map((entity) => {
        if (entity.entityId === circleId && entity.kind === "circle")
          return { ...entity, radius: 3 };
        if (entity.entityId === splineId && entity.kind === "spline")
          return {
            ...entity,
            pointOccurrences: entity.pointOccurrences.map((occurrence, index) =>
              index === 1
                ? {
                    ...occurrence,
                    tangent: {
                      kind: "authored" as const,
                      vector: [2, 1] as const,
                    },
                  }
                : occurrence,
            ),
          };
        return entity;
      }),
    };
    const documentId = "doc_derived" as DocumentId;
    const revisionId = "rev_derived" as RevisionId;
    const neutralCurveQueries =
      createCertifiedNeutralCurveQueryCapabilityForTest();
    const core = new SketchConstraintSolverAdapter({
      documentId,
      revisionId,
      neutralCurveQueries,
    });
    const mock = new MockSketchSolverAdapter({
      documentId,
      revisionId,
      neutralCurveQueries,
    });
    for (const missingSeed of [false, true, false]) {
      const input = {
        ...changed,
        ...(missingSeed
          ? {
              entities: changed.entities.filter((e) => e.entityId !== circleId),
              entityIds: changed.entityIds.filter((id) => id !== circleId),
            }
          : {}),
      };
      const request = {
        contractVersion: CONTRACT_VERSION,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: "request_derived" as RequestId,
        documentId,
        revisionId,
        sketchId: "sketch_arrangement" as SketchId,
        plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
        tolerances,
        modelingTolerance: settings.modelingTolerance,
        partialSolvePolicy: "bestEffort" as const,
        definition: literalResolvedDefinition(input),
        projectedReferences: [],
      };
      const production = await core.solveSketch(request);
      const response = await mock.solveSketch(request);
      expect.soft(response.status).toEqual(production.status);
      const diagnostics = (r: typeof response) =>
        r.solvedSnapshot.diagnostics.map((d) => d.code);
      expect.soft(diagnostics(response)).toEqual(diagnostics(production));
      if (missingSeed) {
        expect.soft(diagnostics(response)).toContain(
          "derived-transform-missing-seed",
        );
        expect.soft(response.status.solveState).not.toBe("solved");
      } else {
        const output = (r: typeof response, id: string) =>
          r.solvedSnapshot.solvedEntities!.find(
            (e) => e.entityId === outputOf(id).outputEntityId,
          );
        expect.soft(output(response, circleId)).toEqual(
          output(production, circleId),
        );
        expect.soft(output(response, splineId)).toEqual(
          output(production, splineId),
        );
        expect.soft(output(response, circleId)).toMatchObject({ solvedRadius: 3 });
      }
    }
  });
}
