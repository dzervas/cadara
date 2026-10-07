import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  ConstraintId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  ProjectedSketchGeometryConstraintOperand,
  ProjectedSketchGeometryRef,
  ReadOnlySketchCurveConstraintOperand,
  ReadOnlySketchPointConstraintOperand,
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type {
  SketchPlacementRole,
  SketchToolCommitContribution,
  SketchToolDrawContribution,
  SketchToolId,
} from "@/core/sketch-tools/definition";
import {
  collectSketchSnapGeometries,
  resolveSketchSnap,
  type SketchSnapCandidate,
  type SketchSnapSourceRef,
} from "@/domain/sketch-snapping/snap-candidates";

/**
 * T13-D15: the one owner of placement inference. For one click of a drawing
 * tool it decides where the click places its point and which relations the
 * commit will author for it; the preview shows exactly these, and the commit
 * binds exactly these (`bindPlacementInferences`), re-deriving nothing.
 */

/**
 * One relation a placement will author. `subject` names the placement's
 * role symbolically: its own `point`, the tool's new `line` (Line only) or
 * the new `circle`/arc whose centre the placement is. Targets are durable
 * ids or read-only operands. `joins` (Line only) reuses the target point id
 * instead of authoring a constraint.
 */
export type InferredRequirement = {
  /** Constraint id suffix and label stem the binding authors with. */
  idSuffix: string;
  labelStem: string;
  /** What the preview says about this requirement. */
  text: string;
} & (
  | { subject: "point"; kind: "joins"; pointId: SketchPointId }
  | { subject: "point"; kind: "coincident"; pointId: SketchPointId }
  | {
      subject: "point";
      kind: "coincidentProjectedPoint";
      target: ReadOnlySketchPointConstraintOperand;
    }
  | { subject: "point"; kind: "midpoint"; entityId: SketchEntityId }
  | {
      subject: "point";
      kind: "midpointProjectedLine";
      target: ReadOnlySketchCurveConstraintOperand;
    }
  | { subject: "point"; kind: "pointOnCurve"; entityId: SketchEntityId }
  | {
      subject: "point";
      kind: "pointOnProjectedCurve";
      target: ReadOnlySketchCurveConstraintOperand;
    }
  | { subject: "circle"; kind: "concentric"; entityId: SketchEntityId }
  | {
      subject: "circle";
      kind: "concentricProjectedCurve";
      target: ProjectedSketchGeometryConstraintOperand;
    }
  | { subject: "line"; kind: "horizontal" | "vertical" }
  | { subject: "line"; kind: "perpendicular"; entityId: SketchEntityId }
  | {
      subject: "line";
      kind: "perpendicularProjectedLine";
      target: ReadOnlySketchCurveConstraintOperand;
    }
  | { subject: "line"; kind: "tangent"; entityId: SketchEntityId }
  | {
      subject: "line";
      kind: "tangentProjectedCurve";
      target: ProjectedSketchGeometryConstraintOperand;
    }
);

export interface PlacementInference {
  /** The pointer the inference was computed at (Undo reconcile, D21). */
  rawPosition: SketchPoint;
  /** Where the click places its point: the candidate's point, else raw. */
  position: SketchPoint;
  candidate: SketchSnapCandidate | null;
  /** Inference suppressed for this placement (set by T13h; false here). */
  suppressed: boolean;
  role: SketchPlacementRole;
  requirements: readonly InferredRequirement[];
  /** The preview text: names every requirement; empty without a candidate. */
  text: string;
  /** The screen scale the snap resolved at (Undo reconcile, D21). */
  sketchUnitsPerPixel: number | null;
}

/** What the owner knows about the click being placed. */
export interface PlacementInferenceContext {
  toolId: SketchToolId;
  role: SketchPlacementRole;
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  /**
   * Line end only: the line's start point when it is an existing point (a
   * chain anchor or a joined start), for D18.
   */
  lineStartPointId?: SketchPointId | null;
}

export const SNAP_POSITION_ONLY_TEXT = "Snap position only — no relation";

