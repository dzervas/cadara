import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from "@/core/sketch-tools/definition";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import {
  createCircleRadiusDimension,
  createEqualLengthConstraint,
  createPointOnCurveConstraint,
  createTangentConstraint,
} from "@/core/sketch-tools/constraints";
import {
  createRegularPolygonVertices,
  pointsDistinct,
} from "@/core/sketch-tools/geometry";
import {
  createSketchToolDefinition,
  distanceBetween,
  validateDistance,
} from "@/core/sketch-tools/shared";

const DEFAULT_SIDE_COUNT = 6;

export function createRegularPolygonSketchToolDefinition(input: {
  id: "inscribedPolygon" | "circumscribedPolygon";
  name: string;
  tooltip: string;
  dropdown?: SketchToolDefinition<"inscribedPolygon">["metadata"]["dropdown"];
  mode: "inscribed" | "circumscribed";
}): SketchToolDefinition<"inscribedPolygon" | "circumscribedPolygon"> {
  const buildPreview = (
    center: SketchPoint,
    edgePoint: SketchPoint,
  ): readonly SketchDraftEntity[] => {
    const radius = getVertexRadius(
      input.mode,
      distanceBetween(center, edgePoint),
      DEFAULT_SIDE_COUNT,
    );
    const vertices = createRegularPolygonVertices({
      center,
      radius,
      sideCount: DEFAULT_SIDE_COUNT,
    });

    return [
      {
        id: `preview-${input.id}`,
        kind: "polyline",
        points: vertices,
        isClosed: true,
        entityId: null,
        status: "preview",
        label: `${input.name} preview`,
        isConstruction: false,
      },
    ];
  };

  const validate = (center: SketchPoint, edgePoint: SketchPoint) =>
    validateDistance(
      center,
      edgePoint,
      `${input.name} requires a center and radius.`,
    );

  const buildPresentation = (
    state: SketchToolRuntimeState,
  ): SketchToolPresentationSchema => {
    const center = state.status === "drawing" ? state.pointerDownPoint : null;
    const edgePoint = state.status === "drawing" ? state.livePoint : null;
    const isDrawing = center !== null && edgePoint !== null;
    const radius = isDrawing ? distanceBetween(center, edgePoint) : 0;
    const validation = state.validationMessage
      ? [
          {
            id: `${input.id}-validation`,
            message: state.validationMessage,
            severity: "error" as const,
          },
        ]
      : [];

    return {
      prompts: [
        {
          id: `${input.id}-prompt`,
          text: isDrawing ? "Set polygon radius" : "Pick polygon center",
          tone: validation.length > 0 ? "warning" : "neutral",
        },
      ],
      steps: [
        { id: `${input.id}-step`, label: isDrawing ? "Radius" : "Center" },
      ],
      measurements: isDrawing
        ? [
            {
              id: `${input.id}-radius`,
              label: "Radius",
              value: radius,
              unit: "mm",
            },
          ]
        : [],
      completionHints: [
        {
          id: `${input.id}-completion`,
          text: isDrawing
            ? "Click to accept the polygon"
            : "Click to set the center",
          ready: isDrawing ? validate(center, edgePoint).valid : false,
        },
      ],
      overlays: isDrawing
        ? [
            {
              id: `${input.id}-center`,
              kind: "helperMarker",
              label: "Center",
              point: center,
            },
            {
              id: `${input.id}-cue`,
              kind: "completionCue",
              label: "Place radius",
              point: edgePoint,
              ready: validate(center, edgePoint).valid,
            },
          ]
        : [],
      validation,
    };
  };

  return createSketchToolDefinition(
    {
      id: input.id,
      group: "drawing",
      name: input.name,
      tooltip: input.tooltip,
      icon: "line",
      modes: ["sketch"],
      dropdown: input.dropdown,
    },
    {
      buildPreview,
      buildPresentation,
      validate,
      createCommitContribution({
        sequence,
        start,
        end,
        factories,
      }): SketchToolCommitContribution {
        if (!pointsDistinct(start, end)) {
          return { points: [], entities: [] };
        }

        const circleRadius = distanceBetween(start, end);
        const vertexRadius = getVertexRadius(
          input.mode,
          circleRadius,
          DEFAULT_SIDE_COUNT,
        );
        const vertices = createRegularPolygonVertices({
          center: start,
          radius: vertexRadius,
          sideCount: DEFAULT_SIDE_COUNT,
        });
        const centerPointId = factories.createPointId(`${input.id}-center`);
        const vertexPointIds = vertices.map((_, index) =>
          factories.createPointId(`${input.id}-vertex-${index + 1}`),
        );
        const entityIds = vertices.map((_, index) =>
          factories.createEntityId(`${input.id}-side-${index + 1}`),
        );
        const circleEntityId = factories.createEntityId(
          `${input.id}-construction-circle`,
        );

        return {
          points: [
            factories.createPoint(
              `${input.name} ${sequence} center`,
              centerPointId,
              start,
            ),
            ...vertices.map((point, index) =>
              factories.createPoint(
                `${input.name} ${sequence} vertex ${index + 1}`,
                vertexPointIds[index]!,
                point,
              ),
            ),
          ],
          entities: [
            {
              ...factories.createCircleEntity(
                `${input.name} ${sequence} construction circle`,
                circleEntityId,
                centerPointId,
                circleRadius,
              ),
              isConstruction: true,
            },
            ...vertices.map((_, index) =>
              factories.createLineEntity(
                `${input.name} ${sequence} side ${index + 1}`,
                entityIds[index]!,
                vertexPointIds[index]!,
                vertexPointIds[(index + 1) % vertexPointIds.length]!,
              ),
            ),
          ],
          constraints: [
            ...entityIds.slice(1).map((entityId, index) =>
              createEqualLengthConstraint({
                constraintId: factories.createConstraintId(
                  `${input.id}-equal-${index + 1}`,
                ),
                label: `${input.name} ${sequence} equal sides`,
                entityIds: [entityIds[0]!, entityId],
              }),
            ),
            ...(input.mode === "inscribed"
              ? vertexPointIds.map((pointId, index) =>
                  createPointOnCurveConstraint({
                    constraintId: factories.createConstraintId(
                      `${input.id}-vertex-on-circle-${index + 1}`,
                    ),
                    label: `${input.name} ${sequence} vertex on circle`,
                    pointId,
                    curveEntityId: circleEntityId,
                  }),
                )
              : entityIds.map((entityId, index) =>
                  createTangentConstraint({
                    constraintId: factories.createConstraintId(
                      `${input.id}-side-tangent-${index + 1}`,
                    ),
                    label: `${input.name} ${sequence} tangent side`,
                    entityIds: [entityId, circleEntityId],
                  }),
                )),
          ],
          dimensions: [
            createCircleRadiusDimension({
              dimensionId: factories.createDimensionId(`${input.id}-radius`),
              label: `${input.name} ${sequence} radius`,
              entityId: circleEntityId,
              value: circleRadius,
            }),
          ],
        };
      },
    },
  );
}

function getVertexRadius(
  mode: "inscribed" | "circumscribed",
  circleRadius: number,
  sideCount: number,
) {
  return mode === "inscribed"
    ? circleRadius
    : circleRadius / Math.cos(Math.PI / sideCount);
}
