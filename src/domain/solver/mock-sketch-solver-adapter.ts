import type { SketchSolverAdapter } from "@/contracts/solver/adapter";
import {
  SOLVER_SCHEMA_VERSION,
  type DeriveSketchRegionsRequest,
  type DeriveSketchRegionsResponse,
  type DisposeInteractiveSketchSolveSessionRequest,
  type DisposeInteractiveSketchSolveSessionResponse,
  type FinalizeInteractiveSketchSolveSessionRequest,
  type FinalizeInteractiveSketchSolveSessionResponse,
  type InteractiveSketchSolveSessionId,
  type ProjectedSketchReferenceGeometry,
  type ProjectedSketchReferenceRecord,
  type ProjectSketchExternalReferencesRequest,
  type ProjectSketchExternalReferencesResponse,
  type QuerySketchEditIntersectionsRequest,
  type QuerySketchEditIntersectionsResponse,
  type ResolveSketchReferenceRequest,
  type ResolveSketchReferenceResponse,
  type SketchPlaneFrame,
  type SketchSolverResponseBase,
  type SolverTolerancePolicy,
  type SolveSketchRequest,
  type SolveSketchResponse,
  type StartInteractiveSketchSolveSessionRequest,
  type StartInteractiveSketchSolveSessionResponse,
  type UpdateInteractiveSketchSolveSessionRequest,
  type UpdateInteractiveSketchSolveSessionResponse,
  type ValidateSketchRequest,
  type ValidateSketchResponse,
} from "@/contracts/solver/schema";
import { validateSketchSolverEnvelope } from "@/contracts/solver/runtime-schema";
import type { NeutralCurveQueryCapability } from "@/contracts/modeling/neutral-curve-query";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
  type SketchArrangementDeriver,
} from "@/contracts/sketch/region-extraction";
import { assertDocumentModelingTolerance } from "@/domain/solver/sketch-constraint-solver-adapter";
import { querySketchEditIntersections } from "@/contracts/sketch/edit-intersections";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  updateCompiledSketchSolveSession,
  type SketchCompiledSolveSession,
} from "@/contracts/sketch/solver-core";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  type ProjectedSketchGeometryRef,
  type SketchDefinition,
  type SketchEntityDefinition,
  type SketchPoint2D,
  type SketchSolveDiagnostic,
  type SolvedSketchDerivedCubicSpan,
  type SolvedSketchEntityGeometryRecord,
  type SolvedSketchSnapshot,
  type SolvedSketchStatus,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  solvedOffsetFramePlans,
  solvedOffsetShellSpans,
} from "@/contracts/sketch/derived-geometry";
import { OffsetCertificationMemo } from "@/contracts/sketch/offset-derivation-frame";
import {
  applyOffsetPublications,
  isOffsetPublicationSolveAccepted,
  publishSketchOffsets,
  type OffsetPublicationCapabilities,
} from "@/contracts/sketch/offset-publication";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import type {
  ConstraintId,
  DimensionId,
  DocumentId,
  ReferenceId,
  RevisionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

export interface MockSketchSolverAdapterOptions {
  /** Durable document identity the mock solver accepts. */
  documentId: DocumentId;
  /** Current committed revision identity the mock solver accepts. */
  revisionId: RevisionId;
  /** The selected kernel's neutral curve queries; only `deriveSketchRegions` uses them. */
  neutralCurveQueries: NeutralCurveQueryCapability;
}

interface StoredInteractiveSolveSession {
  session: SketchCompiledSolveSession;
  documentId: StartInteractiveSketchSolveSessionRequest["documentId"];
  revisionId: StartInteractiveSketchSolveSessionRequest["revisionId"];
  sketchId: StartInteractiveSketchSolveSessionRequest["sketchId"];
}

const DEFAULT_SOLVER_OPTIONS = {
  documentId: "doc_workspace",
  revisionId: "rev_0001",
} satisfies Partial<MockSketchSolverAdapterOptions>;

function makeResponseBase(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
    | StartInteractiveSketchSolveSessionRequest
    | UpdateInteractiveSketchSolveSessionRequest
    | FinalizeInteractiveSketchSolveSessionRequest
    | DisposeInteractiveSketchSolveSessionRequest
    | DeriveSketchRegionsRequest
    | QuerySketchEditIntersectionsRequest
    | ResolveSketchReferenceRequest,
): SketchSolverResponseBase {
  return {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: request.requestId,
    documentId: request.documentId,
    revisionId: request.revisionId,
    sketchId: request.sketchId,
  };
}

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return {
    code,
    severity,
    message,
    target,
  };
}

function getRevisionMismatchDiagnostics(
  request: {
    documentId: DocumentId;
    revisionId: RevisionId;
  },
  options: MockSketchSolverAdapterOptions,
) {
  if (
    request.documentId === options.documentId &&
    request.revisionId === options.revisionId
  ) {
    return [] as SketchSolveDiagnostic[];
  }

  return [
    makeDiagnostic(
      "solver-revision-mismatch",
      "error",
      `Mock solver request targeted ${request.documentId}@${request.revisionId}, but the mock runtime is configured for ${options.documentId}@${options.revisionId}.`,
      null,
    ),
  ];
}

