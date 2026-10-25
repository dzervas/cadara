import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolDrawContribution,
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

const REQUIRED_POINTS = 2;

// The browser stores only the two real placements. Semantic callers can still
// provide the explicit start/direction/end geometry contract.
function geometryPoints(state: SketchToolRuntimeState): readonly SketchPoint[] {
  const points = state.livePoint && state.status === "drawing"
    ? [...getPlacedPoints(state), state.livePoint] : getPlacedPoints(state);
  const start = points[0];
  const x = state.settings?.tangentDirectionX;
  const y = state.settings?.tangentDirectionY;
  return start && typeof x === "number" && typeof y === "number" && points[1]
    ? [start, [start[0] + x, start[1] + y], points[1]] : [];
}

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

export function validateTangentArc(
  points: readonly SketchPoint[],
): SketchToolValidationResult {
  if (points.length < 3) {
    return {
      valid: false,
      message: "Pick a curve end, then place the arc end.",
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
  const points = getPlacedPoints(state);
  const validation = state.validationMessage
    ? [
        {
          id: "tangent-arc-validation",
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];
  const ready = validateTangentArc(geometryPoints(state)).valid;

  return {
    prompts: [
      {
        id: "tangent-arc-prompt",
        text:
          points.length < 1
            ? "Pick a curve end"
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
          : (points.length === 0 ? "Click a line, arc or spline endpoint" : "Click to place the arc end"),
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
              point: state.status === "drawing" ? state.livePoint ?? points.at(-1)! : points.at(-1)!,
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
      tooltip: "Start on a curve endpoint, then place the tangent arc end.",
      icon: "tangentArc",
      modes: ["sketch"],
    },
    lifecycle: "discrete",
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
      const nextState = { ...state, livePoint: point, validationMessage: null };
      return {
        state: nextState,
        stagedEntities: buildTangentArcPreview(geometryPoints(nextState)),
        presentation: buildTangentArcPresentation(nextState),
      };
    },
    pointerRelease({ state, point, tangentSource }) {
      if (!point) return { state, stagedEntities: [], presentation: buildTangentArcPresentation(state) };
      if (getPlacedPoints(state).length === 0) {
        const nextState: SketchToolRuntimeState = tangentSource ? {
          ...state, status: "drawing", pointerDownPoint: point, livePoint: null,
          placedPoints: [point], validationMessage: null,
          settings: { ...state.settings, tangentDirectionX: tangentSource.direction[0], tangentDirectionY: tangentSource.direction[1],
            ...(tangentSource.center ? { tangentSourceCenterX: tangentSource.center[0], tangentSourceCenterY: tangentSource.center[1] } : {}),
          },
        } : { ...state, validationMessage: "Pick a curve end (line, arc or spline)." };
        return { state: nextState, stagedEntities: [], presentation: buildTangentArcPresentation(nextState) };
      }
      const validation = validateTangentArc(geometryPoints({ ...state, livePoint: point }));
      const nextState: SketchToolRuntimeState = validation.valid ? {
        ...state, status: "idle", livePoint: point,
        placedPoints: [getPlacedPoints(state)[0]!, point], validationMessage: null,
      } : { ...state, livePoint: point, validationMessage: validation.message };
      return { state: nextState, stagedEntities: [], presentation: buildTangentArcPresentation(nextState) };
    },
    getStagedEntities(state) {
      return buildTangentArcPreview(geometryPoints(state));
    },
    validate(start, end) {
      return validateTangentArc([start, end]);
    },
    getPresentation: buildTangentArcPresentation,
    placementRole: () => "point",
    structuralTangentSource: true,
    createCommitContribution({
      sequence,
      points,
      tangentSourceEntityId,
      settings,
      factories,
    }): SketchToolDrawContribution {
      const start = points?.[0];
      const x = settings?.tangentDirectionX, y = settings?.tangentDirectionY;
      const arcPoints = start && points?.length === 2 && typeof x === "number" && typeof y === "number"
        ? [start, [start[0] + x, start[1] + y] as SketchPoint, points[1]!]
        : (points ?? []).slice(0, 3);
      const circle =
        arcPoints.length === 3
          ? getTangentArcCircle(arcPoints[0]!, arcPoints[1]!, arcPoints[2]!)
          : null;
      if (!circle) {
        return { points: [], entities: [], placementPointIds: [] };
      }

      const centerPointId = factories.createPointId("tangent-arc-center");
      const startPointId = factories.createPointId("tangent-arc-start");
      const endPointId = factories.createPointId("tangent-arc-end");
      const entityId = factories.createEntityId("tangent-arc");

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
          // R-7: the source recorded at the first click, never suppressed.
          ...(tangentSourceEntityId
            ? [
                createTangentConstraint({
                    constraintId: factories.createConstraintId("tangent-arc-source"),
                    label: `Tangent arc ${sequence} tangent`,
                    entityIds: [entityId, tangentSourceEntityId],
                  // Same-side radii mean internal circle tangency; forcing
                  // external tangency would move the source arc on creation.
                  relation: typeof settings?.tangentSourceCenterX === "number" && typeof settings?.tangentSourceCenterY === "number" &&
                    (arcPoints[0]![0] - circle.center[0]) * (arcPoints[0]![0] - settings.tangentSourceCenterX) +
                    (arcPoints[0]![1] - circle.center[1]) * (arcPoints[0]![1] - settings.tangentSourceCenterY) > 0
                    ? "internal" : "external",
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
        placementPointIds: points?.length === 2 ? [startPointId, endPointId] : [startPointId, null, endPointId],
      };
    },
  };
