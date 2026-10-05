import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolLifecycle,
  SketchToolRuntimeState,
} from "@/core/sketch-tools/definition";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import { createIdleState } from "@/core/sketch-tools/shared";
import {
  reconstructSplineAggregate,
  tessellateCubicSpans,
} from "@/contracts/sketch/spline-geometry";

// Fit points are added until the spline is finalized (Enter, double-click
// or Escape) with at least `minimum` of them (T11-D10, D13).
const lifecycle = {
  kind: "fitPoints",
  minimum: 2,
} as const satisfies SketchToolLifecycle;

function getPlacedPoints(
  state: SketchToolRuntimeState,
): readonly SketchPoint[] {
  return state.placedPoints ?? [];
}

/**
 * The placed fit points plus the live pointer while drawing. A pointer on
 * the last fit point (where a release is ignored) adds nothing, so the
 * preview keeps refitting through the placed points.
 */
function getPreviewPoints(
  state: SketchToolRuntimeState,
): readonly SketchPoint[] {
  const placedPoints = getPlacedPoints(state);

  return state.livePoint &&
    state.status === "drawing" &&
    !isCoincidentWithLastFitPoint(placedPoints, state.livePoint)
    ? [...placedPoints, state.livePoint]
    : placedPoints;
}

/** Whether `point` would make a zero-length span after the last fit point. */
function isCoincidentWithLastFitPoint(
  placedPoints: readonly SketchPoint[],
  point: SketchPoint,
) {
  const last = placedPoints.at(-1);

  return (
    last !== undefined &&
    reconstructPreviewSpline([last, point]).diagnostics.some(
      (diagnostic) => diagnostic.code === "coincident-points",
    )
  );
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

  if (points.length < lifecycle.minimum) {
    return {
      valid: false,
      message: `Spline requires ${lifecycle.minimum} points.`,
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
  const previewPoints = getPreviewPoints(state);
  const validation = state.validationMessage
    ? [
        {
          id: "spline-validation",
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];
  const missing = lifecycle.minimum - placedPoints.length;
  const ready = missing <= 0;

  return {
    prompts: [
      {
        id: "spline-prompt",
        text: ready
          ? "Place more spline points or finish the spline"
          : "Place spline points",
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    steps: [
      {
        id: "spline-step",
        label: `${placedPoints.length} point${placedPoints.length === 1 ? "" : "s"}`,
      },
    ],
    cursor: { id: "spline-cursor", label: "Spline point", icon: "crosshair" },
    completionHints: [
      {
        id: "spline-completion",
        text: ready
          ? "Press Enter, double-click or press Escape to finish the spline"
          : `Place ${missing} more point${missing === 1 ? "" : "s"}`,
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
              label: ready ? "Add point or finish spline" : "Add point",
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
        pointCount: placedPoints.length,
        minimumPointCount: lifecycle.minimum,
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
  lifecycle,
  activate() {
    const state = createIdleState();

    return {
      state,
      stagedEntities: [],
      presentation: buildSplinePresentation(state),
    };
  },
  pointerMove({ state, point }) {
    const movedState = { ...state, livePoint: point };
    const previewPoints = getPreviewPoints(movedState);
    const nextState = {
      ...movedState,
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

    const placedPoints = getPlacedPoints(state);
    // A release on the last fit point is ignored; the draft goes on.
    if (
      state.status === "drawing" &&
      isCoincidentWithLastFitPoint(placedPoints, point)
    ) {
      return splineSketchToolDefinition.pointerMove({ state, point });
    }

    // Each release adds a fit point; the spline never completes on a
    // release, only when it is finalized.
    const nextPoints = [...placedPoints, point];
    const nextState = {
      status: "drawing",
      pointerDownPoint: nextPoints[0] ?? point,
      livePoint: null,
      placedPoints: nextPoints,
      validationMessage: getSplineGeometryValidationMessage(nextPoints),
    } satisfies SketchToolRuntimeState;

    return {
      state: nextState,
      stagedEntities: buildSplinePreview(nextPoints),
      presentation: buildSplinePresentation(nextState),
    };
  },
  getStagedEntities(state) {
    return buildSplinePreview(getPreviewPoints(state));
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
    const splinePoints = points ?? [];
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
