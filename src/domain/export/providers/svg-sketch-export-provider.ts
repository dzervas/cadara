import type {
  ExportProvider,
  ExportProviderInput,
} from "@/contracts/export/provider";
import type { ExportResult } from "@/contracts/export/result";
import type {
  SketchVectorEntity,
  SketchVectorExportModel,
  SketchVectorRegion,
  SketchVectorRegionSegment,
  SketchVectorStyle,
} from "@/contracts/export/sketch-vector";
import type { DocumentExportDiagnostic } from "@/contracts/modeling/export";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export type SvgSketchExportOptions = Record<string, never>;

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(6)));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface SvgCoordinateSystem {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function formatPoint(point: SketchPoint2D, coordinates: SvgCoordinateSystem) {
  return `${formatNumber(point[0] - coordinates.minX)} ${formatNumber(point[1] - coordinates.minY)}`;
}

function arcPath(
  entity: Extract<SketchVectorEntity, { kind: "arc" }>,
  coordinates: SvgCoordinateSystem,
) {
  const startAngle = Math.atan2(
    entity.start[1] - entity.center[1],
    entity.start[0] - entity.center[0],
  );
  const endAngle = Math.atan2(
    entity.end[1] - entity.center[1],
    entity.end[0] - entity.center[0],
  );
  const rawDelta =
    entity.sweepDirection === "counterClockwise"
      ? (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2)
      : (startAngle - endAngle + Math.PI * 2) % (Math.PI * 2);
  const largeArcFlag = rawDelta > Math.PI ? 1 : 0;
  const sweepFlag = entity.sweepDirection === "counterClockwise" ? 1 : 0;

  return [
    `M ${formatPoint(entity.start, coordinates)}`,
    `A ${formatNumber(entity.radius)} ${formatNumber(entity.radius)} 0 ${largeArcFlag} ${sweepFlag} ${formatPoint(entity.end, coordinates)}`,
  ].join(" ");
}

function bezierPath(
  points: readonly SketchPoint2D[],
  degree: 2 | 3,
  coordinates: SvgCoordinateSystem,
) {
  if (degree === 3 && points.length >= 4) {
    const [start, first, second, end] = points;
    return `M ${formatPoint(start!, coordinates)} C ${formatPoint(first!, coordinates)} ${formatPoint(second!, coordinates)} ${formatPoint(end!, coordinates)}`;
  }

  const [start, control, end] = points;
  return `M ${formatPoint(start!, coordinates)} Q ${formatPoint(control!, coordinates)} ${formatPoint(end!, coordinates)}`;
}

function entityPath(
  entity: SketchVectorEntity,
  coordinates: SvgCoordinateSystem,
): string | null {
  switch (entity.kind) {
    case "lineSegment":
      return `M ${formatPoint(entity.start, coordinates)} L ${formatPoint(entity.end, coordinates)}`;
    case "circle":
      return [
        `M ${formatPoint([entity.center[0] - entity.radius, entity.center[1]], coordinates)}`,
        `A ${formatNumber(entity.radius)} ${formatNumber(entity.radius)} 0 1 0 ${formatPoint([entity.center[0] + entity.radius, entity.center[1]], coordinates)}`,
        `A ${formatNumber(entity.radius)} ${formatNumber(entity.radius)} 0 1 0 ${formatPoint([entity.center[0] - entity.radius, entity.center[1]], coordinates)}`,
      ].join(" ");
    case "arc":
      return arcPath(entity, coordinates);
    case "spline":
      if (entity.spans.length === 0) return null;
      return [
        `M ${formatPoint(entity.spans[0]![0], coordinates)}`,
        ...entity.spans.map(
          ([, first, second, end]) =>
            `C ${formatPoint(first, coordinates)} ${formatPoint(second, coordinates)} ${formatPoint(end, coordinates)}`,
        ),
      ].join(" ");
    case "bezierCurve":
      return bezierPath(entity.controlPoints, entity.degree, coordinates);
    case "conic":
      return bezierPath(
        [entity.start, entity.control, entity.end],
        2,
        coordinates,
      );
  }
}

function appendStrokeAttributes(
  attributes: string[],
  style: SketchVectorStyle | null,
) {
  const stroke = style?.stroke;
  if (!stroke) {
    attributes.push(
      'stroke="black"',
      'stroke-width="1"',
      'vector-effect="non-scaling-stroke"',
      'fill="none"',
    );
    return;
  }

  attributes.push(
    `stroke="${escapeXml(stroke.color)}"`,
    `stroke-opacity="${formatNumber(stroke.opacity)}"`,
    `stroke-width="${formatNumber(stroke.width)}"`,
    'vector-effect="non-scaling-stroke"',
    `stroke-linecap="${stroke.lineCap}"`,
    `stroke-linejoin="${stroke.lineJoin}"`,
    `stroke-miterlimit="${formatNumber(stroke.miterLimit)}"`,
    'fill="none"',
  );

  if ((stroke.dashSize ?? 0) > 0 && (stroke.gapSize ?? 0) > 0) {
    attributes.push(
      `stroke-dasharray="${formatNumber(stroke.dashSize!)} ${formatNumber(stroke.gapSize!)}"`,
    );
  }
}

function appendFillAttributes(
  attributes: string[],
  style: SketchVectorStyle | null,
  gradientId: string | null,
) {
  if (!style || style.fill.kind === "none") {
    attributes.push('fill="none"');
    return;
  }

  if (style.fill.kind === "solid") {
    attributes.push(
      `fill="${escapeXml(style.fill.color)}"`,
      `fill-opacity="${formatNumber(style.fill.opacity)}"`,
    );
    return;
  }

  attributes.push(`fill="url(#${gradientId})"`);
}

function createGradientDefinition(id: string, style: SketchVectorStyle) {
  if (style.fill.kind !== "gradient") {
    return null;
  }

  const angle = style.fill.gradient.angleRadians;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const x1 = formatNumber(50 - x * 50);
  const y1 = formatNumber(50 - y * 50);
  const x2 = formatNumber(50 + x * 50);
  const y2 = formatNumber(50 + y * 50);

  return [
    `<linearGradient id="${id}" gradientUnits="objectBoundingBox" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">`,
    `<stop offset="0%" stop-color="${escapeXml(style.fill.gradient.startColor)}" stop-opacity="${formatNumber(style.fill.gradient.startOpacity)}"/>`,
    `<stop offset="100%" stop-color="${escapeXml(style.fill.gradient.endColor)}" stop-opacity="${formatNumber(style.fill.gradient.endOpacity)}"/>`,
    "</linearGradient>",
  ].join("");
}

function entityBounds(entity: SketchVectorEntity): SketchPoint2D[] {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.start, entity.end];
    case "circle":
      return [
        [entity.center[0] - entity.radius, entity.center[1] - entity.radius],
        [entity.center[0] + entity.radius, entity.center[1] + entity.radius],
      ];
    case "arc":
      return [
        entity.start,
        entity.end,
        [entity.center[0] - entity.radius, entity.center[1] - entity.radius],
        [entity.center[0] + entity.radius, entity.center[1] + entity.radius],
      ];
    case "spline":
      return entity.spans.flatMap((span) => [...span]);
    case "bezierCurve":
      return [...entity.controlPoints];
    case "conic":
      return [entity.start, entity.control, entity.end];
  }
}

