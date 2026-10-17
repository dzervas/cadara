import { getSketchSessionDisplaySolvedSnapshot, getStableSketchSessionDisplayKey } from "./solved-snapshot";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { ReferenceImageOperationState } from "@/contracts/reference-image/schema";
import type {
  ReferenceId,
  RenderableId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  RegionRecord,
  SketchReferenceImageRecord,
  SketchDefinition,
  SketchDerivedValidity,
  SketchEntityDefinition,
  SketchStyleDefinition,
  SketchStyleRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import {
  tessellateBoundaryLoop,
  type RegionBoundaryBasis,
} from "@/contracts/sketch/region-boundary-curves";
import {
  tessellateCubicSpans,
  tessellateProjectedSpline,
  solvedCubicSpans,
  orderedSplineOccurrences,
  reconstructSplineAggregate,
  splineVisibleHandleVectors,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  projectedSplineIsClosed,
  type ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchTangentHandleRef } from "@/contracts/shared/references";
import { solveReferenceImageOperationState } from "@/domain/reference-image-calibration/state";
import {
  collectActiveReferenceImageOperations,
  createReferenceImageOperationTarget,
} from "@/domain/reference-image/operations";
import {
  createReferenceImageTextureSourceKey,
  getReferenceImageCornerPoints,
} from "@/domain/reference-image/rendering";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { ShapeUtils, Vector2 } from "three";
import type {
  SketchConstraintDisplaySummary,
  SketchDisplayPaintStyle,
  SketchDisplayStrokeStyle,
  SketchSessionDisplayRenderable,
  SketchSessionState,
} from "./types";
import { getEntityPointIds } from "@/domain/sketch-editing/definition-references";
import {
  REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
  REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS,
  REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS,
  collectVisibleReferenceImageAnchorLabels,
  collectVisibleReferenceImageAnchorPointIds,
  createSketchEntityRef,
  createSketchPointRef,
  getReferenceImageOperationOverrides,
  getSketchSessionDisplayDefinition,
  getSketchSessionDisplayProjectedReferences,
  getSketchSessionDerivedValidity,
  mapDefinitionEntityToDraftEntity,
} from "./internals";
import { mapSketchPointToWorld } from "./state";
import {
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
} from "./annotation-display";
import { getSketchDatumGuideExtent } from "./definition-patches";
import { isSketchSvgRenderingEnabled } from "./styles";

export function sketchSessionHasReferenceImage(
  session: SketchSessionState,
): boolean {
  return collectActiveReferenceImageOperations(session.definition).length > 0;
}

let stableDisplayCacheKey: string | null = null;
let stableDisplayCacheRenderables: SketchSessionDisplayRenderable[] = [];

export function getSketchSessionDisplayRenderables(
  session: SketchSessionState,
): SketchSessionDisplayRenderable[] {
  return [
    ...getStableSketchSessionDisplayRenderables(session),
    ...getTransientSketchSessionDisplayRenderables(session),
  ];
}

export function getStableSketchSessionDisplayRenderables(
  session: SketchSessionState,
): SketchSessionDisplayRenderable[] {
  const stableKey = getStableSketchSessionDisplayKey(session);

  if (stableDisplayCacheKey === stableKey) {
    return stableDisplayCacheRenderables;
  }

  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const svgRenderingEnabled = isSketchSvgRenderingEnabled(session);
  const localStyleLookup = svgRenderingEnabled
    ? createSketchEntityStyleLookup(session)
    : new Map<SketchEntityId, SketchEntityDisplayStyle>();
  const pointStyleLookup = svgRenderingEnabled
    ? createSketchPointStyleLookup(session)
    : new Map<SketchPointId, SketchEntityDisplayStyle>();
  const regionStyleLookup = svgRenderingEnabled
    ? createSketchRegionStyleLookup(session)
    : new Map<RegionRecord["regionId"], SketchEntityDisplayStyle>();
  const displayDefinition = getSketchSessionDisplayDefinition(session);
  const displayProjectedReferences = getSketchSessionDisplayProjectedReferences(
    session,
    displayDefinition,
  );
  const datumGuideExtent = getSketchDatumGuideExtent(
    displayDefinition,
    displayProjectedReferences,
  );
  const referenceImageOperationOverrides =
    getReferenceImageOperationOverrides(session);
  const visibleReferenceImageAnchorPointIds =
    collectVisibleReferenceImageAnchorPointIds(
      displayDefinition,
      referenceImageOperationOverrides,
    );
  const visibleReferenceImageAnchorLabels =
    collectVisibleReferenceImageAnchorLabels(
      displayDefinition,
      referenceImageOperationOverrides,
    );
  const solved = {
    solvedSnapshot: getSketchSessionDisplaySolvedSnapshot(session),
  };
  const constraintDisplaySummary = getSketchConstraintDisplaySummary({
    sketchId,
    definition: displayDefinition,
    solvedSnapshot: solved.solvedSnapshot,
  });
  const solvedPointPositionsById = new Map(
    solved.solvedSnapshot.solvedPoints.map(
      (point) => [point.pointId, point.solvedPosition] as const,
    ),
  );
  const derivedValidity = getSketchSessionDerivedValidity(session);
  const regionRenderables = session.liveRegions.regions.flatMap(
    (region, index) => {
      const renderable = createDisplayRenderableForRegion(
        session,
        region,
        index,
        regionStyleLookup.get(region.regionId),
        derivedValidity.state,
      );
      return renderable
        ? [withSketchConstraintDisplay(renderable, constraintDisplaySummary)]
        : [];
    },
  );
  const pointOwners = getSketchPointOwnerEntityIds(displayDefinition);
  const pointRenderables = displayDefinition.points.map((point) => {
    const style = pointStyleLookup.get(point.pointId);
    const ownerEntityIds = pointOwners.get(point.pointId) ?? [];
    const isVisibleReferenceImageAnchor =
      visibleReferenceImageAnchorPointIds.has(point.pointId);
    const referenceImageAnchorStyle = isVisibleReferenceImageAnchor
      ? {
          paintStyle: {
            color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
            opacity: 1,
          } satisfies SketchDisplayPaintStyle,
          strokeStyle: {
            color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
            opacity: 1,
          } satisfies SketchDisplayStrokeStyle,
        }
      : null;

    return withSketchConstraintDisplay(
      {
        id: `renderable_sketch_point_${point.pointId}` as RenderableId,
        label: point.label,
        target: createSketchPointRef(sketchId, point.pointId),
        geometry: {
          kind: "marker" as const,
          position: mapSketchPointToWorld(session.plane, point.position),
          displayRadius: isVisibleReferenceImageAnchor
            ? REFERENCE_IMAGE_ANCHOR_MARKER_RADIUS
            : 0.16,
        },
        linePattern: "solid" as const,
        role: "local" as const,
        pointMarker: {
          visibility:
            ownerEntityIds.length > 0
              ? ("contextual" as const)
              : ("always" as const),
          ownerEntityIds,
        },
        paintStyle: style?.paintStyle ?? referenceImageAnchorStyle?.paintStyle,
        strokeStyle:
          style?.strokeStyle ?? referenceImageAnchorStyle?.strokeStyle,
      },
      constraintDisplaySummary,
    );
  });
  const referenceImageAnchorOverlayRenderables =
    displayDefinition.points.flatMap((point) => {
      if (!visibleReferenceImageAnchorPointIds.has(point.pointId)) {
        return [];
      }

      return [
        withSketchConstraintDisplay(
          {
            id: `renderable_reference_image_anchor_overlay_${point.pointId}` as RenderableId,
            label:
              visibleReferenceImageAnchorLabels.get(point.pointId) ??
              point.label,
            target: createSketchPointRef(sketchId, point.pointId),
            geometry: {
              kind: "marker" as const,
              position: mapSketchPointToWorld(session.plane, point.position),
              displayRadius: REFERENCE_IMAGE_ANCHOR_OVERLAY_RADIUS,
            },
            linePattern: "solid" as const,
            role: "local" as const,
            markerLayer: "overlay" as const,
            paintStyle: {
              color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
              opacity: 1,
            },
            strokeStyle: {
              color: REFERENCE_IMAGE_ANCHOR_MARKER_COLOR,
              opacity: 1,
            },
          },
          constraintDisplaySummary,
        ),
      ];
    });
  const referenceImageRenderables = collectActiveReferenceImageOperations(
    displayDefinition,
    referenceImageOperationOverrides,
  ).map(({ operation, state }, index) =>
    createDisplayRenderableForReferenceImageOperation(
      session,
      operation,
      hasSolvedReferenceImageCalibration(state)
        ? state
        : solveReferenceImageOperationState(state, {
            pointPositionsById: solvedPointPositionsById,
          }),
      index,
    ),
  );
  // [TECH] G19: a non-accepted offset output (line, arc, joint arc) takes the
  // same stale/invalid display state as a non-accepted shell.
  const nonAcceptedOutputs = nonAcceptedDerivedOutputs(
    displayDefinition,
    solved.solvedSnapshot,
  );
  const failedOwners = new Set(
    sketchProfileGateFailures(solved.solvedSnapshot),
  );
  const entityRenderables = [
    ...getAcceptedSketchDisplayEntities(sketchId, displayDefinition).map(
      (entity, index) => {
        const renderable = createDisplayRenderableForEntity(
          session,
          entity,
          index,
          entity.entityId ? localStyleLookup.get(entity.entityId) : undefined,
        );
        const owner = entity.entityId
          ? nonAcceptedOutputs.get(entity.entityId)
          : undefined;
        // T17c3: a spline drawn through its fit points (a degenerate span)
        // takes the invalid tint.
        if (entity.id === degenerateSplineDraftId(entity.entityId))
          return { ...renderable, regionValidity: "invalid" as const };
        return owner
          ? {
              ...renderable,
              regionValidity: getNonAcceptedOutputDisplayValidity(
                session,
                owner,
                failedOwners,
              ),
            }
          : renderable;
      },
    ),
    ...createDisplayRenderablesForDerivedShells(
      session,
      displayDefinition,
      solved.solvedSnapshot,
      localStyleLookup,
    ),
  ].map((renderable) =>
    withSketchConstraintDisplay(renderable, constraintDisplaySummary),
  );

  const renderables = [
    ...regionRenderables,
    ...referenceImageRenderables,
    createDisplayRenderableForSketchDatum(
      session,
      sketchId,
      "origin",
      datumGuideExtent,
    ),
    createDisplayRenderableForSketchDatum(
      session,
      sketchId,
      "xAxis",
      datumGuideExtent,
    ),
    createDisplayRenderableForSketchDatum(
      session,
      sketchId,
      "yAxis",
      datumGuideExtent,
    ),
    ...pointRenderables,
    ...createTangentHandleRenderables(
      session,
      sketchId,
      displayDefinition,
      solvedPointPositionsById,
      constraintDisplaySummary,
    ),
    ...referenceImageAnchorOverlayRenderables,
    ...entityRenderables,
    ...entityRenderables.flatMap(createOverconstraintDiagnosticRenderable),
    ...displayDefinition.references.flatMap((reference, index) => {
      if (reference.kind === "referenceImageAnchor") {
        return [];
      }

      const projectedReference = displayProjectedReferences.find(
        (entry) => entry.referenceId === reference.referenceId,
      );
      if (
        projectedReference &&
        projectedReference.status === "projected" &&
        projectedReference.geometry.length > 0
      ) {
        return [];
      }

      return [
        createDisplayRenderableForReferenceRecord(
          session,
          reference.referenceId,
          index,
        ),
      ];
    }),
    ...displayProjectedReferences
      .filter((reference) =>
        shouldRenderProjectedReference(
          session,
          displayDefinition,
          reference.referenceId,
        ),
      )
      .flatMap((reference) =>
        reference.geometry.map((geometry, index) =>
          createDisplayRenderableForProjectedGeometry(
            session,
            reference.referenceId,
            geometry,
            index,
          ),
        ),
      ),
  ];
  stableDisplayCacheKey = stableKey;
  stableDisplayCacheRenderables = renderables;

  return renderables;
}

/**
 * Tangent-handle renderables for every spline occurrence (T12d, D8):
 * a line from the fit point to the handle tip, and a small tip marker.
 * The visible vector is the authored vector for authored tangents, or
 * the mean-arm handle vector from the reconstruction for automatic ones.
 * Exact zero: no line, the tip coincides with the fit point.
 *
 * Visibility: contextual, owned by the spline entity — shown when the
 * spline, any of its fit points, or a handle is hovered/selected/dragged.
 */
function createTangentHandleRenderables(
  session: SketchSessionState,
  sketchId: SketchId,
  displayDefinition: SketchDefinition,
  solvedPointPositionsById: ReadonlyMap<SketchPointId, SketchPoint>,
  constraintDisplaySummary: SketchConstraintDisplaySummary,
): SketchSessionDisplayRenderable[] {
  const renderables: SketchSessionDisplayRenderable[] = [];
  for (const entity of displayDefinition.entities) {
    if (entity.kind !== "spline") continue;
    const occurrences = orderedSplineOccurrences(entity);
    if (!occurrences || occurrences.length < 2) continue;
    const positions: Record<string, SplineVector> = {};
    for (const occ of occurrences) {
      const pos = solvedPointPositionsById.get(occ.pointId as SketchPointId);
      if (!pos) continue;
      positions[occ.pointId] = pos;
    }
    const visibleVectors = splineVisibleHandleVectors(entity, positions);
    if (!visibleVectors) continue;
    for (let i = 0; i < occurrences.length; i++) {
      const occ = occurrences[i]!;
      const fitPointPos = solvedPointPositionsById.get(
        occ.pointId as SketchPointId,
      );
      if (!fitPointPos) continue;
      const isAuthored = occ.tangent.kind === "authored";
      const visibleVector: SplineVector = visibleVectors[i]!;
      const tipPosition: SketchPoint = [
        fitPointPos[0] + visibleVector[0],
        fitPointPos[1] + visibleVector[1],
      ];
      const isZero = visibleVector[0] === 0 && visibleVector[1] === 0;
      const handleTarget: SketchTangentHandleRef = {
        kind: "sketchTangentHandle",
        sketchId,
        entityId: entity.entityId as SketchEntityId,
        occurrenceId: occ.occurrenceId,
        pointId: occ.pointId as SketchPointId,
      };
      // Handle line: from fit point to tip (skip if zero).
      if (!isZero) {
        renderables.push(
          withSketchConstraintDisplay(
            {
              id: `renderable_tangent_handle_line_${entity.entityId}_${occ.occurrenceId}` as RenderableId,
              label: "Tangent handle",
              target: handleTarget,
              geometry: {
                kind: "polyline" as const,
                points: [
                  mapSketchPointToWorld(session.plane, fitPointPos),
                  mapSketchPointToWorld(session.plane, tipPosition),
                ],
                isClosed: false,
              },
              linePattern: isAuthored
                ? ("solid" as const)
                : ("dashed" as const),
              role: "local" as const,
              handleDisplay: {
                visibility: "contextual" as const,
                ownerEntityId: entity.entityId as SketchEntityId,
                isAuthored,
              },
              strokeStyle: isAuthored
                ? undefined
                : { color: 0x888888, opacity: 0.6 },
            },
            constraintDisplaySummary,
          ),
        );
      }
      // Handle tip marker.
      renderables.push(
        withSketchConstraintDisplay(
          {
            id: `renderable_tangent_handle_tip_${entity.entityId}_${occ.occurrenceId}` as RenderableId,
            label: "Tangent handle",
            target: handleTarget,
            geometry: {
              kind: "marker" as const,
              position: mapSketchPointToWorld(session.plane, tipPosition),
              displayRadius: 0.12,
            },
            linePattern: "solid" as const,
            role: "local" as const,
            handleDisplay: {
              visibility: "contextual" as const,
              ownerEntityId: entity.entityId as SketchEntityId,
              isAuthored,
            },
            strokeStyle: isAuthored
              ? undefined
              : { color: 0x888888, opacity: 0.6 },
          },
          constraintDisplaySummary,
        ),
      );
    }
  }
  return renderables;
}

/**
 * The curves each point belongs to (T11-D8): every entity whose definition
 * references it, except the Point tool's own `point` entity; a derived
 * shell's driven terminal points (from its offset relationship); and the
 * curve of a `pointOnCurve` / line of a `midpoint` constraint on a point
 * that is not a Point-tool point (3-point circle and arc, midpoint line;
 * T11f review R-1). A point with no owner is a free point (Point tool,
 * kept after Trim).
 */
function getSketchPointOwnerEntityIds(definition: SketchDefinition) {
  const owners = new Map<SketchPointId, SketchEntityId[]>();
  const add = (pointId: SketchPointId, entityId: SketchEntityId) => {
    const entry = owners.get(pointId);
    if (!entry) owners.set(pointId, [entityId]);
    else if (!entry.includes(entityId)) entry.push(entityId);
  };
  const pointToolPointIds = new Set<SketchPointId>();
  for (const entity of definition.entities) {
    if (entity.kind === "point") {
      pointToolPointIds.add(entity.pointId);
      continue;
    }
    for (const pointId of getEntityPointIds(entity)) {
      add(pointId, entity.entityId);
    }
  }
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") continue;
    for (const output of relationship.piecewiseCubicOutputs) {
      add(output.startPointId, output.outputEntityId);
      add(output.endPointId, output.outputEntityId);
    }
  }
  for (const constraint of definition.constraints) {
    const [point, curve] =
      constraint.kind === "pointOnCurve"
        ? [constraint.point, constraint.curve]
        : constraint.kind === "midpoint"
          ? [constraint.point, constraint.line]
          : [null, null];
    if (
      point?.kind === "localPoint" &&
      curve?.kind === "localEntity" &&
      !pointToolPointIds.has(point.pointId)
    ) {
      add(point.pointId, curve.entityId);
    }
  }
  return owners;
}