/**
 * The inference of one placement at `pointer`: resolves the snap (D13/D14;
 * alignment, perpendicular foot and tangent only for Line, D17) and derives
 * the requirements its commit will author.
 */
export function inferPlacement(
  input: PlacementInferenceContext & {
    pointer: SketchPoint;
    solvedSnapshot: SolvedSketchSnapshot | null;
    sketchUnitsPerPixel: number | null;
    /** The draft start a Line end aligns to (ignored for other tools). */
    anchor: SketchPoint | null;
    /** The previous candidate, kept up to its exit radius (hysteresis). */
    activeCandidateKey: string | null;
  },
): PlacementInference {
  const snap = resolveSketchSnap({
    pointer: input.pointer,
    geometries: collectSketchSnapGeometries({
      definition: input.definition,
      projectedReferences: input.projectedReferences ?? [],
      solvedSnapshot: input.solvedSnapshot,
    }),
    sketchUnitsPerPixel: input.sketchUnitsPerPixel,
    activeAnchor: input.toolId === "line" ? input.anchor : null,
    activeCandidateKey: input.activeCandidateKey,
  });

  return inferPlacementFromCandidate(input, {
    candidate: snap.activeCandidate,
    rawPosition: input.pointer,
    sketchUnitsPerPixel: input.sketchUnitsPerPixel,
  });
}

/** The inference of a placement whose snap candidate is already known. */
export function inferPlacementFromCandidate(
  context: PlacementInferenceContext,
  input: {
    candidate: SketchSnapCandidate | null;
    rawPosition: SketchPoint;
    sketchUnitsPerPixel: number | null;
  },
): PlacementInference {
  const { candidate } = input;
  const derived = candidate
    ? deriveRequirements(context, candidate)
    : { requirements: [], emptyText: "" };

  return {
    rawPosition: input.rawPosition,
    position: candidate?.point ?? input.rawPosition,
    candidate,
    suppressed: false,
    role: context.role,
    requirements: derived.requirements,
    text:
      derived.requirements.length > 0
        ? derived.requirements.map((requirement) => requirement.text).join(", ")
        : derived.emptyText,
    sketchUnitsPerPixel: input.sketchUnitsPerPixel,
  };
}

/**
 * The tangent source a Tangent arc records at its first click (R-7): the
 * first local line, circle or arc the click's candidate is on.
 */
export function getStructuralTangentSourceEntityId(
  candidate: SketchSnapCandidate | null,
): SketchEntityId | null {
  const source = candidate?.sources.find(
    (entry) =>
      entry.kind === "localEntity" &&
      (entry.geometryKind === "lineSegment" ||
        entry.geometryKind === "circle" ||
        entry.geometryKind === "arc"),
  );

  return source?.kind === "localEntity" ? source.entityId : null;
}

type RequirementDraft = InferredRequirement;

