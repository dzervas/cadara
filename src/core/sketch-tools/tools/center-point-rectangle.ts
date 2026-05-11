import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from "@/core/sketch-tools/definition";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import {
  createDistanceDimension,
  createMidpointConstraint,
} from "@/core/sketch-tools/constraints";
import { getAxisAlignedRectangleCorners } from "@/core/sketch-tools/geometry";
import {
  createSketchToolDefinition,
  midpoint,
  validateRectangle,
} from "@/core/sketch-tools/shared";

function buildCenterPointRectanglePreview(
  center: SketchPoint,
  corner: SketchPoint,
): readonly SketchDraftEntity[] {
  const { bottomLeft, bottomRight, topRight, topLeft } =
    getAxisAlignedRectangleCorners(center, corner);

  return [
    {
      id: "preview-center-rect-bottom",
      kind: "line",
      start: bottomLeft,
      end: bottomRight,
      entityId: null,
      status: "preview",
      label: "Center rectangle preview bottom",
      isConstruction: false,
    },
    {
      id: "preview-center-rect-right",
      kind: "line",
      start: bottomRight,
      end: topRight,
      entityId: null,
      status: "preview",
      label: "Center rectangle preview right",
      isConstruction: false,
    },
    {
      id: "preview-center-rect-top",
      kind: "line",
      start: topRight,
      end: topLeft,
      entityId: null,
      status: "preview",
      label: "Center rectangle preview top",
      isConstruction: false,
    },
    {
      id: "preview-center-rect-left",
      kind: "line",
      start: topLeft,
      end: bottomLeft,
      entityId: null,
      status: "preview",
      label: "Center rectangle preview left",
      isConstruction: false,
    },
  ];
}

function validateCenterPointRectangle(
  center: SketchPoint,
  corner: SketchPoint,
) {
  return validateRectangle(center, corner);
}

