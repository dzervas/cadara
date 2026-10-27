import type {
  SketchId,
  SketchPointId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchPointDefinition,
  SketchEntityDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  createSketchPointRef,
  createSketchEntityRef,
  cloneDefinition,
  mergeDerivedProjectedReferences,
} from "./session-definition";
import type { SketchToolCommitContribution } from "@/core/sketch-tools/definition";
import type { SketchSessionState } from "./types";
import { reconcileSketchToolDraft } from "./tool-placement";
import { withLiveSolveBasis } from "./session-live-solve";
import { rebuildSessionCommitRequest } from "./tool-authoring";
import { getSketchSessionInvalidFeedback } from "./session-feedback";

export function createPointDefinition(
  sketchId: SketchId,
  pointId: SketchPointId,
  label: string,
  position: SketchPoint,
  isConstruction = false,
): SketchPointDefinition {
  return {
    pointId,
    label,
    target: createSketchPointRef(sketchId, pointId),
    position,
    isConstruction,
  };
}

export function createLineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "lineSegment",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    startPointId,
    endPointId,
  };
}

export function createPointEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  pointId: SketchPointId,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "point",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    pointId,
  };
}

export function createCircleEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  radius: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "circle",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    radius,
  };
}

export function createArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  sweepDirection: "clockwise" | "counterClockwise",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "arc",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    startPointId,
    endPointId,
    sweepDirection,
  };
}

export function createSplineEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  pointIds: readonly SketchPointId[],
  isConstruction = false,
): SketchEntityDefinition {
  const pointOccurrences = pointIds.map((pointId) => ({
    occurrenceId: `spline_occurrence_${crypto.randomUUID()}`,
    pointId,
    tangent: { kind: "automatic" } as const,
  }));
  return {
    kind: "spline",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    pointOccurrenceIds: pointOccurrences.map(
      (occurrence) => occurrence.occurrenceId,
    ),
    pointOccurrences,
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  };
}

export function createEllipseEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  minorRadius: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "ellipse",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    minorRadius,
  };
}

export function createEllipticalArcEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  centerPointId: SketchPointId,
  majorAxisPointId: SketchPointId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
  minorRadius: number,
  sweepDirection: "clockwise" | "counterClockwise",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "ellipticalArc",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    centerPointId,
    majorAxisPointId,
    startPointId,
    endPointId,
    minorRadius,
    sweepDirection,
  };
}

export function createConicEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  startPointId: SketchPointId,
  controlPointId: SketchPointId,
  endPointId: SketchPointId,
  rho: number,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "conic",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    startPointId,
    controlPointId,
    endPointId,
    rho,
  };
}

export function createBezierCurveEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  controlPointIds: readonly SketchPointId[],
  degree: 2 | 3,
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "bezierCurve",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    controlPointIds,
    degree,
  };
}

export function createProfileTextEntityDefinition(
  sketchId: SketchId,
  entityId: SketchEntityId,
  label: string,
  anchorPointId: SketchPointId,
  text: string,
  height: number,
  rotationRadians: number,
  horizontalAlign: "left" | "center" | "right",
  verticalAlign: "baseline" | "middle" | "top" | "bottom",
  isConstruction = false,
): SketchEntityDefinition {
  return {
    kind: "profileText",
    entityId,
    label,
    target: createSketchEntityRef(sketchId, entityId),
    isConstruction,
    anchorPointId,
    text,
    height,
    rotationRadians,
    horizontalAlign,
    verticalAlign,
  };
}

export function appendDefinition(
  definition: SketchDefinition,
  patch: SketchToolCommitContribution,
): SketchDefinition {
  return {
    ...definition,
    schemaVersion: definition.schemaVersion,
    referenceIds: [...definition.referenceIds],
    references: [...definition.references],
    pointIds: [
      ...definition.pointIds,
      ...patch.points.map((point) => point.pointId),
    ],
    points: [...definition.points, ...patch.points],
    entityIds: [
      ...definition.entityIds,
      ...patch.entities.map((entity) => entity.entityId),
    ],
    entities: [...definition.entities, ...patch.entities],
    constraintIds: [
      ...definition.constraintIds,
      ...(patch.constraints ?? []).map((constraint) => constraint.constraintId),
    ],
    constraints: [...definition.constraints, ...(patch.constraints ?? [])],
    dimensionIds: [
      ...definition.dimensionIds,
      ...(patch.dimensions ?? []).map((dimension) => dimension.dimensionId),
    ],
    dimensions: [...definition.dimensions, ...(patch.dimensions ?? [])],
    styleIds: definition.styleIds ? [...definition.styleIds] : undefined,
    styles: definition.styles ? [...definition.styles] : undefined,
    svgRenderingEnabled: definition.svgRenderingEnabled ?? false,
    derivedRelationships: [
      ...(definition.derivedRelationships ?? []),
      ...(patch.derivedRelationships ?? []),
    ],
  };
}

export function applySketchContribution(
  session: SketchSessionState,
  patch: SketchToolCommitContribution,
) {
  return { definition: appendDefinition(session.definition, patch) };
}

export function rebuildSessionForDefinition(
  session: SketchSessionState,
  input: { definition: SketchDefinition },
): SketchSessionState {
  const definition = cloneDefinition(input.definition);
  const rebuilt = reconcileSketchToolDraft(
    withLiveSolveBasis(
      {
        ...session,
        definition,
        projectedReferences: mergeDerivedProjectedReferences(
          definition,
          session.projectedReferences,
        ),
        toolStagedEntities: [],
        activeAnnotationEdit: null,
        activeEditTarget: null,
        activeDrag: null,
        commitRequest: rebuildSessionCommitRequest(session, definition),
      },
      definition,
    ),
  );
  return {
    ...rebuilt,
    validationMessage:
      rebuilt.liveRegions.status === "unavailable"
        ? (getSketchSessionInvalidFeedback(rebuilt) ??
          "Sketch profiles are unavailable until the sketch is corrected.")
        : null,
  };
}