function deriveRequirements(
  context: PlacementInferenceContext,
  candidate: SketchSnapCandidate,
): { requirements: RequirementDraft[]; emptyText: string } {
  const requirements: RequirementDraft[] = [];
  let emptyText = SNAP_POSITION_ONLY_TEXT;

  // A shape click only sizes the primitive: its position may snap, it
  // authors nothing (D16).
  if (context.role === "shape") {
    return { requirements, emptyText };
  }

  const { definition } = context;
  const isLine = context.toolId === "line";
  const labels = createLabels(definition);

  candidate.sources.forEach((source, index) => {
    if (source.kind === "transientAnchor") {
      return;
    }

    switch (candidate.kind) {
      case "endpoint": {
        const pointId =
          source.kind === "localPoint"
            ? source.pointId
            : source.kind === "localEntity"
              ? getEntityEndpointAtPoint(
                  definition,
                  source.entityId,
                  candidate.point,
                )
              : null;

        if (pointId && isLine) {
          // D18: never join two points already declared coincident.
          if (
            context.lineStartPointId &&
            context.lineStartPointId !== pointId &&
            sameCoincidentClass(definition, context.lineStartPointId, pointId)
          ) {
            emptyText = `Snap position only — ${labels.point(pointId)} is already coincident with the line start`;
            return;
          }
          requirements.push({
            subject: "point",
            kind: "joins",
            pointId,
            idSuffix: `joins-${index}`,
            labelStem: "Joins",
            text: `Joins ${labels.point(pointId)}`,
          });
          return;
        }

        if (pointId) {
          requirements.push({
            subject: "point",
            kind: "coincident",
            pointId,
            idSuffix:
              source.kind === "localPoint"
                ? `inferred-coincident-${index}`
                : `inferred-coincident-endpoint-${index}`,
            labelStem: "Inferred coincident",
            text: `Coincident · ${labels.point(pointId)}`,
          });
          return;
        }

        if (
          (source.kind === "projectedGeometry" &&
            source.geometryKind === "point") ||
          (source.kind === "sketchDatum" && source.datumId === "origin")
        ) {
          const target = pointReadOnlyOperandFromSource(source);
          requirements.push({
            subject: "point",
            kind: "coincidentProjectedPoint",
            target,
            idSuffix:
              source.kind === "sketchDatum"
                ? `inferred-coincident-datum-${index}`
                : `inferred-coincident-projected-${index}`,
            labelStem:
              source.kind === "sketchDatum"
                ? "Inferred coincident sketch datum"
                : "Inferred coincident projected point",
            text: `Coincident · ${labels.readOnly(target)}`,
          });
        }
        return;
      }

      case "center": {
        if (
          source.kind === "localEntity" &&
          (source.geometryKind === "circle" || source.geometryKind === "arc")
        ) {
          if (context.role === "center") {
            requirements.push({
              subject: "circle",
              kind: "concentric",
              entityId: source.entityId,
              idSuffix: `inferred-concentric-${index}`,
              labelStem: "Inferred concentric",
              text: `Concentric with ${labels.entity(source.entityId)}`,
            });
            return;
          }

          const centerPointId = getEntityCenterPointId(
            definition,
            source.entityId,
          );
          if (centerPointId) {
            requirements.push({
              subject: "point",
              kind: "coincident",
              pointId: centerPointId,
              idSuffix: `inferred-coincident-center-${index}`,
              labelStem: "Inferred center coincident",
              text: `Coincident with ${labels.entity(source.entityId)} centre`,
            });
          }
          return;
        }

        if (
          source.kind === "projectedGeometry" &&
          (source.geometryKind === "circle" || source.geometryKind === "arc") &&
          context.role === "center"
        ) {
          const target = projectedOperandFromSource(source);
          requirements.push({
            subject: "circle",
            kind: "concentricProjectedCurve",
            target,
            idSuffix: `inferred-concentric-projected-${index}`,
            labelStem: "Inferred concentric projected curve",
            text: `Concentric with ${labels.readOnly(target)}`,
          });
        }
        return;
      }

      case "midpoint": {
        if (
          source.kind === "localEntity" &&
          source.geometryKind === "lineSegment"
        ) {
          requirements.push({
            subject: "point",
            kind: "midpoint",
            entityId: source.entityId,
            idSuffix: `inferred-midpoint-${index}`,
            labelStem: "Inferred midpoint",
            text: `Midpoint of ${labels.entity(source.entityId)}`,
          });
          return;
        }

        // Datum axes give no midpoint candidates (unbounded lines, T13f).
        if (
          source.kind === "projectedGeometry" &&
          source.geometryKind === "lineSegment"
        ) {
          const target = projectedOperandFromSource(source);
          requirements.push({
            subject: "point",
            kind: "midpointProjectedLine",
            target,
            idSuffix: `inferred-midpoint-projected-${index}`,
            labelStem: "Inferred projected midpoint",
            text: `Midpoint of ${labels.readOnly(target)}`,
          });
        }
        return;
      }

      case "nearestOnLine":
      case "nearestOnCircle":
      case "nearestOnArc":
      case "nearestOnSpline":
      case "intersection": {
        const requirement = pointOnSourceRequirement(
          context,
          labels,
          source,
          index,
        );
        if (requirement) requirements.push(requirement);
        return;
      }

      case "horizontalAlignment":
      case "verticalAlignment":
        return;

      case "perpendicularFoot": {
        if (
          !isLine ||
          source.kind === "localPoint" ||
          source.geometryKind !== "lineSegment"
        ) {
          return;
        }
        if (source.kind === "localEntity") {
          requirements.push(
            {
              subject: "line",
              kind: "perpendicular",
              entityId: source.entityId,
              idSuffix: `inferred-perpendicular-${index}`,
              labelStem: "Inferred perpendicular",
              text: `Perpendicular to ${labels.entity(source.entityId)}`,
            },
            {
              subject: "point",
              kind: "pointOnCurve",
              entityId: source.entityId,
              idSuffix: `inferred-foot-on-line-${index}`,
              labelStem: "Inferred perpendicular foot",
              text: `On ${labels.entity(source.entityId)}`,
            },
          );
          return;
        }
        if (
          source.kind === "projectedGeometry" ||
          source.kind === "sketchDatum"
        ) {
          const target = curveReadOnlyOperandFromSource(source);
          const via = source.kind === "sketchDatum" ? "datum" : "projected";
          requirements.push(
            {
              subject: "line",
              kind: "perpendicularProjectedLine",
              target,
              idSuffix: `inferred-perpendicular-${via}-${index}`,
              labelStem:
                via === "datum"
                  ? "Inferred perpendicular sketch datum"
                  : "Inferred perpendicular projected line",
              text: `Perpendicular to ${labels.readOnly(target)}`,
            },
            {
              subject: "point",
              kind: "pointOnProjectedCurve",
              target,
              idSuffix: `inferred-foot-on-${via}-${index}`,
              labelStem:
                via === "datum"
                  ? "Inferred perpendicular foot sketch datum"
                  : "Inferred perpendicular foot projected",
              text: `On ${labels.readOnly(target)}`,
            },
          );
        }
        return;
      }

      case "tangent": {
        if (
          !isLine ||
          source.kind === "localPoint" ||
          (source.geometryKind !== "circle" && source.geometryKind !== "arc")
        ) {
          return;
        }
        if (source.kind === "localEntity") {
          requirements.push(
            {
              subject: "line",
              kind: "tangent",
              entityId: source.entityId,
              idSuffix: `inferred-tangent-${index}`,
              labelStem: "Inferred tangent",
              text: `Tangent to ${labels.entity(source.entityId)}`,
            },
            {
              subject: "point",
              kind: "pointOnCurve",
              entityId: source.entityId,
              idSuffix: `inferred-tangent-point-on-${index}`,
              labelStem: "Inferred tangent point",
              text: `On ${labels.entity(source.entityId)}`,
            },
          );
          return;
        }
        if (source.kind === "projectedGeometry") {
          const target = projectedOperandFromSource(source);
          requirements.push(
            {
              subject: "line",
              kind: "tangentProjectedCurve",
              target,
              idSuffix: `inferred-tangent-projected-${index}`,
              labelStem: "Inferred tangent projected curve",
              text: `Tangent to ${labels.readOnly(target)}`,
            },
            {
              subject: "point",
              kind: "pointOnProjectedCurve",
              target,
              idSuffix: `inferred-tangent-point-projected-${index}`,
              labelStem: "Inferred tangent point projected",
              text: `On ${labels.readOnly(target)}`,
            },
          );
        }
        return;
      }
    }
  });

  // Alignment has no geometry source: it constrains the new line (D17).
  if (isLine && candidate.kind === "horizontalAlignment") {
    requirements.push({
      subject: "line",
      kind: "horizontal",
      idSuffix: "inferred-horizontal",
      labelStem: "Inferred horizontal",
      text: "Horizontal",
    });
  }
  if (isLine && candidate.kind === "verticalAlignment") {
    requirements.push({
      subject: "line",
      kind: "vertical",
      idSuffix: "inferred-vertical",
      labelStem: "Inferred vertical",
      text: "Vertical",
    });
  }

  return { requirements, emptyText };
}