function assertSupportedRequest(
  request:
    | ProjectSketchExternalReferencesRequest
    | ValidateSketchRequest
    | SolveSketchRequest
    | StartInteractiveSketchSolveSessionRequest
    | UpdateInteractiveSketchSolveSessionRequest
    | FinalizeInteractiveSketchSolveSessionRequest
    | DisposeInteractiveSketchSolveSessionRequest
    | DeriveSketchRegionsRequest
    | QuerySketchEditIntersectionsRequest
    | ResolveSketchReferenceRequest,
  options: MockSketchSolverAdapterOptions,
): void {
  const parsed = validateSketchSolverEnvelope(request);
  if (!parsed.success) {
    throw new Error(
      parsed.issues[0]?.message ?? "Invalid sketch solver request envelope.",
    );
  }

  const revisionDiagnostics = getRevisionMismatchDiagnostics(request, options);

  if (revisionDiagnostics.length > 0) {
    throw new Error(revisionDiagnostics[0]!.message);
  }
}

function samePoint(
  left: SketchPoint2D,
  right: SketchPoint2D,
  tolerance: number,
) {
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  );
}

function pointRecordMap(definition: SketchDefinition) {
  return new Map(definition.points.map((point) => [point.pointId, point]));
}

function entityRecordMap(definition: SketchDefinition) {
  return new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
}

function projectedKindForConstraintRef(
  kind: NonNullable<ProjectedSketchGeometryRef["kind"]>,
) {
  switch (kind) {
    case "projectedPoint":
      return "point";
    case "projectedLineSegment":
      return "lineSegment";
    case "projectedCircle":
      return "circle";
    case "projectedArc":
      return "arc";
    case "projectedSpline":
      return "spline";
  }
}

function findProjectedGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): ProjectedSketchReferenceGeometry | null {
  const projectedReference = projectedReferences.find(
    (entry) => entry.referenceId === reference.referenceId,
  );

  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const expectedKind = projectedKindForConstraintRef(reference.kind);
  return (
    projectedReference.geometry.find(
      (geometry) =>
        geometry.geometryId === reference.geometryId &&
        geometry.kind === expectedKind,
    ) ?? null
  );
}

function projectedGeometryForReference(
  reference: ProjectSketchExternalReferencesRequest["references"][number],
) {
  if (reference.reference.kind === "constructionPlane") {
    return {
      status: "projected" as const,
      geometry: [] as ProjectedSketchReferenceGeometry[],
      diagnostics: [] as SketchSolveDiagnostic[],
    };
  }

  if (reference.reference.kind === "sketchReference") {
    return {
      status: "unsupportedSource" as const,
      geometry: [] as ProjectedSketchReferenceGeometry[],
      diagnostics: [
        makeDiagnostic(
          "unsupported-sketch-reference-source",
          "warning",
          `Sketch reference ${reference.referenceId} does not expose projectable geometry in this solver.`,
          null,
        ),
      ],
    };
  }

  return {
    status: "unsupportedSource" as const,
    geometry: [] as ProjectedSketchReferenceGeometry[],
    diagnostics: [
      makeDiagnostic(
        "unsupported-model-reference-source",
        "warning",
        `Model reference ${reference.referenceId} cannot be projected because this mock solver has no resolved source geometry.`,
        null,
      ),
    ],
  };
}

