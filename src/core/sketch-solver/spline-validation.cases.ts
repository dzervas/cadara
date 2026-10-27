import { solveSketchDefinitionCore } from "./solve-sketch";
import { makePoint, tolerances } from "./solver-basic.fixtures";
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
} from "./solver-test-seams";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { expect } from "vitest";

export async function testSplinePointResidualPreservesSubnormalPhysicalGap() {
    const splinePoints = [
      makePoint("sketch_point_tiny_s0", "S0", 0, 0),
      makePoint("sketch_point_tiny_s1", "S1", 1, 0),
    ];
    const contact = makePoint(
      "sketch_point_tiny_contact",
      "Contact",
      0,
      1e-200,
    );
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_tiny_spline" as const,
      label: "Tiny-gap spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_tiny_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_tiny_0", "occ_tiny_1"],
      pointOccurrences: [
        {
          occurrenceId: "occ_tiny_0",
          pointId: splinePoints[0]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_tiny_1",
          pointId: splinePoints[1]!.pointId,
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const localConstraint = {
      constraintId: "constraint_tiny_local_spline" as const,
      kind: "pointOnCurve" as const,
      label: "Tiny local gap",
      point: { kind: "localPoint" as const, pointId: contact.pointId },
      curve: { kind: "localEntity" as const, entityId: spline.entityId },
    };
    const localDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        ...splinePoints.map((point) => point.pointId),
        contact.pointId,
      ],
      points: [...splinePoints, contact],
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: [localConstraint.constraintId],
      constraints: [localConstraint],
      dimensionIds: [],
      dimensions: [],
    };
    const local = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: localDefinition,
      constraintId: localConstraint.constraintId,
      values: getSketchSolveInitialValuesForTest(
        localDefinition,
        tolerances,
        1e-3,
      ),
    });
    expect(local.residual).toBe(Number.MIN_VALUE);

    const reconstruction = reconstructSplineAggregate(
      spline,
      Object.fromEntries(
        splinePoints.map((point) => [point.pointId, point.position]),
      ),
    );
    expect(reconstruction.validity).toBe("valid");
    if (reconstruction.validity !== "valid") return;
    const projectedConstraint = {
      constraintId: "constraint_tiny_projected_spline" as const,
      kind: "pointOnProjectedCurve" as const,
      label: "Tiny projected gap",
      point: { kind: "localPoint" as const, pointId: contact.pointId },
      projectedCurve: {
        kind: "projectedGeometry" as const,
        reference: {
          kind: "projectedSpline" as const,
          referenceId: "ref_tiny_spline" as const,
          geometryId: "projected_geometry_tiny_spline" as const,
        },
      },
    };
    const projectedDefinition: SketchDefinition = {
      ...localDefinition,
      referenceIds: ["ref_tiny_spline"],
      references: [
        {
          referenceId: "ref_tiny_spline",
          kind: "modelReference",
          label: "Tiny external spline",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      entityIds: [],
      entities: [],
      pointIds: [contact.pointId],
      points: [contact],
      constraintIds: [projectedConstraint.constraintId],
      constraints: [projectedConstraint],
    };
    const projectedReferences = [
      {
        referenceId: "ref_tiny_spline" as const,
        status: "projected" as const,
        geometry: [
          {
            geometryId: "projected_geometry_tiny_spline" as const,
            kind: "spline" as const,
            representation: {
              kind: "neutralCubicSpans" as const,
              spans: reconstruction.spans,
            },
          },
        ],
        diagnostics: [],
      },
    ];
    const projected = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: projectedDefinition,
      projectedReferences,
      constraintId: projectedConstraint.constraintId,
      values: getSketchSolveInitialValuesForTest(
        projectedDefinition,
        tolerances,
        1e-3,
      ),
    });
    expect(projected.residual).toBe(Number.MIN_VALUE);
  }

export async function testInvalidOrdinarySplineSolveDoesNotMutateAuthoredInput() {
    const points = [
      makePoint("sketch_point_bad0", "Bad 0", 0, 0),
      makePoint("sketch_point_bad1", "Bad 1", 0, 0),
      makePoint("sketch_point_bad_contact", "Bad contact", 1, 1),
    ];
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_bad_spline" as const,
      label: "Invalid spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_bad_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_bad0", "occ_bad1"],
      pointOccurrences: [
        {
          occurrenceId: "occ_bad0",
          pointId: points[0]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_bad1",
          pointId: points[1]!.pointId,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const constraint = {
      constraintId: "constraint_bad_contact" as const,
      kind: "pointOnCurve" as const,
      label: "Impossible contact",
      point: { kind: "localPoint" as const, pointId: points[2]!.pointId },
      curve: { kind: "localEntity" as const, entityId: spline.entityId },
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: [constraint.constraintId],
      constraints: [constraint],
      dimensionIds: [],
      dimensions: [],
    };
    const before = structuredClone(definition);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("failed");
    expect(definition).toEqual(before);
    expect(
      solved.solvedSnapshot.solvedEntities.find(
        (entity) =>
          entity.entityId === spline.entityId && entity.kind === "spline",
      ),
    ).toMatchObject({ reconstruction: { validity: "invalid" } });
  }
