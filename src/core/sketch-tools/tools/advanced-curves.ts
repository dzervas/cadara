import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDraftEntity,
  SketchToolCommitContribution,
  SketchToolDefinition,
  SketchToolRuntimeState,
  SketchToolValidationResult,
} from "@/core/sketch-tools/definition";
import type {
  SketchToolControlValue,
  SketchToolPresentationSchema,
} from "@/core/sketch-tools/editor-schema";
import {
  addPoints,
  dotPoints,
  normalizePoint,
  perpendicularLeft,
  pointsDistinct,
  scalePoint,
  subtractPoints,
} from "@/core/sketch-tools/geometry";
import { distanceBetween } from "@/core/sketch-tools/shared";

const EPSILON = 0.0001;
const ADVANCED_SAMPLE_COUNT = 64;

type FixedPointToolConfig = {
  id: string;
  name: string;
  requiredPointCount: number;
  prompt: string;
  readyPrompt: string;
  cursorLabel: string;
  validate(
    points: readonly SketchPoint[],
    state: SketchToolRuntimeState,
  ): SketchToolValidationResult;
  buildPreview(
    points: readonly SketchPoint[],
    state: SketchToolRuntimeState,
  ): readonly SketchDraftEntity[];
  createCommitContribution(input: {
    sequence: number;
    points: readonly SketchPoint[];
    state: SketchToolRuntimeState;
    factories: Parameters<
      SketchToolDefinition["createCommitContribution"]
    >[0]["factories"];
  }): SketchToolCommitContribution;
  controls?(
    state: SketchToolRuntimeState,
  ): SketchToolPresentationSchema["controls"];
};

function getPlacedPoints(
  state: SketchToolRuntimeState,
): readonly SketchPoint[] {
  return state.placedPoints ?? [];
}

function getPreviewPoints(state: SketchToolRuntimeState) {
  return state.livePoint && state.status === "drawing"
    ? [...getPlacedPoints(state), state.livePoint]
    : getPlacedPoints(state);
}

function advanceFixedPointTool(
  state: SketchToolRuntimeState,
  point: SketchPoint | null,
  config: FixedPointToolConfig,
) {
  if (!point) {
    return {
      state,
      stagedEntities: config.buildPreview(getPreviewPoints(state), state),
      presentation: buildFixedPointPresentation(state, config),
    };
  }

  const placedPoints = getPlacedPoints(state);
  const candidatePoints = [...placedPoints, point];
  const validation =
    candidatePoints.length >= config.requiredPointCount
      ? config.validate(candidatePoints, state)
      : { valid: false, message: null };

  if (
    candidatePoints.length >= config.requiredPointCount &&
    !validation.valid
  ) {
    const nextState = {
      ...state,
      status: "drawing",
      livePoint: point,
      validationMessage: validation.message,
    } satisfies SketchToolRuntimeState;

    return {
      state: nextState,
      stagedEntities: config.buildPreview(
        getPreviewPoints(nextState),
        nextState,
      ),
      presentation: buildFixedPointPresentation(nextState, config),
    };
  }

  const complete = candidatePoints.length >= config.requiredPointCount;
  const nextState = {
    status: complete ? "idle" : "drawing",
    pointerDownPoint: candidatePoints[0] ?? point,
    livePoint: point,
    placedPoints: candidatePoints,
    settings: state.settings,
    validationMessage: null,
  } satisfies SketchToolRuntimeState;

  return {
    state: nextState,
    stagedEntities: complete
      ? []
      : config.buildPreview(candidatePoints, nextState),
    presentation: buildFixedPointPresentation(nextState, config),
  };
}

