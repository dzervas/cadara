import { expect, test } from "vitest";
import type {
  ConstraintId,
  DimensionId,
  SketchId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  makeSketchFixture,
  literalResolvedDefinition,
} from "@/contracts/sketch/region-extraction.fixtures";
import type {
  NumericSketchDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  createDocumentSolverTolerances,
  SOLVER_SCHEMA_VERSION,
  type SolveSketchRequest,
} from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/application/solver/mock-sketch-solver-adapter";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";

// Logic lane: compare the exported adapter contract, not private residuals.
// The non-moving mock must explicitly refuse requirements it cannot evaluate.
function adapters() {
  const options = {
    documentId: "doc_mock_parity" as const,
    revisionId: "rev_mock_parity" as const,
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
  };
  return {
    mock: new MockSketchSolverAdapter(options),
    production: new SketchConstraintSolverAdapter(options),
  };
}

function request(definition: NumericSketchDefinition): SolveSketchRequest {
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_mock_parity",
    documentId: "doc_mock_parity",
    revisionId: "rev_mock_parity",
    sketchId: "sketch_arrangement",
    plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
    tolerances: createDocumentSolverTolerances(OCC_KERNEL_SETTINGS),
    modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    partialSolvePolicy: "failOnConflict",
    definition,
    projectedReferences: [],
  };
}

test.each([2, 3])(
  "mock explicitly refuses local tangent (authored line y=%s)",
  async (y) => {
    const f = makeSketchFixture();
    f.point("center", 0, 0);
    const circle = f.circle("circle", "center", 2);
    f.point("a", -3, y);
    f.point("b", 3, y);
    const line = f.line("line", "a", "b");
    const constraintId = "constraint_tangent" as ConstraintId;
    const definition: NumericSketchDefinition = {
      ...literalResolvedDefinition(f.definition()),
      constraintIds: [constraintId],
      constraints: [
        {
          constraintId,
          kind: "tangent",
          label: "Tangent",
          entityIds: [line, circle],
          relation: "external",
        },
      ],
    };
    const { mock, production } = adapters();
    const input = request(definition);
    const real = await production.solveSketch(input);
    expect(real.status.solveState).toBe("solved");
    expect(real.solvedSnapshot.constraintStatuses).toEqual([
      { constraintId, status: "satisfied" },
    ]);
    const validation = await mock.validateSketch(input);
    expect.soft(validation.isValid).toBe(false);
    expect.soft(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "mock-unsupported-constraint",
        severity: "error",
        target: { kind: "constraint", constraintId },
      }),
    );
    const result = await mock.solveSketch(input);
    expect.soft(result.status.solveState).toBe("failed");
    expect
      .soft(result.solvedSnapshot.constraintStatuses)
      .toEqual([{ constraintId, status: "conflicting" }]);
  },
);

test.each(["arcStartPointCoincident", "arcEndPointCoincident"] as const)(
  "mock explicitly refuses %s rather than accepting an unevaluated binding",
  async (kind) => {
    const f = makeSketchFixture();
    f.point("center", 0, 0);
    f.point("start", 2, 0);
    f.point("end", 0, 2);
    const arc = f.arc("arc", "center", "start", "end");
    const pointId = f.point("binding", 5, 4);
    const dimensionId = "dimension_endpoint" as DimensionId;
    const definition: NumericSketchDefinition = {
      ...literalResolvedDefinition(f.definition()),
      dimensionIds: [dimensionId],
      dimensions: [
        { dimensionId, kind, label: "Arc endpoint", entityId: arc, pointId },
      ],
    };
    const { mock, production } = adapters();
    const input = request(definition);
    const real = await production.solveSketch(input);
    expect(real.status.solveState).toBe("solved");
    expect(real.solvedSnapshot.dimensionStatuses[0]).toMatchObject({
      dimensionId,
      status: "driving",
    });
    const solvedArc = real.solvedSnapshot.solvedEntities!.find(
      (e) => e.entityId === arc,
    );
    if (solvedArc?.kind !== "arc") throw new Error("Missing solved arc");
    const endpoint =
      kind === "arcStartPointCoincident"
        ? solvedArc.startPosition
        : solvedArc.endPosition;
    const binding = real.solvedSnapshot.solvedPoints.find(
      (p) => p.pointId === pointId,
    )!.solvedPosition;
    expect(
      Math.hypot(binding[0] - endpoint[0], binding[1] - endpoint[1]),
    ).toBeLessThan(input.tolerances.coincidence);
    const validation = await mock.validateSketch(input);
    expect.soft(validation.isValid).toBe(false);
    expect.soft(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "mock-unsupported-dimension",
        severity: "error",
        target: { kind: "dimension", dimensionId },
      }),
    );
    const result = await mock.solveSketch(input);
    expect.soft(result.status.solveState).toBe("failed");
    expect
      .soft(result.solvedSnapshot.dimensionStatuses[0])
      .toMatchObject({ dimensionId, status: "unsatisfied" });
  },
);