function pointOnSourceRequirement(
  context: PlacementInferenceContext,
  labels: ReturnType<typeof createLabels>,
  source: Exclude<SketchSnapSourceRef, { kind: "transientAnchor" }>,
  index: number,
): RequirementDraft | null {
  if (source.kind === "localEntity" && source.geometryKind !== "point") {
    return {
      subject: "point",
      kind: "pointOnCurve",
      entityId: source.entityId,
      idSuffix: `inferred-point-on-${index}`,
      labelStem: "Inferred point on curve",
      text: `On ${labels.entity(source.entityId)}`,
    };
  }

  if (
    source.kind === "projectedGeometry" &&
    source.geometryKind !== "point" &&
    // Sampled projected splines are display-only: the solver refuses an
    // exact constraint on them.
    !isSampledProjectedSpline(context.projectedReferences ?? [], source)
  ) {
    const target = projectedOperandFromSource(source);
    return {
      subject: "point",
      kind: "pointOnProjectedCurve",
      target,
      idSuffix: `inferred-point-on-projected-${index}`,
      labelStem: "Inferred point on projected curve",
      text: `On ${labels.readOnly(target)}`,
    };
  }

  if (source.kind === "sketchDatum" && source.geometryKind === "lineSegment") {
    const target = curveReadOnlyOperandFromSource(source);
    return {
      subject: "point",
      kind: "pointOnProjectedCurve",
      target,
      idSuffix: `inferred-point-on-datum-${index}`,
      labelStem: "Inferred point on sketch datum",
      text: `On ${labels.readOnly(target)}`,
    };
  }

  return null;
}