function buildFixedPointPresentation(
  state: SketchToolRuntimeState,
  config: FixedPointToolConfig,
): SketchToolPresentationSchema {
  const points = getPreviewPoints(state);
  const validation = state.validationMessage
    ? [
        {
          id: `${config.id}-validation`,
          message: state.validationMessage,
          severity: "error" as const,
        },
      ]
    : [];
  const ready =
    points.length >= config.requiredPointCount &&
    config.validate(points, state).valid;
  const remaining = Math.max(config.requiredPointCount - points.length, 0);

  return {
    prompts: [
      {
        id: `${config.id}-prompt`,
        text: ready ? config.readyPrompt : config.prompt,
        tone: validation.length > 0 ? "warning" : "neutral",
      },
    ],
    steps: [
      {
        id: `${config.id}-step`,
        label: `${Math.min(points.length, config.requiredPointCount)}/${config.requiredPointCount} points`,
      },
    ],
    cursor: {
      id: `${config.id}-cursor`,
      label: config.cursorLabel,
      icon: "crosshair",
    },
    controls: config.controls?.(state),
    completionHints: [
      {
        id: `${config.id}-completion`,
        text: ready
          ? `Click to accept ${config.name.toLowerCase()}`
          : `Place ${remaining} more point${remaining === 1 ? "" : "s"}`,
        ready,
      },
    ],
    overlays: getPlacedPoints(state).map((point, index) => ({
      id: `${config.id}-point-${index}`,
      kind: "anchor" as const,
      label: `Point ${index + 1}`,
      point,
    })),
    validation,
    extension: {
      id: `${config.id}-workflow`,
      payload: {
        pointCount: points.length,
        requiredPointCount: config.requiredPointCount,
        readyToComplete: ready,
      },
    },
  };
}

function createFixedPointTool<
  TToolId extends SketchToolDefinition["metadata"]["id"],
>(
  metadata: SketchToolDefinition<TToolId>["metadata"],
  config: FixedPointToolConfig,
): SketchToolDefinition<TToolId> {
  return {
    metadata,
    activate() {
      const state = {
        status: "idle",
        pointerDownPoint: null,
        livePoint: null,
        placedPoints: [],
        settings: {},
        validationMessage: null,
      } satisfies SketchToolRuntimeState;

      return {
        state,
        stagedEntities: [],
        presentation: buildFixedPointPresentation(state, config),
      };
    },
    pointerMove({ state, point }) {
      const nextState = { ...state, livePoint: point };
      return {
        state: nextState,
        stagedEntities: config.buildPreview(
          getPreviewPoints(nextState),
          nextState,
        ),
        presentation: buildFixedPointPresentation(nextState, config),
      };
    },
    pointerRelease({ state, point }) {
      return advanceFixedPointTool(state, point, config);
    },
    getStagedEntities(state) {
      return config.buildPreview(getPreviewPoints(state), state);
    },
    validate(start, end) {
      return config.validate([start, end], {
        status: "drawing",
        pointerDownPoint: start,
        livePoint: end,
        placedPoints: [start, end],
        settings: {},
        validationMessage: null,
      });
    },
    getPresentation(state) {
      return buildFixedPointPresentation(state, config);
    },
    createCommitContribution({ sequence, points, settings, factories }) {
      return config.createCommitContribution({
        sequence,
        points: points ?? [],
        state: {
          status: "idle",
          pointerDownPoint: null,
          livePoint: null,
          placedPoints: points ?? [],
          settings: settings ?? {},
          validationMessage: null,
        },
        factories,
      });
    },
  };
}

function minorRadiusFromPoint(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorPoint: SketchPoint,
) {
  const majorUnit = normalizePoint(subtractPoints(majorAxisEndpoint, center));
  if (!majorUnit) {
    return 0;
  }

  const minorUnit = perpendicularLeft(majorUnit);
  return Math.abs(dotPoints(subtractPoints(minorPoint, center), minorUnit));
}

function sampleEllipsePoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorRadius: number,
) {
  const major = subtractPoints(majorAxisEndpoint, center);
  const majorRadius = Math.hypot(major[0], major[1]);
  const majorUnit = normalizePoint(major);
  if (!majorUnit || majorRadius <= EPSILON || minorRadius <= EPSILON) {
    return [];
  }

  const minorUnit = perpendicularLeft(majorUnit);
  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const angle = (Math.PI * 2 * index) / ADVANCED_SAMPLE_COUNT;
    return addPoints(
      center,
      addPoints(
        scalePoint(majorUnit, Math.cos(angle) * majorRadius),
        scalePoint(minorUnit, Math.sin(angle) * minorRadius),
      ),
    );
  });
}