function validateDefinition(
  definition: SketchDefinition,
  projectedReferences: ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
) {
  const diagnostics: SketchSolveDiagnostic[] = [];
  const pointIds = new Set<SketchPointId>();
  const entityIds = new Set<SketchEntityId>();
  const constraintIds = new Set<ConstraintId>();
  const dimensionIds = new Set<DimensionId>();
  const referenceIds = new Set<ReferenceId>();
  const points = pointRecordMap(definition);
  const entities = entityRecordMap(definition);
  const offsetOutputLineIds = new Set<SketchEntityId>(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.outputs.map((output) => output.outputEntityId)
        : [],
    ),
  );

  for (const pointId of definition.pointIds) {
    if (pointIds.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-point-id",
          "error",
          `Point ${pointId} appears more than once.`,
          { kind: "point", pointId },
        ),
      );
      continue;
    }

    pointIds.add(pointId);
  }

  for (const entityId of definition.entityIds) {
    if (entityIds.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-entity-id",
          "error",
          `Entity ${entityId} appears more than once.`,
          { kind: "entity", entityId },
        ),
      );
      continue;
    }

    entityIds.add(entityId);
  }

  for (const constraintId of definition.constraintIds) {
    if (constraintIds.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-constraint-id",
          "error",
          `Constraint ${constraintId} appears more than once.`,
          { kind: "constraint", constraintId },
        ),
      );
      continue;
    }

    constraintIds.add(constraintId);
  }

  for (const dimensionId of definition.dimensionIds) {
    if (dimensionIds.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-dimension-id",
          "error",
          `Dimension ${dimensionId} appears more than once.`,
          { kind: "dimension", dimensionId },
        ),
      );
      continue;
    }

    dimensionIds.add(dimensionId);
  }

  for (const referenceId of definition.referenceIds) {
    if (referenceIds.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-reference-id",
          "error",
          `Reference ${referenceId} appears more than once.`,
          null,
        ),
      );
      continue;
    }

    referenceIds.add(referenceId);
  }

  for (const point of definition.points) {
    if (!pointIds.has(point.pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-order",
          "error",
          `Point ${point.pointId} is not listed in pointIds.`,
          { kind: "point", pointId: point.pointId },
        ),
      );
    }
  }

  for (const pointId of definition.pointIds) {
    if (!points.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-records",
          "error",
          `pointIds references missing point ${pointId}.`,
          { kind: "point", pointId },
        ),
      );
    }
  }

  for (const entity of definition.entities) {
    if (!entityIds.has(entity.entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "entity-missing-from-order",
          "error",
          `Entity ${entity.entityId} is not listed in entityIds.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }

    switch (entity.kind) {
      case "point":
        if (!points.has(entity.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-point-reference",
              "error",
              `Point entity ${entity.entityId} references missing point ${entity.pointId}.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        break;
      case "lineSegment":
        if (
          !points.has(entity.startPointId) ||
          !points.has(entity.endPointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-line-endpoint",
              "error",
              `Line ${entity.entityId} references a missing endpoint.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
          break;
        }

        // T10i (C5): an offset line output is relationship-owned, as in
        // the core (its solve frame fails it below τ).
        if (
          !offsetOutputLineIds.has(entity.entityId) &&
          samePoint(
            points.get(entity.startPointId)!.position,
            points.get(entity.endPointId)!.position,
            tolerances.minimumSegmentLength,
          )
        ) {
          diagnostics.push(
            makeDiagnostic(
              "degenerate-line-segment",
              "error",
              `Line ${entity.entityId} is shorter than the minimum segment length tolerance.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        break;
      case "circle":
        if (!points.has(entity.centerPointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-circle-center",
              "error",
              `Circle ${entity.entityId} references a missing center point.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }

        if (entity.radius <= 0) {
          diagnostics.push(
            makeDiagnostic(
              "invalid-circle-radius",
              "error",
              `Circle ${entity.entityId} must have a radius greater than zero.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        break;
      case "arc":
        if (
          !points.has(entity.centerPointId) ||
          !points.has(entity.startPointId) ||
          !points.has(entity.endPointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-arc-point",
              "error",
              `Arc ${entity.entityId} references a missing point.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        break;
      case "spline": {
        const occurrences = orderedSplineOccurrences(entity);
        if (!occurrences || occurrences.length < 2) {
          diagnostics.push(
            makeDiagnostic(
              "invalid-spline-point-occurrences",
              "error",
              `Spline ${entity.entityId} requires at least two ordered point occurrences.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
          break;
        }

        if (occurrences.some(({ pointId }) => !points.has(pointId))) {
          diagnostics.push(
            makeDiagnostic(
              "missing-spline-fit-point",
              "error",
              `Spline ${entity.entityId} references a missing fit point.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        break;
      }
    }
  }

  for (const entityId of definition.entityIds) {
    if (!entities.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "entity-missing-from-records",
          "error",
          `entityIds references missing entity ${entityId}.`,
          { kind: "entity", entityId },
        ),
      );
    }
  }

  for (const constraint of definition.constraints) {
    if (!constraintIds.has(constraint.constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "constraint-missing-from-order",
          "error",
          `Constraint ${constraint.constraintId} is not listed in constraintIds.`,
          { kind: "constraint", constraintId: constraint.constraintId },
        ),
      );
    }

    switch (constraint.kind) {
      case "coincident":
        if (
          !points.has(constraint.pointIds[0]) ||
          !points.has(constraint.pointIds[1])
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-coincident-point",
              "error",
              `Constraint ${constraint.constraintId} references a missing point.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "horizontal":
      case "vertical":
        if (!entities.has(constraint.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-constrained-entity",
              "error",
              `Constraint ${constraint.constraintId} references a missing entity.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "coincidentProjectedPoint":
        if (!points.has(constraint.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-coincident-point",
              "error",
              `Constraint ${constraint.constraintId} references a missing point.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (
          constraint.projectedPoint.kind === "projectedGeometry" &&
          (!referenceIds.has(constraint.projectedPoint.reference.referenceId) ||
            !findProjectedGeometry(
              projectedReferences,
              constraint.projectedPoint.reference,
            ))
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-constraint-target",
              "error",
              `Constraint ${constraint.constraintId} targets missing projected geometry.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "pointOnProjectedCurve":
        if (!points.has(constraint.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-point-on-projected-curve-point",
              "error",
              `Constraint ${constraint.constraintId} references a missing point.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (
          constraint.projectedCurve.kind === "projectedGeometry" &&
          (!referenceIds.has(constraint.projectedCurve.reference.referenceId) ||
            !findProjectedGeometry(
              projectedReferences,
              constraint.projectedCurve.reference,
            ))
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-constraint-target",
              "error",
              `Constraint ${constraint.constraintId} targets missing projected geometry.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "parallelProjectedLine":
      case "perpendicularProjectedLine": {
        const entity = entities.get(constraint.line.entityId);
        const projected =
          constraint.projectedLine.kind === "projectedGeometry"
            ? findProjectedGeometry(
                projectedReferences,
                constraint.projectedLine.reference,
              )
            : null;
        if (!entity || entity.kind !== "lineSegment") {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-line-local-entity",
              "error",
              `Constraint ${constraint.constraintId} references a missing or unsupported line entity.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (
          constraint.projectedLine.kind === "projectedGeometry" &&
          (!referenceIds.has(constraint.projectedLine.reference.referenceId) ||
            projected?.kind !== "lineSegment")
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-constraint-target",
              "error",
              `Constraint ${constraint.constraintId} targets missing projected line geometry.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "tangentProjectedCurve": {
        const entity = entities.get(constraint.curve.entityId);
        const projected = findProjectedGeometry(
          projectedReferences,
          constraint.projectedCurve.reference,
        );
        if (
          !entity ||
          (entity.kind !== "lineSegment" &&
            entity.kind !== "circle" &&
            entity.kind !== "arc")
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-tangent-local-curve",
              "error",
              `Constraint ${constraint.constraintId} references a missing or unsupported local curve.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (
          !referenceIds.has(constraint.projectedCurve.reference.referenceId) ||
          (projected?.kind !== "circle" && projected?.kind !== "arc")
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-constraint-target",
              "error",
              `Constraint ${constraint.constraintId} targets missing projected circle or arc geometry.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
    }
  }

  const constraintMap = new Set(
    definition.constraints.map((constraint) => constraint.constraintId),
  );
  for (const constraintId of definition.constraintIds) {
    if (!constraintMap.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "constraint-missing-from-records",
          "error",
          `constraintIds references missing constraint ${constraintId}.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  }

  for (const dimension of definition.dimensions) {
    if (!dimensionIds.has(dimension.dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-order",
          "error",
          `Dimension ${dimension.dimensionId} is not listed in dimensionIds.`,
          { kind: "dimension", dimensionId: dimension.dimensionId },
        ),
      );
    }

    switch (dimension.kind) {
      case "distance":
      case "horizontalDistance":
      case "verticalDistance":
        if (
          !points.has(dimension.pointIds[0]) ||
          !points.has(dimension.pointIds[1])
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `Dimension ${dimension.dimensionId} references a missing point.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "circleRadius":
      case "diameter":
        if (!entities.has(dimension.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `Dimension ${dimension.dimensionId} references a missing entity.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "lineLength":
        if (!entities.has(dimension.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `Dimension ${dimension.dimensionId} references a missing line.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "lineDistance":
      case "lineAngle":
        for (const line of dimension.lines) {
          if (line.kind === "localEntity" && !entities.has(line.entityId)) {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-entity",
                "error",
                `Dimension ${dimension.dimensionId} references a missing line.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        }
        break;
      case "linePointDistance":
        if (
          dimension.line.kind === "localEntity" &&
          !entities.has(dimension.line.entityId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `Dimension ${dimension.dimensionId} references a missing line.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        if (
          dimension.point.kind === "localPoint" &&
          !points.has(dimension.point.pointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `Dimension ${dimension.dimensionId} references a missing point.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "arcStartPointCoincident":
      case "arcEndPointCoincident":
        if (
          !entities.has(dimension.entityId) ||
          !points.has(dimension.pointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-arc-endpoint-reference",
              "error",
              `Dimension ${dimension.dimensionId} references missing arc or point data.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
    }
  }

  const dimensionMap = new Set(
    definition.dimensions.map((dimension) => dimension.dimensionId),
  );
  for (const dimensionId of definition.dimensionIds) {
    if (!dimensionMap.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-records",
          "error",
          `dimensionIds references missing dimension ${dimensionId}.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  }

  const definitionReferenceIds = new Set<ReferenceId>();
  for (const reference of definition.references) {
    if (definitionReferenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-reference-record",
          "error",
          `Reference record ${reference.referenceId} appears more than once.`,
          null,
        ),
      );
      continue;
    }

    definitionReferenceIds.add(reference.referenceId);

    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-order",
          "error",
          `Reference ${reference.referenceId} is not listed in referenceIds.`,
          null,
        ),
      );
    }
  }
  for (const referenceId of definition.referenceIds) {
    if (!definitionReferenceIds.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-records",
          "error",
          `referenceIds references missing reference ${referenceId}.`,
          null,
        ),
      );
    }
  }

  for (const projectedReference of projectedReferences) {
    if (projectedReference.status !== "projected") {
      diagnostics.push(
        makeDiagnostic(
          "external-reference-not-projected",
          "error",
          `Reference ${projectedReference.referenceId} could not be projected into sketch space.`,
          null,
        ),
      );
    }
  }

  return {
    isValid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
  };
}

function distance(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function solvedGeometryForEntity(
  entity: SketchEntityDefinition,
  definition: SketchDefinition,
  shellSpans: ReadonlyMap<SketchEntityId, SolvedSketchDerivedCubicSpan[]>,
): SolvedSketchEntityGeometryRecord | null {
  const points = pointRecordMap(definition);

  switch (entity.kind) {
    case "derivedPiecewiseCubic":
      // The shared contracts solve frame (no second evaluator), uncertified.
      return {
        entityId: entity.entityId,
        kind: "derivedPiecewiseCubic",
        publication: "provisional",
        spans: shellSpans.get(entity.entityId) ?? [],
      };
    case "point": {
      const point = points.get(entity.pointId);
      return point
        ? {
            entityId: entity.entityId,
            kind: "point",
            solvedPosition: point.position,
          }
        : null;
    }
    case "lineSegment": {
      const start = points.get(entity.startPointId);
      const end = points.get(entity.endPointId);
      return start && end
        ? {
            entityId: entity.entityId,
            kind: "lineSegment",
            startPosition: start.position,
            endPosition: end.position,
          }
        : null;
    }
    case "circle": {
      const center = points.get(entity.centerPointId);
      return center
        ? {
            entityId: entity.entityId,
            kind: "circle",
            centerPosition: center.position,
            solvedRadius: entity.radius,
          }
        : null;
    }
    case "arc": {
      const center = points.get(entity.centerPointId);
      const start = points.get(entity.startPointId);
      const end = points.get(entity.endPointId);
      return center && start && end
        ? {
            entityId: entity.entityId,
            kind: "arc",
            centerPosition: center.position,
            startPosition: start.position,
            endPosition: end.position,
            sweepDirection: entity.sweepDirection,
          }
        : null;
    }
    case "spline": {
      const positions = Object.fromEntries(
        [...points.entries()].map(([pointId, point]) => [
          pointId,
          point.position,
        ]),
      ) as Record<SketchPointId, SketchPoint2D>;
      return {
        entityId: entity.entityId,
        kind: "spline",
        reconstruction: reconstructSplineAggregate(entity, positions),
      };
    }
    case "ellipse": {
      const center = points.get(entity.centerPointId);
      const major = points.get(entity.majorAxisPointId);
      return center && major
        ? {
            entityId: entity.entityId,
            kind: "ellipse",
            centerPosition: center.position,
            majorAxisEndpointPosition: major.position,
            minorRadius: entity.minorRadius,
          }
        : null;
    }
    case "ellipticalArc": {
      const center = points.get(entity.centerPointId);
      const major = points.get(entity.majorAxisPointId);
      const start = points.get(entity.startPointId);
      const end = points.get(entity.endPointId);
      return center && major && start && end
        ? {
            entityId: entity.entityId,
            kind: "ellipticalArc",
            centerPosition: center.position,
            majorAxisEndpointPosition: major.position,
            startPosition: start.position,
            endPosition: end.position,
            minorRadius: entity.minorRadius,
            sweepDirection: entity.sweepDirection,
          }
        : null;
    }
    case "conic": {
      const start = points.get(entity.startPointId);
      const control = points.get(entity.controlPointId);
      const end = points.get(entity.endPointId);
      return start && control && end
        ? {
            entityId: entity.entityId,
            kind: "conic",
            startPosition: start.position,
            controlPosition: control.position,
            endPosition: end.position,
            rho: entity.rho,
          }
        : null;
    }
    case "bezierCurve": {
      const controlPoints = entity.controlPointIds.flatMap((pointId) => {
        const point = points.get(pointId);
        return point ? [point.position] : [];
      });
      return controlPoints.length === entity.controlPointIds.length
        ? {
            entityId: entity.entityId,
            kind: "bezierCurve",
            controlPoints,
            degree: entity.degree,
          }
        : null;
    }
    case "profileText": {
      const anchor = points.get(entity.anchorPointId);
      return anchor
        ? {
            entityId: entity.entityId,
            kind: "profileText",
            anchorPosition: anchor.position,
            text: entity.text,
            height: entity.height,
            rotationRadians: entity.rotationRadians,
            horizontalAlign: entity.horizontalAlign,
            verticalAlign: entity.verticalAlign,
          }
        : null;
    }
  }
}

function solveDefinition(
  authoredDefinition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  authoredValidationDiagnostics: SketchSolveDiagnostic[],
  partialSolvePolicy: SolveSketchRequest["partialSolvePolicy"],
  modelingTolerance: number,
  offsetPlans: SolveSketchRequest["offsetPlans"],
) {
  // T08b-g5: offsets come from the shared contracts solve frame at τ.
  const hasOffsets = (authoredDefinition.derivedRelationships ?? []).some(
    (relationship) => relationship.kind === "offset",
  );
  const evaluation = hasOffsets
    ? evaluateSketchDerivations({
        definition: authoredDefinition,
        modelingTolerance,
        ...(offsetPlans ? { offsetPlans } : {}),
      })
    : null;
  const definition = evaluation?.definition ?? authoredDefinition;
  const validationDiagnostics = [
    ...authoredValidationDiagnostics,
    ...(evaluation?.diagnostics ?? []),
  ];
  const shellSpans = evaluation
    ? solvedOffsetShellSpans(evaluation)
    : new Map<SketchEntityId, SolvedSketchDerivedCubicSpan[]>();
  const points = pointRecordMap(definition);
  const entityMap = entityRecordMap(definition);
  const solvedEntities = definition.entities.flatMap((entity) => {
    const solved = solvedGeometryForEntity(entity, definition, shellSpans);
    return solved ? [solved] : [];
  });
  const solvedPoints = definition.points.map((point) => ({
    pointId: point.pointId,
    target: point.target,
    solvedPosition: point.position,
  }));
  const constraintStatuses = definition.constraints.map((constraint) => {
    switch (constraint.kind) {
      case "coincident": {
        const left = points.get(constraint.pointIds[0]);
        const right = points.get(constraint.pointIds[1]);
        return {
          constraintId: constraint.constraintId,
          status:
            left && right && samePoint(left.position, right.position, 1e-9)
              ? "satisfied"
              : left && right
                ? "unsatisfied"
                : "conflicting",
        } as const;
      }
      case "horizontal": {
        const entity = entityMap.get(constraint.entityId);
        return {
          constraintId: constraint.constraintId,
          status: entity?.kind === "lineSegment" ? "satisfied" : "conflicting",
        } as const;
      }
      case "vertical": {
        const entity = entityMap.get(constraint.entityId);
        return {
          constraintId: constraint.constraintId,
          status: entity?.kind === "lineSegment" ? "satisfied" : "conflicting",
        } as const;
      }
      case "coincidentProjectedPoint": {
        const point = points.get(constraint.point.pointId);
        const projected =
          constraint.projectedPoint.kind === "projectedGeometry"
            ? findProjectedGeometry(
                projectedReferences,
                constraint.projectedPoint.reference,
              )
            : null;
        const datumPoint =
          constraint.projectedPoint.kind === "sketchDatum" &&
          constraint.projectedPoint.datum === "origin"
            ? ([0, 0] as const)
            : null;
        return {
          constraintId: constraint.constraintId,
          status:
            point &&
            ((projected?.kind === "point" &&
              samePoint(point.position, projected.position, 1e-9)) ||
              (datumPoint !== null &&
                samePoint(point.position, datumPoint, 1e-9)))
              ? "satisfied"
              : point && (projected?.kind === "point" || datumPoint !== null)
                ? "unsatisfied"
                : "conflicting",
        } as const;
      }
      case "pointOnProjectedCurve":
      case "parallelProjectedLine":
      case "perpendicularProjectedLine":
      case "tangentProjectedCurve":
        return {
          constraintId: constraint.constraintId,
          status: validationDiagnostics.some(
            (diagnostic) =>
              diagnostic.target?.kind === "constraint" &&
              diagnostic.target.constraintId === constraint.constraintId,
          )
            ? "conflicting"
            : "satisfied",
        } as const;
      default:
        return {
          constraintId: constraint.constraintId,
          status: "conflicting",
        } as const;
    }
  });
  const dimensionStatuses = definition.dimensions.map((dimension) => {
    switch (dimension.kind) {
      case "distance": {
        const left = points.get(dimension.pointIds[0]);
        const right = points.get(dimension.pointIds[1]);
        return {
          dimensionId: dimension.dimensionId,
          status: left && right ? "driving" : "unsatisfied",
          solvedValue:
            left && right ? distance(left.position, right.position) : null,
        } as const;
      }
      case "circleRadius": {
        const entity = entityMap.get(dimension.entityId);
        return {
          dimensionId: dimension.dimensionId,
          status: entity?.kind === "circle" ? "driving" : "unsatisfied",
          solvedValue: entity?.kind === "circle" ? entity.radius : null,
        } as const;
      }
      case "diameter": {
        // T10g-1: a Trim turns a circle's radius dimension into a diameter
        // on the arc it becomes; it drives circles and arcs, as in the core.
        const entity = entityMap.get(dimension.entityId);
        const center =
          entity?.kind === "arc" ? points.get(entity.centerPointId) : null;
        const start =
          entity?.kind === "arc" ? points.get(entity.startPointId) : null;
        const solvedValue =
          entity?.kind === "circle"
            ? 2 * entity.radius
            : center && start
              ? 2 * distance(center.position, start.position)
              : null;
        return {
          dimensionId: dimension.dimensionId,
          status: solvedValue === null ? "unsatisfied" : "driving",
          solvedValue,
        } as const;
      }
      case "lineLength": {
        const entity = entityMap.get(dimension.entityId);
        const start =
          entity?.kind === "lineSegment"
            ? points.get(entity.startPointId)
            : null;
        const end =
          entity?.kind === "lineSegment" ? points.get(entity.endPointId) : null;
        return {
          dimensionId: dimension.dimensionId,
          status: start && end ? "driving" : "unsatisfied",
          solvedValue:
            start && end ? distance(start.position, end.position) : null,
        } as const;
      }
      default:
        return {
          dimensionId: dimension.dimensionId,
          status: "unsatisfied",
          solvedValue: null,
        } as const;
    }
  });
  const errorCount = validationDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;

  let status: SolvedSketchStatus;
  if (errorCount > 0) {
    status = {
      solveState:
        partialSolvePolicy === "bestEffort" ? "partiallySolved" : "failed",
      constraintState: "inconsistent",
    };
  } else if (
    definition.constraints.length + definition.dimensions.length ===
    0
  ) {
    status = {
      solveState: definition.entities.length === 0 ? "notEvaluated" : "solved",
      constraintState:
        definition.entities.length === 0 ? "unknown" : "underConstrained",
    };
  } else {
    status = {
      solveState: "solved",
      constraintState: "wellConstrained",
    };
  }

  const solvedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
    status,
    solvedEntities,
    solvedPoints,
    constraintStatuses,
    dimensionStatuses,
    diagnostics: validationDiagnostics,
    ...(evaluation
      ? { offsetFramePlans: solvedOffsetFramePlans(evaluation) }
      : {}),
  };
  // [TECH] G16′, as the core solver: an offset relationship's failure is
  // relationship-scoped (its publication reports it); only an unaccepted
  // solve, which publishes nothing, carries it in the snapshot.
  if (evaluation && !isOffsetPublicationSolveAccepted(solvedSnapshot))
    validationDiagnostics.push(
      ...evaluation.offsetFailures.map((failure) => failure.diagnostic),
    );

  return {
    status,
    solvedSnapshot,
    diagnostics: validationDiagnostics,
  };
}

export const DEFAULT_MOCK_SKETCH_PLANE_FRAME: SketchPlaneFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
  linearUnit: "documentLength",
  handedness: "rightHanded",
};

export const DEFAULT_MOCK_SOLVER_TOLERANCES: SolverTolerancePolicy = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};

export class MockSketchSolverAdapter implements SketchSolverAdapter {
  private readonly options: MockSketchSolverAdapterOptions;
  private readonly interactiveSessions = new Map<
    InteractiveSketchSolveSessionId,
    StoredInteractiveSolveSession
  >();
  private nextInteractiveSessionSequence = 1;

  private readonly regionDeriver: SketchArrangementDeriver;
  /** The same kernel-free offset publication as the production adapter. */
  private readonly offsetPublication: OffsetPublicationCapabilities = {
    query: createCertifiedNeutralCurveRequestQuery(),
    certifier: createCertifiedCubicTubeChain(),
    memo: new OffsetCertificationMemo(),
  };

  constructor(
    options: Partial<
      Omit<MockSketchSolverAdapterOptions, "neutralCurveQueries">
    > &
      Pick<MockSketchSolverAdapterOptions, "neutralCurveQueries">,
  ) {
    this.options = {
      ...DEFAULT_SOLVER_OPTIONS,
      ...options,
    };
    this.regionDeriver = createSketchArrangementDeriver(
      options.neutralCurveQueries,
    );
  }

  async projectExternalReferences(
    request: ProjectSketchExternalReferencesRequest,
  ): Promise<ProjectSketchExternalReferencesResponse> {
    assertSupportedRequest(request, this.options);
    const base = makeResponseBase(request);

    return {
      ...base,
      projectedReferences: request.references.map((reference) => ({
        referenceId: reference.referenceId,
        ...projectedGeometryForReference(reference),
      })),
      diagnostics: [],
    };
  }

  async validateSketch(
    request: ValidateSketchRequest,
  ): Promise<ValidateSketchResponse> {
    assertSupportedRequest(request, this.options);
    const base = makeResponseBase(request);
    const validation = validateDefinition(
      request.definition,
      request.projectedReferences,
      request.tolerances,
    );
    return {
      ...base,
      isValid: validation.isValid,
      diagnostics: validation.diagnostics,
    };
  }

  async solveSketch(request: SolveSketchRequest): Promise<SolveSketchResponse> {
    assertSupportedRequest(request, this.options);
    const base = makeResponseBase(request);
    const validation = validateDefinition(
      request.definition,
      request.projectedReferences,
      request.tolerances,
    );
    const solved = solveDefinition(
      request.definition,
      request.projectedReferences,
      validation.diagnostics,
      request.partialSolvePolicy,
      request.modelingTolerance,
      request.offsetPlans,
    );
    return {
      ...base,
      status: solved.status,
      solvedSnapshot: solved.solvedSnapshot,
      diagnostics: solved.diagnostics,
    };
  }

  async startInteractiveSolveSession(
    request: StartInteractiveSketchSolveSessionRequest,
  ): Promise<StartInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const offsetPlans = request.priorSolvedSnapshot?.offsetFramePlans;
    const program = compileSketchSolveProgram({
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      tolerances: request.tolerances,
      modelingTolerance: request.modelingTolerance,
      ...(offsetPlans ? { offsetPlans } : {}),
      partialSolvePolicy: request.partialSolvePolicy,
      strategy: request.strategy,
    });
    const sessionId =
      `interactive_sketch_solve_mock_${this.nextInteractiveSessionSequence++}` as InteractiveSketchSolveSessionId;
    const session = createCompiledSketchSolveSession({
      sessionId,
      program,
      priorSolvedSnapshot: request.priorSolvedSnapshot,
    });
    this.interactiveSessions.set(sessionId, {
      session,
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
    });
    return {
      ...makeResponseBase(request),
      sessionId,
      programId: program.programId,
      warmStarted: session.warmStarted,
      solvedSnapshot: session.lastAcceptedSnapshot,
      status: session.lastAcceptedSnapshot.status,
      diagnostics: session.lastAcceptedSnapshot.diagnostics,
    };
  }

  async updateInteractiveSolveSession(
    request: UpdateInteractiveSketchSolveSessionRequest,
  ): Promise<UpdateInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    if (!stored || stored.session.disposed) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        result: {
          kind: "blocked",
          reason: "staleSession",
          solvedSnapshot: null,
          diagnostics: [
            {
              code: "stale-interactive-solve-session",
              severity: "error",
              message: `Interactive solve session ${request.sessionId} is no longer active.`,
              target: { kind: "point", pointId: request.dragTarget.pointId },
            },
          ],
        },
      };
    }

    if (
      stored.documentId !== request.documentId ||
      stored.revisionId !== request.revisionId ||
      stored.sketchId !== request.sketchId
    ) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        result: {
          kind: "blocked",
          reason: "staleRevision",
          solvedSnapshot: stored.session.lastAcceptedSnapshot,
          diagnostics: [
            {
              code: "stale-interactive-solve-session-basis",
              severity: "error",
              message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
              target: { kind: "point", pointId: request.dragTarget.pointId },
            },
          ],
        },
      };
    }

    const result = updateCompiledSketchSolveSession(
      stored.session,
      request.dragTarget,
      1e-4,
    );
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      result:
        result.kind === "solved"
          ? {
              kind: "accepted",
              status: result.solvedSnapshot.status,
              solvedSnapshot: result.solvedSnapshot,
              diagnostics: result.diagnostics,
            }
          : {
              kind: "blocked",
              reason: result.reason,
              solvedSnapshot: result.solvedSnapshot,
              diagnostics: result.diagnostics,
            },
    };
  }

  async finalizeInteractiveSolveSession(
    request: FinalizeInteractiveSketchSolveSessionRequest,
  ): Promise<FinalizeInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    if (!stored || stored.session.disposed) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        solvedSnapshot: null,
        status: null,
        diagnostics: [
          {
            code: "stale-interactive-solve-session",
            severity: "error",
            message: `Interactive solve session ${request.sessionId} is no longer active.`,
            target: null,
          },
        ],
      };
    }

    if (
      stored.documentId !== request.documentId ||
      stored.revisionId !== request.revisionId ||
      stored.sketchId !== request.sketchId
    ) {
      return {
        ...makeResponseBase(request),
        sessionId: request.sessionId,
        solvedSnapshot: null,
        status: null,
        diagnostics: [
          {
            code: "stale-interactive-solve-session-basis",
            severity: "error",
            message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
            target: null,
          },
        ],
      };
    }

    stored.session.disposed = true;
    this.interactiveSessions.delete(request.sessionId);
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      solvedSnapshot: stored.session.lastAcceptedSnapshot,
      status: stored.session.lastAcceptedSnapshot.status,
      diagnostics: stored.session.lastAcceptedSnapshot.diagnostics,
    };
  }

  async disposeInteractiveSolveSession(
    request: DisposeInteractiveSketchSolveSessionRequest,
  ): Promise<DisposeInteractiveSketchSolveSessionResponse> {
    assertSupportedRequest(request, this.options);
    const stored = this.interactiveSessions.get(request.sessionId);
    const basisMatches = Boolean(
      stored &&
      stored.documentId === request.documentId &&
      stored.revisionId === request.revisionId &&
      stored.sketchId === request.sketchId,
    );
    const disposed = Boolean(
      stored && !stored.session.disposed && basisMatches,
    );
    if (stored && basisMatches) {
      stored.session.disposed = true;
      this.interactiveSessions.delete(request.sessionId);
    }
    return {
      ...makeResponseBase(request),
      sessionId: request.sessionId,
      disposed,
      diagnostics: disposed
        ? []
        : [
            basisMatches || !stored
              ? {
                  code: "stale-interactive-solve-session",
                  severity: "warning",
                  message: `Interactive solve session ${request.sessionId} was not active.`,
                  target: null,
                }
              : {
                  code: "stale-interactive-solve-session-basis",
                  severity: "warning",
                  message: `Interactive solve session ${request.sessionId} does not match the request document, revision, and sketch basis.`,
                  target: null,
                },
          ],
    };
  }

  async deriveSketchRegions(
    request: DeriveSketchRegionsRequest,
  ): Promise<DeriveSketchRegionsResponse> {
    assertSupportedRequest(request, this.options);
    assertDocumentModelingTolerance(request.modelingTolerance);
    const base = makeResponseBase(request);
    // [TECH] G1: publish first (relationship-scoped), then regions.
    const offsetPublications = publishSketchOffsets({
      definition: request.definition,
      solvedSnapshot: request.solvedSnapshot,
      modelingTolerance: request.modelingTolerance,
      capabilities: this.offsetPublication,
    });
    // T08b-g5b/g5c: regions consume exactly the accepted offset outputs
    // ([TECH] G7/G19); every non-accepted one is excluded like construction
    // geometry with one targeted diagnostic, and blocks nothing ([TECH] G19).
    const solvedSnapshot = applyOffsetPublications(
      request.definition,
      request.solvedSnapshot,
      offsetPublications,
    );
    const derived = await this.regionDeriver.derive({
      documentId: request.documentId,
      revisionId: request.revisionId,
      sketchId: request.sketchId,
      solvedSnapshot,
      definition: request.definition,
      projectedReferences: request.projectedReferences,
      modelingTolerance: request.modelingTolerance,
      ...offsetArrangementInput(
        request.definition,
        solvedSnapshot,
        offsetPublications,
      ),
    });
    return {
      ...base,
      regions: derived.regions,
      diagnostics: derived.diagnostics,
      offsetPublications,
    };
  }

  /** T10g-1: the same contract function as the real adapter (mock parity). */
  async querySketchEditIntersections(
    request: QuerySketchEditIntersectionsRequest,
  ): Promise<QuerySketchEditIntersectionsResponse> {
    assertSupportedRequest(request, this.options);
    assertDocumentModelingTolerance(request.modelingTolerance);
    return {
      ...makeResponseBase(request),
      result: await querySketchEditIntersections(
        request,
        this.options.neutralCurveQueries,
      ),
    };
  }

  async resolveSketchReference(
    request: ResolveSketchReferenceRequest,
  ): Promise<ResolveSketchReferenceResponse> {
    assertSupportedRequest(request, this.options);
    const base = makeResponseBase(request);

    if ("referenceId" in request.target && "geometryId" in request.target) {
      const target: ProjectedSketchGeometryRef = request.target;
      const projectedGeometryExists = request.definition.references.some(
        (reference) => reference.referenceId === target.referenceId,
      );

      return {
        ...base,
        resolution: {
          target,
          label: `Projected geometry ${target.geometryId}`,
          isValid: projectedGeometryExists,
          invalidationReason: projectedGeometryExists
            ? null
            : "missingProjectedGeometry",
        },
        diagnostics: [],
      };
    }

    switch (request.target.kind) {
      case "sketch":
        return {
          ...base,
          resolution: {
            target: request.target,
            label:
              request.target.sketchId === request.sketchId
                ? "Solved sketch"
                : "Unknown sketch",
            isValid: request.target.sketchId === request.sketchId,
            invalidationReason:
              request.target.sketchId === request.sketchId
                ? null
                : "missingSketch",
          },
          diagnostics: [],
        };
      case "sketchEntity": {
        const target = request.target;
        const entity = request.definition.entities.find(
          (record) => record.entityId === target.entityId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: entity?.label ?? "Unknown sketch entity",
            isValid: Boolean(entity),
            invalidationReason: entity ? null : "missingEntity",
          },
          diagnostics: [],
        };
      }
      case "sketchPoint": {
        const target = request.target;
        const point = request.definition.points.find(
          (record) => record.pointId === target.pointId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: point?.label ?? "Unknown sketch point",
            isValid: Boolean(point),
            invalidationReason: point ? null : "missingPoint",
          },
          diagnostics: [],
        };
      }
      case "region": {
        const target = request.target;
        const region = request.regions.find(
          (record) => record.regionId === target.regionId,
        );
        return {
          ...base,
          resolution: {
            target,
            label: region?.label ?? "Unknown sketch region",
            isValid: Boolean(region),
            invalidationReason: region ? null : "missingRegion",
          },
          diagnostics: [],
        };
      }
      default: {
        const exhaustive: never = request.target;
        return exhaustive;
      }
    }
  }
}