/**
 * The commit binding (D15/D16): authors exactly the stored placements'
 * requirements on the patch's points. `placements` is aligned with
 * `patch.placementPointIds`; a requirement whose role the patch lacks
 * throws. `structuralStartPointId` (D20, a Line chain's anchor) becomes the
 * first placement's point. Line `joins` reuse their target point id.
 */
export function bindPlacementInferences(input: {
  patch: SketchToolDrawContribution;
  placements: readonly (PlacementInference | null)[];
  structuralStartPointId?: SketchPointId | null;
  sequence: number;
  createConstraintId: (suffix: string) => ConstraintId;
}): SketchToolCommitContribution {
  const { placementPointIds, ...patch } = input.patch;

  // A degenerate commit (validation refused the geometry) authors nothing.
  if (patch.points.length === 0 && patch.entities.length === 0) {
    return patch;
  }

  if (input.placements.length !== placementPointIds.length) {
    throw new Error(
      `Placement inference: ${input.placements.length} placements for ${placementPointIds.length} tool clicks.`,
    );
  }

  const ownPointIds = [...placementPointIds];
  const replacements = new Map<SketchPointId, SketchPointId>();
  const reuse = (index: number, pointId: SketchPointId) => {
    const own = ownPointIds[index];
    if (!own) {
      throw new Error(
        `Placement inference: click ${index + 1} reuses a point but authors none.`,
      );
    }
    if (own !== pointId) replacements.set(own, pointId);
    ownPointIds[index] = pointId;
  };

  if (input.structuralStartPointId) {
    reuse(0, input.structuralStartPointId);
  }
  input.placements.forEach((placement, index) => {
    for (const requirement of placement?.requirements ?? []) {
      if (requirement.kind === "joins") reuse(index, requirement.pointId);
    }
  });

  const entities =
    replacements.size === 0
      ? patch.entities
      : patch.entities.map((entity) =>
          entity.kind === "lineSegment"
            ? {
                ...entity,
                startPointId:
                  replacements.get(entity.startPointId) ?? entity.startPointId,
                endPointId:
                  replacements.get(entity.endPointId) ?? entity.endPointId,
              }
            : entity,
        );
  const points = patch.points.filter(
    (point) => !replacements.has(point.pointId),
  );
  const lineEntityId =
    patch.entities.find((entity) => entity.kind === "lineSegment")?.entityId ??
    null;
  const inferred: ConstraintDefinition[] = [];
  const lastIndex = input.placements.length - 1;

  input.placements.forEach((placement, index) => {
    const placementName =
      index === 0
        ? "start"
        : index === lastIndex
          ? "end"
          : `click-${index + 1}`;
    for (const requirement of placement?.requirements ?? []) {
      if (requirement.kind === "joins") continue;
      const label = `${requirement.labelStem} ${input.sequence}`;
      const subject = (() => {
        switch (requirement.subject) {
          case "point": {
            const pointId = ownPointIds[index];
            if (!pointId) {
              throw new Error(
                `Placement inference: "${requirement.text}" needs the point of click ${index + 1}, which authors none.`,
              );
            }
            return { pointId, entityId: null };
          }
          case "line":
            if (!lineEntityId) {
              throw new Error(
                `Placement inference: "${requirement.text}" needs the tool's new line.`,
              );
            }
            return { pointId: null, entityId: lineEntityId };
          case "circle": {
            const centerPointId = ownPointIds[index];
            const circle = patch.entities.find(
              (entity) =>
                (entity.kind === "circle" || entity.kind === "arc") &&
                entity.centerPointId === centerPointId,
            );
            if (!centerPointId || !circle) {
              throw new Error(
                `Placement inference: "${requirement.text}" needs a new circle or arc centred on click ${index + 1}.`,
              );
            }
            return { pointId: centerPointId, entityId: circle.entityId };
          }
        }
      })();
      const constraintId = input.createConstraintId(
        subject.pointId
          ? `${placementName}-${subject.pointId}-${requirement.idSuffix}`
          : requirement.idSuffix,
      );
      const point = { kind: "localPoint" as const, pointId: subject.pointId! };
      const own = { kind: "localEntity" as const, entityId: subject.entityId! };

      switch (requirement.kind) {
        case "coincident":
          inferred.push({
            constraintId,
            kind: "coincident",
            label,
            pointIds: [subject.pointId!, requirement.pointId],
          });
          break;
        case "coincidentProjectedPoint":
          inferred.push({
            constraintId,
            kind: "coincidentProjectedPoint",
            label,
            point,
            projectedPoint: requirement.target,
          });
          break;
        case "midpoint":
          inferred.push({
            constraintId,
            kind: "midpoint",
            label,
            point,
            line: { kind: "localEntity", entityId: requirement.entityId },
          });
          break;
        case "midpointProjectedLine":
          inferred.push({
            constraintId,
            kind: "midpointProjectedLine",
            label,
            point,
            projectedLine: requirement.target,
          });
          break;
        case "pointOnCurve":
          inferred.push({
            constraintId,
            kind: "pointOnCurve",
            label,
            point,
            curve: { kind: "localEntity", entityId: requirement.entityId },
          });
          break;
        case "pointOnProjectedCurve":
          inferred.push({
            constraintId,
            kind: "pointOnProjectedCurve",
            label,
            point,
            projectedCurve: requirement.target,
          });
          break;
        case "concentric":
          inferred.push({
            constraintId,
            kind: "concentric",
            label,
            entityIds: [subject.entityId!, requirement.entityId],
          });
          break;
        case "concentricProjectedCurve":
          inferred.push({
            constraintId,
            kind: "concentricProjectedCurve",
            label,
            curve: own,
            projectedCurve: requirement.target,
          });
          break;
        case "horizontal":
        case "vertical":
          inferred.push({
            constraintId,
            kind: requirement.kind,
            label,
            entityId: subject.entityId!,
          });
          break;
        case "perpendicular":
          inferred.push({
            constraintId,
            kind: "perpendicular",
            label,
            entityIds: [subject.entityId!, requirement.entityId],
          });
          break;
        case "perpendicularProjectedLine":
          inferred.push({
            constraintId,
            kind: "perpendicularProjectedLine",
            label,
            line: own,
            projectedLine: requirement.target,
          });
          break;
        case "tangent":
          inferred.push({
            constraintId,
            kind: "tangent",
            label,
            entityIds: [subject.entityId!, requirement.entityId],
            relation: "external",
          });
          break;
        case "tangentProjectedCurve":
          inferred.push({
            constraintId,
            kind: "tangentProjectedCurve",
            label,
            curve: own,
            projectedCurve: requirement.target,
            relation: "external",
          });
          break;
      }
    }
  });

  const constraints = dedupeConstraints([
    ...(patch.constraints ?? []),
    ...inferred,
  ]);

  return {
    ...patch,
    points,
    entities,
    ...(constraints.length === (patch.constraints ?? []).length
      ? {}
      : { constraints }),
  };
}