function computeCoordinateSystem(
  model: SketchVectorExportModel,
): SvgCoordinateSystem {
  const points = [
    ...model.entities.flatMap(entityBounds),
    ...model.regions.flatMap((region) =>
      region.loops.flatMap((loop) => loop.segments.flatMap(segmentBounds)),
    ),
  ];

  if (points.length === 0) {
    return { minX: 0, minY: 0, width: 1, height: 1 };
  }

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  return { minX, minY, width, height };
}

function formatViewBox(coordinates: SvgCoordinateSystem) {
  return `0 0 ${formatNumber(coordinates.width)} ${formatNumber(coordinates.height)}`;
}

function segmentBounds(segment: SketchVectorRegionSegment): SketchPoint2D[] {
  switch (segment.kind) {
    case "line":
      return [segment.start, segment.end];
    case "arc":
      // The full circle's box, like an arc entity (conservative).
      return [
        [
          segment.center[0] - segment.radius,
          segment.center[1] - segment.radius,
        ],
        [
          segment.center[0] + segment.radius,
          segment.center[1] + segment.radius,
        ],
      ];
    case "cubic":
      return [...segment.poles];
  }
}

function arcPoint(
  segment: Extract<SketchVectorRegionSegment, { kind: "arc" }>,
  angle: number,
): SketchPoint2D {
  return [
    segment.center[0] + segment.radius * Math.cos(angle),
    segment.center[1] + segment.radius * Math.sin(angle),
  ];
}

function segmentStart(segment: SketchVectorRegionSegment): SketchPoint2D {
  switch (segment.kind) {
    case "line":
      return segment.start;
    case "arc":
      return arcPoint(segment, segment.startAngle);
    case "cubic":
      return segment.poles[0];
  }
}

/**
 * The path commands of one segment from its own start (B5): a line `L`, an
 * arc `A` over its exact sub-angles, a cubic `C` with its sub-poles. An arc
 * sweeping more than π is written as two `A`s of half its sweep: one `A`
 * cannot draw a full turn, and a wrap edge [a, a + 2π] whose binary64 sweep
 * falls an ulp short of 2π would otherwise end where it starts, which SVG
 * draws as nothing (review R-1).
 */