/** What reveals contextual point markers (T11-D8). */
export interface SketchPointMarkerContext {
  /** The whole current hover stack, not only its top. */
  hoverStack: readonly PrimitiveRef[];
  /** The hovered target (a click's preview, the chooser's item preview). */
  hoverTarget: PrimitiveRef | null;
  selection: readonly PrimitiveRef[];
  /** The active tool's draft and chain anchor points. */
  toolPointIds: ReadonlySet<SketchPointId>;
}

/**
 * The contextual points whose markers are revealed (T11-D8, review A-2):
 * the point or one of its owning curves (same sketch) is in the hover
 * stack (anywhere), is the hover target or is selected, or the point
 * anchors the active tool's draft. One pass over the context and the
 * markers (T11f review A-3).
 */
export function getSketchRevealedPointIds(
  renderables: readonly SketchSessionDisplayRenderable[],
  context: SketchPointMarkerContext,
): ReadonlySet<SketchPointId> {
  const active = [
    ...context.hoverStack,
    ...(context.hoverTarget ? [context.hoverTarget] : []),
    ...context.selection,
  ];
  const activePoints = new Set<string>();
  const activeEntities = new Set<string>();
  for (const entry of active) {
    if (entry.kind === "sketchPoint")
      activePoints.add(`${entry.sketchId}|${entry.pointId}`);
    else if (entry.kind === "sketchEntity")
      activeEntities.add(`${entry.sketchId}|${entry.entityId}`);
  }
  const revealed = new Set<SketchPointId>();
  for (const { pointMarker, target } of renderables) {
    if (
      pointMarker?.visibility !== "contextual" ||
      target?.kind !== "sketchPoint"
    )
      continue;
    if (
      context.toolPointIds.has(target.pointId) ||
      activePoints.has(`${target.sketchId}|${target.pointId}`) ||
      pointMarker.ownerEntityIds.some((entityId) =>
        activeEntities.has(`${target.sketchId}|${entityId}`),
      )
    ) {
      revealed.add(target.pointId);
    }
  }
  return revealed;
}