export function dedupeConstraints(constraints: ConstraintDefinition[]) {
  const seen = new Set<string>();
  const uniqueConstraints: ConstraintDefinition[] = [];

  for (const constraint of constraints) {
    const key = getConstraintDedupeKey(constraint);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueConstraints.push(constraint);
  }

  return uniqueConstraints;
}

export function getConstraintDedupeKey(
  constraint: ConstraintDefinition,
): string {
  const readOnlyOperandKey = (operand: {
    kind: string;
    reference?: { referenceId: ReferenceId; geometryId: string };
    datum?: "origin" | "xAxis" | "yAxis";
  }) =>
    operand.kind === "projectedGeometry"
      ? `${operand.reference!.referenceId}:${operand.reference!.geometryId}`
      : `datum:${operand.datum}`;

  switch (constraint.kind) {
    case "coincident":
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(":")}`;
    case "equalOffset":
      return `${constraint.kind}:${constraint.pairs
        .map(
          (pair) => `${pair.seedEntityId}:${pair.offsetEntityId}:${pair.side}`,
        )
        .join(":")}`;
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return `${constraint.kind}:${[...constraint.entityIds].sort().join(":")}`;
    case "horizontal":
    case "vertical":
      return `${constraint.kind}:${constraint.entityId}`;
    case "midpoint":
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.line.entityId}`;
    case "pointOnCurve":
      return `${constraint.kind}:${constraint.point.pointId}:${constraint.curve.entityId}`;
    case "collinear":
      return `${constraint.kind}:${collinearTargetKey(constraint.target)}:${constraint.line.entityId}`;
    case "collinearProjectedLine":
      return `${constraint.kind}:${collinearTargetKey(constraint.target)}:${readOnlyOperandKey(constraint.projectedLine)}`;
    case "fixPoint":
      return `${constraint.kind}:${constraint.pointId}:${constraint.position.join(":")}`;
    case "angle":
      return `${constraint.kind}:${constraint.pointIds.join(":")}:${constraint.valueRadians}`;
    case "coincidentProjectedPoint":
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedPoint)}`;
    case "pointOnProjectedCurve":
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedCurve)}`;
    case "midpointProjectedLine":
      return `${constraint.kind}:${constraint.point.pointId}:${readOnlyOperandKey(constraint.projectedLine)}`;
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return `${constraint.kind}:${constraint.line.entityId}:${readOnlyOperandKey(constraint.projectedLine)}`;
    case "tangentProjectedCurve":
    case "concentricProjectedCurve":
      return `${constraint.kind}:${constraint.curve.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}`;
    case "normal":
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.curve.entityId}:${constraint.point.pointId}`;
    case "normalProjectedCurve":
      return `${constraint.kind}:${constraint.line.entityId}:${constraint.projectedCurve.reference.referenceId}:${constraint.projectedCurve.reference.geometryId}:${constraint.point.pointId}`;
    case "symmetric":
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(":")}:${constraint.axis.entityId}`;
    case "symmetricProjectedLine":
      return `${constraint.kind}:${[...constraint.pointIds].sort().join(":")}:${readOnlyOperandKey(constraint.projectedLine)}`;
  }
}

