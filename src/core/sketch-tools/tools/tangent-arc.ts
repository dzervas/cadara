import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchSnapCandidate } from "@/domain/sketch-snapping/snap-candidates";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
  SketchToolValidationResult,
} from "@/core/sketch-tools/definition";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import {
  createArcEndpointDimensions,
  createPointOnCurveConstraint,
  createTangentConstraint,
} from "@/core/sketch-tools/constraints";
import {
  getTangentArcCircle,
  pointsDistinct,
  sampleArcPoints,
} from "@/core/sketch-tools/geometry";

const REQUIRED_POINTS = 3;

function getPlacedPoints(
  state: SketchToolRuntimeState,
): readonly SketchPoint[] {
  return state.placedPoints ?? [];
}

function buildTangentArcPreview(
  points: readonly SketchPoint[],
): readonly SketchDraftEntity[] {
  if (points.length < 2) {
    return [];
  }

  if (points.length < 3) {
    return [
      {
        id: "preview-tangent-arc-vector",
        kind: "line",
        start: points[0]!,
        end: points[1]!,
        entityId: null,
        status: "preview",
        label: "Tangent direction",
        isConstruction: false,
      },
    ];
  }

  const circle = getTangentArcCircle(points[0]!, points[1]!, points[2]!);
  if (!circle) {
    return [];
  }

  return [
    {
      id: "preview-tangent-arc",
      kind: "polyline",
      points: sampleArcPoints(
        circle.center,
        points[0]!,
        points[2]!,
        circle.sweepDirection,
      ),
      isClosed: false,
      entityId: null,
      status: "preview",
      label: "Tangent arc preview",
      isConstruction: false,
    },
  ];
}

function validateTangentArc(
  points: readonly SketchPoint[],
): SketchToolValidationResult {
  if (points.length < REQUIRED_POINTS) {
    return {
      valid: false,
      message: `Tangent arc requires ${REQUIRED_POINTS} points.`,
    };
  }

  if (
    !pointsDistinct(points[0]!, points[1]!) ||
    !pointsDistinct(points[0]!, points[2]!)
  ) {
    return {
      valid: false,
      message: "Tangent arc requires a tangent direction and end point.",
    };
  }

  return getTangentArcCircle(points[0]!, points[1]!, points[2]!)
    ? { valid: true, message: null }
    : {
        valid: false,
        message: "Tangent arc end cannot lie on the tangent line.",
      };
}