/**
 * Whether a marker renderable is drawn (T11-D8): a contextual point marker
 * only while revealed (`getSketchRevealedPointIds`). Every other marker (a
 * free point, the datum origin, projected and unresolved references)
 * always shows. Display only: pickability never depends on it.
 */
export function getSketchPointMarkerVisibility(
  renderable: SketchSessionDisplayRenderable,
  revealedPointIds: ReadonlySet<SketchPointId>,
): boolean {
  const { pointMarker, target } = renderable;
  return (
    pointMarker?.visibility !== "contextual" ||
    target?.kind !== "sketchPoint" ||
    revealedPointIds.has(target.pointId)
  );
}

/**
 * The entity ids (spline + fit-point owners) whose tangent handles are
 * revealed (T12d, D8): a spline entity, one of its fit points or a handle
 * is in the hover stack, is the hover target, is selected, or is being
 * dragged.
 */
export function getSketchRevealedHandleEntityIds(
  renderables: readonly SketchSessionDisplayRenderable[],
  context: SketchPointMarkerContext,
): ReadonlySet<SketchEntityId> {
  const active = [
    ...context.hoverStack,
    ...(context.hoverTarget ? [context.hoverTarget] : []),
    ...context.selection,
  ];
  const activeEntities = new Set<string>();
  const activePoints = new Set<string>();
  const activeHandles = new Set<string>();
  for (const entry of active) {
    if (entry.kind === "sketchEntity")
      activeEntities.add(`${entry.sketchId}|${entry.entityId}`);
    else if (entry.kind === "sketchPoint")
      activePoints.add(`${entry.sketchId}|${entry.pointId}`);
    else if (entry.kind === "sketchTangentHandle")
      activeHandles.add(`${entry.sketchId}|${entry.entityId}`);
  }
  const revealed = new Set<SketchEntityId>();
  // A handle entity is revealed if the spline, any of its fit points, or
  // any of its handles is active.
  for (const { handleDisplay, target } of renderables) {
    if (!handleDisplay || !target) continue;
    const entityId = handleDisplay.ownerEntityId;
    if (revealed.has(entityId)) continue;
    const sketchId =
      target.kind === "sketchTangentHandle" ? target.sketchId : null;
    if (!sketchId) continue;
    if (
      activeEntities.has(`${sketchId}|${entityId}`) ||
      activeHandles.has(`${sketchId}|${entityId}`)
    ) {
      revealed.add(entityId);
      continue;
    }
  }
  // Also reveal if any fit point of the spline is active.
  for (const { pointMarker, target } of renderables) {
    if (
      pointMarker?.visibility === "contextual" &&
      target?.kind === "sketchPoint"
    ) {
      for (const ownerEntityId of pointMarker.ownerEntityIds) {
        if (
          !revealed.has(ownerEntityId) &&
          activePoints.has(`${target.sketchId}|${target.pointId}`)
        ) {
          // This point is active AND owns a spline entity → reveal all handles
          // of that entity.
          for (const { handleDisplay: hd } of renderables) {
            if (hd?.ownerEntityId === ownerEntityId) {
              revealed.add(ownerEntityId);
              break;
            }
          }
        }
      }
    }
  }
  return revealed;
}

