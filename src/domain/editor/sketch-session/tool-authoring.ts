import type { SketchSessionState, SketchAuthoringToolId } from "./types";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { evaluateAuthoredSketchDerivations } from "@/domain/modeling/sketch-dimension-expressions";
import {
  getSketchSessionDerivationSettings,
  createPointId,
  createEntityId,
  createConstraintId,
  createDimensionId,
} from "./session-definition";
import { buildCommitRequest } from "./history";
import {
  createLiteralAuthoredValue,
  createExpressionAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchDraftEntity,
  SketchToolId,
} from "@/core/sketch-tools/definition";
import { isRegisteredSketchConstraintToolId } from "@/core/sketch-constraints/registry";
import { isRegisteredSketchEditToolId } from "@/core/sketch-edit-tools/registry";
import type {
  SketchId,
  SketchPointId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import type { SketchPoint } from "@/contracts/modeling/schema";
import {
  createPointDefinition,
  createLineEntityDefinition,
  createPointEntityDefinition,
  createCircleEntityDefinition,
  createArcEntityDefinition,
  createSplineEntityDefinition,
  createEllipseEntityDefinition,
  createEllipticalArcEntityDefinition,
  createConicEntityDefinition,
  createBezierCurveEntityDefinition,
  createProfileTextEntityDefinition,
} from "./definition-authoring";

export function rebuildSessionCommitRequest(
  session: SketchSessionState,
  definition: SketchDefinition,
) {
  // Committed geometry is current; the authored relationship records are
  // persisted, so expression distances survive the round-trip.
  const evaluatedDefinition = evaluateAuthoredSketchDerivations({
    definition,
    ...getSketchSessionDerivationSettings(session),
  }).definition;
  return buildCommitRequest({
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: session.plane,
    definition: evaluatedDefinition,
  });
}

export function normalizeConstraintValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : createLiteralAuthoredValue(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue)
    ? createLiteralAuthoredValue(numericValue)
    : createExpressionAuthoredValue(trimmed);
}

/**
 * T13b (D3, D29): an edit operation parameter (Offset distance, Fillet
 * radius, Chamfer distance, Slot width, pattern and transform values) from a
 * tool patch value. A number is kept (NaN clears it); a string is trimmed and
 * read with a finite `Number(...)`. Empty clears the value. Operation
 * parameters are plain numbers (no expressions), so any other string clears
 * it with a message naming `field`.
 */
export function parseOperationParameter(
  value: unknown,
  field: string,
): { readonly value: number | null; readonly message: string | null } {
  if (typeof value === "number")
    return { value: Number.isNaN(value) ? null : value, message: null };
  if (typeof value !== "string") return { value: null, message: null };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { value: null, message: null };
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue)
    ? { value: numericValue, message: null }
    : { value: null, message: `Enter a number for the ${field}.` };
}

export function getTargetKey(target: PrimitiveRef) {
  switch (target.kind) {
    case "sketchPoint":
      return target.pointId;
    case "sketchEntity":
      return target.entityId;
    case "constraint":
      return target.constraintId;
    case "dimension":
      return target.dimensionId;
    case "sketch":
      return target.sketchId;
    case "sketchOperation":
      return target.operationId;
    case "body":
      return target.bodyId;
    case "face":
      return `${target.bodyId}:${target.faceId}`;
    case "edge":
      return `${target.bodyId}:${target.edgeId}`;
    case "vertex":
      return `${target.bodyId}:${target.vertexId}`;
    case "loop":
      return `${target.bodyId}:${target.loopId}`;
    case "feature":
      return target.featureId;
    case "construction":
      return target.constructionId;
    case "region":
      return `${target.sketchId}:${target.regionId}`;
    case "projectedReferenceGeometry":
      return `${target.referenceId}:${target.geometryId}`;
    case "sketchDatumReference":
      return `${target.sketchId}:${target.datumId}`;
    case "sketchExternalReference":
      return target.referenceId;
    case "sketchTangentHandle":
      return `${target.entityId}:${target.occurrenceId}`;
  }
}

export function withConstructionFlag(
  entities: readonly SketchDraftEntity[],
  isConstruction: boolean,
): readonly SketchDraftEntity[] {
  return isConstruction
    ? entities.map((entity) => ({ ...entity, isConstruction: true }))
    : entities;
}

