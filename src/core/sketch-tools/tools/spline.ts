import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
} from "@/core/sketch-tools/definition";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import { createIdleState } from "@/core/sketch-tools/shared";
import {
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";

const MIN_SPLINE_POINTS = 3;

function getPlacedPoints(
  state: SketchToolRuntimeState,
): readonly SketchPoint[] {
  return state.placedPoints ?? [];
}

function reconstructPreviewSpline(points: readonly SketchPoint[]) {
  const pointOccurrences = points.map((_, index) => ({
    occurrenceId: `preview-spline-occurrence-${index}`,
    pointId: `preview-spline-point-${index}`,
    tangent: { kind: "automatic" as const },
  }));
  return reconstructSplineAggregate(
    {
      entityId: "preview-spline",
      pointOccurrenceIds: pointOccurrences.map(
        (occurrence) => occurrence.occurrenceId,
      ),
      pointOccurrences,
      closure: "open",
      interpolationPolicy: "centripetal-mean-arm-v1",
    },
    Object.fromEntries(
      points.map((point, index) => [`preview-spline-point-${index}`, point]),
    ),
  );
}

function getSplineGeometryValidationMessage(
  points: readonly SketchPoint[],
): string | null {
  if (points.length < 2) {
    return null;
  }

  const reconstruction = reconstructPreviewSpline(points);
  if (reconstruction.validity === "valid") {
    return null;
  }

  return reconstruction.diagnostics[0]?.code === "coincident-points"
    ? "Spline has consecutive coincident fit points."
    : "Spline geometry is invalid.";
}

function buildSplinePreview(
  points: readonly SketchPoint[],
): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return [];
  }

  const sampled = tessellateCubicSpans(reconstructPreviewSpline(points).spans);

  return sampled.length < 2
    ? []
    : [
        {
          id: "preview-spline",
          kind: "spline",
          points: sampled,
          entityId: null,
          status: "preview",
          label: "Spline preview",
          isConstruction: false,
        },
      ];
}

function validateSpline(points: readonly SketchPoint[]) {
  const geometryMessage = getSplineGeometryValidationMessage(points);
  if (geometryMessage) {
    return { valid: false, message: geometryMessage };
  }

  if (points.length < MIN_SPLINE_POINTS) {
    return {
      valid: false,
      message: `Spline requires ${MIN_SPLINE_POINTS} points.`,
    };
  }

  return {
    valid: true,
    message: null,
  };
}

function buildSplinePresentation(
  state: SketchToolRuntimeState,
): SketchToolPresentationSchema {
  const placedPoints = getPlacedPoints(state);
  const previewPoints =
    state.livePoint && state.status === "drawing"
      ? [...placedPoints, state.livePoint]
      : placedPoints;
  const validation = state.validationMessage
    ? [
        {
          id: "spline-validation",
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];
  const ready = previewPoints.length >= MIN_SPLINE_POINTS;

  return {
    prompts: [
      {
        id: "spline-prompt",
        text: ready ? "Place final spline point" : "Place spline points",
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    steps: [
      {
        id: "spline-step",
        label: `${Math.min(previewPoints.length, MIN_SPLINE_POINTS)}/${MIN_SPLINE_POINTS} points`,
      },
    ],
    cursor: { id: "spline-cursor", label: "Spline point", icon: "crosshair" },
    completionHints: [
      {
        id: "spline-completion",
        text: ready
          ? "Click to accept the spline"
          : `Place ${MIN_SPLINE_POINTS - previewPoints.length} more point${MIN_SPLINE_POINTS - previewPoints.length === 1 ? "" : "s"}`,
        ready,
      },
    ],
    overlays: [
      ...placedPoints.map((point, index) => ({
        id: `spline-point-${index}`,
        kind: "anchor" as const,
        label: `Point ${index + 1}`,
        point,
      })),
      ...(previewPoints.at(-1)
        ? [
            {
              id: "spline-completion-cue",
              kind: "completionCue" as const,
              label: ready ? "Accept spline" : "Add point",
              point: previewPoints.at(-1)!,
              ready,
            },
          ]
        : []),
    ],
    validation,
    extension: {
      id: "spline-workflow",
      payload: {
        pointCount: previewPoints.length,
        minimumPointCount: MIN_SPLINE_POINTS,
        readyToComplete: ready,
      },
    },
  };
}

export const splineSketchToolDefinition: SketchToolDefinition<"spline"> = {
  metadata: {
    id: "spline",
    group: "drawing",
    name: "Spline",
    tooltip: "Create spline geometry.",
    icon: "spline",
    modes: ["sketch"],
    dropdown: {
      familyId: "spline-family",
      variantIds: ["spline", "controlPointSpline"],
    },
  },
  lifecycle: { kind: "fitPoints", minimum: 2 },
  activate() {
    const state = createIdleState();

    return {
      state,
      stagedEntities: [],
      presentation: buildSplinePresentation(state),
    };
  },
  pointerMove({ state, point }) {
    const previewPoints =
      point && state.status === "drawing"
        ? [...getPlacedPoints(state), point]
        : getPlacedPoints(state);
    const nextState = {
      ...state,
      livePoint: point,
      validationMessage: getSplineGeometryValidationMessage(previewPoints),
    };

    return {
      state: nextState,
      stagedEntities: buildSplinePreview(previewPoints),
      presentation: buildSplinePresentation(nextState),
    };
  },
  pointerRelease({ state, point }) {
    if (!point) {
      return {
        state,
        stagedEntities: buildSplinePreview(getPlacedPoints(state)),
        presentation: buildSplinePresentation(state),
      };
    }

    const nextPoints = [...getPlacedPoints(state), point];
    const complete = nextPoints.length >= MIN_SPLINE_POINTS;
    const nextState = {
      status: complete ? "idle" : "drawing",
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: null,
      placedPoints: nextPoints,
      validationMessage: getSplineGeometryValidationMessage(nextPoints),
    } satisfies SketchToolRuntimeState;

    return {
      state: nextState,
      stagedEntities: complete ? [] : buildSplinePreview(nextPoints),
      presentation: buildSplinePresentation(nextState),
    };
  },
  getStagedEntities(state) {
    const previewPoints =
      state.livePoint && state.status === "drawing"
        ? [...getPlacedPoints(state), state.livePoint]
        : getPlacedPoints(state);

    return buildSplinePreview(previewPoints);
  },
  validate(start, end) {
    return validateSpline([start, end]);
  },
  getPresentation: buildSplinePresentation,
  createCommitContribution({
    sequence,
    points,
    factories,
  }): SketchToolCommitContribution {
    const splinePoints = (points ?? []).slice(0, MIN_SPLINE_POINTS);
    const pointIds = splinePoints.map((_, index) =>
      factories.createPointId(`spline-${index + 1}`),
    );
    const entityId = factories.createEntityId("spline");

    return {
      points: splinePoints.map((point, index) =>
        factories.createPoint(
          `Spline ${sequence} point ${index + 1}`,
          pointIds[index]!,
          point,
        ),
      ),
      entities: [
        factories.createSplineEntity(`Spline ${sequence}`, entityId, pointIds),
      ],
    };
  },
};