/**
 * Whether a handle renderable is drawn (T12d, D8): only while its owning
 * entity is revealed.
 */
export function getSketchHandleVisibility(
  renderable: SketchSessionDisplayRenderable,
  revealedHandleEntityIds: ReadonlySet<SketchEntityId>,
): boolean {
  const { handleDisplay } = renderable;
  if (!handleDisplay) return true;
  return revealedHandleEntityIds.has(handleDisplay.ownerEntityId);
}

/**
 * The active tool's draft anchor points (T11-D8): the existing point a
 * drawing tool's draft starts from, a Line chain's structural start
 * (T13-D20) or the point its first placement joins or is coincident with.
 */
export function getSketchToolMarkerPointIds(
  session: Pick<
    SketchSessionState,
    "activeTool" | "toolStartPointId" | "toolPlacements"
  >,
): ReadonlySet<SketchPointId> {
  if (session.activeTool === null) {
    return new Set();
  }
  if (session.toolStartPointId) {
    return new Set([session.toolStartPointId]);
  }
  return new Set(
    (session.toolPlacements?.[0]?.requirements ?? []).flatMap((requirement) =>
      requirement.kind === "joins" || requirement.kind === "coincident"
        ? [requirement.pointId]
        : [],
    ),
  );
}

export function getTransientSketchSessionDisplayRenderables(
  session: SketchSessionState,
): SketchSessionDisplayRenderable[] {
  if (session.toolStagedEntities.length === 0) {
    return [];
  }

  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const displayDefinition = getSketchSessionDisplayDefinition(session);
  const acceptedEntityCount = getAcceptedSketchDisplayEntities(
    sketchId,
    displayDefinition,
  ).length;

  return session.toolStagedEntities.map((entity, index) =>
    createDisplayRenderableForEntity(
      session,
      entity,
      acceptedEntityCount + index,
      undefined,
    ),
  );
}

function getAcceptedSketchDisplayEntities(
  sketchId: SketchId,
  displayDefinition: SketchDefinition,
): readonly SketchDraftEntity[] {
  return displayDefinition.entities.flatMap((entity) => {
    const drafts = mapDefinitionEntityToDraftEntity(
      sketchId,
      displayDefinition.points,
      entity,
    );
    return drafts.length === 0 && entity.kind === "spline"
      ? getDegenerateSplineDraft(displayDefinition, entity)
      : drafts;
  });
}

const degenerateSplineDraftId = (entityId: SketchEntityId | null) =>
  `${entityId}:degenerate-span`;

/**
 * T17c3 (issue 08 :107): a spline with a degenerate span (two consecutive
 * fit points at the same place) has no reconstruction, but it is never
 * invisible: it is drawn through its fit points (a smooth closure back to
 * the first), and its renderable takes the invalid tint. The authored
 * points are kept as they are.
 */
function getDegenerateSplineDraft(
  definition: SketchDefinition,
  spline: Extract<SketchEntityDefinition, { kind: "spline" }>,
): SketchDraftEntity[] {
  const positions = new Map(
    definition.points.map((point) => [point.pointId, point.position] as const),
  );
  const reconstruction = reconstructSplineAggregate(
    spline,
    Object.fromEntries(positions) as Record<SketchPointId, SketchPoint>,
  );
  if (
    !reconstruction.diagnostics.some(
      (diagnostic) => diagnostic.code === "coincident-points",
    )
  )
    return [];
  const fitPoints = (orderedSplineOccurrences(spline) ?? []).map(
    (occurrence) => positions.get(occurrence.pointId)!,
  );
  return [
    {
      id: degenerateSplineDraftId(spline.entityId),
      kind: "spline",
      points:
        spline.closure === "smooth" ? [...fitPoints, fitPoints[0]!] : fitPoints,
      entityId: spline.entityId,
      status: "accepted",
      label: spline.label,
      isConstruction: spline.isConstruction,
    },
  ];
}

export function shouldRenderProjectedReference(
  session: SketchSessionState,
  definition: SketchDefinition,
  referenceId: ReferenceId,
) {
  void session;
  void definition;
  void referenceId;
  return true;
}

export function withSketchConstraintDisplay(
  renderable: SketchSessionDisplayRenderable,
  summary: SketchConstraintDisplaySummary,
): SketchSessionDisplayRenderable {
  if (renderable.role === "reference") {
    return renderable;
  }

  return {
    ...renderable,
    constraintDisplay: getSketchConstraintDisplayForTarget(
      renderable.target,
      summary,
    ),
  };
}

/**
 * Display validity of a derived offset output (T08b-g5b, plan §3.4; [TECH]
 * G19 for every output kind): an accepted (`certified`) output is current. A
 * non-accepted (`provisional`) one is `stale` (normal colour, U-A) while a
 * drag is active or while its publication round is pending; once the round
 * has settled (current, unavailable or failed) without certifying it, it is
 * `invalid` (the existing red tint). T17g3: before the session has a live
 * solve (an opened session, review G-1) nothing is judged yet, so every
 * output is `stale`, never `current`.
 */