function normalizeAngle(angle: number) {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

function sweepBetween(
  startAngle: number,
  endAngle: number,
  direction: "clockwise" | "counterClockwise",
) {
  const start = normalizeAngle(startAngle);
  const end = normalizeAngle(endAngle);
  if (direction === "counterClockwise") {
    return end >= start ? end - start : end + Math.PI * 2 - start;
  }
  return end <= start ? start - end : start + Math.PI * 2 - end;
}

function sampleEllipticalArcPoints(
  center: SketchPoint,
  majorAxisEndpoint: SketchPoint,
  minorRadius: number,
  start: SketchPoint,
  end: SketchPoint,
  direction: "clockwise" | "counterClockwise",
) {
  const major = subtractPoints(majorAxisEndpoint, center);
  const majorRadius = Math.hypot(major[0], major[1]);
  const majorUnit = normalizePoint(major);
  if (!majorUnit || majorRadius <= EPSILON || minorRadius <= EPSILON) {
    return [];
  }

  const minorUnit = perpendicularLeft(majorUnit);
  const ellipseAngle = (point: SketchPoint) => {
    const delta = subtractPoints(point, center);
    return Math.atan2(
      dotPoints(delta, minorUnit) / minorRadius,
      dotPoints(delta, majorUnit) / majorRadius,
    );
  };
  const startAngle = ellipseAngle(start);
  const sweep = sweepBetween(startAngle, ellipseAngle(end), direction);

  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1);
    const angle =
      direction === "counterClockwise"
        ? startAngle + sweep * t
        : startAngle - sweep * t;
    return addPoints(
      center,
      addPoints(
        scalePoint(majorUnit, Math.cos(angle) * majorRadius),
        scalePoint(minorUnit, Math.sin(angle) * minorRadius),
      ),
    );
  });
}

function sampleConicPoints(
  start: SketchPoint,
  control: SketchPoint,
  end: SketchPoint,
  rho: number,
) {
  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1);
    const oneMinusT = 1 - t;
    const startWeight = oneMinusT * oneMinusT;
    const controlWeight = 2 * rho * oneMinusT * t;
    const endWeight = t * t;
    const weight = startWeight + controlWeight + endWeight;
    return [
      (startWeight * start[0] +
        controlWeight * control[0] +
        endWeight * end[0]) /
        weight,
      (startWeight * start[1] +
        controlWeight * control[1] +
        endWeight * end[1]) /
        weight,
    ] satisfies SketchPoint;
  });
}

function sampleBezierPoints(controlPoints: readonly SketchPoint[]) {
  return Array.from({ length: ADVANCED_SAMPLE_COUNT }, (_, index) => {
    const t = index / (ADVANCED_SAMPLE_COUNT - 1);
    const oneMinusT = 1 - t;
    const [p0, p1, p2, p3] = controlPoints;
    return [
      oneMinusT ** 3 * p0![0] +
        3 * oneMinusT * oneMinusT * t * p1![0] +
        3 * oneMinusT * t * t * p2![0] +
        t ** 3 * p3![0],
      oneMinusT ** 3 * p0![1] +
        3 * oneMinusT * oneMinusT * t * p1![1] +
        3 * oneMinusT * t * t * p2![1] +
        t ** 3 * p3![1],
    ] satisfies SketchPoint;
  });
}

function getSetting(
  state: SketchToolRuntimeState,
  key: string,
  fallback: SketchToolControlValue,
) {
  return state.settings?.[key] ?? fallback;
}

function getProfileText(state: SketchToolRuntimeState) {
  const value = getSetting(state, "text", "Text");
  return typeof value === "string" ? value : "Text";
}

function getHorizontalAlign(
  state: SketchToolRuntimeState,
): "left" | "center" | "right" {
  const value = getSetting(state, "horizontalAlign", "left");
  return value === "center" || value === "right" ? value : "left";
}

function getVerticalAlign(
  state: SketchToolRuntimeState,
): "baseline" | "middle" | "top" | "bottom" {
  const value = getSetting(state, "verticalAlign", "baseline");
  return value === "middle" || value === "top" || value === "bottom"
    ? value
    : "baseline";
}