function buildCenterPointRectanglePresentation(
  state: SketchToolRuntimeState,
): SketchToolPresentationSchema {
  const center = state.status === "drawing" ? state.pointerDownPoint : null;
  const corner = state.status === "drawing" ? state.livePoint : null;
  const isDrawing = center !== null && corner !== null;
  const width = isDrawing ? Math.abs(corner[0] - center[0]) * 2 : null;
  const height = isDrawing ? Math.abs(corner[1] - center[1]) * 2 : null;
  const validation = state.validationMessage
    ? [
        {
          id: "center-rectangle-validation",
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];

  return {
    prompts: [
      {
        id: "center-rectangle-prompt",
        text: isDrawing ? "Place corner" : "Pick rectangle center",
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    steps: [
      { id: "center-rectangle-step", label: isDrawing ? "Corner" : "Center" },
    ],
    measurements: isDrawing
      ? [
          {
            id: "center-rectangle-width",
            label: "Width",
            value: width ?? 0,
            unit: "mm",
          },
          {
            id: "center-rectangle-height",
            label: "Height",
            value: height ?? 0,
            unit: "mm",
          },
        ]
      : [],
    completionHints: [
      {
        id: "center-rectangle-completion",
        text: isDrawing
          ? "Click to accept the rectangle"
          : "Click to set the center",
        ready: isDrawing
          ? validateCenterPointRectangle(center, corner).valid
          : false,
      },
    ],
    overlays: isDrawing
      ? [
          {
            id: "center-rectangle-center",
            kind: "helperMarker",
            label: "Center",
            point: center,
          },
          {
            id: "center-rectangle-width-overlay",
            kind: "measurement",
            label: "Width",
            value: width ?? 0,
            unit: "mm",
            anchor: {
              kind: "sketchPoint",
              point: midpoint([center[0], corner[1]], corner),
              offset: { x: 0, y: -28 },
            },
          },
          {
            id: "center-rectangle-completion-cue",
            kind: "completionCue",
            label: "Place corner",
            point: corner,
            ready: validateCenterPointRectangle(center, corner).valid,
          },
        ]
      : [],
    validation,
  };
}

export const centerPointRectangleSketchToolDefinition: SketchToolDefinition<"centerPointRectangle"> =
  createSketchToolDefinition(
    {
      id: "centerPointRectangle",
      group: "drawing",
      name: "Center Rectangle",
      tooltip: "Create an axis-aligned rectangle from its center.",
      icon: "rectangle",
      modes: ["sketch"],
    },
    {
      buildPreview: buildCenterPointRectanglePreview,
      buildPresentation: buildCenterPointRectanglePresentation,
      validate: validateCenterPointRectangle,
      createCommitContribution({
        sequence,
        start,
        end,
        factories,
      }): SketchToolCommitContribution {
        const { bottomLeft, bottomRight, topRight, topLeft, center } =
          getAxisAlignedRectangleCorners(start, end);
        const cornerIds = [
          factories.createPointId("center-rect-bottom-left"),
          factories.createPointId("center-rect-bottom-right"),
          factories.createPointId("center-rect-top-right"),
          factories.createPointId("center-rect-top-left"),
        ] as const;
        const centerPointId = factories.createPointId("center-rect-center");
        const entityIds = [
          factories.createEntityId("center-rect-bottom"),
          factories.createEntityId("center-rect-right"),
          factories.createEntityId("center-rect-top"),
          factories.createEntityId("center-rect-left"),
          factories.createEntityId("center-rect-diagonal-a"),
          factories.createEntityId("center-rect-diagonal-b"),
        ] as const;

        return {
          points: [
            factories.createPoint(
              `Center rectangle ${sequence} bottom left`,
              cornerIds[0],
              bottomLeft,
            ),
            factories.createPoint(
              `Center rectangle ${sequence} bottom right`,
              cornerIds[1],
              bottomRight,
            ),
            factories.createPoint(
              `Center rectangle ${sequence} top right`,
              cornerIds[2],
              topRight,
            ),
            factories.createPoint(
              `Center rectangle ${sequence} top left`,
              cornerIds[3],
              topLeft,
            ),
            factories.createPoint(
              `Center rectangle ${sequence} center`,
              centerPointId,
              center,
            ),
          ],
          entities: [
            factories.createLineEntity(
              `Center rectangle ${sequence} bottom`,
              entityIds[0],
              cornerIds[0],
              cornerIds[1],
            ),
            factories.createLineEntity(
              `Center rectangle ${sequence} right`,
              entityIds[1],
              cornerIds[1],
              cornerIds[2],
            ),
            factories.createLineEntity(
              `Center rectangle ${sequence} top`,
              entityIds[2],
              cornerIds[2],
              cornerIds[3],
            ),
            factories.createLineEntity(
              `Center rectangle ${sequence} left`,
              entityIds[3],
              cornerIds[3],
              cornerIds[0],
            ),
            {
              ...factories.createLineEntity(
                `Center rectangle ${sequence} diagonal`,
                entityIds[4],
                cornerIds[0],
                cornerIds[2],
              ),
              isConstruction: true,
            },
            {
              ...factories.createLineEntity(
                `Center rectangle ${sequence} diagonal`,
                entityIds[5],
                cornerIds[1],
                cornerIds[3],
              ),
              isConstruction: true,
            },
          ],
          constraints: [
            {
              constraintId: factories.createConstraintId(
                "center-rect-bottom-horizontal",
              ),
              kind: "horizontal",
              label: `Center rectangle ${sequence} bottom horizontal`,
              entityId: entityIds[0],
            },
            {
              constraintId: factories.createConstraintId(
                "center-rect-top-horizontal",
              ),
              kind: "horizontal",
              label: `Center rectangle ${sequence} top horizontal`,
              entityId: entityIds[2],
            },
            {
              constraintId: factories.createConstraintId(
                "center-rect-right-vertical",
              ),
              kind: "vertical",
              label: `Center rectangle ${sequence} right vertical`,
              entityId: entityIds[1],
            },
            {
              constraintId: factories.createConstraintId(
                "center-rect-left-vertical",
              ),
              kind: "vertical",
              label: `Center rectangle ${sequence} left vertical`,
              entityId: entityIds[3],
            },
            createMidpointConstraint({
              constraintId: factories.createConstraintId(
                "center-rect-diagonal-a-midpoint",
              ),
              label: `Center rectangle ${sequence} center`,
              pointId: centerPointId,
              lineEntityId: entityIds[4],
            }),
            createMidpointConstraint({
              constraintId: factories.createConstraintId(
                "center-rect-diagonal-b-midpoint",
              ),
              label: `Center rectangle ${sequence} center`,
              pointId: centerPointId,
              lineEntityId: entityIds[5],
            }),
          ],
          dimensions: [
            createDistanceDimension({
              dimensionId: factories.createDimensionId("center-rect-width"),
              label: `Center rectangle ${sequence} width`,
              axis: "horizontal",
              pointIds: [cornerIds[0], cornerIds[1]],
              value: Math.abs(topRight[0] - bottomLeft[0]),
            }),
            createDistanceDimension({
              dimensionId: factories.createDimensionId("center-rect-height"),
              label: `Center rectangle ${sequence} height`,
              axis: "vertical",
              pointIds: [cornerIds[0], cornerIds[3]],
              value: Math.abs(topRight[1] - bottomLeft[1]),
            }),
          ],
        };
      },
    },
  );