export function getDerivedShellDisplayValidity(
  session: SketchSessionState,
  publication: "provisional" | "certified",
): SketchDerivedValidity["state"] {
  if (session.liveSolve === null) return "stale";
  if (publication === "certified") return "current";
  return session.activeDrag !== null || session.liveRegions.status === "pending"
    ? "stale"
    : "invalid";
}

/**
 * T16b ([TECH] T16-6, plan review A-5): display validity of a non-accepted
 * derived output by its owner (the G16‴ closure of
 * `nonAcceptedDerivedOutputs`). An output held by a failed relationship (the
 * sketch-wide profile gate: directly, or a copy of a held copy) is settled
 * invalid geometry, so it is always `invalid` (red), during a drag too.
 * Any other owner, a not yet certified offset, keeps
 * `getDerivedShellDisplayValidity` (U-A).
 */
function getNonAcceptedOutputDisplayValidity(
  session: SketchSessionState,
  owner: { readonly derivationId: string },
  failedOwners: ReadonlySet<string>,
): SketchDerivedValidity["state"] {
  return failedOwners.has(owner.derivationId)
    ? "invalid"
    : getDerivedShellDisplayValidity(session, "provisional");
}

/**
 * The derived offset shells of the display definition, drawn from their
 * solved spans clipped to each span's drawn `queryDomain` (the same
 * `solvedCubicSpans` pick, snap, measure, export and the OCC snapshot read).
 * Provisional shells draw too (U-A); a shell has no handles.
 */
export function createDisplayRenderablesForDerivedShells(
  session: SketchSessionState,
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  styles: ReadonlyMap<SketchEntityId, SketchEntityDisplayStyle>,
): SketchSessionDisplayRenderable[] {
  const records = new Map(
    solvedSnapshot.solvedEntities.map((record) => [record.entityId, record]),
  );
  const nonAccepted = nonAcceptedDerivedOutputs(definition, solvedSnapshot);
  const failedOwners = new Set(sketchProfileGateFailures(solvedSnapshot));
  return definition.entities.flatMap((entity) => {
    if (entity.kind !== "derivedPiecewiseCubic") return [];
    const record = records.get(entity.entityId);
    if (record?.kind !== "derivedPiecewiseCubic") return [];
    const points = tessellateCubicSpans(solvedCubicSpans(record));
    if (points.length < 2) return [];
    return [
      {
        ...createDisplayRenderableForEntity(
          session,
          {
            id: entity.entityId,
            kind: "polyline",
            points,
            isClosed: false,
            entityId: entity.entityId,
            status: "accepted",
            label: entity.label,
            isConstruction: entity.isConstruction,
          },
          0,
          styles.get(entity.entityId),
        ),
        id: `renderable_sketch_shell_${entity.entityId}` as RenderableId,
        // T17o (B14, [TECH] T17-13): kept for owner-rule consistency with
        // the line/arc outputs (`getNonAcceptedOutputDisplayValidity`).
        // Its failed-owner branch is unreachable for shells today: a
        // shell's owner is its offset, and a failed relationship could own
        // it only through a certified offset of a held seed, which
        // `withNonAcceptedSeedsFailed` forbids (T16b review A-2).
        regionValidity: nonAccepted.has(entity.entityId)
          ? getNonAcceptedOutputDisplayValidity(
              session,
              nonAccepted.get(entity.entityId)!,
              failedOwners,
            )
          : getDerivedShellDisplayValidity(session, "certified"),
      },
    ];
  });
}

export function createOverconstraintDiagnosticRenderable(
  renderable: SketchSessionDisplayRenderable,
): SketchSessionDisplayRenderable[] {
  if (
    renderable.geometry.kind !== "polyline" ||
    renderable.role !== "local" ||
    renderable.target?.kind !== "sketchEntity" ||
    !renderable.constraintDisplay?.isAffectedOverconstraint
  ) {
    return [];
  }

  return [
    {
      ...renderable,
      id: `${renderable.id}_overconstraint_diagnostic` as RenderableId,
      label: `${renderable.label} overconstraint diagnostic`,
      linePattern: "solid",
      paintStyle: undefined,
      strokeStyle: undefined,
      diagnosticStyle: { kind: "overconstraint" },
    },
  ];
}

export function createDisplayRenderableForRegion(
  session: SketchSessionState,
  region: RegionRecord,
  index: number,
  style: SketchEntityDisplayStyle | undefined,
  validity: SketchDerivedValidity["state"] = "current",
): SketchSessionDisplayRenderable | null {
  const basis = session.liveRegions.boundaryBasis;
  const triangulated = basis
    ? triangulateSketchRegionLoops(basis, region)
    : null;
  if (!triangulated) {
    return null;
  }

  return {
    id: `renderable_sketch_region_${region.regionId}_${index}` as RenderableId,
    label: validity === "stale" ? `${region.label} (stale)` : region.label,
    target: validity === "current" ? region.target : null,
    geometry: {
      kind: "mesh",
      vertexPositions: triangulated.points.map((point) =>
        mapSketchPointToWorld(session.plane, point),
      ),
      vertexNormals: triangulated.points.map(() => session.plane.frame.normal),
      triangleIndices: triangulated.triangleIndices,
    },
    sketchPlaneFrame: session.plane.frame,
    linePattern: "solid",
    role: "local",
    semanticClass: "region",
    regionValidity: validity,
    paintStyle: style?.paintStyle,
    strokeStyle: style?.strokeStyle,
  };
}

/**
 * Samples per boundary curve of the in-sketch region fill: the density of the
 * circle display polyline, so a filled circle meets its stroke.
 */
const REGION_FILL_SAMPLES_PER_CURVE = 48;

/**
 * In-sketch region fill (T10 plan §2.3): each loop is the region-boundary
 * owner's display tessellation of its resolved segments at the solved
 * positions of the pair that produced the region (`basis`, review R2), so
 * arcs, splines and crossing-closed lobes fill along their exact curves.
 * Null when a loop does not resolve against `basis` or does not triangulate.
 */
export function triangulateSketchRegionLoops(
  basis: RegionBoundaryBasis,
  region: RegionRecord,
): {
  points: SketchPoint[];
  triangleIndices: Array<readonly [number, number, number]>;
} | null {
  const outerLoop = region.loops.find((loop) => loop.role === "outer");
  if (!outerLoop) {
    return null;
  }

  const loops: (readonly SketchPoint[])[] = [];
  for (const loop of [
    outerLoop,
    ...region.loops.filter((entry) => entry.role === "inner"),
  ]) {
    const points = tessellateBoundaryLoop(
      basis,
      loop,
      REGION_FILL_SAMPLES_PER_CURVE,
    );
    if ("kind" in points || points.length < 3) {
      return null;
    }
    loops.push(points);
  }
  const [outerPoints, ...innerPoints] = loops;

  const triangleIndices = ShapeUtils.triangulateShape(
    outerPoints!.map(pointToVector2),
    innerPoints.map((loop) => loop.map(pointToVector2)),
  ).map((triangle) => [triangle[0]!, triangle[1]!, triangle[2]!] as const);

  if (triangleIndices.length === 0) {
    return null;
  }

  return {
    points: loops.flat(),
    triangleIndices,
  };
}