function sampleProfileTextOutline(
  state: SketchToolRuntimeState,
  anchor: SketchPoint,
  heightPoint: SketchPoint,
) {
  const text = getProfileText(state).trim();
  const height = distanceBetween(anchor, heightPoint);
  const width = Math.max(height * 0.6, text.length * height * 0.6);
  const horizontalAlign = getHorizontalAlign(state);
  const verticalAlign = getVerticalAlign(state);
  const x =
    horizontalAlign === "center"
      ? -width / 2
      : horizontalAlign === "right"
        ? -width
        : 0;
  const y =
    verticalAlign === "middle"
      ? -height / 2
      : verticalAlign === "top"
        ? -height
        : verticalAlign === "baseline"
          ? -height * 0.2
          : 0;
  const angle = Math.atan2(
    heightPoint[1] - anchor[1],
    heightPoint[0] - anchor[0],
  );
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(
    (point) =>
      [
        anchor[0] + point[0]! * cos - point[1]! * sin,
        anchor[1] + point[0]! * sin + point[1]! * cos,
      ] satisfies SketchPoint,
  );
}

function distinctPoints(points: readonly SketchPoint[]) {
  return points.every((point, index) =>
    points.slice(index + 1).every((other) => pointsDistinct(point, other)),
  );
}

function pointPolylinePreview(
  id: string,
  label: string,
  points: readonly SketchPoint[],
  isClosed = false,
): readonly SketchDraftEntity[] {
  return points.length >= 2
    ? [
        {
          id,
          kind: "polyline",
          points,
          isClosed,
          entityId: null,
          status: "preview",
          label,
          isConstruction: false,
        },
      ]
    : [];
}

function controlLines(points: readonly SketchPoint[], prefix: string) {
  return points.slice(0, -1).map((point, index) => ({
    id: `${prefix}-control-${index}`,
    kind: "line" as const,
    start: point,
    end: points[index + 1]!,
    entityId: null,
    status: "preview" as const,
    label: "Control polygon",
    isConstruction: true,
  }));
}

export const ellipseSketchToolDefinition = createFixedPointTool(
  {
    id: "ellipse",
    group: "drawing",
    name: "Ellipse",
    tooltip: "Create an ellipse from center, major radius, and minor radius.",
    icon: "ellipse",
    modes: ["sketch"],
    dropdown: {
      familyId: "advanced-curve-family",
      variantIds: ["ellipse", "ellipticalArc", "conic", "bezierCurve"],
    },
  },
  {
    id: "ellipse",
    name: "Ellipse",
    requiredPointCount: 3,
    prompt: "Pick ellipse points",
    readyPrompt: "Place ellipse",
    cursorLabel: "Ellipse point",
    validate(points) {
      if (points.length < 3) {
        return {
          valid: false,
          message:
            "Ellipse requires center, major axis, and minor radius points.",
        };
      }
      const minorRadius = minorRadiusFromPoint(
        points[0]!,
        points[1]!,
        points[2]!,
      );
      return pointsDistinct(points[0]!, points[1]!) && minorRadius > EPSILON
        ? { valid: true, message: null }
        : {
            valid: false,
            message: "Ellipse requires non-zero major and minor radii.",
          };
    },
    buildPreview(points) {
      if (points.length < 2) {
        return [];
      }
      if (points.length === 2) {
        return [
          {
            id: "preview-ellipse-major-axis",
            kind: "line",
            start: points[0]!,
            end: points[1]!,
            entityId: null,
            status: "preview",
            label: "Ellipse major axis",
            isConstruction: true,
          },
        ];
      }
      return pointPolylinePreview(
        "preview-ellipse",
        "Ellipse preview",
        sampleEllipsePoints(
          points[0]!,
          points[1]!,
          minorRadiusFromPoint(points[0]!, points[1]!, points[2]!),
        ),
        true,
      );
    },
    createCommitContribution({ sequence, points, factories }) {
      const centerPointId = factories.createPointId("ellipse-center");
      const majorPointId = factories.createPointId("ellipse-major");
      const entityId = factories.createEntityId("ellipse");
      return {
        points: [
          factories.createPoint(
            `Ellipse ${sequence} center`,
            centerPointId,
            points[0]!,
          ),
          factories.createPoint(
            `Ellipse ${sequence} major`,
            majorPointId,
            points[1]!,
          ),
        ],
        entities: [
          factories.createEllipseEntity(
            `Ellipse ${sequence}`,
            entityId,
            centerPointId,
            majorPointId,
            minorRadiusFromPoint(points[0]!, points[1]!, points[2]!),
          ),
        ],
      };
    },
  },
);