function segmentCommands(
  segment: SketchVectorRegionSegment,
  coordinates: SvgCoordinateSystem,
): string[] {
  switch (segment.kind) {
    case "line":
      return [`L ${formatPoint(segment.end, coordinates)}`];
    case "arc": {
      const delta = segment.endAngle - segment.startAngle;
      // Sketch coordinates are written unflipped, so increasing angle is
      // SVG's positive-angle direction (sweep 1), as for arc entities.
      const sweepFlag = delta > 0 ? 1 : 0;
      const radius = formatNumber(segment.radius);
      const arc = (angle: number) =>
        `A ${radius} ${radius} 0 0 ${sweepFlag} ${formatPoint(arcPoint(segment, angle), coordinates)}`;
      return Math.abs(delta) > Math.PI
        ? [arc(segment.startAngle + delta / 2), arc(segment.endAngle)]
        : [arc(segment.endAngle)];
    }
    case "cubic": {
      const [, first, second, end] = segment.poles;
      return [
        `C ${formatPoint(first, coordinates)} ${formatPoint(second, coordinates)} ${formatPoint(end, coordinates)}`,
      ];
    }
  }
}

/**
 * One closed subpath per loop, one command run per resolved segment. Where
 * a segment does not start where the previous one ended (a declared join
 * realized within tolerance), a straight connector `L` joins them, as in the
 * owner's loop area, so every written pole stays the exact sub-pole.
 */
function regionPath(
  region: SketchVectorRegion,
  coordinates: SvgCoordinateSystem,
) {
  const commands: string[] = [];

  for (const loop of region.loops) {
    let current: string | null = null;
    for (const segment of loop.segments) {
      const start = formatPoint(segmentStart(segment), coordinates);
      if (current === null) commands.push(`M ${start}`);
      else if (current !== start) commands.push(`L ${start}`);
      const segmentPath = segmentCommands(segment, coordinates);
      commands.push(...segmentPath);
      current = segmentPath.at(-1)!.split(" ").slice(-2).join(" ");
    }
    if (current !== null) commands.push("Z");
  }

  return commands.join(" ");
}

function serializeSvg(model: SketchVectorExportModel): ExportResult {
  const diagnostics: DocumentExportDiagnostic[] = [...model.diagnostics];
  const defs: string[] = [];
  const regionElements: string[] = [];
  const entityElements: string[] = [];
  let gradientCounter = 0;
  const coordinates = computeCoordinateSystem(model);

  for (const region of model.regions) {
    const path = regionPath(region, coordinates);
    if (!path) {
      continue;
    }

    const attributes = [`data-region-id="${escapeXml(region.regionId)}"`];
    let gradientId: string | null = null;
    if (region.style?.fill.kind === "gradient") {
      gradientCounter += 1;
      gradientId = `cadara-gradient-${gradientCounter}`;
      const definition = createGradientDefinition(gradientId, region.style);
      if (definition) {
        defs.push(definition);
      }
    }
    appendFillAttributes(attributes, region.style, gradientId);
    if (region.style?.stroke) {
      appendStrokeAttributes(attributes, region.style);
    } else {
      attributes.push('stroke="none"');
    }
    regionElements.push(
      `<path d="${escapeXml(path)}" ${attributes.join(" ")}/>`,
    );
  }

  for (const entity of model.entities) {
    if (entity.isConstruction) {
      continue;
    }
    const path = entityPath(entity, coordinates);
    if (!path) {
      continue;
    }
    const attributes = [`data-entity-id="${escapeXml(entity.entityId)}"`];
    appendStrokeAttributes(attributes, entity.style);
    entityElements.push(
      `<path d="${escapeXml(path)}" ${attributes.join(" ")}/>`,
    );
  }

  if (regionElements.length === 0 && entityElements.length === 0) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "sketch-svg-empty-export",
          severity: "error",
          message:
            "SVG export could not produce any supported sketch geometry.",
          target: { kind: "sketch", sketchId: model.sketchId },
        },
        ...diagnostics,
      ],
    };
  }

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(coordinates.width)}mm" height="${formatNumber(coordinates.height)}mm" viewBox="${formatViewBox(coordinates)}" overflow="visible" data-cadara-sketch-id="${escapeXml(model.sketchId)}">`,
    defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "",
    regionElements.join(""),
    entityElements.join(""),
    "</svg>",
  ].join("");

  return { ok: true, payload: svg, diagnostics };
}

export const svgSketchExportProvider: ExportProvider<
  SvgSketchExportOptions,
  FeatureEditorFormSchema
> = {
  id: "sketch-svg",
  label: "SVG",
  formatId: "svg",
  fileExtension: "svg",
  mimeType: "image/svg+xml",
  targetKinds: ["sketch"],

  getDefaultOptions(): SvgSketchExportOptions {
    return {};
  },

  getOptionFormSchema(): FeatureEditorFormSchema {
    return { sections: [] };
  },

  applyOptionPatch(options: SvgSketchExportOptions): SvgSketchExportOptions {
    return options;
  },

  async export(
    input: ExportProviderInput<SvgSketchExportOptions>,
  ): Promise<ExportResult> {
    const result =
      await input.capabilities.sketchVector.resolveSketchVectorModel(
        input.target,
      );

    if ("diagnostic" in result) {
      return { ok: false, diagnostics: [result.diagnostic] };
    }

    return serializeSvg(result);
  },
};