function collinearTargetKey(operand: {
  kind: string;
  pointId?: string;
  entityId?: string;
}) {
  return operand.kind === "localPoint"
    ? `point:${operand.pointId}`
    : `entity:${operand.entityId}`;
}

const POINT_TOLERANCE = 1e-6;

function getEntityEndpointAtPoint(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  point: SketchPoint,
): SketchPointId | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );
  const candidatePointIds =
    entity?.kind === "lineSegment" || entity?.kind === "arc"
      ? [entity.startPointId, entity.endPointId]
      : entity?.kind === "point"
        ? [entity.pointId]
        : [];

  return (
    candidatePointIds.find((pointId) => {
      const candidate = definition.points.find(
        (entry) => entry.pointId === pointId,
      );
      return (
        candidate &&
        Math.hypot(
          candidate.position[0] - point[0],
          candidate.position[1] - point[1],
        ) <= POINT_TOLERANCE
      );
    }) ?? null
  );
}

function getEntityCenterPointId(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): SketchPointId | null {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );

  return entity?.kind === "circle" || entity?.kind === "arc"
    ? entity.centerPointId
    : null;
}

/** Whether two points are in one declared coincident class (D18). */
function sameCoincidentClass(
  definition: SketchDefinition,
  left: SketchPointId,
  right: SketchPointId,
) {
  const reached = new Set([left]);
  const queue = [left];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const constraint of definition.constraints) {
      if (
        constraint.kind !== "coincident" ||
        !constraint.pointIds.includes(current)
      ) {
        continue;
      }
      for (const pointId of constraint.pointIds) {
        if (!reached.has(pointId)) {
          reached.add(pointId);
          queue.push(pointId);
        }
      }
    }
  }
  return reached.has(right);
}