export function pointToVector2(point: SketchPoint) {
  return new Vector2(point[0], point[1]);
}

export function createDisplayRenderableForEntity(
  session: SketchSessionState,
  entity: SketchDraftEntity,
  index: number,
  style: SketchEntityDisplayStyle | undefined,
): SketchSessionDisplayRenderable {
  if (entity.kind === "line") {
    return {
      id: `renderable_sketch_line_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(
            session.sketchId ?? ("sketch_draft" as SketchId),
            entity.entityId,
          )
        : null,
      geometry: {
        kind: "polyline",
        points: [
          mapSketchPointToWorld(session.plane, entity.start),
          mapSketchPointToWorld(session.plane, entity.end),
        ],
        isClosed: false,
      },
      sketchPlaneFrame: session.plane.frame,
      linePattern: entity.isConstruction ? "dashed" : "solid",
      role: "local",
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    };
  }

  if (entity.kind === "spline") {
    return {
      id: `renderable_sketch_spline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(
            session.sketchId ?? ("sketch_draft" as SketchId),
            entity.entityId,
          )
        : null,
      geometry: {
        kind: "polyline",
        points: entity.points.map((point) =>
          mapSketchPointToWorld(session.plane, point),
        ),
        isClosed: false,
      },
      sketchPlaneFrame: session.plane.frame,
      linePattern: entity.isConstruction ? "dashed" : "solid",
      role: "local",
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    };
  }

  if (entity.kind === "polyline") {
    return {
      id: `renderable_sketch_polyline_${index}` as RenderableId,
      label: entity.label,
      target: entity.entityId
        ? createSketchEntityRef(
            session.sketchId ?? ("sketch_draft" as SketchId),
            entity.entityId,
          )
        : null,
      geometry: {
        kind: "polyline",
        points: entity.points.map((point) =>
          mapSketchPointToWorld(session.plane, point),
        ),
        isClosed: entity.isClosed,
      },
      sketchPlaneFrame: session.plane.frame,
      linePattern: entity.isConstruction ? "dashed" : "solid",
      role: "local",
      paintStyle: style?.paintStyle,
      strokeStyle: style?.strokeStyle,
    };
  }

  const pointCount = 48;
  const points = Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
    const angle = (Math.PI * 2 * pointIndex) / pointCount;
    return mapSketchPointToWorld(session.plane, [
      entity.center[0] + Math.cos(angle) * entity.radius,
      entity.center[1] + Math.sin(angle) * entity.radius,
    ]);
  });

  return {
    id: `renderable_sketch_circle_${index}` as RenderableId,
    label: entity.label,
    target: entity.entityId
      ? createSketchEntityRef(
          session.sketchId ?? ("sketch_draft" as SketchId),
          entity.entityId,
        )
      : null,
    geometry: {
      kind: "polyline",
      points,
      isClosed: true,
    },
    sketchPlaneFrame: session.plane.frame,
    linePattern: entity.isConstruction ? "dashed" : "solid",
    role: "local",
    paintStyle: style?.paintStyle,
    strokeStyle: style?.strokeStyle,
  };
}