export const ellipticalArcSketchToolDefinition = createFixedPointTool(
  {
    id: "ellipticalArc",
    group: "drawing",
    name: "Elliptical Arc",
    tooltip: "Create an elliptical arc from center, axes, and endpoints.",
    icon: "ellipticalArc",
    modes: ["sketch"],
  },
  {
    id: "elliptical-arc",
    name: "Elliptical Arc",
    requiredPointCount: 5,
    prompt: "Pick elliptical arc points",
    readyPrompt: "Place elliptical arc",
    cursorLabel: "Elliptical arc point",
    validate(points) {
      if (points.length < 5) {
        return {
          valid: false,
          message:
            "Elliptical arc requires center, major, minor, start, and end points.",
        };
      }
      const minorRadius = minorRadiusFromPoint(
        points[0]!,
        points[1]!,
        points[2]!,
      );
      return pointsDistinct(points[0]!, points[1]!) &&
        pointsDistinct(points[3]!, points[4]!) &&
        minorRadius > EPSILON
        ? { valid: true, message: null }
        : {
            valid: false,
            message:
              "Elliptical arc requires non-zero axes and distinct start/end points.",
          };
    },
    buildPreview(points) {
      if (points.length < 3) {
        return points.length === 2
          ? [
              {
                id: "preview-elliptical-arc-major-axis",
                kind: "line",
                start: points[0]!,
                end: points[1]!,
                entityId: null,
                status: "preview",
                label: "Elliptical arc major axis",
                isConstruction: true,
              },
            ]
          : [];
      }
      if (points.length < 5) {
        return pointPolylinePreview(
          "preview-elliptical-arc-ellipse",
          "Elliptical arc ellipse preview",
          sampleEllipsePoints(
            points[0]!,
            points[1]!,
            minorRadiusFromPoint(points[0]!, points[1]!, points[2]!),
          ),
          true,
        );
      }
      return pointPolylinePreview(
        "preview-elliptical-arc",
        "Elliptical arc preview",
        sampleEllipticalArcPoints(
          points[0]!,
          points[1]!,
          minorRadiusFromPoint(points[0]!, points[1]!, points[2]!),
          points[3]!,
          points[4]!,
          "counterClockwise",
        ),
      );
    },
    createCommitContribution({ sequence, points, factories }) {
      const centerPointId = factories.createPointId("elliptical-arc-center");
      const majorPointId = factories.createPointId("elliptical-arc-major");
      const startPointId = factories.createPointId("elliptical-arc-start");
      const endPointId = factories.createPointId("elliptical-arc-end");
      const entityId = factories.createEntityId("elliptical-arc");
      return {
        points: [
          factories.createPoint(
            `Elliptical arc ${sequence} center`,
            centerPointId,
            points[0]!,
          ),
          factories.createPoint(
            `Elliptical arc ${sequence} major`,
            majorPointId,
            points[1]!,
          ),
          factories.createPoint(
            `Elliptical arc ${sequence} start`,
            startPointId,
            points[3]!,
          ),
          factories.createPoint(
            `Elliptical arc ${sequence} end`,
            endPointId,
            points[4]!,
          ),
        ],
        entities: [
          factories.createEllipticalArcEntity(
            `Elliptical arc ${sequence}`,
            entityId,
            centerPointId,
            majorPointId,
            startPointId,
            endPointId,
            minorRadiusFromPoint(points[0]!, points[1]!, points[2]!),
            "counterClockwise",
          ),
        ],
      };
    },
  },
);