function buildTangentArcPresentation(
  state: SketchToolRuntimeState,
): SketchToolPresentationSchema {
  const points =
    state.livePoint && state.status === "drawing"
      ? [...getPlacedPoints(state), state.livePoint]
      : getPlacedPoints(state);
  const validation = state.validationMessage
    ? [
        {
          id: "tangent-arc-validation",
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];
  const ready = validateTangentArc(points).valid;

  return {
    prompts: [
      {
        id: "tangent-arc-prompt",
        text:
          points.length < 2
            ? "Pick tangent start and direction"
            : "Place arc end",
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    steps: [
      {
        id: "tangent-arc-step",
        label: `${Math.min(points.length, REQUIRED_POINTS)}/${REQUIRED_POINTS} points`,
      },
    ],
    completionHints: [
      {
        id: "tangent-arc-completion",
        text: ready
          ? "Click to accept the tangent arc"
          : `Place ${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS)} more point${REQUIRED_POINTS - Math.min(points.length, REQUIRED_POINTS) === 1 ? "" : "s"}`,
        ready,
      },
    ],
    overlays: [
      ...getPlacedPoints(state).map((point, index) => ({
        id: `tangent-arc-point-${index}`,
        kind: "anchor" as const,
        label: `Point ${index + 1}`,
        point,
      })),
      ...(points.at(-1)
        ? [
            {
              id: "tangent-arc-cue",
              kind: "completionCue" as const,
              label: ready ? "Accept arc" : "Add point",
              point: points.at(-1)!,
              ready,
            },
          ]
        : []),
    ],
    validation,
  };
}

export const tangentArcSketchToolDefinition: SketchToolDefinition<"tangentArc"> =
  {
    metadata: {
      id: "tangentArc",
      group: "drawing",
      name: "Tangent Arc",
      tooltip: "Create an arc tangent to a picked direction or source curve.",
      icon: "circle",
      modes: ["sketch"],
    },
    activate() {
      const state = {
        status: "idle",
        pointerDownPoint: null,
        livePoint: null,
        placedPoints: [],
        validationMessage: null,
      } satisfies SketchToolRuntimeState;

      return {
        state,
        stagedEntities: [],
        presentation: buildTangentArcPresentation(state),
      };
    },
    pointerMove({ state, point }) {
      const nextState = { ...state, livePoint: point };
      const previewPoints =
        point && state.status === "drawing"
          ? [...getPlacedPoints(state), point]
          : getPlacedPoints(state);

      return {
        state: nextState,
        stagedEntities: buildTangentArcPreview(previewPoints),
        presentation: buildTangentArcPresentation(nextState),
      };
    },
    pointerRelease({ state, point }) {
      if (!point) {
        return {
          state,
          stagedEntities: buildTangentArcPreview(getPlacedPoints(state)),
          presentation: buildTangentArcPresentation(state),
        };
      }

      const nextPoints = [...getPlacedPoints(state), point];
      const validation = validateTangentArc(nextPoints);
      const complete = nextPoints.length >= REQUIRED_POINTS && validation.valid;
      const nextState = {
        status: complete ? "idle" : "drawing",
        pointerDownPoint: nextPoints[0] ?? point,
        livePoint: point,
        placedPoints: nextPoints,
        validationMessage:
          complete || nextPoints.length < REQUIRED_POINTS
            ? null
            : validation.message,
      } satisfies SketchToolRuntimeState;

      return {
        state: nextState,
        stagedEntities: complete ? [] : buildTangentArcPreview(nextPoints),
        presentation: buildTangentArcPresentation(nextState),
      };
    },
    getStagedEntities(state) {
      const points =
        state.livePoint && state.status === "drawing"
          ? [...getPlacedPoints(state), state.livePoint]
          : getPlacedPoints(state);

      return buildTangentArcPreview(points);
    },
    validate(start, end) {
      return validateTangentArc([start, end]);
    },
    getPresentation: buildTangentArcPresentation,
    createCommitContribution({
      sequence,
      points,
      acceptedSnaps,
      factories,
    }): SketchToolCommitContribution {
      const arcPoints = (points ?? []).slice(0, REQUIRED_POINTS);
      const circle =
        arcPoints.length === REQUIRED_POINTS
          ? getTangentArcCircle(arcPoints[0]!, arcPoints[1]!, arcPoints[2]!)
          : null;
      if (!circle) {
        return { points: [], entities: [] };
      }

      const centerPointId = factories.createPointId("tangent-arc-center");
      const startPointId = factories.createPointId("tangent-arc-start");
      const endPointId = factories.createPointId("tangent-arc-end");
      const entityId = factories.createEntityId("tangent-arc");
      const tangentSourceEntityId = getLocalTangentSourceEntityId(
        acceptedSnaps?.start ?? null,
      );

      return {
        points: [
          factories.createPoint(
            `Tangent arc ${sequence} center`,
            centerPointId,
            circle.center,
          ),
          factories.createPoint(
            `Tangent arc ${sequence} start`,
            startPointId,
            arcPoints[0]!,
          ),
          factories.createPoint(
            `Tangent arc ${sequence} end`,
            endPointId,
            arcPoints[2]!,
          ),
        ],
        entities: [
          factories.createArcEntity(
            `Tangent arc ${sequence}`,
            entityId,
            centerPointId,
            startPointId,
            endPointId,
            circle.sweepDirection,
          ),
        ],
        constraints: [
          ...(tangentSourceEntityId
            ? [
                createTangentConstraint({
                  constraintId:
                    factories.createConstraintId("tangent-arc-source"),
                  label: `Tangent arc ${sequence} tangent`,
                  entityIds: [entityId, tangentSourceEntityId],
                }),
                createPointOnCurveConstraint({
                  constraintId: factories.createConstraintId(
                    "tangent-arc-start-on-source",
                  ),
                  label: `Tangent arc ${sequence} start on source`,
                  pointId: startPointId,
                  curveEntityId: tangentSourceEntityId,
                }),
              ]
            : []),
        ],
        dimensions: createArcEndpointDimensions({
          createDimensionId: factories.createDimensionId,
          labelPrefix: `Tangent arc ${sequence}`,
          entityId,
          startPointId,
          endPointId,
        }),
      };
    },
  };

function getLocalTangentSourceEntityId(candidate: SketchSnapCandidate | null) {
  const source = candidate?.sources.find(
    (entry) =>
      entry.kind === "localEntity" &&
      (entry.geometryKind === "lineSegment" ||
        entry.geometryKind === "circle" ||
        entry.geometryKind === "arc"),
  );

  return source?.kind === "localEntity" ? source.entityId : null;
}