test.each(["aligned", "horizontal", "vertical"] as const)(
  "mock refuses driving %s datum distance but still measures its reference variant",
  async (axis) => {
    const f = makeSketchFixture();
    const pointId = f.point("center", 3, 4);
    f.circle("circle", "center", 1);
    const dimensionId = "dimension_datum" as DimensionId;
    const definition: NumericSketchDefinition = {
      ...literalResolvedDefinition(f.definition()),
      dimensionIds: [dimensionId],
      dimensions: [
        {
          dimensionId,
          kind: "pointDatumDistance",
          label: "Datum distance",
          axis,
          point: { kind: "localPoint", pointId },
          datum: { kind: "sketchDatum", datum: "origin" },
          value: 8,
        },
      ],
    };
    const { mock, production } = adapters();
    const input = request(definition);
    const real = await production.solveSketch(input);
    expect(real.status.solveState).toBe("solved");
    expect(real.solvedSnapshot.dimensionStatuses[0]).toMatchObject({
      dimensionId,
      status: "driving",
    });
    expect(real.solvedSnapshot.dimensionStatuses[0]!.solvedValue).toBeCloseTo(
      8,
      5,
    );
    const validation = await mock.validateSketch(input);
    expect.soft(validation.isValid).toBe(false);
    expect.soft(validation.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "mock-unsupported-dimension",
        severity: "error",
        target: { kind: "dimension", dimensionId },
      }),
    );
    const result = await mock.solveSketch(input);
    expect.soft(result.status.solveState).toBe("failed");
    expect
      .soft(result.solvedSnapshot.dimensionStatuses[0])
      .toMatchObject({ dimensionId, status: "unsatisfied" });

    const reference = request({
      ...definition,
      dimensions: definition.dimensions.map((d) => ({ ...d, reference: true })),
    });
    expect((await mock.validateSketch(reference)).isValid).toBe(true);
    const measured = await mock.solveSketch(reference);
    const realMeasured = await production.solveSketch(reference);
    expect(measured.status.solveState).toBe("solved");
    expect(measured.solvedSnapshot.dimensionStatuses).toEqual(
      realMeasured.solvedSnapshot.dimensionStatuses,
    );
    expect(measured.solvedSnapshot.dimensionStatuses[0]).toEqual({
      dimensionId,
      status: "driven",
      solvedValue: axis === "aligned" ? 5 : axis === "horizontal" ? 3 : 4,
    });
  },
);

