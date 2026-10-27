import type { SketchSessionState } from "./types";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getSessionSketchId,
  rebuildSessionCommitRequest,
  getTargetKey,
} from "./tool-authoring";
import { withLiveSolveBasis } from "./session-live-solve";
import type { ReferenceId } from "@/contracts/shared/ids";
import type {
  SketchReferenceDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import { buildReferenceTargetPresentation } from "./edit-tool-activation";

export function toggleSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    !session.constructionTargetPicking ||
    (target.kind !== "sketchEntity" && target.kind !== "sketchPoint") ||
    target.sketchId !== getSessionSketchId(session)
  ) {
    return session;
  }

  return setSketchConstructionTarget(session, target);
}

/** Shared explicit construction edit; omitting the value is the browser toggle. */
export function setSketchConstructionTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
  construction?: boolean,
): SketchSessionState {
  if ((target.kind !== "sketchEntity" && target.kind !== "sketchPoint") || target.sketchId !== getSessionSketchId(session)) return session;
  const selected = target.kind === "sketchEntity"
    ? session.definition.entities.find(e => e.entityId === target.entityId)
    : session.definition.points.find(p => p.pointId === target.pointId);
  if (!selected) return session;
  if (selected.isConstruction === construction) return { ...session, validationMessage: null };
  const nextFullDefinition = toggleConstructionTargetInDefinition(
    session.definition,
    target,
  );

  if (nextFullDefinition === session.definition) {
    return session;
  }

  const definition = nextFullDefinition;

  return withLiveSolveBasis(
    {
      ...session,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      definition,
      toolStagedEntities: [],
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

function createReferenceId(
  sequence: number,
  target: PrimitiveRef,
): ReferenceId {
  return `ref_${sequence}_${getTargetKey(target).replaceAll(/[^a-zA-Z0-9_-]/g, "-")}_${crypto.randomUUID()}` as ReferenceId;
}

function sourceMatchesTarget(
  reference: SketchReferenceDefinition,
  target: PrimitiveRef,
) {
  if (reference.kind === "modelReference") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  if (reference.kind === "sketchReference") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  if (reference.kind === "constructionPlane") {
    return getTargetKey(reference.source) === getTargetKey(target);
  }

  return false;
}

function createReferenceDefinition(
  sequence: number,
  target: PrimitiveRef,
): SketchReferenceDefinition | { kind: "unsupported"; message: string } {
  switch (target.kind) {
    case "face":
    case "edge":
    case "vertex":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "modelReference",
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode:
          target.kind === "face"
            ? "useExistingCoplanarGeometry"
            : "projectAlongPlaneNormal",
      };
    case "sketch":
    case "sketchEntity":
    case "sketchPoint":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "sketchReference",
        label: `Reference ${target.kind}`,
        source: target,
        projectionMode: "useExistingCoplanarGeometry",
      };
    case "construction":
      return {
        referenceId: createReferenceId(sequence, target),
        kind: "constructionPlane",
        label: "Reference construction plane",
        source: target,
        projectionMode: "coplanar",
      };
    default:
      return {
        kind: "unsupported",
        message: `${target.kind} cannot be referenced from a sketch.`,
      };
  }
}

function appendReferenceDefinition(
  definition: SketchDefinition,
  reference: SketchReferenceDefinition,
): SketchDefinition {
  return {
    ...definition,
    referenceIds: [...definition.referenceIds, reference.referenceId],
    references: [...definition.references, reference],
  };
}

export function selectSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  return session.referenceTargetPicking ? authorSketchReference(session, target) : session;
}

/** Explicit reference authoring shared with browser target selection. */
export function authorSketchReference(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    (target.kind === "sketch" ||
      target.kind === "sketchEntity" ||
      target.kind === "sketchPoint") &&
    (target.sketchId === getSessionSketchId(session) || target.sketchId === session.actionContextId)
  ) {
    const message =
      "Reference geometry must come from model topology or another existing sketch.";
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(message),
    };
  }

  if (
    session.definition.references.some((reference) =>
      sourceMatchesTarget(reference, target),
    )
  ) {
    const message = "That reference is already authored in this sketch.";
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(message),
    };
  }

  const nextSequence = session.sequence + 1;
  const reference = createReferenceDefinition(nextSequence, target);

  if (reference.kind === "unsupported") {
    return {
      ...session,
      toolPresentation: buildReferenceTargetPresentation(reference.message),
    };
  }

  const definition = appendReferenceDefinition(session.definition, reference);

  return withLiveSolveBasis(
    {
      ...session,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      constructionModifierActive: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeAnnotationEdit: null,
      activeEditTarget: null,
      activeDrag: null,
      sequence: nextSequence,
      definition,
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

export function deleteSketchReferenceTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  if (
    target.kind !== "projectedReferenceGeometry" &&
    target.kind !== "sketchExternalReference"
  ) {
    return session;
  }

  const removeFromDefinition = (
    definition: SketchDefinition,
  ): SketchDefinition => ({
    ...definition,
    referenceIds: definition.referenceIds.filter(
      (referenceId) => referenceId !== target.referenceId,
    ),
    references: definition.references.filter(
      (reference) => reference.referenceId !== target.referenceId,
    ),
  });
  const fullDefinition = removeFromDefinition(session.definition);

  if (fullDefinition === session.definition) {
    return session;
  }

  const definition = removeFromDefinition(session.definition);

  return withLiveSolveBasis(
    {
      ...session,
      definition,
      projectedReferences: session.projectedReferences.filter(
        (reference) => reference.referenceId !== target.referenceId,
      ),
      projectionDiagnostics: session.projectionDiagnostics,
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
  );
}

function toggleConstructionTargetInDefinition(
  definition: SketchDefinition,
  target: PrimitiveRef,
): SketchDefinition {
  if (target.kind === "sketchEntity") {
    const selectedEntity = definition.entities.find(
      (entity) => entity.entityId === target.entityId,
    );

    if (!selectedEntity) {
      return definition;
    }

    const isConstruction = !selectedEntity.isConstruction;
    const points =
      selectedEntity.kind === "point"
        ? definition.points.map((point) =>
            point.pointId === selectedEntity.pointId
              ? { ...point, isConstruction }
              : point,
          )
        : definition.points;

    return {
      ...definition,
      points,
      entities: definition.entities.map((entity) =>
        entity.entityId === target.entityId
          ? { ...entity, isConstruction }
          : entity,
      ),
    };
  }

  if (target.kind !== "sketchPoint") {
    return definition;
  }

  const selectedPoint = definition.points.find(
    (point) => point.pointId === target.pointId,
  );

  if (!selectedPoint) {
    return definition;
  }

  const isConstruction = !selectedPoint.isConstruction;

  return {
    ...definition,
    points: definition.points.map((point) =>
      point.pointId === target.pointId ? { ...point, isConstruction } : point,
    ),
    entities: definition.entities.map((entity) =>
      entity.kind === "point" && entity.pointId === target.pointId
        ? { ...entity, isConstruction }
        : entity,
    ),
  };
}