export function createDisplayRenderableForReferenceImageOperation(
  session: SketchSessionState,
  operation: SketchReferenceImageRecord,
  state: NonNullable<SketchReferenceImageRecord["ownedState"]>,
  index: number,
): SketchSessionDisplayRenderable {
  const corners = getReferenceImageCornerPoints(state).map((point) =>
    mapSketchPointToWorld(session.plane, point),
  );

  return {
    id: `renderable_sketch_reference_image_${index}` as RenderableId,
    label: operation.label,
    target: createReferenceImageOperationTarget(
      session.sketchId ?? ("sketch_draft" as SketchId),
      operation.operationId,
    ),
    geometry: {
      kind: "mesh",
      vertexPositions: corners,
      vertexNormals: corners.map(() => session.plane.frame.normal),
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
    sketchPlaneFrame: session.plane.frame,
    linePattern: "solid",
    role: "local",
    semanticClass: "sketchImage",
    textureFill: {
      kind: "inlineImage",
      sourceKey: createReferenceImageTextureSourceKey({
        operationId: operation.operationId,
        state,
      }),
      mediaType: state.image.mediaType,
      base64Data: state.image.base64Data,
      uvCoordinates: [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
      opacity: 0.55,
    },
  };
}

export function hasSolvedReferenceImageCalibration(
  state: ReferenceImageOperationState,
): state is ReturnType<typeof solveReferenceImageOperationState> {
  return (
    typeof state.calibration === "object" &&
    state.calibration !== null &&
    "solveResult" in state.calibration
  );
}

export interface SketchEntityDisplayStyle {
  paintStyle?: SketchDisplayPaintStyle;
  strokeStyle?: SketchDisplayStrokeStyle;
}

export function createSketchEntityStyleLookup(
  session: SketchSessionState,
): Map<SketchEntityId, SketchEntityDisplayStyle> {
  const styleRecords = getPersistedSketchStyleRecords(session.definition);
  const entityStyleById = new Map<SketchEntityId, SketchEntityDisplayStyle>();
  for (const entity of session.definition.entities) {
    const localStyle = parseSketchStyleDefinition(entity.style);
    const styleId = getEntityStyleId(entity);
    const persistedStyle = styleId ? styleRecords.get(styleId) : undefined;
    const style = mergeSketchEntityDisplayStyle(persistedStyle, localStyle);
    if (!style) {
      continue;
    }

    entityStyleById.set(entity.entityId, style);
  }

  return entityStyleById;
}

export function createSketchPointStyleLookup(
  session: SketchSessionState,
): Map<SketchPointId, SketchEntityDisplayStyle> {
  const pointStyleById = new Map<SketchPointId, SketchEntityDisplayStyle>();

  for (const point of session.definition.points) {
    const style = parseSketchStyleDefinition(point.style);
    if (!style) {
      continue;
    }

    pointStyleById.set(point.pointId, style);
  }

  return pointStyleById;
}

export function createSketchRegionStyleLookup(
  session: SketchSessionState,
): Map<RegionRecord["regionId"], SketchEntityDisplayStyle> {
  const regionStyleById = new Map<
    RegionRecord["regionId"],
    SketchEntityDisplayStyle
  >();

  for (const styleRecord of session.definition.styles ?? []) {
    if (!styleRecord.target || styleRecord.target.kind !== "region") {
      continue;
    }

    const style = parseSketchStyleRecord(styleRecord);
    if (!style) {
      continue;
    }

    regionStyleById.set(styleRecord.target.regionId, style);
  }

  return regionStyleById;
}

export function mergeSketchEntityDisplayStyle(
  base: SketchEntityDisplayStyle | undefined,
  override: SketchEntityDisplayStyle | undefined,
): SketchEntityDisplayStyle | undefined {
  if (!base) {
    return override;
  }

  if (!override) {
    return base;
  }

  return {
    paintStyle: override.paintStyle ?? base.paintStyle,
    strokeStyle: override.strokeStyle ?? base.strokeStyle,
  };
}

export function parseSketchStyleDefinition(
  style: SketchStyleDefinition | undefined,
): SketchEntityDisplayStyle | undefined {
  if (!style) {
    return undefined;
  }

  const paintStyle = parseLocalPaintStyle(style);
  const strokeStyle = parseLocalStrokeStyle(style);

  if (!paintStyle && !strokeStyle) {
    return undefined;
  }

  return { paintStyle, strokeStyle };
}

export function parseSketchStyleRecord(
  style: SketchStyleRecord,
): SketchEntityDisplayStyle | undefined {
  const paintStyle = parseSketchStyleRecordFill(style.fill);
  const strokeStyle = parseSketchStyleRecordStroke(style.stroke);

  if (!paintStyle && !strokeStyle) {
    return undefined;
  }

  return { paintStyle, strokeStyle };
}

export function parseSketchStyleRecordFill(
  fill: SketchStyleRecord["fill"],
): SketchDisplayPaintStyle | undefined {
  if (fill.kind === "none") {
    return undefined;
  }

  if (fill.kind === "solid") {
    return {
      kind: "solid",
      color: parseColorValue(fill.color) ?? 0x48b6ff,
      opacity: fill.opacity,
    };
  }

  const startColor = parseColorValue(fill.gradient.startColor) ?? 0x48b6ff;
  const endColor = parseColorValue(fill.gradient.endColor) ?? startColor;
  return {
    kind: "linearGradient",
    color: startColor,
    opacity: fill.gradient.startOpacity,
    startColor,
    startOpacity: fill.gradient.startOpacity,
    endColor,
    endOpacity: fill.gradient.endOpacity,
    angleRadians: fill.gradient.angleRadians,
  };
}

export function parseSketchStyleRecordStroke(
  stroke: SketchStyleRecord["stroke"],
): SketchDisplayStrokeStyle | undefined {
  if (stroke.opacity <= 0 || stroke.width <= 0) {
    return undefined;
  }

  return {
    color: parseColorValue(stroke.color) ?? 0xdde7f0,
    opacity: stroke.opacity,
    width: stroke.width,
    lineCap: stroke.lineCap,
    lineJoin: stroke.lineJoin,
    miterLimit: stroke.miterLimit,
    dashSize: stroke.dashSize,
    gapSize: stroke.gapSize,
  };
}

export function parseLocalPaintStyle(
  style: SketchStyleDefinition,
): SketchDisplayPaintStyle | undefined {
  if (style.fillMode === undefined || style.fillMode === "none") {
    return undefined;
  }

  const color =
    parseColorValue(style.fillColor) ??
    (style.fillMode === "gradient"
      ? parseColorValue(style.gradientStartColor)
      : null) ??
    0x48b6ff;

  if (style.fillMode === "gradient") {
    const startColor = parseColorValue(style.gradientStartColor) ?? color;
    const endColor = parseColorValue(style.gradientEndColor) ?? color;
    return {
      kind: "linearGradient",
      color,
      opacity: 0.32,
      startColor,
      startOpacity: 0.32,
      endColor,
      endOpacity: 0.32,
      angleRadians: 0,
    };
  }

  return {
    kind: "solid",
    color,
    opacity: 0.42,
  };
}

export function parseLocalStrokeStyle(
  style: SketchStyleDefinition,
): SketchDisplayStrokeStyle | undefined {
  if (style.strokeEnabled !== true) {
    return undefined;
  }

  return {
    color: parseColorValue(style.strokeColor) ?? 0xdde7f0,
    opacity: 0.95,
    width: style.strokeWidth,
    lineCap: style.strokeCap,
    lineJoin: style.strokeJoin,
    miterLimit: style.strokeMiterLimit,
    dashSize: style.strokeDashSize,
    gapSize: style.strokeGapSize,
  };
}

export function getPersistedSketchStyleRecords(
  definition: SketchDefinition,
): Map<string, SketchEntityDisplayStyle> {
  const rawDefinition = definition as SketchDefinition & {
    styles?: unknown;
    styleDefinitions?: unknown;
  };
  const styleEntries = Array.isArray(rawDefinition.styles)
    ? rawDefinition.styles
    : Array.isArray(rawDefinition.styleDefinitions)
      ? rawDefinition.styleDefinitions
      : [];
  const records = new Map<string, SketchEntityDisplayStyle>();

  for (const entry of styleEntries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const styleId = getRecordStringValue(entry, "styleId");
    if (!styleId) {
      continue;
    }

    const paintStyle = parsePaintStyle(
      getRecordObjectValue(entry, "paint") ??
        getRecordObjectValue(entry, "fill"),
    );
    const strokeStyle = parseStrokeStyle(getRecordObjectValue(entry, "stroke"));
    if (!paintStyle && !strokeStyle) {
      continue;
    }

    records.set(styleId, { paintStyle, strokeStyle });
  }

  return records;
}

export function getEntityStyleId(
  entity: SketchEntityDefinition,
): string | null {
  const rawEntity = entity as SketchEntityDefinition & {
    styleId?: unknown;
    style?: unknown;
    displayStyleId?: unknown;
  };
  const styleId =
    getOptionalString(rawEntity.styleId) ??
    getOptionalString(rawEntity.displayStyleId);
  if (styleId) {
    return styleId;
  }

  const styleRecord = getRecordObjectValue(rawEntity, "style");
  if (!styleRecord) {
    return null;
  }

  return getRecordStringValue(styleRecord, "styleId");
}

export function parsePaintStyle(
  value: Record<string, unknown> | null,
): SketchDisplayPaintStyle | undefined {
  if (!value) {
    return undefined;
  }

  if (value.kind === "gradient") {
    const gradient = getRecordObjectValue(value, "gradient");
    const startColor = parseColorValue(gradient?.startColor);
    const endColor = parseColorValue(gradient?.endColor);
    if (startColor === null || endColor === null) {
      return undefined;
    }

    return {
      kind: "linearGradient",
      color: startColor,
      opacity: getOptionalNumber(gradient?.startOpacity) ?? 1,
      startColor,
      startOpacity: getOptionalNumber(gradient?.startOpacity) ?? 1,
      endColor,
      endOpacity: getOptionalNumber(gradient?.endOpacity) ?? 1,
      angleRadians: getOptionalNumber(gradient?.angleRadians) ?? 0,
    };
  }

  const color = parseColorValue(value.color);
  if (color === null) {
    return undefined;
  }

  return {
    kind: "solid",
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
  };
}

export function parseStrokeStyle(
  value: Record<string, unknown> | null,
): SketchDisplayStrokeStyle | undefined {
  if (!value) {
    return undefined;
  }

  const color = parseColorValue(value.color);
  if (color === null) {
    return undefined;
  }

  return {
    color,
    opacity: getOptionalNumber(value.opacity) ?? 1,
    width: getOptionalNumber(value.width) ?? getOptionalNumber(value.thickness),
    lineCap: getOptionalStrokeCap(value.lineCap),
    lineJoin: getOptionalStrokeJoin(value.lineJoin),
    miterLimit: getOptionalNumber(value.miterLimit),
    dashSize: getOptionalNumber(value.dashSize),
    gapSize: getOptionalNumber(value.gapSize),
  };
}

export function getOptionalStrokeCap(
  value: unknown,
): SketchDisplayStrokeStyle["lineCap"] | undefined {
  return value === "butt" || value === "round" || value === "square"
    ? value
    : undefined;
}

export function getOptionalStrokeJoin(
  value: unknown,
): SketchDisplayStrokeStyle["lineJoin"] | undefined {
  return value === "miter" || value === "round" || value === "bevel"
    ? value
    : undefined;
}

export function parseColorValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }

  return Number.parseInt(hex, 16);
}