test.each([false, true])(
  "mock restore rebuilds cross-sketch projection like production and Finish (reversed storage=%s)",
  async (reverseStorage) => {
    const seed = new MockKernelAdapter();
    const document = await seed.exportAuthoredModelDocument("doc_workspace");
    const plane = document.sketches[0]!.plane;
    const f = makeSketchFixture();
    const sourcePoint = f.point("source", 8, 3);
    f.point("end", 12, 3);
    f.line("source", "source", "end");
    const sourceId = "sketch_restore_source" as SketchId;
    const targetId = "sketch_restore_target" as SketchId;
    const bind = (
      definition: SketchDefinition,
      sketchId: SketchId,
    ): SketchDefinition => ({
      ...definition,
      points: definition.points.map((p) => ({
        ...p,
        target: { ...p.target, sketchId },
      })),
      entities: definition.entities.map((e) => ({
        ...e,
        target: { ...e.target, sketchId },
      })),
    });
    const target = makeSketchFixture();
    target.point("a", 8, 3);
    target.point("b", 8, 6);
    target.line("target", "a", "b");
    const referenceId = "ref_restore_source" as const;
    const targetDefinition: SketchDefinition = {
      ...bind(target.definition(), targetId),
      referenceIds: [referenceId],
      references: [
        {
          referenceId,
          kind: "sketchReference",
          label: "Restored source",
          source: {
            kind: "sketchPoint",
            sketchId: sourceId,
            pointId: sourcePoint,
          },
          projectionMode: "useExistingCoplanarGeometry",
        },
      ],
    };
    document.sketches = [
      {
        sketchId: sourceId,
        label: "Source",
        plane,
        definition: bind(f.definition(), sourceId),
      },
      {
        sketchId: targetId,
        label: "Target",
        plane,
        definition: targetDefinition,
      },
    ];
    document.features = [];
    document.featureOrder = [];
    document.historyOrder = document.sketches.map((s) => ({
      kind: "sketch",
      sketchId: s.sketchId,
    }));
    if (reverseStorage) document.sketches.reverse();
    document.cursor = { kind: "sketch", sketchId: targetId };
    document.bodyLabels = [];
    const production = new OpenCascadeKernelAdapter({
      createSolverAdapter: (revisionId, neutralCurveQueries) =>
        new SketchConstraintSolverAdapter({
          documentId: document.documentId,
          revisionId,
          neutralCurveQueries,
        }),
    });
    try {
      for (const position of [
        [8, 3],
        [11, 5],
      ] as const) {
        const source = document.sketches.find((s) => s.sketchId === sourceId)!;
        source.definition = {
          ...source.definition,
          points: source.definition.points.map((p) =>
            p.pointId === sourcePoint ? { ...p, position } : p,
          ),
        };
        await production.restoreAuthoredModelDocument(document);
        const real = (
          await production.getDocumentSnapshot({
            contractVersion: CONTRACT_VERSION,
            documentId: document.documentId,
          })
        ).snapshot.document.sketches.find((s) => s.sketchId === targetId)!;
        expect(real.sketch.derivedValidity.state).toBe("current");
        expect(real.sketch.projectedReferences![0]).toMatchObject({
          status: "projected",
          geometry: [{ kind: "point", position }],
        });
        await seed.restoreAuthoredModelDocument(document);
        const snapshot = (
          await seed.getDocumentSnapshot({
            contractVersion: CONTRACT_VERSION,
            documentId: document.documentId,
          })
        ).snapshot;
        expect(
          snapshot.document.sketches
            .find((s) => s.sketchId === sourceId)!
            .sketch.solvedSnapshot.solvedPoints.find(
              (p) => p.pointId === sourcePoint,
            )!.solvedPosition,
        ).toEqual(position);
        const restored = snapshot.document.sketches.find(
          (s) => s.sketchId === targetId,
        )!;
        const finishProjection = await seed.projectSketchExternalReferences({
          ...request(literalResolvedDefinition(targetDefinition)),
          documentId: document.documentId,
          revisionId: document.revisionId,
          sketchId: targetId,
          references: targetDefinition.references.map((reference) => ({
            referenceId: reference.referenceId,
            reference,
          })),
        });
        expect(finishProjection.projectedReferences).toEqual(
          real.sketch.projectedReferences,
        );
        expect
          .soft(restored.sketch.projectedReferences)
          .toEqual(finishProjection.projectedReferences);
        expect.soft(restored.sketch.derivedValidity.state).toBe("current");
      }
      // A source retained in the pre-restore snapshot must not satisfy a
      // reference after that source is removed from the restored document.
      document.sketches = document.sketches.filter(
        (s) => s.sketchId !== sourceId,
      );
      document.historyOrder = [{ kind: "sketch", sketchId: targetId }];
      await seed.restoreAuthoredModelDocument(document);
      const missing = (
        await seed.getDocumentSnapshot({
          contractVersion: CONTRACT_VERSION,
          documentId: document.documentId,
        })
      ).snapshot.document.sketches[0]!;
      expect(missing.sketch.derivedValidity.state).toBe("invalid");
      expect(missing.sketch.projectedReferences![0]!.status).toBe(
        "missingSource",
      );
    } finally {
      production.dispose();
    }
  },
);