function isSampledProjectedSpline(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  source: Extract<SketchSnapSourceRef, { kind: "projectedGeometry" }>,
) {
  if (source.geometryKind !== "spline") return false;
  const geometry = projectedReferences
    .find((reference) => reference.referenceId === source.referenceId)
    ?.geometry.find((entry) => entry.geometryId === source.geometryId);
  return (
    geometry?.kind === "spline" &&
    geometry.representation.kind !== "neutralCubicSpans"
  );
}

function projectedKindForSource(
  source: Extract<SketchSnapSourceRef, { kind: "projectedGeometry" }>,
): NonNullable<ProjectedSketchGeometryRef["kind"]> {
  switch (source.geometryKind) {
    case "point":
      return "projectedPoint";
    case "lineSegment":
      return "projectedLineSegment";
    case "circle":
      return "projectedCircle";
    case "arc":
      return "projectedArc";
    case "spline":
      return "projectedSpline";
  }
}

function projectedOperandFromSource(
  source: Extract<SketchSnapSourceRef, { kind: "projectedGeometry" }>,
): ProjectedSketchGeometryConstraintOperand {
  return {
    kind: "projectedGeometry",
    reference: {
      kind: projectedKindForSource(source),
      referenceId: source.referenceId,
      geometryId: source.geometryId,
    },
  };
}

function pointReadOnlyOperandFromSource(
  source: Extract<
    SketchSnapSourceRef,
    { kind: "projectedGeometry" | "sketchDatum" }
  >,
): ReadOnlySketchPointConstraintOperand {
  return source.kind === "sketchDatum"
    ? { kind: "sketchDatum", datum: source.datumId }
    : projectedOperandFromSource(source);
}

function curveReadOnlyOperandFromSource(
  source: Extract<
    SketchSnapSourceRef,
    { kind: "projectedGeometry" | "sketchDatum" }
  >,
): ReadOnlySketchCurveConstraintOperand {
  return source.kind === "sketchDatum"
    ? { kind: "sketchDatum", datum: source.datumId }
    : projectedOperandFromSource(source);
}

const DATUM_LABELS = {
  origin: "Sketch origin",
  xAxis: "Sketch X axis",
  yAxis: "Sketch Y axis",
} as const;

/** Target names for the preview text; construction targets say so. */
function createLabels(definition: SketchDefinition) {
  const named = (label: string, isConstruction: boolean | undefined) =>
    isConstruction ? `${label} (construction)` : label;
  return {
    point(pointId: SketchPointId) {
      const point = definition.points.find(
        (entry) => entry.pointId === pointId,
      );
      return point ? named(point.label, point.isConstruction) : pointId;
    },
    entity(entityId: SketchEntityId) {
      const entity = definition.entities.find(
        (entry) => entry.entityId === entityId,
      );
      return entity ? named(entity.label, entity.isConstruction) : entityId;
    },
    readOnly(
      operand:
        | ReadOnlySketchPointConstraintOperand
        | ReadOnlySketchCurveConstraintOperand,
    ) {
      return operand.kind === "sketchDatum"
        ? DATUM_LABELS[operand.datum]
        : `Projected ${operand.reference.geometryId}`;
    },
  };
}