export function isDrawingSketchTool(
  toolId: SketchAuthoringToolId | null,
): toolId is SketchToolId {
  return (
    toolId !== null &&
    !isRegisteredSketchConstraintToolId(toolId) &&
    !isRegisteredSketchEditToolId(toolId) &&
    toolId !== "construction" &&
    toolId !== "projectReference"
  );
}

export function createSessionCommitFactories(
  sequence: number,
  sketchId: SketchId,
  construction = false,
) {
  return {
    createPointId: (suffix: string) => createPointId(sequence, suffix),
    createEntityId: (suffix: string) => createEntityId(sequence, suffix),
    createConstraintId: (suffix: string) =>
      createConstraintId(sequence, suffix),
    createDimensionId: (suffix: string) => createDimensionId(sequence, suffix),
    createPoint: (
      label: string,
      pointId: SketchPointId,
      position: SketchPoint,
    ) => createPointDefinition(sketchId, pointId, label, position, construction),
    createLineEntity: (
      label: string,
      entityId: SketchEntityId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
    ) =>
      createLineEntityDefinition(
        sketchId,
        entityId,
        label,
        startPointId,
        endPointId,
        construction,
      ),
    createPointEntity: (
      label: string,
      entityId: SketchEntityId,
      pointId: SketchPointId,
    ) => createPointEntityDefinition(sketchId, entityId, label, pointId, construction),
    createCircleEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      radius: number,
    ) =>
      createCircleEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        radius,
        construction,
      ),
    createArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      sweepDirection: "clockwise" | "counterClockwise",
    ) =>
      createArcEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        startPointId,
        endPointId,
        sweepDirection,
        construction,
      ),
    createSplineEntity: (
      label: string,
      entityId: SketchEntityId,
      pointIds: readonly SketchPointId[],
    ) =>
      createSplineEntityDefinition(sketchId, entityId, label, pointIds, construction),
    createEllipseEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      majorAxisPointId: SketchPointId,
      minorRadius: number,
    ) =>
      createEllipseEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        majorAxisPointId,
        minorRadius,
        construction,
      ),
    createEllipticalArcEntity: (
      label: string,
      entityId: SketchEntityId,
      centerPointId: SketchPointId,
      majorAxisPointId: SketchPointId,
      startPointId: SketchPointId,
      endPointId: SketchPointId,
      minorRadius: number,
      sweepDirection: "clockwise" | "counterClockwise",
    ) =>
      createEllipticalArcEntityDefinition(
        sketchId,
        entityId,
        label,
        centerPointId,
        majorAxisPointId,
        startPointId,
        endPointId,
        minorRadius,
        sweepDirection,
        construction,
      ),
    createConicEntity: (
      label: string,
      entityId: SketchEntityId,
      startPointId: SketchPointId,
      controlPointId: SketchPointId,
      endPointId: SketchPointId,
      rho: number,
    ) =>
      createConicEntityDefinition(
        sketchId,
        entityId,
        label,
        startPointId,
        controlPointId,
        endPointId,
        rho,
        construction,
      ),
    createBezierCurveEntity: (
      label: string,
      entityId: SketchEntityId,
      controlPointIds: readonly SketchPointId[],
      degree: 2 | 3,
    ) =>
      createBezierCurveEntityDefinition(
        sketchId,
        entityId,
        label,
        controlPointIds,
        degree,
        construction,
      ),
    createProfileTextEntity: (
      label: string,
      entityId: SketchEntityId,
      anchorPointId: SketchPointId,
      text: string,
      height: number,
      rotationRadians: number,
      horizontalAlign: "left" | "center" | "right",
      verticalAlign: "baseline" | "middle" | "top" | "bottom",
    ) =>
      createProfileTextEntityDefinition(
        sketchId,
        entityId,
        label,
        anchorPointId,
        text,
        height,
        rotationRadians,
        horizontalAlign,
        verticalAlign,
        construction,
      ),
  };
}

export function getSessionSketchId(session: SketchSessionState): SketchId {
  return session.sketchId ?? ("sketch_draft" as SketchId);
}