export const conicSketchToolDefinition = createFixedPointTool(
  {
    id: "conic",
    group: "drawing",
    name: "Conic",
    tooltip: "Create a conic from start, control, and end points.",
    icon: "conic",
    modes: ["sketch"],
  },
  {
    id: "conic",
    name: "Conic",
    requiredPointCount: 3,
    prompt: "Pick conic points",
    readyPrompt: "Place conic",
    cursorLabel: "Conic point",
    validate(points) {
      return points.length >= 3 && distinctPoints(points.slice(0, 3))
        ? { valid: true, message: null }
        : {
            valid: false,
            message: "Conic requires three distinct defining points.",
          };
    },
    buildPreview(points) {
      return points.length < 3
        ? controlLines(points, "preview-conic")
        : [
            ...controlLines(points, "preview-conic"),
            ...pointPolylinePreview(
              "preview-conic",
              "Conic preview",
              sampleConicPoints(points[0]!, points[1]!, points[2]!, 0.5),
            ),
          ];
    },
    createCommitContribution({ sequence, points, factories }) {
      const startPointId = factories.createPointId("conic-start");
      const controlPointId = factories.createPointId("conic-control");
      const endPointId = factories.createPointId("conic-end");
      const entityId = factories.createEntityId("conic");
      return {
        points: [
          factories.createPoint(
            `Conic ${sequence} start`,
            startPointId,
            points[0]!,
          ),
          factories.createPoint(
            `Conic ${sequence} control`,
            controlPointId,
            points[1]!,
          ),
          factories.createPoint(
            `Conic ${sequence} end`,
            endPointId,
            points[2]!,
          ),
        ],
        entities: [
          factories.createConicEntity(
            `Conic ${sequence}`,
            entityId,
            startPointId,
            controlPointId,
            endPointId,
            0.5,
          ),
        ],
      };
    },
  },
);

export const bezierCurveSketchToolDefinition = createFixedPointTool(
  {
    id: "bezierCurve",
    group: "drawing",
    name: "Bezier",
    tooltip: "Create a cubic Bezier curve from four control points.",
    icon: "bezierCurve",
    modes: ["sketch"],
  },
  {
    id: "bezier",
    name: "Bezier",
    requiredPointCount: 4,
    prompt: "Pick Bezier control points",
    readyPrompt: "Place Bezier curve",
    cursorLabel: "Bezier control point",
    validate(points) {
      return points.length >= 4 && distinctPoints(points.slice(0, 4))
        ? { valid: true, message: null }
        : {
            valid: false,
            message: "Bezier curve requires four distinct control points.",
          };
    },
    buildPreview(points) {
      return points.length < 4
        ? controlLines(points, "preview-bezier")
        : [
            ...controlLines(points, "preview-bezier"),
            ...pointPolylinePreview(
              "preview-bezier",
              "Bezier preview",
              sampleBezierPoints(points.slice(0, 4)),
            ),
          ];
    },
    createCommitContribution({ sequence, points, factories }) {
      const pointIds = points
        .slice(0, 4)
        .map((_, index) =>
          factories.createPointId(`bezier-control-${index + 1}`),
        );
      const entityId = factories.createEntityId("bezier");
      return {
        points: points
          .slice(0, 4)
          .map((point, index) =>
            factories.createPoint(
              `Bezier ${sequence} control ${index + 1}`,
              pointIds[index]!,
              point,
            ),
          ),
        entities: [
          factories.createBezierCurveEntity(
            `Bezier ${sequence}`,
            entityId,
            pointIds,
            3,
          ),
        ],
      };
    },
  },
);