export function getRecordObjectValue(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function getRecordStringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return getOptionalString(record[key]);
}

export function getOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function createReferenceRecordTarget(
  referenceId: ReferenceId,
): PrimitiveRef {
  return {
    kind: "sketchExternalReference",
    referenceId,
  };
}

export function createSketchDatumReferenceTarget(
  sketchId: SketchId,
  datumId: "origin" | "xAxis" | "yAxis",
  geometryKind: "point" | "lineSegment",
): PrimitiveRef {
  return {
    kind: "sketchDatumReference",
    sketchId,
    datumId,
    geometryKind,
  };
}

export function createDisplayRenderableForSketchDatum(
  session: SketchSessionState,
  sketchId: SketchId,
  datumId: "origin" | "xAxis" | "yAxis",
  extent: number,
): SketchSessionDisplayRenderable {
  if (datumId === "origin") {
    return {
      id: `renderable_sketch_datum_origin_${sketchId}` as RenderableId,
      label: "Sketch origin",
      target: createSketchDatumReferenceTarget(sketchId, "origin", "point"),
      geometry: {
        kind: "marker",
        position: mapSketchPointToWorld(session.plane, [0, 0]),
        displayRadius: 0.18,
      },
      linePattern: "solid",
      role: "reference",
    };
  }

  const start: SketchPoint = datumId === "xAxis" ? [-extent, 0] : [0, -extent];
  const end: SketchPoint = datumId === "xAxis" ? [extent, 0] : [0, extent];

  return {
    id: `renderable_sketch_datum_${datumId}_${sketchId}` as RenderableId,
    label: datumId === "xAxis" ? "Sketch X axis" : "Sketch Y axis",
    target: createSketchDatumReferenceTarget(sketchId, datumId, "lineSegment"),
    geometry: {
      kind: "polyline",
      points: [
        mapSketchPointToWorld(session.plane, start),
        mapSketchPointToWorld(session.plane, end),
      ],
      isClosed: false,
    },
    linePattern: "dashed",
    role: "reference",
  };
}

export function createDisplayRenderableForReferenceRecord(
  session: SketchSessionState,
  referenceId: ReferenceId,
  index: number,
): SketchSessionDisplayRenderable {
  const column = index % 6;
  const row = Math.floor(index / 6);

  return {
    id: `renderable_reference_marker_${referenceId}` as RenderableId,
    label: `Reference ${referenceId}`,
    target: createReferenceRecordTarget(referenceId),
    geometry: {
      kind: "marker",
      position: mapSketchPointToWorld(session.plane, [
        -0.72 + column * 0.24,
        -0.72 - row * 0.24,
      ]),
      displayRadius: 0.12,
    },
    linePattern: "solid",
    role: "reference",
  };
}

export function createProjectedGeometryTarget(
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord["geometry"][number],
): PrimitiveRef {
  return {
    kind: "projectedReferenceGeometry",
    referenceId,
    geometryId: geometry.geometryId,
    geometryKind: geometry.kind,
  };
}

export function createDisplayRenderableForProjectedGeometry(
  session: SketchSessionState,
  referenceId: ReferenceId,
  geometry: ProjectedSketchReferenceRecord["geometry"][number],
  index: number,
): SketchSessionDisplayRenderable {
  const target = createProjectedGeometryTarget(referenceId, geometry);

  if (geometry.kind === "point") {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: "marker",
        position: mapSketchPointToWorld(session.plane, geometry.position),
        displayRadius: 0.14,
      },
      linePattern: "dashed",
      role: "reference",
    };
  }

  if (geometry.kind === "lineSegment") {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: "polyline",
        points: [
          mapSketchPointToWorld(session.plane, geometry.startPosition),
          mapSketchPointToWorld(session.plane, geometry.endPosition),
        ],
        isClosed: false,
      },
      linePattern: "dashed",
      role: "reference",
    };
  }

  if (geometry.kind === "circle") {
    const pointCount = 48;
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: "polyline",
        points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
          const angle = (Math.PI * 2 * pointIndex) / pointCount;
          return mapSketchPointToWorld(session.plane, [
            geometry.centerPosition[0] + Math.cos(angle) * geometry.radius,
            geometry.centerPosition[1] + Math.sin(angle) * geometry.radius,
          ]);
        }),
        isClosed: true,
      },
      linePattern: "dashed",
      role: "reference",
    };
  }

  if (geometry.kind === "spline") {
    return {
      id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
      label: `Projected ${geometry.geometryId}`,
      target,
      geometry: {
        kind: "polyline",
        points: tessellateProjectedSpline(geometry).map((point) =>
          mapSketchPointToWorld(session.plane, point),
        ),
        isClosed: projectedSplineIsClosed(geometry),
      },
      linePattern: "dashed",
      role: "reference",
    };
  }

  const startAngle = Math.atan2(
    geometry.startPosition[1] - geometry.centerPosition[1],
    geometry.startPosition[0] - geometry.centerPosition[0],
  );
  const endAngle = Math.atan2(
    geometry.endPosition[1] - geometry.centerPosition[1],
    geometry.endPosition[0] - geometry.centerPosition[0],
  );
  const radius = Math.hypot(
    geometry.startPosition[0] - geometry.centerPosition[0],
    geometry.startPosition[1] - geometry.centerPosition[1],
  );
  const normalizedEnd =
    geometry.sweepDirection === "counterClockwise" && endAngle < startAngle
      ? endAngle + Math.PI * 2
      : geometry.sweepDirection === "clockwise" && endAngle > startAngle
        ? endAngle - Math.PI * 2
        : endAngle;
  const pointCount = 32;

  return {
    id: `renderable_projected_${referenceId}_${geometry.geometryId}_${index}` as RenderableId,
    label: `Projected ${geometry.geometryId}`,
    target,
    geometry: {
      kind: "polyline",
      points: Array.from({ length: pointCount + 1 }, (_, pointIndex) => {
        const angle =
          startAngle + ((normalizedEnd - startAngle) * pointIndex) / pointCount;
        return mapSketchPointToWorld(session.plane, [
          geometry.centerPosition[0] + Math.cos(angle) * radius,
          geometry.centerPosition[1] + Math.sin(angle) * radius,
        ]);
      }),
      isClosed: false,
    },
    linePattern: "dashed",
    role: "reference",
  };
}