export const controlPointSplineSketchToolDefinition = createFixedPointTool(
  {
    id: "controlPointSpline",
    group: "drawing",
    name: "Control Spline",
    tooltip:
      "Create a spline from control points without changing fit-point spline behavior.",
    icon: "controlPointSpline",
    modes: ["sketch"],
  },
  {
    id: "control-point-spline",
    name: "Control Spline",
    requiredPointCount: 4,
    prompt: "Pick spline control points",
    readyPrompt: "Place control-point spline",
    cursorLabel: "Spline control point",
    validate(points) {
      return points.length >= 4 && distinctPoints(points.slice(0, 4))
        ? { valid: true, message: null }
        : {
            valid: false,
            message: "Control-point spline requires four distinct points.",
          };
    },
    buildPreview(points) {
      return points.length < 2
        ? []
        : [
            ...controlLines(points, "preview-control-spline"),
            {
              id: "preview-control-spline",
              kind: "spline",
              points,
              entityId: null,
              status: "preview",
              label: "Control-point spline preview",
              isConstruction: false,
            },
          ];
    },
    createCommitContribution({ sequence, points, factories }) {
      const pointIds = points
        .slice(0, 4)
        .map((_, index) =>
          factories.createPointId(`control-spline-${index + 1}`),
        );
      const entityId = factories.createEntityId("control-spline");
      return {
        points: points
          .slice(0, 4)
          .map((point, index) =>
            factories.createPoint(
              `Control spline ${sequence} point ${index + 1}`,
              pointIds[index]!,
              point,
            ),
          ),
        entities: [
          factories.createSplineEntity(
            `Control spline ${sequence}`,
            entityId,
            pointIds,
            3,
          ),
        ],
      };
    },
  },
);

export const profileTextSketchToolDefinition = createFixedPointTool(
  {
    id: "profileText",
    group: "drawing",
    name: "Text",
    tooltip: "Create profile-generating sketch text.",
    icon: "profileText",
    modes: ["sketch"],
  },
  {
    id: "profile-text",
    name: "Text",
    requiredPointCount: 2,
    prompt: "Pick text anchor and height",
    readyPrompt: "Place text",
    cursorLabel: "Text point",
    controls(state) {
      return [
        {
          id: "profile-text-content",
          kind: "text",
          label: "Text",
          value: getProfileText(state),
          placeholder: "Text",
          action: {
            type: "patch",
            patch: { intent: "setToolSetting", key: "text" },
          },
        },
        {
          id: "profile-text-horizontal-align",
          kind: "option",
          label: "Horizontal",
          value: getHorizontalAlign(state),
          options: [
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ],
          action: {
            type: "patch",
            patch: { intent: "setToolSetting", key: "horizontalAlign" },
          },
        },
        {
          id: "profile-text-vertical-align",
          kind: "option",
          label: "Vertical",
          value: getVerticalAlign(state),
          options: [
            { value: "baseline", label: "Baseline" },
            { value: "middle", label: "Middle" },
            { value: "top", label: "Top" },
            { value: "bottom", label: "Bottom" },
          ],
          action: {
            type: "patch",
            patch: { intent: "setToolSetting", key: "verticalAlign" },
          },
        },
      ];
    },
    validate(points, state) {
      if (getProfileText(state).trim().length === 0) {
        return { valid: false, message: "Text content is required." };
      }
      return points.length >= 2 &&
        distanceBetween(points[0]!, points[1]!) > EPSILON
        ? { valid: true, message: null }
        : { valid: false, message: "Text height must be greater than zero." };
    },
    buildPreview(points, state) {
      return points.length >= 2
        ? pointPolylinePreview(
            "preview-profile-text",
            "Text preview",
            sampleProfileTextOutline(state, points[0]!, points[1]!),
            true,
          )
        : [];
    },
    createCommitContribution({ sequence, points, state, factories }) {
      const anchorPointId = factories.createPointId("text-anchor");
      const entityId = factories.createEntityId("text");
      const anchor = points[0]!;
      const heightPoint = points[1]!;
      return {
        points: [
          factories.createPoint(
            `Text ${sequence} anchor`,
            anchorPointId,
            anchor,
          ),
        ],
        entities: [
          factories.createProfileTextEntity(
            `Text ${sequence}`,
            entityId,
            anchorPointId,
            getProfileText(state).trim(),
            distanceBetween(anchor, heightPoint),
            Math.atan2(heightPoint[1] - anchor[1], heightPoint[0] - anchor[0]),
            getHorizontalAlign(state),
            getVerticalAlign(state),
          ),
        ],
      };
    },
  },
);
